/**
 * Blindagem contra prompt-injection indireta nos campos de texto do e-Cidadania — em duas camadas
 * proporcionais à origem do texto:
 *
 *  1. **Sanitização silenciosa** (todas as entidades): os campos de texto vêm de scraping de páginas
 *     do portal (não de API). Remove caracteres de controle/invisíveis/bidi ("Trojan Source") e
 *     neutraliza cercas de código (```), sem alterar o sentido nem adicionar marcação visível.
 *     Ementas, nomes de matéria, relatores etc. são conteúdo OFICIAL do Senado — não recebem
 *     demarcação (rotulá-los como suspeitos difama o próprio dado; ver prompt-test P30).
 *
 *  2. **Demarcação explícita** (apenas `ideias`): título, descrição e autor de uma ideia legislativa
 *     são escritos por QUALQUER CIDADÃO no portal — o vetor clássico de injeção indireta ("ignore as
 *     instruções anteriores…"). Esses campos, além de sanitizados, são envolvidos em delimitadores
 *     `«texto-enviado-por-cidadao: … »`, sinalizando ao LLM cliente que o trecho é dado literal
 *     (citação), não instrução. O rótulo é factual e inócuo se verbalizado — NÃO é um juízo de
 *     qualidade; atualidade/confiabilidade do corpus é comunicada por outro canal
 *     (`meta.fonte`/`possivelDesatualizacao`).
 *
 * Tudo é aplicado na **borda de saída da tool** (quando o texto é serializado no
 * `toolResult`/`structuredContent`), NÃO no payload persistido em D1. Isso preserva a regra de
 * byte-compatibilidade dos `buildXResumo` (campos persistidos inalterados → `contentHash` estável →
 * sem inchaço de `ecidadania_history`) e mantém o corpus limpo.
 */

/** Delimitadores explícitos de "isto é texto de cidadão, dado literal — não instrução". */
export const UNTRUSTED_OPEN = "«texto-enviado-por-cidadao: ";
export const UNTRUSTED_CLOSE = " »";

/**
 * Caracteres a remover (escapes \uXXXX explícitos, para não depender de bytes invisíveis no
 * arquivo-fonte): controles C0 exceto \t, \n e \r, DEL + controles C1, zero-width + LRM/RLM,
 * embeddings/overrides bidi (LRE/RLE/PDF/LRO/RLO), isolates bidi (LRI/RLI/FSI/PDI) e BOM
 * ("Trojan Source").
 */
