import { describe, it, expect } from "vitest";
import { gunzipSync, gzipSync } from "node:zlib";
import {
  Arquivo,
  ArquivoIndisponivelError,
  LIMITE_DICIONARIO,
  autoprovaZstd,
  chaveDaPagina,
  chaveDaPaginaZstd,
  chaveDaReferencia,
  chaveDoManifesto,
  chaveDoPonteiro,
  configDoAmbiente,
  descomprimirZstd,
  idDaUrl,
  indiceInsertStmt,
  manifestoJsonl,
  paginaInsertStmt,
  tipoDaPagina,
  versaoDoLayout,
  type RegistroDoIndice,
} from "../../scripts/ingest-ecidadania/arquivo.js";
import { assinarV4, amzDateDe, criarClienteR2, sha256Hex, type ClienteR2 } from "../../scripts/ingest-ecidadania/r2.js";
import { ehFalhaDeTransporte } from "../../scripts/ingest-ecidadania/breaker.js";

const enc = (s: string) => new TextEncoder().encode(s);

/** Este Node comprime com dicionário (≥ 24.6)? A matriz do CI roda 22 e 24. */
const TEM_DICIONARIO = (() => {
  try {
    autoprovaZstd();
    return true;
  } catch {
    return false;
  }
})();

/** Balde em memória: conta HEADs, PUTs e GETs; a trava (não sobrescreve) como no R2; `falhar` faz toda chamada lançar. */
function baldeFalso(inicial: Record<string, Uint8Array> = {}) {
  const objetos = new Map<string, Uint8Array>(Object.entries(inicial));
  const metadados = new Map<string, Record<string, string>>();
  const chamadas = { head: 0, put: 0, get: 0 };
  let falhar = false;
  const cliente: ClienteR2 = {
    async existe(chave) {
      chamadas.head++;
      if (falhar) throw new Error("R2 fora");
      return objetos.has(chave);
    },
    async gravar(chave, corpo, headers) {
      chamadas.put++;
      if (falhar) throw new Error("R2 fora");
      if (!objetos.has(chave)) {
        objetos.set(chave, corpo);
        metadados.set(chave, headers);
      }
    },
    async ler(chave) {
      chamadas.get++;
      if (falhar) throw new Error("R2 fora");
      return objetos.get(chave) ?? null;
    },
  };
  return { cliente, objetos, metadados, chamadas, falhe: () => (falhar = true) };
}

/** Página com cara de portal: esqueleto grande com carimbo de versão + conteúdo pequeno. */
function paginaDoPortal(conteudo: string, versao = "2026-11-11%2012%3A51%3A28", dataModificada = "2026-11-12T09:24:20-03:00"): Uint8Array {
  const esqueleto = Array.from({ length: 300 }, (_, i) => `<li class="menu-${i}">item de menu ${i}</li>`).join("");
  return enc(
    `<html><head><meta name="DC.date.modified" content="${dataModificada}" />` +
      `<link href="https://www12.senado.leg.br/ecidadania/++resource++static/css/ecidadania.css?version=${versao}" /></head>` +
      `<body><ul>${esqueleto}</ul><div>${conteudo}</div></body></html>`,
  );
}

