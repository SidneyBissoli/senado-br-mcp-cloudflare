/**
 * Arquivo bruto de páginas do e-Cidadania — fase B1 do ROADMAP (desenho aprovado pelo dono em
 * 30/10/2026, uma decisão por vez; formato revisto pelo dono em 15/11/2026):
 *
 *   - cada resposta do portal é guardada INTEIRA no balde privado `ecidadania-arquivos` (R2, Europa
 *     Ocidental, trava contra apagar/sobrescrever), ANTES de o coletor lê-la;
 *   - a chave é o sha256 dos bytes ORIGINAIS: página idêntica é guardada uma vez só. Sem normalização
 *     antes do hash — o que se guarda é exatamente o que o portal mandou;
 *   - cada leitura vira uma linha do índice `ecidadania_arquivo_indice` no D1 (url × id × instante ×
 *     status HTTP × sha256 × leitor), inclusive a leitura repetida (`nova = 0`);
 *   - cada rodada deixa o seu manifesto no próprio balde (as mesmas linhas, em partes JSONL), para o
 *     arquivo se explicar sem o banco.
 *
 * FORMATO (15/11/2026). Até aqui cada página ia em gzip (`paginas/ab/cd/<sha>.html.gz`, ~49 KB por
 * detalhe de ideia). Medido em 15/11: ~105 MB/dia só nas ideias, porque quase tudo numa página é o
 * esqueleto do portal (cabeçalho, menus, estilos) e esse esqueleto muda a cada versão publicada pelo
 * Senado (27/10, 11/11) e a cada `DC.date.modified` do site — releitura de página com o mesmo dado
 * virava página nova inteira. Agora: zstd usando como DICIONÁRIO uma página de referência do mesmo
 * tipo e da mesma versão do portal (`paginas/ab/cd/<sha>.zst`): ~0,6 KB por detalhe, bytes exatos.
 *
 *   - versão do portal = sha dos carimbos `++unique++…` e `?version=…` do cabeçalho (mudam a cada
 *     publicação); tipo = último segmento do caminho da URL (`visualizacaoideia`, `pesquisaideia`…);
 *   - a referência é a 1ª página com HTTP 200 daquele tipo × versão, guardada em GZIP (abre em qualquer
 *     ferramenta) em `referencias/<sha>.html.gz`; o ponteiro `referencias/<tipo>/<versão>.sha` diz qual
 *     usar. Depois de gravar o ponteiro ele é RELIDO: com a trava do balde, quem gravou primeiro vence,
 *     e toda página aponta para a referência que de fato está lá;
 *   - para abrir: `zstd -d -D <referência descomprimida> <página>.zst`. A referência de cada página está
 *     no metadado do objeto (`x-amz-meta-referencia`), no manifesto e na tabela `ecidadania_arquivo_pagina`;
 *   - página acima de `LIMITE_DICIONARIO` (o CSV de votos, ~33 MB) vai em zstd sem referência;
 *   - o que já estava em gzip fica onde está (a trava não deixa apagar) e continua valendo: antes de
 *     gravar, procura a página nos dois formatos.
 *
 * O índice vai ao D1 em lotes (`LOTE_INDICE`) pelo `apply-d1.sh`, como os lotes do detalhe. Página
 * gravada e linha ainda não descarregada é o único estado intermediário: se o run morrer ali, a página
 * fica no balde sem a linha (nada se perde; só a leitura não fica registrada).
 */

import { constants, gunzipSync, gzipSync, zstdCompressSync, zstdDecompressSync } from "node:zlib";
import { sha256Hex, type ClienteR2 } from "./r2.js";
import { sqlValue } from "./sql.js";

export const BALDE_PADRAO = "ecidadania-arquivos";
const LOTE_INDICE = 250;
/** Acima disto a página não usa referência (dicionário grande custa memória e tempo). */
export const LIMITE_DICIONARIO = 4 * 1024 * 1024;
const NIVEL_ZSTD = 19;

/** Como a página está guardada no balde. `gzip` = formato até 15/11/2026. */
export type FormatoPagina = "gzip" | "zstd" | "zstd+ref";

