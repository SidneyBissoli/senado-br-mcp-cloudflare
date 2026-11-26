/**
 * E1.c do ROADMAP — fatos das respostas da autoria oficial das matérias (guardadas pela E1.b, job
 * `autoria`, desde 25/11/2026). Mesma camada 2 das demais (`fundir.ts`): formato longo, valor em texto,
 * uma série por entidade × id × fonte. Puro, exceto `versaoDoLeitorAutoria` (lê os fontes).
 *
 *   processos  lista `/dadosabertos/processo?codigoMateria=N` → statusHttp, quantos e um fato
 *              `processo` por id (id da série = o código da matéria);
 *   processo   detalhe `/dadosabertos/processo/{id}` → statusHttp, codigoMateria, identificacao,
 *              resumoAutoria, casaIniciadora, idProcessoCasaInicial e um fato `autor` por autor, com o
 *              PAPEL (decisão 4 de 24/11/2026): `iniciativa` (`autoriaIniciativa[]`) e `texto`
 *              (`documento.autoria[]`, o texto em tramitação). Id da série = o id do processo;
 *   camara     `/api/v2/proposicoes/{id}/autores` (Câmara) → statusHttp e um fato `autor` por autor.
 *
 * Fica num módulo SEU (não em `fatos-c5.ts`/`fatos.ts`) porque esses arquivos entram na versão do leitor
 * das outras entidades: tocar neles reprocessaria do zero ideias, consultas, eventos e o acervo.
 */

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { conferirAutoresDaCamara, conferirDetalheDoProcesso, idsDaListaDeProcessos } from "../ingest-ecidadania/autoria.js";
import type { Fato, Fonte } from "./fatos.js";
import type { Leitura } from "./fundir.js";
import type { LinhaC5 } from "./fatos-c5.js";

export const ENTIDADE_AUTORIA = "autoria";
export type FonteAutoria = "processos" | "processo" | "camara";

const txt = (x: unknown): string | null => (x === null || x === undefined || x === "" ? null : String(x));
const int = (x: unknown): number | null => (typeof x === "number" && Number.isSafeInteger(x) ? x : null);