/** Lê a página guardada no balde de volta aos bytes originais, seguindo a referência do metadado. */
function lerDoBalde(b: ReturnType<typeof baldeFalso>, sha: string): Buffer {
  const chave = chaveDaPaginaZstd(sha);
  const ref = b.metadados.get(chave)?.["x-amz-meta-referencia"];
  const dic = ref ? gunzipSync(b.objetos.get(chaveDaReferencia(ref))!) : undefined;
  return descomprimirZstd(b.objetos.get(chave)!, dic);
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

  it("GET devolve os bytes (200) ou null (404)", async () => {
    const respostas = [new Response("abc", { status: 200 }), new Response(null, { status: 404 })];
    const c = criarClienteR2({ ...base, fetchFn: (async () => respostas.shift()!) as typeof fetch });
    expect(Buffer.from((await c.ler("referencias/x.sha"))!).toString("utf8")).toBe("abc");
    expect(await c.ler("referencias/y.sha")).toBeNull();
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

  it("a página é endereçada pelo sha256 dos bytes ORIGINAIS, nos dois formatos", () => {
    expect(chaveDaPagina(sha)).toBe(`paginas/${sha.slice(0, 2)}/${sha.slice(2, 4)}/${sha}.html.gz`);
    expect(chaveDaPaginaZstd(sha)).toBe(`paginas/${sha.slice(0, 2)}/${sha.slice(2, 4)}/${sha}.zst`);
    expect(chaveDaReferencia(sha)).toBe(`referencias/${sha}.html.gz`);
    expect(chaveDoPonteiro("visualizacaoideia", "abcd")).toBe("referencias/visualizacaoideia/abcd.sha");
    expect(chaveDoManifesto("ideias", "123-1", 7)).toBe("manifestos/ideias/123-1/parte-007.jsonl.gz");
  });

  it("tipo da página = último segmento do caminho, sem acento", () => {
    expect(tipoDaPagina("https://www12.senado.leg.br/ecidadania/visualizacaoideia?id=1")).toBe("visualizacaoideia");
    expect(tipoDaPagina("https://www12.senado.leg.br/ecidadania/pesquisaideia?situacao=7&p=956")).toBe("pesquisaideia");
    expect(tipoDaPagina("https://www.senado.gov.br/bi-arqs/Arquimedes/ecidadania/DadosAbertos/Proposi%C3%A7%C3%B5es-com-votos.csv")).toBe(
      "proposicoes-com-votos-csv",
    );
  });

  it("versão do portal muda com o carimbo de versão, NÃO com o DC.date.modified", () => {
    const a = versaoDoLayout(paginaDoPortal("x", "v1", "2026-11-11T11:04:20-03:00"));
    expect(versaoDoLayout(paginaDoPortal("y", "v1", "2026-11-12T09:24:20-03:00"))).toBe(a);
    expect(versaoDoLayout(paginaDoPortal("x", "v2"))).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(versaoDoLayout(enc("<div>fragmento AJAX</div>"))).toBe("sem-layout");
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
    expect(JSON.parse(linhas[1])).toMatchObject({ sha256: sha, nova: 0, entityId: "1", formato: null, referencia: null });
    expect(JSON.parse(manifestoJsonl([{ ...r, formato: "zstd+ref", referencia: "f".repeat(64) }]))).toMatchObject({
      formato: "zstd+ref", referencia: "f".repeat(64),
    });
  });

  it("linha da página gravada: OR IGNORE (o sha já registrado não muda)", () => {
    const s = paginaInsertStmt({ sha256: sha, formato: "zstd+ref", referencia: "e".repeat(64), bytesGravados: 634, gravadaEm: "2026-11-15T20:00:00.000Z" });
    expect(s).toMatch(/^INSERT OR IGNORE INTO ecidadania_arquivo_pagina \(sha256, formato, referencia, bytes_gravados, gravada_em\)/);
    expect(s).toContain("'zstd+ref'");
  });
});

describe("autoprova do zstd com dicionário", () => {
  it.runIf(TEM_DICIONARIO)("Node ≥ 24.6: passa", () => {
    expect(() => autoprovaZstd()).not.toThrow();
  });

  it.runIf(!TEM_DICIONARIO)("Node sem dicionário: recusa, dizendo a versão (o job para antes de coletar)", () => {
    expect(() => autoprovaZstd()).toThrow(process.version);
  });
});

describe.runIf(TEM_DICIONARIO)("Arquivo — guarda antes de ler, uma vez só, cada leitura no índice", () => {
  const url = "https://www12.senado.leg.br/ecidadania/visualizacaoideia?id=136304";
  const url2 = "https://www12.senado.leg.br/ecidadania/visualizacaoideia?id=94406";

  it("1ª página do tipo × versão vira a referência (gzip) e a página vai em zstd; volta aos bytes exatos", async () => {
    const b = baldeFalso();
    const { arq, sqls } = arquivoDeTeste(b.cliente);
    const corpo = paginaDoPortal("ideia 136304");
    const sha = sha256Hex(corpo);
    await arq.guardar(url, 200, corpo);
    const ptr = chaveDoPonteiro("visualizacaoideia", versaoDoLayout(corpo));
    expect(Buffer.from(b.objetos.get(ptr)!).toString("utf8").trim()).toBe(sha);
    expect(Buffer.from(gunzipSync(b.objetos.get(chaveDaReferencia(sha))!)).equals(Buffer.from(corpo))).toBe(true);
    expect(b.metadados.get(chaveDaPaginaZstd(sha))).toMatchObject({ "x-amz-meta-formato": "zstd+ref", "x-amz-meta-referencia": sha });
    expect(lerDoBalde(b, sha).equals(Buffer.from(corpo))).toBe(true);
    expect(b.objetos.has(chaveDaPagina(sha))).toBe(false); // nada novo em gzip
    expect(arq.resumo()).toMatchObject({ leituras: 1, novas: 1, repetidas: 0, referenciasNovas: 1 });
    await arq.descarregar();
    expect(sqls[0]).toContain("INSERT OR IGNORE INTO ecidadania_arquivo_pagina");
    expect(sqls[0]).toContain(`'zstd+ref', '${sha}'`);
  });

  it("2ª página do mesmo tipo × versão usa a mesma referência e sai pequena (o esqueleto não se repete)", async () => {
    const b = baldeFalso();
    const { arq } = arquivoDeTeste(b.cliente);
    const p1 = paginaDoPortal("ideia 136304");
    const p2 = paginaDoPortal("ideia 94406, com outro texto", undefined, "2026-11-13T08:00:00-03:00");
    await arq.guardar(url, 200, p1);
    await arq.guardar(url2, 200, p2);
    const guardada = b.objetos.get(chaveDaPaginaZstd(sha256Hex(p2)))!;
    expect(b.metadados.get(chaveDaPaginaZstd(sha256Hex(p2)))?.["x-amz-meta-referencia"]).toBe(sha256Hex(p1));
    expect(guardada.length).toBeLessThan(p2.length / 20);
    expect(lerDoBalde(b, sha256Hex(p2)).equals(Buffer.from(p2))).toBe(true);
    expect(arq.resumo().referenciasNovas).toBe(1);
  });

  it("outro run reaproveita a referência do balde (GET do ponteiro + referência), sem gravar outra", async () => {
    const b = baldeFalso();
    const p1 = paginaDoPortal("ideia 136304");
    await arquivoDeTeste(b.cliente).arq.guardar(url, 200, p1);
    const { arq } = arquivoDeTeste(b.cliente);
    const p2 = paginaDoPortal("ideia 94406");
    await arq.guardar(url2, 200, p2);
    expect(arq.resumo().referenciasNovas).toBe(0);
    expect(b.metadados.get(chaveDaPaginaZstd(sha256Hex(p2)))?.["x-amz-meta-referencia"]).toBe(sha256Hex(p1));
    expect(lerDoBalde(b, sha256Hex(p2)).equals(Buffer.from(p2))).toBe(true);
  });

  it("corrida: o ponteiro já aponta para outra página → usa a que está no balde, não a sua", async () => {
    const outra = paginaDoPortal("ideia de outro run");
    const shaOutra = sha256Hex(outra);
    const versao = versaoDoLayout(outra);
    const b = baldeFalso({
      [chaveDaReferencia(shaOutra)]: gzipSync(outra),
      [chaveDoPonteiro("visualizacaoideia", versao)]: enc(`${shaOutra}\n`),
    });
    const { arq } = arquivoDeTeste(b.cliente);
    const minha = paginaDoPortal("ideia 136304");
    await arq.guardar(url, 200, minha);
    expect(b.metadados.get(chaveDaPaginaZstd(sha256Hex(minha)))?.["x-amz-meta-referencia"]).toBe(shaOutra);
    expect(b.objetos.has(chaveDaReferencia(sha256Hex(minha)))).toBe(false);
    expect(lerDoBalde(b, sha256Hex(minha)).equals(Buffer.from(minha))).toBe(true);
  });

  it("referência adulterada no balde (sha não confere) → arquivo indisponível, a página não é lida", async () => {
    const outra = paginaDoPortal("ideia de outro run");
    const b = baldeFalso({
      [chaveDaReferencia(sha256Hex(outra))]: gzipSync(enc("outra coisa")),
      [chaveDoPonteiro("visualizacaoideia", versaoDoLayout(outra))]: enc(sha256Hex(outra)),
    });
    const { arq } = arquivoDeTeste(b.cliente);
    await expect(arq.guardar(url, 200, paginaDoPortal("ideia 1"))).rejects.toBeInstanceOf(ArquivoIndisponivelError);
  });

  it("versão nova do portal → referência nova", async () => {
    const b = baldeFalso();
    const { arq } = arquivoDeTeste(b.cliente);
    await arq.guardar(url, 200, paginaDoPortal("ideia 1", "v-antiga"));
    await arq.guardar(url2, 200, paginaDoPortal("ideia 2", "v-nova"));
    expect(arq.resumo().referenciasNovas).toBe(2);
  });

  it("página idêntica não é regravada: nem PUT nem novo HEAD no mesmo run, mas vira linha do índice", async () => {
    const b = baldeFalso();
    const { arq, sqls } = arquivoDeTeste(b.cliente);
    const corpo = paginaDoPortal("igual");
    await arq.guardar(url, 200, corpo);
    const antes = { ...b.chamadas };
    await arq.guardar(url, 200, corpo);
    expect(b.chamadas).toEqual(antes);
    await arq.descarregar();
    const indice = sqls[0].trim().split("\n").filter((l) => l.startsWith("INSERT INTO ecidadania_arquivo_indice"));
    expect(indice).toHaveLength(2);
    expect(sqls[0]).toMatch(/, 1\);\n.*, 0\);\n$/);
  });

  it("página já guardada em GZIP por outro run (formato antigo): encontra, não grava de novo, nova = 0", async () => {
    const corpo = enc("<html>de ontem</html>");
    const b = baldeFalso({ [chaveDaPagina(sha256Hex(corpo))]: enc("gz") });
    const { arq } = arquivoDeTeste(b.cliente);
    await arq.guardar(url, 200, corpo);
    expect(b.chamadas.put).toBe(0);
    expect(arq.resumo()).toMatchObject({ novas: 0, repetidas: 1 });
  });

  it("página já guardada em zstd por outro run: um HEAD só, não grava", async () => {
    const corpo = enc("<html>de ontem</html>");
    const b = baldeFalso({ [chaveDaPaginaZstd(sha256Hex(corpo))]: enc("zst") });
    const { arq } = arquivoDeTeste(b.cliente);
    await arq.guardar(url, 200, corpo);
    expect(b.chamadas).toMatchObject({ head: 1, put: 0 });
  });

  it("4xx/5xx sem referência ainda: guarda em zstd sem referência e NÃO vira referência", async () => {
    const b = baldeFalso();
    const { arq, sqls } = arquivoDeTeste(b.cliente);
    const corpo = enc("<html>removida</html>");
    await arq.guardar(url, 410, corpo);
    await arq.descarregar();
    expect(sqls[0]).toContain(", 410, ");
    expect(sqls[0]).toContain(`'${sha256Hex(corpo)}', 'zstd', NULL`);
    expect([...b.objetos.keys()].some((k) => k.endsWith(".sha"))).toBe(false);
    expect(lerDoBalde(b, sha256Hex(corpo)).equals(Buffer.from(corpo))).toBe(true);
  });

  it("página acima do limite (o CSV de ~33 MB) vai em zstd sem referência", async () => {
    const b = baldeFalso();
    const { arq } = arquivoDeTeste(b.cliente);
    const corpo = new Uint8Array(LIMITE_DICIONARIO + 1).fill(65);
    await arq.guardar("https://www.senado.gov.br/bi-arqs/x.csv", 200, corpo);
    expect(b.metadados.get(chaveDaPaginaZstd(sha256Hex(corpo)))).toMatchObject({ "x-amz-meta-formato": "zstd" });
    expect(arq.resumo().referenciasNovas).toBe(0);
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