/** Uma leitura do portal, como vai ao índice e ao manifesto. */
export interface RegistroDoIndice {
  url: string;
  entidade: string;
  /** Id da página de detalhe (`?id=N`); null para listagens. */
  entityId: string | null;
  /** Instante (ISO, UTC) em que a resposta chegou. */
  instante: string;
  statusHttp: number;
  sha256: string;
  /** Tamanho dos bytes originais (antes da compressão). */
  bytes: number;
  /** Quem baixou: `<job>@<commit>`. A versão do leitor que extrai os campos é registrada na fase C. */
  leitor: string;
  rodada: string;
  /** 1 = a página foi gravada nesta leitura; 0 = já estava no balde. */
  nova: 0 | 1;
  /** Formato no balde; null quando a página já estava lá em zstd, gravada por outro run (ver a tabela). */
  formato?: FormatoPagina | null;
  /** sha256 da página de referência (só `zstd+ref`). */
  referencia?: string | null;
}

/** Uma página GRAVADA (nova = 1): o formato é do objeto, não da leitura. */
export interface RegistroDaPagina {
  sha256: string;
  formato: FormatoPagina;
  referencia: string | null;
  bytesGravados: number;
  gravadaEm: string;
}

/** Erro do arquivo: a página NÃO é lida (o arquivo vem antes da leitura). Conta no disjuntor. */
export class ArquivoIndisponivelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArquivoIndisponivelError";
  }
}

/** Formato antigo (até 15/11/2026): `paginas/ab/cd/<sha256>.html.gz`. */
export function chaveDaPagina(sha: string): string {
  return `paginas/${sha.slice(0, 2)}/${sha.slice(2, 4)}/${sha}.html.gz`;
}

/** Formato atual: `paginas/ab/cd/<sha256>.zst` (com ou sem referência; ver o metadado). */
export function chaveDaPaginaZstd(sha: string): string {
  return `paginas/${sha.slice(0, 2)}/${sha.slice(2, 4)}/${sha}.zst`;
}

/** Página de referência, em gzip, endereçada pelo sha dos seus bytes originais. */
export function chaveDaReferencia(sha: string): string {
  return `referencias/${sha}.html.gz`;
}

/** Ponteiro tipo × versão do portal → sha da referência (texto, uma linha). */
export function chaveDoPonteiro(tipo: string, versao: string): string {
  return `referencias/${tipo}/${versao}.sha`;
}

/** `manifestos/<job>/<rodada>/parte-NNN.jsonl.gz`. */
export function chaveDoManifesto(job: string, rodada: string, parte: number): string {
  return `manifestos/${job}/${rodada}/parte-${String(parte).padStart(3, "0")}.jsonl.gz`;
}