const STRIP_INVISIBLE = /[\u0000-\u0008\u000B-\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

/**
 * Camada 1 — sanitização silenciosa de texto raspado do portal: remove invisíveis/controles e
 * neutraliza cercas de código, preservando o conteúdo legível verbatim. Sem marcação visível.
 */
export function sanitizeScrapedText(value: string): string {
  return value
    .replace(STRIP_INVISIBLE, "")
    // Neutraliza cercas de código: ``` -> "` ` `" (quebra a sequência sem perder os caracteres).
    .replace(/```/g, "` ` `");
}

/**
 * Camada 2 — sanitiza E demarca um trecho de texto escrito por cidadão. Usado na borda de saída —
 * não é chamado duas vezes sobre o mesmo campo.
 */
export function neutralizeUntrustedText(value: string): string {
  const cleaned = sanitizeScrapedText(value)
    // Impede que o conteúdo "feche" a demarcação: elimina o glifo de fechamento `»` do conteúdo
    // (troca por `>>`), de modo que o par exato `UNTRUSTED_CLOSE` (" »") nunca apareça dentro.
    .replace(/»/g, ">>");
  return `${UNTRUSTED_OPEN}${cleaned}${UNTRUSTED_CLOSE}`;
}

type TextTransform = (value: string) => string;

/** Aplica uma transformação a um campo string, preservando `null`/`undefined`/vazio. */
function applyField(value: unknown, fn: TextTransform): unknown {
  if (typeof value !== "string" || value.length === 0) return value;
  return fn(value);
}

/** Aplica a transformação a cada string de um array (ignorando não-strings/vazias). */
function applyStringArray(value: unknown, fn: TextTransform): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((v) => (typeof v === "string" && v.length > 0 ? fn(v) : v));
}

/**
 * Campos escritos por CIDADÃOS (UGC real) — sanitizados E demarcados. Só as ideias legislativas
 * têm texto livre de cidadão nos campos expostos pelas tools.
 */
const CITIZEN_STRING_FIELDS: Record<string, readonly string[]> = {
  consultas: [],
  ideias: ["titulo", "descricao", "autor", "autorNome"],
  eventos: [],
  consultas_votos: [],
};

/**
 * Campos de texto OFICIAL raspado do portal (ementas, matérias, autoria parlamentar, relatoria,
 * pauta de eventos etc.) — apenas sanitização silenciosa, sem demarcação. Campos numéricos, status
 * normalizado, datas, ids e urls (controlados por nós) ficam de fora.
 */
const OFFICIAL_STRING_FIELDS: Record<string, readonly string[]> = {
  // `autor` is the detail-endpoint field (obter_consulta); `autoria` is the corpus/list
  // field (ConsultaResumo). Both are sanitized so no scraped name carries hidden characters.
  consultas: ["materia", "ementa", "autor", "autoria", "relator", "plConvertido"],
  ideias: ["plConvertido"],
  eventos: ["titulo", "descricao", "comissaoNomeCompleto", "local"],
  consultas_votos: ["materia", "ementa", "autoria"],
};

/** Campos oficiais que são arrays de string (tratados elemento a elemento). */
const OFFICIAL_ARRAY_FIELDS: Record<string, readonly string[]> = {
  eventos: ["pauta", "convidados"],
};

/**
 * Texto de cidadão dentro de estruturas do detalhe da ideia (fase A4): os acontecimentos da linha do
 * tempo copiam o texto da página (com o nome do autor), e um aviso cita o item não reconhecido.
 */
const CITIZEN_ARRAY_FIELDS: Record<string, readonly string[]> = { ideias: ["avisos"] };
const CITIZEN_OBJECT_ARRAY_FIELDS: Record<string, Record<string, readonly string[]>> = { ideias: { linhaDoTempo: ["texto"] } };

export type EcidadaniaEntidade = keyof typeof CITIZEN_STRING_FIELDS;

/**
 * Retorna uma CÓPIA rasa de `item` com os campos de texto tratados para a entidade dada: campos de
 * cidadão demarcados, campos oficiais sanitizados. Não muta a entrada (o item persistido em
 * D1 / cache permanece intacto). Campos fora das listas passam inalterados.
 */
export function tagUntrustedFields<T extends Record<string, unknown>>(
  entidade: EcidadaniaEntidade,
  item: T,
): T {
  if (!item || typeof item !== "object") return item;
  const citizenFields = CITIZEN_STRING_FIELDS[entidade] ?? [];
  const officialFields = OFFICIAL_STRING_FIELDS[entidade] ?? [];
  const officialArrays = OFFICIAL_ARRAY_FIELDS[entidade] ?? [];
  const out: Record<string, unknown> = { ...item };
  for (const f of citizenFields) {
    if (f in out) out[f] = applyField(out[f], neutralizeUntrustedText);
  }
  for (const f of officialFields) {
    if (f in out) out[f] = applyField(out[f], sanitizeScrapedText);
  }
  for (const f of officialArrays) {
    if (f in out) out[f] = applyStringArray(out[f], sanitizeScrapedText);
  }
  for (const f of CITIZEN_ARRAY_FIELDS[entidade] ?? []) {
    if (f in out) out[f] = applyStringArray(out[f], neutralizeUntrustedText);
  }
  for (const [f, campos] of Object.entries(CITIZEN_OBJECT_ARRAY_FIELDS[entidade] ?? {})) {
    const arr = out[f];
    if (!Array.isArray(arr)) continue;
    out[f] = arr.map((el) => {
      if (!el || typeof el !== "object") return el;
      const copia: Record<string, unknown> = { ...(el as Record<string, unknown>) };
      for (const c of campos) if (c in copia) copia[c] = applyField(copia[c], neutralizeUntrustedText);
      return copia;
    });
  }
  return out as T;
}

/** Versão para listas: mapeia `tagUntrustedFields` sobre cada item. */
export function tagUntrustedList<T extends Record<string, unknown>>(
  entidade: EcidadaniaEntidade,
  items: readonly T[],
): T[] {
  return items.map((it) => tagUntrustedFields(entidade, it));
}
