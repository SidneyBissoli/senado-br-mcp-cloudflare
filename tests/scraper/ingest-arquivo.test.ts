import { describe, it, expect } from "vitest";
import { gunzipSync } from "node:zlib";
import {
  Arquivo,
  ArquivoIndisponivelError,
  chaveDaPagina,
  chaveDoManifesto,
  configDoAmbiente,
  idDaUrl,
  indiceInsertStmt,
  manifestoJsonl,
  type RegistroDoIndice,
} from "../../scripts/ingest-ecidadania/arquivo.js";
import { assinarV4, amzDateDe, criarClienteR2, sha256Hex, type ClienteR2 } from "../../scripts/ingest-ecidadania/r2.js";
import { ehFalhaDeTransporte } from "../../scripts/ingest-ecidadania/breaker.js";

const enc = (s: string) => new TextEncoder().encode(s);

/** Balde em memória: conta HEADs e PUTs; `falhar` faz toda chamada lançar. */
function baldeFalso(inicial: Record<string, Uint8Array> = {}) {
  const objetos = new Map<string, Uint8Array>(Object.entries(inicial));
  const chamadas = { head: 0, put: 0 };
  let falhar = false;
  const cliente: ClienteR2 = {
    async existe(chave) {
      chamadas.head++;
      if (falhar) throw new Error("R2 fora");
      return objetos.has(chave);
    },
    async gravar(chave, corpo) {
      chamadas.put++;
      if (falhar) throw new Error("R2 fora");
      if (!objetos.has(chave)) objetos.set(chave, corpo);
    },
  };
  return { cliente, objetos, chamadas, falhe: () => (falhar = true) };
}

function arquivoDeTeste(cliente: ClienteR2, loteIndice = 250) {
  const sqls: string[] = [];
  const arq = new Arquivo({
    cliente, entidade: "ideias", job: "ideias-detalhe", rodada: "123-1", leitor: "ideias-detalhe@abc1234",
    aplicarSql: (sql) => sqls.push(sql), loteIndice, agora: () => new Date("2026-10-30T12:00:00.000Z"),
  });
  return { arq, sqls };
}

