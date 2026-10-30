/**
 * Arquivo bruto de páginas do e-Cidadania — fase B1 do ROADMAP (desenho aprovado pelo dono em
 * 30/10/2026, uma decisão por vez):
 *
 *   - cada resposta do portal é guardada INTEIRA, em gzip, no balde privado `ecidadania-arquivos`
 *     (R2, Europa Ocidental, trava contra apagar/sobrescrever), ANTES de o coletor lê-la;
 *   - a chave é o sha256 dos bytes ORIGINAIS (não do gzip): página idêntica é guardada uma vez só e
 *     trocar a compressão um dia não quebra a deduplicação. Sem normalização antes do hash — o que se
 *     guarda é exatamente o que o portal mandou;
 *   - cada leitura vira uma linha do índice `ecidadania_arquivo_indice` no D1 (url × id × instante ×
 *     status HTTP × sha256 × leitor), inclusive a leitura repetida (`nova = 0`);
 *   - cada rodada deixa o seu manifesto no próprio balde (as mesmas linhas, em partes JSONL), para o
 *     arquivo se explicar sem o banco.
 *
 * Medido para o desenho (30/10): detalhe ~150 KB cru / ~48 KB gzip, idêntico byte a byte em duas
 * leituras seguidas; listagem ~205 KB / ~21 KB, muda só quando o dado muda.
 *
 * O índice vai ao D1 em lotes (`LOTE_INDICE`) pelo `apply-d1.sh`, como os lotes do detalhe. Página
 * gravada e linha ainda não descarregada é o único estado intermediário: se o run morrer ali, a página
 * fica no balde sem a linha (nada se perde; só a leitura não fica registrada).
 */

import { gzipSync } from "node:zlib";
import { sha256Hex, type ClienteR2 } from "./r2.js";
import { sqlValue } from "./sql.js";

export const BALDE_PADRAO = "ecidadania-arquivos";
const LOTE_INDICE = 250;

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
  /** Tamanho dos bytes originais (antes do gzip). */
  bytes: number;
  /** Quem baixou: `<job>@<commit>`. A versão do leitor que extrai os campos é registrada na fase C. */
  leitor: string;
  rodada: string;
  /** 1 = a página foi gravada nesta leitura; 0 = já estava no balde. */
  nova: 0 | 1;
}

/** Erro do arquivo: a página NÃO é lida (o arquivo vem antes da leitura). Conta no disjuntor. */
export class ArquivoIndisponivelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArquivoIndisponivelError";
  }
}

/** `paginas/ab/cd/<sha256>.html.gz` — dois níveis de prefixo para listagens navegáveis no painel. */
export function chaveDaPagina(sha: string): string {
  return `paginas/${sha.slice(0, 2)}/${sha.slice(2, 4)}/${sha}.html.gz`;
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

/** Uma linha do índice (INSERT simples: o índice só acrescenta). */
export function indiceInsertStmt(r: RegistroDoIndice): string {
  const cols = [r.url, r.entidade, r.entityId, r.instante, r.statusHttp, r.sha256, r.bytes, r.leitor, r.rodada, r.nova];
  return (
    "INSERT INTO ecidadania_arquivo_indice (url, entidade, entity_id, instante, status_http, sha256, bytes, leitor, rodada, nova) VALUES (" +
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
}

export class Arquivo {
  private pendentes: RegistroDoIndice[] = [];
  private partes = 0;
  private lotesSql = 0;
  /** Chaves já confirmadas no balde nesta rodada (poupa o HEAD da página repetida no mesmo run). */
  private conhecidas = new Set<string>();
  private readonly resumoInterno: ResumoArquivo = { leituras: 0, novas: 0, repetidas: 0, bytesOriginais: 0, bytesGravados: 0 };

  constructor(private readonly o: OpcoesArquivo) {}

  /**
   * Guarda uma resposta do portal. Chamado ANTES de o coletor ler o corpo; se falhar, lança
   * `ArquivoIndisponivelError` e a página não é lida.
   */
  async guardar(url: string, statusHttp: number, corpo: Uint8Array): Promise<void> {
    const sha = sha256Hex(corpo);
    const chave = chaveDaPagina(sha);
    let nova: 0 | 1 = 0;
    try {
      if (!this.conhecidas.has(chave) && !(await this.o.cliente.existe(chave))) {
        const gz = gzipSync(corpo, { level: 9 });
        await this.o.cliente.gravar(chave, gz, { "content-type": "application/gzip" });
        nova = 1;
        this.resumoInterno.bytesGravados += gz.length;
      }
    } catch (e) {
      throw new ArquivoIndisponivelError(`arquivo indisponível para ${url}: ${e instanceof Error ? e.message : String(e)}`);
    }
    this.conhecidas.add(chave);
    this.resumoInterno.leituras++;
    this.resumoInterno.bytesOriginais += corpo.length;
    if (nova) this.resumoInterno.novas++;
    else this.resumoInterno.repetidas++;
    this.pendentes.push({
      url, entidade: this.o.entidade, entityId: idDaUrl(url), instante: (this.o.agora?.() ?? new Date()).toISOString(),
      statusHttp, sha256: sha, bytes: corpo.length, leitor: this.o.leitor, rodada: this.o.rodada, nova,
    });
    if (this.pendentes.length >= (this.o.loteIndice ?? LOTE_INDICE)) await this.descarregar();
  }

  /** Leva as linhas pendentes ao D1 e a parte correspondente do manifesto ao balde. */
  async descarregar(): Promise<void> {
    if (this.pendentes.length === 0) return;
    const lote = this.pendentes;
    this.pendentes = [];
    this.o.aplicarSql(lote.map(indiceInsertStmt).join("\n") + "\n", ++this.lotesSql);
    const parte = ++this.partes;
    try {
      await this.o.cliente.gravar(chaveDoManifesto(this.o.job, this.o.rodada, parte), gzipSync(Buffer.from(manifestoJsonl(lote), "utf8")), {
        "content-type": "application/gzip",
      });
    } catch (e) {
      // O índice já está no D1; a parte do manifesto é a cópia de segurança. Avisa, não para o run.
      console.warn(`[arquivo][manifesto] parte ${parte} não gravada: ${e instanceof Error ? e.message : String(e)}`);
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