/** Fonte da resposta; null = fora do escopo. */
export function fonteAutoria(url: string): FonteAutoria | null {
  if (/\/dadosabertos\/processo\?(?:.*&)?codigoMateria=\d+/.test(url)) return "processos";
  if (/\/dadosabertos\/processo\/\d+(?:\.json)?(?:[?#]|$)/.test(url)) return "processo";
  if (/dadosabertos\.camara\.leg\.br\/api\/v2\/proposicoes\/\d+\/autores/.test(url)) return "camara";
  return null;
}

/** Id da série, lido da URL (não do `entity_id` do índice: a regra é a mesma, mas aqui fica explícita). */
export function idDaSerieAutoria(fonte: FonteAutoria, url: string): string | null {
  const re = fonte === "processos" ? /[?&]codigoMateria=(\d+)/ : fonte === "processo" ? /\/processo\/(\d+)/ : /\/proposicoes\/(\d+)\//;
  return re.exec(url)?.[1] ?? null;
}

/** 200 e 404 observam (a matéria que a fonte não conhece é fato); 5xx não. */
export function statusObservavelAutoria(statusHttp: number): boolean {
  return statusHttp === 200 || statusHttp === 404;
}

/** Autor do Senado como fato: JSON com a posição na lista (a fusão ordena por valor). */
function autorDoSenado(papel: "iniciativa" | "texto", a: Record<string, unknown>, posicao: number): Fato {
  return {
    campo: "autor",
    valor: JSON.stringify({
      papel, posicao, ordem: int(a.ordem), autor: txt(a.autor), tipo: txt(a.siglaTipo), codigoParlamentar: int(a.codigoParlamentar),
      uf: txt(a.uf), siglaPartido: txt(a.siglaPartido), cargo: txt(a.siglaCargo), ente: txt(a.siglaEnte),
      outrosAutoresNaoInformados: txt(a.outrosAutoresNaoInformados),
    }),
  };
}

export function fatosDaListaDeProcessos(json: unknown, codigoMateria: number): Fato[] {
  const ids = idsDaListaDeProcessos(json, codigoMateria);
  return [{ campo: "statusHttp", valor: "200" }, { campo: "quantos", valor: String(ids.length) }, ...ids.map((id) => ({ campo: "processo", valor: String(id) }))];
}

export function fatosDoProcesso(json: unknown, id: number): Fato[] {
  conferirDetalheDoProcesso(json, id);
  const p = json as Record<string, unknown> & { autoriaIniciativa: Record<string, unknown>[]; documento?: { autoria?: unknown; resumoAutoria?: unknown } };
  const texto = Array.isArray(p.documento?.autoria) ? (p.documento!.autoria as Record<string, unknown>[]) : [];
  return [
    { campo: "statusHttp", valor: "200" },
    { campo: "codigoMateria", valor: txt(int(p.codigoMateria)) },
    { campo: "identificacao", valor: txt(p.identificacao) },
    { campo: "resumoAutoria", valor: txt(p.documento?.resumoAutoria) },
    { campo: "casaIniciadora", valor: txt(p.siglaCasaIniciadora) },
    { campo: "idProcessoCasaInicial", valor: txt(int(p.idProcessoCasaInicial)) },
    ...p.autoriaIniciativa.map((a, i) => autorDoSenado("iniciativa", a, i)),
    ...texto.map((a, i) => autorDoSenado("texto", a, i)),
  ];
}

export function fatosDosAutoresDaCamara(json: unknown, id: number): Fato[] {
  conferirAutoresDaCamara(json, id);
  const dados = (json as { dados: Record<string, unknown>[] }).dados;
  return [
    { campo: "statusHttp", valor: "200" },
    ...dados.map((a, posicao) => ({
      campo: "autor",
      valor: JSON.stringify({
        papel: "camara", posicao, ordem: int(a.ordemAssinatura), autor: txt(a.nome), tipo: txt(a.tipo),
        idDeputado: int(Number(/\/deputados\/(\d+)$/.exec(String(a.uri ?? ""))?.[1] ?? NaN)), proponente: int(a.proponente),
      }),
    })),
  ];
}

export interface ContagemAutoria {
  foraDoMolde: number;
}

/** Leituras de série de UMA linha do índice da entidade `autoria`. */
export function leiturasAutoria(l: LinhaC5, texto: string, c: ContagemAutoria): Leitura[] {
  const fonte = fonteAutoria(l.url);
  const id = fonte ? idDaSerieAutoria(fonte, l.url) : null;
  if (!fonte || !id) return [];
  // A união `Fonte` mora em `fatos.ts`, que entra na versão do leitor das ideias: alargá-la lá
  // reprocessaria as ideias do zero. Os três valores daqui só circulam nesta entidade.
  const base = { indice: l.id, instante: l.instante, sha256: l.sha256, entidade: ENTIDADE_AUTORIA, entityId: id, fonte: fonte as unknown as Fonte };
  if (l.status_http !== 200) return [{ ...base, fatos: [{ campo: "statusHttp", valor: String(l.status_http) }] }];
  try {
    const json: unknown = JSON.parse(texto);
    const n = Number(id);
    const fatos = fonte === "processos" ? fatosDaListaDeProcessos(json, n) : fonte === "processo" ? fatosDoProcesso(json, n) : fatosDosAutoresDaCamara(json, n);
    return [{ ...base, fatos }];
  } catch (e) {
    c.foraDoMolde++;
    return [{ ...base, fatos: [{ campo: "statusHttp", valor: "200" }, { campo: "erroLeitura", valor: e instanceof Error ? e.message : String(e) }] }];
  }
}

/** SQL de um lote do índice da autoria (só inteiros e constantes). */
export function sqlDoLoteAutoria(cursor: number, lote: number): string {
  if (!Number.isInteger(cursor) || !Number.isInteger(lote)) throw new Error("lote inválido");
  return (
    "SELECT i.id, i.url, i.entity_id, i.instante, i.status_http, i.sha256, p.formato, p.referencia " +
    "FROM ecidadania_arquivo_indice i LEFT JOIN ecidadania_arquivo_pagina p ON p.sha256 = i.sha256 " +
    `WHERE i.entidade = '${ENTIDADE_AUTORIA}' AND i.id > ${cursor} ORDER BY i.id LIMIT ${lote}`
  );
}

/** Versão do leitor da autoria: sha dos fontes que decidem os fatos dela. */
export function versaoDoLeitorAutoria(): string {
  const aqui = dirname(fileURLToPath(import.meta.url));
  const h = createHash("sha256").update(ENTIDADE_AUTORIA);
  for (const rel of ["fatos-autoria.ts", "fundir.ts", "../ingest-ecidadania/autoria.ts"]) h.update(readFileSync(join(aqui, rel), "utf8").replace(/\r\n/g, "\n"));
  return `observacoes-${ENTIDADE_AUTORIA}@${h.digest("hex").slice(0, 12)}`;
}