describe("assinatura V4 do R2 (S3)", () => {
  // Exemplo oficial da AWS, "Signature Calculations for the Authorization Header: Example GET Object"
  // (docs do S3): mesma chave, data, cabeçalhos e assinatura esperada.
  it("reproduz a assinatura do exemplo GET Object da documentação da AWS", () => {
    const h = assinarV4(
      {
        method: "GET",
        host: "examplebucket.s3.amazonaws.com",
        path: "/test.txt",
        headers: { Range: "bytes=0-9" },
        payloadSha256: sha256Hex(""),
        amzDate: "20130524T000000Z",
        region: "us-east-1",
        service: "s3",
      },
      { accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" },
    );
    expect(h.authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, " +
        "SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, " +
        "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
    );
  });

  it("formata a data no padrão da AWS", () => {
    expect(amzDateDe(new Date("2026-10-30T12:34:56.789Z"))).toBe("20261030T123456Z");
  });
});

describe("cliente R2", () => {
  const base = {
    accountId: "conta", bucket: "ecidadania-arquivos", cred: { accessKeyId: "k", secretAccessKey: "s" },
    sleepFn: async () => {}, agora: () => new Date("2026-10-30T00:00:00Z"),
  };

  it("HEAD 404 = ausente, 200 = presente; endereço path-style da conta", async () => {
    const urls: string[] = [];
    const respostas = [404, 200];
    const c = criarClienteR2({ ...base, fetchFn: (async (u: string) => { urls.push(u); return new Response(null, { status: respostas.shift() }); }) as typeof fetch });
    expect(await c.existe("paginas/ab/cd/x.html.gz")).toBe(false);
    expect(await c.existe("paginas/ab/cd/x.html.gz")).toBe(true);
    expect(urls[0]).toBe("https://conta.r2.cloudflarestorage.com/ecidadania-arquivos/paginas/ab/cd/x.html.gz");
  });

  it("PUT 409 (trava do balde: chave já existe) conta como gravado — a chave é o conteúdo", async () => {
    const c = criarClienteR2({ ...base, fetchFn: (async () => new Response("ObjectLockedByBucketPolicy", { status: 409 })) as typeof fetch });
    await expect(c.gravar("k", enc("x"), {})).resolves.toBeUndefined();
  });

  it("repete 5xx e falha de rede; esgotado, lança", async () => {
    let n = 0;
    const ok = criarClienteR2({ ...base, fetchFn: (async () => (++n < 3 ? new Response(null, { status: 503 }) : new Response(null, { status: 200 }))) as typeof fetch });
    await ok.gravar("k", enc("x"), {});
    expect(n).toBe(3);
    const fora = criarClienteR2({ ...base, tentativas: 2, fetchFn: (async () => { throw new TypeError("fetch failed"); }) as typeof fetch });
    await expect(fora.existe("k")).rejects.toThrow(/falhou após 2 tentativa/);
  });

  it("403 não se repete e lança (credencial errada não é passageira)", async () => {
    let n = 0;
    const c = criarClienteR2({ ...base, fetchFn: (async () => { n++; return new Response(null, { status: 403 }); }) as typeof fetch });
    await expect(c.gravar("k", enc("x"), {})).rejects.toThrow(/HTTP 403/);
    expect(n).toBe(1);
  });
});

describe("chaves, índice e manifesto", () => {
  const sha = sha256Hex(enc("<html>ideia</html>"));

  it("a página é endereçada pelo sha256 dos bytes ORIGINAIS", () => {
    expect(chaveDaPagina(sha)).toBe(`paginas/${sha.slice(0, 2)}/${sha.slice(2, 4)}/${sha}.html.gz`);
    expect(chaveDoManifesto("ideias", "123-1", 7)).toBe("manifestos/ideias/123-1/parte-007.jsonl.gz");
  });

  it("id só nas páginas de detalhe; listagem fica sem id", () => {
    expect(idDaUrl("https://www12.senado.leg.br/ecidadania/visualizacaoideia?id=136304")).toBe("136304");
    expect(idDaUrl("https://www12.senado.leg.br/ecidadania/visualizacaoaudiencia?id=9")).toBe("9");
    expect(idDaUrl("https://www12.senado.leg.br/ecidadania/pesquisaideia?situacao=99&p=1")).toBeNull();
  });

  it("linha do índice escapa aspas e manifesto tem uma linha JSON por leitura", () => {
    const r: RegistroDoIndice = {
      url: "https://x/visualizacaoideia?id=1&o='a'", entidade: "ideias", entityId: "1", instante: "2026-10-30T12:00:00.000Z",
      statusHttp: 200, sha256: sha, bytes: 10, leitor: "ideias@abc", rodada: "1-1", nova: 1,
    };
    expect(indiceInsertStmt(r)).toContain("'https://x/visualizacaoideia?id=1&o=''a'''");
    expect(indiceInsertStmt(r)).toMatch(/^INSERT INTO ecidadania_arquivo_indice \(/);
    const linhas = manifestoJsonl([r, { ...r, nova: 0 }]).trimEnd().split("\n");
    expect(linhas).toHaveLength(2);
    expect(JSON.parse(linhas[1])).toMatchObject({ sha256: sha, nova: 0, entityId: "1" });
  });
});

describe("Arquivo — guarda antes de ler, uma vez só, cada leitura no índice", () => {
  const url = "https://www12.senado.leg.br/ecidadania/visualizacaoideia?id=136304";

  it("grava a página nova em gzip (descomprime para os bytes originais)", async () => {
    const b = baldeFalso();
    const { arq } = arquivoDeTeste(b.cliente);
    const corpo = enc("<html>ideia 136304</html>");
    await arq.guardar(url, 200, corpo);
    const guardado = b.objetos.get(chaveDaPagina(sha256Hex(corpo)))!;
    expect(Buffer.from(gunzipSync(guardado)).equals(Buffer.from(corpo))).toBe(true);
    expect(arq.resumo()).toMatchObject({ leituras: 1, novas: 1, repetidas: 0 });
  });

  it("página idêntica não é regravada: nem PUT nem novo HEAD no mesmo run, mas vira linha do índice", async () => {
    const b = baldeFalso();
    const { arq, sqls } = arquivoDeTeste(b.cliente);
    const corpo = enc("<html>igual</html>");
    await arq.guardar(url, 200, corpo);
    await arq.guardar(url, 200, corpo);
    expect(b.chamadas).toEqual({ head: 1, put: 1 });
    await arq.descarregar();
    expect(sqls[0].trim().split("\n")).toHaveLength(2);
    expect(sqls[0]).toMatch(/, 1\);\n.*, 0\);\n$/);
  });

  it("página já guardada por outro run: HEAD encontra, não grava, registra nova = 0", async () => {
    const corpo = enc("<html>de ontem</html>");
    const b = baldeFalso({ [chaveDaPagina(sha256Hex(corpo))]: enc("gz") });
    const { arq } = arquivoDeTeste(b.cliente);
    await arq.guardar(url, 200, corpo);
    expect(b.chamadas.put).toBe(0);
    expect(arq.resumo()).toMatchObject({ novas: 0, repetidas: 1 });
  });

  it("4xx também se guarda (a página da ideia removida é dado)", async () => {
    const b = baldeFalso();
    const { arq, sqls } = arquivoDeTeste(b.cliente);
    await arq.guardar(url, 410, enc("<html>removida</html>"));
    await arq.descarregar();
    expect(sqls[0]).toContain(", 410, ");
  });

  it("descarrega o índice a cada lote e grava a parte do manifesto no balde", async () => {
    const b = baldeFalso();
    const { arq, sqls } = arquivoDeTeste(b.cliente, 2);
    await arq.guardar(url, 200, enc("a"));
    await arq.guardar(url, 200, enc("b"));
    await arq.guardar(url, 200, enc("c"));
    expect(sqls).toHaveLength(1);
    const parte = b.objetos.get("manifestos/ideias-detalhe/123-1/parte-001.jsonl.gz")!;
    expect(gunzipSync(parte).toString("utf8").trimEnd().split("\n")).toHaveLength(2);
    await arq.descarregar();
    expect(sqls).toHaveLength(2);
    expect(b.objetos.has("manifestos/ideias-detalhe/123-1/parte-002.jsonl.gz")).toBe(true);
  });

  it("balde fora: lança ArquivoIndisponivelError, não registra a leitura, e o disjuntor conta", async () => {
    const b = baldeFalso();
    b.falhe();
    const { arq, sqls } = arquivoDeTeste(b.cliente);
    const e = await arq.guardar(url, 200, enc("x")).catch((err: unknown) => err);
    expect(e).toBeInstanceOf(ArquivoIndisponivelError);
    expect(ehFalhaDeTransporte(e)).toBe(true);
    await arq.descarregar();
    expect(sqls).toHaveLength(0);
    expect(arq.resumo().leituras).toBe(0);
  });
});

describe("configuração pelo ambiente", () => {
  const cred = { CLOUDFLARE_ACCOUNT_ID: "c", ECIDADANIA_R2_ACCESS_KEY_ID: "k", ECIDADANIA_R2_SECRET_ACCESS_KEY: "s" };

  it("obrigatório sem credencial falha cedo, dizendo o que falta", () => {
    expect(() => configDoAmbiente({ ECIDADANIA_ARQUIVO: "obrigatorio", CLOUDFLARE_ACCOUNT_ID: "c" })).toThrow(
      /faltam: ECIDADANIA_R2_ACCESS_KEY_ID, ECIDADANIA_R2_SECRET_ACCESS_KEY/,
    );
  });

  it("auto sem credencial (execução local) e desligado devolvem null", () => {
    expect(configDoAmbiente({})).toBeNull();
    expect(configDoAmbiente({ ...cred, ECIDADANIA_ARQUIVO: "desligado" })).toBeNull();
  });

  it("com credencial usa o balde ecidadania-arquivos por padrão", () => {
    expect(configDoAmbiente(cred)).toEqual({ accountId: "c", bucket: "ecidadania-arquivos", accessKeyId: "k", secretAccessKey: "s" });
  });
});