/** Id da página de detalhe (`visualizacaoideia?id=N`, `visualizacaoaudiencia?id=N`…); null nas listagens. */
export function idDaUrl(url: string): string | null {
  const m = /\/visualizacao[a-z]+\?(?:[^#]*&)?id=(\d+)/i.exec(url);
  return m ? m[1] : null;
}

/** Tipo da página = último segmento do caminho, em minúsculas e sem acento (`pesquisaideia`). */
export function tipoDaPagina(url: string): string {
  let caminho: string;
  try {
    caminho = new URL(url).pathname;
  } catch {
    caminho = url.split("?")[0];
  }
  const seg = decodeURIComponent(caminho.split("/").filter(Boolean).pop() ?? "");
  const t = seg
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return t || "raiz";
}

/**
 * Versão do portal que serviu a página: sha (16 hex) dos carimbos `++unique++…` e `?version=…` do
 * começo da página, que mudam a cada publicação. Sem carimbo (fragmento AJAX, CSV) → `sem-layout`.
 * O `DC.date.modified` fica de fora: muda quase todo dia sem mudar o esqueleto.
 */
export function versaoDoLayout(corpo: Uint8Array): string {
  const txt = Buffer.from(corpo.subarray(0, 65536)).toString("latin1");
  const achados = new Set<string>();
  for (const m of txt.matchAll(/\+\+unique\+\+([^/"'\s]+)|[?&]version=([^"'&\s]+)/g)) achados.add(m[1] ?? m[2]);
  if (achados.size === 0) return "sem-layout";
  return sha256Hex([...achados].sort().join("\n")).slice(0, 16);
}

/** zstd nível 19, com a referência como dicionário quando houver. */
export function comprimirZstd(corpo: Uint8Array, referencia?: Uint8Array): Buffer {
  return zstdCompressSync(corpo, {
    params: { [constants.ZSTD_c_compressionLevel]: NIVEL_ZSTD },
    ...(referencia ? { dictionary: referencia } : {}),
  });
}

export function descomprimirZstd(comprimido: Uint8Array, referencia?: Uint8Array): Buffer {
  return zstdDecompressSync(comprimido, referencia ? { dictionary: referencia } : {});
}

/**
 * Prova, no início do job, que este Node comprime COM dicionário (opção `dictionary`, Node ≥ 24.6) e
 * devolve os bytes exatos. Um Node antigo ignora a opção calado — a página sairia sem referência, ou
 * pior, ilegível. Falha aqui = o job para antes de coletar.
 */
export function autoprovaZstd(): void {
  const ref = Buffer.from("<html><head>esqueleto do portal ".repeat(400) + "</head>", "utf8");
  const pagina = Buffer.concat([ref, Buffer.from("<body>ideia 1</body>", "utf8")]);
  let com: Buffer;
  let volta: Buffer;
  try {
    com = comprimirZstd(pagina, ref);
    volta = descomprimirZstd(com, ref);
  } catch (e) {
    throw new Error(`zstd indisponível neste Node (${process.version}): ${e instanceof Error ? e.message : String(e)}`);
  }
  const sem = comprimirZstd(pagina);
  if (!volta.equals(pagina)) throw new Error(`zstd com dicionário não devolve os bytes exatos neste Node (${process.version})`);
  if (com.length >= sem.length) {
    throw new Error(`zstd ignorou o dicionário neste Node (${process.version}; precisa ≥ 24.6): ${com.length} ≥ ${sem.length} bytes`);
  }
}

/** Uma linha do índice (INSERT simples: o índice só acrescenta). */
export function indiceInsertStmt(r: RegistroDoIndice): string {
  const cols = [r.url, r.entidade, r.entityId, r.instante, r.statusHttp, r.sha256, r.bytes, r.leitor, r.rodada, r.nova];
  return (
    "INSERT INTO ecidadania_arquivo_indice (url, entidade, entity_id, instante, status_http, sha256, bytes, leitor, rodada, nova) VALUES (" +
    cols.map(sqlValue).join(", ") +
    ");"
  );
}

/** Uma página gravada. OR IGNORE: o sha já registrado (outro run, mesma página) não muda. */
export function paginaInsertStmt(p: RegistroDaPagina): string {
  const cols = [p.sha256, p.formato, p.referencia, p.bytesGravados, p.gravadaEm];
  return (
    "INSERT OR IGNORE INTO ecidadania_arquivo_pagina (sha256, formato, referencia, bytes_gravados, gravada_em) VALUES (" +
    cols.map(sqlValue).join(", ") +
    ");"
  );
}

/** Manifesto de uma parte: uma linha JSON por leitura, chaves em ordem fixa. */
export function manifestoJsonl(rs: readonly RegistroDoIndice[]): string {
  return rs
    .map((r) =>
      JSON.stringify({
        url: r.url, entidade: r.entidade, entityId: r.entityId, instante: r.instante, statusHttp: r.statusHttp,
        sha256: r.sha256, bytes: r.bytes, leitor: r.leitor, rodada: r.rodada, nova: r.nova,
        formato: r.formato ?? null, referencia: r.referencia ?? null,
      }),
    )
    .join("\n") + (rs.length ? "\n" : "");
}

export interface OpcoesArquivo {
  cliente: ClienteR2;
  entidade: string;
  job: string;
  rodada: string;
  leitor: string;
  /** Aplica um lote de SQL do índice no D1 (`n` = número do lote, para o nome do arquivo). */
  aplicarSql: (sql: string, n: number) => void;
  loteIndice?: number;
  agora?: () => Date;
}

export interface ResumoArquivo {
  leituras: number;
  novas: number;
  repetidas: number;
  bytesOriginais: number;
  bytesGravados: number;
  /** Páginas de referência gravadas nesta rodada (uma por tipo × versão do portal, na 1ª vez). */
  referenciasNovas: number;
}

interface Referencia {
  sha: string;
  bytes: Uint8Array;
}

interface InfoPagina {
  formato: FormatoPagina | null;
  referencia: string | null;
}

export class Arquivo {
  private pendentes: RegistroDoIndice[] = [];
  private pendentesPaginas: RegistroDaPagina[] = [];
  private partes = 0;
  private lotesSql = 0;
  /** Páginas já confirmadas no balde nesta rodada, por sha (poupa os HEADs da página repetida). */
  private conhecidas = new Map<string, InfoPagina>();
  /** Referência por `tipo/versão` já carregada nesta rodada. */
  private referencias = new Map<string, Referencia>();
  private readonly resumoInterno: ResumoArquivo = {
    leituras: 0, novas: 0, repetidas: 0, bytesOriginais: 0, bytesGravados: 0, referenciasNovas: 0,
  };

  constructor(private readonly o: OpcoesArquivo) {}

  private agora(): string {
    return (this.o.agora?.() ?? new Date()).toISOString();
  }

  /**
   * Guarda uma resposta do portal. Chamado ANTES de o coletor ler o corpo; se falhar, lança
   * `ArquivoIndisponivelError` e a página não é lida.
   */
  async guardar(url: string, statusHttp: number, corpo: Uint8Array): Promise<void> {
    const sha = sha256Hex(corpo);
    let nova: 0 | 1 = 0;
    let info = this.conhecidas.get(sha);
    try {
      if (!info) {
        if (await this.o.cliente.existe(chaveDaPaginaZstd(sha))) info = { formato: null, referencia: null };
        else if (await this.o.cliente.existe(chaveDaPagina(sha))) info = { formato: "gzip", referencia: null };
        else {
          info = await this.gravarNova(url, statusHttp, corpo, sha);
          nova = 1;
        }
      }
    } catch (e) {
      if (e instanceof ArquivoIndisponivelError) throw e;
      throw new ArquivoIndisponivelError(`arquivo indisponível para ${url}: ${e instanceof Error ? e.message : String(e)}`);
    }
    this.conhecidas.set(sha, info);
    this.resumoInterno.leituras++;
    this.resumoInterno.bytesOriginais += corpo.length;
    if (nova) this.resumoInterno.novas++;
    else this.resumoInterno.repetidas++;
    this.pendentes.push({
      url, entidade: this.o.entidade, entityId: idDaUrl(url), instante: this.agora(),
      statusHttp, sha256: sha, bytes: corpo.length, leitor: this.o.leitor, rodada: this.o.rodada, nova,
      formato: info.formato, referencia: info.referencia,
    });
    if (this.pendentes.length >= (this.o.loteIndice ?? LOTE_INDICE)) await this.descarregar();
  }

  private async gravarNova(url: string, statusHttp: number, corpo: Uint8Array, sha: string): Promise<InfoPagina> {
    const ref = corpo.length <= LIMITE_DICIONARIO
      ? await this.referenciaPara(tipoDaPagina(url), versaoDoLayout(corpo), corpo, statusHttp)
      : null;
    const comprimido = comprimirZstd(corpo, ref?.bytes);
    const formato: FormatoPagina = ref ? "zstd+ref" : "zstd";
    const headers: Record<string, string> = { "content-type": "application/zstd", "x-amz-meta-formato": formato };
    if (ref) headers["x-amz-meta-referencia"] = ref.sha;
    await this.o.cliente.gravar(chaveDaPaginaZstd(sha), comprimido, headers);
    this.resumoInterno.bytesGravados += comprimido.length;
    this.pendentesPaginas.push({
      sha256: sha, formato, referencia: ref?.sha ?? null, bytesGravados: comprimido.length, gravadaEm: this.agora(),
    });
    return { formato, referencia: ref?.sha ?? null };
  }

  /**
   * Referência do tipo × versão: a do ponteiro, se existe; senão esta página vira a referência (só com
   * HTTP 200 — página de erro não serve de esqueleto). O ponteiro é relido depois de gravado: a trava
   * do balde mantém o primeiro, e é ele que vale. A referência lida é conferida pelo sha.
   */
  private async referenciaPara(tipo: string, versao: string, corpo: Uint8Array, statusHttp: number): Promise<Referencia | null> {
    const k = `${tipo}/${versao}`;
    const pronta = this.referencias.get(k);
    if (pronta) return pronta;
    const ponteiro = chaveDoPonteiro(tipo, versao);
    let sha = await this.lerPonteiro(ponteiro);
    if (!sha) {
      if (statusHttp !== 200) return null;
      const meu = sha256Hex(corpo);
      const gz = gzipSync(corpo, { level: 9 });
      await this.o.cliente.gravar(chaveDaReferencia(meu), gz, { "content-type": "application/gzip" });
      await this.o.cliente.gravar(ponteiro, Buffer.from(`${meu}\n`, "utf8"), { "content-type": "text/plain" });
      sha = await this.lerPonteiro(ponteiro);
      if (!sha) throw new ArquivoIndisponivelError(`ponteiro ${ponteiro} gravado mas não encontrado`);
      if (sha === meu) {
        this.resumoInterno.referenciasNovas++;
        this.resumoInterno.bytesGravados += gz.length;
        const ref = { sha, bytes: corpo };
        this.referencias.set(k, ref);
        return ref;
      }
    }
    const gz = await this.o.cliente.ler(chaveDaReferencia(sha));
    if (!gz) throw new ArquivoIndisponivelError(`referência ${sha} apontada por ${ponteiro} não está no balde`);
    const bytes = gunzipSync(gz);
    if (sha256Hex(bytes) !== sha) throw new ArquivoIndisponivelError(`referência ${sha} não confere com o próprio sha`);
    const ref = { sha, bytes };
    this.referencias.set(k, ref);
    return ref;
  }

  private async lerPonteiro(chave: string): Promise<string | null> {
    const b = await this.o.cliente.ler(chave);
    if (!b) return null;
    const sha = Buffer.from(b).toString("utf8").trim();
    if (!/^[0-9a-f]{64}$/.test(sha)) throw new ArquivoIndisponivelError(`ponteiro ${chave} ilegível`);
    return sha;
  }

  /** Leva as linhas pendentes ao D1 e a parte correspondente do manifesto ao balde. */
  async descarregar(): Promise<void> {
    if (this.pendentes.length === 0 && this.pendentesPaginas.length === 0) return;
    const lote = this.pendentes;
    const paginas = this.pendentesPaginas;
    this.pendentes = [];
    this.pendentesPaginas = [];
    const sql = [...paginas.map(paginaInsertStmt), ...lote.map(indiceInsertStmt)].join("\n") + "\n";
    this.o.aplicarSql(sql, ++this.lotesSql);
    if (lote.length === 0) return;
    const parte = ++this.partes;
    try {
      await this.o.cliente.gravar(chaveDoManifesto(this.o.job, this.o.rodada, parte), gzipSync(Buffer.from(manifestoJsonl(lote), "utf8")), {
        "content-type": "application/gzip",
      });
    } catch (e) {
      // O índice já está no D1; a parte do manifesto é a cópia de segurança. Avisa, não para o run.
      console.warn(`[arquivo-bruto][manifesto] parte ${parte} não gravada: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  resumo(): ResumoArquivo {
    return { ...this.resumoInterno };
  }
}

export type ModoArquivo = "obrigatorio" | "desligado" | "auto";

/**
 * Lê a configuração do ambiente. `ECIDADANIA_ARQUIVO=obrigatorio` (o workflow) exige as credenciais e
 * falha cedo sem elas; `desligado` (ou `auto` sem credenciais: execução local, testes) devolve null e
 * o coletor lê como antes.
 */
export function configDoAmbiente(env: NodeJS.ProcessEnv): { accountId: string; bucket: string; accessKeyId: string; secretAccessKey: string } | null {
  const modo = (env.ECIDADANIA_ARQUIVO ?? "auto") as ModoArquivo;
  if (modo === "desligado") return null;
  const accountId = env.CLOUDFLARE_ACCOUNT_ID ?? "";
  const accessKeyId = env.ECIDADANIA_R2_ACCESS_KEY_ID ?? "";
  const secretAccessKey = env.ECIDADANIA_R2_SECRET_ACCESS_KEY ?? "";
  const bucket = env.ECIDADANIA_R2_BUCKET || BALDE_PADRAO;
  const faltam = [
    ["CLOUDFLARE_ACCOUNT_ID", accountId],
    ["ECIDADANIA_R2_ACCESS_KEY_ID", accessKeyId],
    ["ECIDADANIA_R2_SECRET_ACCESS_KEY", secretAccessKey],
  ].filter(([, v]) => !v).map(([k]) => k);
  if (faltam.length) {
    if (modo === "obrigatorio") throw new Error(`ECIDADANIA_ARQUIVO=obrigatorio, mas faltam: ${faltam.join(", ")}`);
    return null;
  }
  return { accountId, bucket, accessKeyId, secretAccessKey };
}
