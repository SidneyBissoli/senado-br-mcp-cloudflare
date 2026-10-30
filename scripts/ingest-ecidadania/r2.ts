/**
 * Minimal R2 client for the raw-page archive (fase B, 30/10/2026), over R2's S3-compatible API.
 *
 * Why not a library: the archive needs exactly two calls (HEAD to skip a page already stored, PUT to
 * store a new one). AWS Signature V4 is ~50 lines over `node:crypto`, and the signer is pure and pinned
 * by the AWS documentation's own example (`tests/scraper/ingest-r2.test.ts`) — cheaper than a new
 * dependency in a lock the Windows npm mangles. Node's fetch is fine here: the TLS block that forced
 * `curl` in `http.ts` is the e-Cidadania portal's, not Cloudflare's.
 *
 * Credentials are an R2 API token scoped to ONE bucket ("Object Read & Write"; R2 has no write-only
 * permission). The bucket lock rejects any delete/overwrite, so a stray PUT on an existing key answers
 * 409 — for a content-addressed key that means "already stored", which is success.
 */

import { createHash, createHmac } from "node:crypto";

const REGION = "auto";
const SERVICE = "s3";

export interface CredenciaisR2 {
  accessKeyId: string;
  secretAccessKey: string;
}

export interface RequisicaoAssinavel {
  method: string;
  host: string;
  /** Path as sent, already starting with "/" (each segment is URI-encoded by the signer). */
  path: string;
  /** Headers to sign besides host/x-amz-date/x-amz-content-sha256 (names in any case). */
  headers?: Record<string, string>;
  payloadSha256: string;
  /** `YYYYMMDDTHHMMSSZ`. */
  amzDate: string;
  region?: string;
  service?: string;
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

export function sha256Hex(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

/** RFC 3986 encoding per path segment, as S3 expects ("/" kept, everything outside unreserved encoded). */
function encodePath(path: string): string {
  return path
    .split("/")
    .map((s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join("/");
}

/** `Date` → `YYYYMMDDTHHMMSSZ`. */
export function amzDateDe(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/**
 * AWS Signature V4 (header form). Pure. Returns every header to send, `authorization` included.
 * No query string support: the archive never needs one.
 */
export function assinarV4(req: RequisicaoAssinavel, cred: CredenciaisR2): Record<string, string> {
  const region = req.region ?? REGION;
  const service = req.service ?? SERVICE;
  const all: Record<string, string> = {
    host: req.host,
    "x-amz-content-sha256": req.payloadSha256,
    "x-amz-date": req.amzDate,
  };
  for (const [k, v] of Object.entries(req.headers ?? {})) all[k.toLowerCase()] = v;
  const names = Object.keys(all).sort();
  const canonicalHeaders = names.map((n) => `${n}:${all[n].trim().replace(/\s+/g, " ")}\n`).join("");
  const signedHeaders = names.join(";");
  const canonicalRequest = [req.method, encodePath(req.path), "", canonicalHeaders, signedHeaders, req.payloadSha256].join("\n");
  const day = req.amzDate.slice(0, 8);
  const scope = `${day}/${region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", req.amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${cred.secretAccessKey}`, day), region), service), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");
  const { host: _host, ...rest } = all;
  return {
    ...rest,
    authorization: `AWS4-HMAC-SHA256 Credential=${cred.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

/** What the archive needs from a bucket. Tests pass an in-memory double. */
export interface ClienteR2 {
  /** True when the key is already stored. */
  existe(chave: string): Promise<boolean>;
  /** Store `corpo` under `chave`. Already stored (409 from the bucket lock) counts as success. */
  gravar(chave: string, corpo: Uint8Array, headers: Record<string, string>): Promise<void>;
}

export class R2Error extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "R2Error";
  }
}

interface OpcoesCliente {
  accountId: string;
  bucket: string;
  cred: CredenciaisR2;
  tentativas?: number;
  /** Test seams. */
  fetchFn?: typeof fetch;
  sleepFn?: (ms: number) => Promise<void>;
  agora?: () => Date;
}

/** Real client over `https://<account>.r2.cloudflarestorage.com/<bucket>/<key>` (path style). */
export function criarClienteR2(o: OpcoesCliente): ClienteR2 {
  const host = `${o.accountId}.r2.cloudflarestorage.com`;
  const fetchFn = o.fetchFn ?? fetch;
  const sleepFn = o.sleepFn ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const agora = o.agora ?? (() => new Date());
  const tentativas = o.tentativas ?? 4;

  // 429/5xx/network repeat with backoff; any other answer is final.
  async function chamar(method: "HEAD" | "PUT", chave: string, corpo?: Uint8Array, extra: Record<string, string> = {}): Promise<number> {
    const path = `/${o.bucket}/${chave}`;
    const payloadSha256 = sha256Hex(corpo ?? new Uint8Array());
    let ultimo = "";
    for (let t = 1; t <= tentativas; t++) {
      const headers = assinarV4({ method, host, path, headers: extra, payloadSha256, amzDate: amzDateDe(agora()) }, o.cred);
      try {
        const r = await fetchFn(`https://${host}${encodePath(path)}`, { method, headers, body: corpo });
        if (r.status !== 429 && r.status < 500) {
          if (method === "PUT") await r.arrayBuffer().catch(() => undefined);
          return r.status;
        }
        ultimo = `HTTP ${r.status}`;
      } catch (e) {
        ultimo = e instanceof Error ? e.message : String(e);
      }
      if (t < tentativas) await sleepFn(Math.min(8000, 500 * 2 ** t));
    }
    throw new R2Error(`R2 ${method} ${chave} falhou após ${tentativas} tentativa(s): ${ultimo}`);
  }

  return {
    async existe(chave) {
      const s = await chamar("HEAD", chave);
      if (s === 200) return true;
      if (s === 404) return false;
      throw new R2Error(`R2 HEAD ${chave}: HTTP ${s}`, s);
    },
    async gravar(chave, corpo, headers) {
      const s = await chamar("PUT", chave, corpo, headers);
      if (s === 200 || s === 409) return;
      throw new R2Error(`R2 PUT ${chave}: HTTP ${s}`, s);
    },
  };
}
