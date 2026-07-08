import { describe, it, expect } from "vitest";
import {
  parseServidor,
  resumoRemuneracao,
  normalizarRemuneracao,
  consolidarPorSequencial,
  estatisticasRemuneracoes,
  parseHoraExtra,
  estatisticasHorasExtras,
} from "../../src/tools/servidores.js";
import { unwrapAdmEnvelope } from "../../src/utils/upstream-parse.js";
import { ensureArray, parseBRL } from "../../src/utils/validation.js";

describe("pessoal_tabelas estagiarios envelope (BUG-034)", () => {
  // /servidores/estagiarios wraps its list in {statusCode,msg,data}; the tool used to
  // ensureArray the envelope itself (count 1 with all 478 rows nested in data).
  it("unwraps the envelope into the real rows", () => {
    const response = {
      statusCode: 200,
      msg: "Dados gerados com sucesso",
      data: [
        { nome: "Ada Brígida", curso: "Letras", siglaOrgao: "SERVSO", nomeOrgao: "SERVIÇO DE REVISÃO" },
        { nome: "Beto", curso: "Direito", siglaOrgao: "X", nomeOrgao: "Y" },
      ],
    };
    const registros = ensureArray(unwrapAdmEnvelope(response));
    expect(registros).toHaveLength(2);
    expect((registros[0] as any).curso).toBe("Letras");
  });

  it("leaves a flat array (pensionistas/aposentados) unchanged", () => {
    const flat = [{ nome: "A" }, { nome: "B" }];
    expect(ensureArray(unwrapAdmEnvelope(flat))).toHaveLength(2);
  });
});

describe("parseServidor", () => {
  it("parses a snake_case servant item", () => {
    const result = parseServidor({
      sequencial: 1,
      nome: "FULANO DE TAL",
      vinculo: "EFETIVO",
      situacao: "ATIVO",
      cargo: "ANALISTA LEGISLATIVO",
      especialidade: "PROCESSO LEGISLATIVO",
      funcao: "FC-3",
      lotacao: "SGM",
      categoria: "NIVEL III",
      cedido: "NÃO",
      ano_admissao: 2012,
    });
    expect(result.nome).toBe("FULANO DE TAL");
    expect(result.vinculo).toBe("EFETIVO");
    expect(result.cargo).toBe("ANALISTA LEGISLATIVO");
    expect(result.lotacao).toBe("SGM");
    expect(result.anoAdmissao).toBe(2012);
    expect((result as any).sequencial).toBeUndefined();
  });

  it("handles empty input", () => {
    const result = parseServidor({});
    expect(result.nome).toBe("");
    expect(result.cargo).toBeNull();
    expect(result.anoAdmissao).toBeNull();
  });
});

describe("resumoRemuneracao", () => {
  it("computes the gross total from components", () => {
    const result = resumoRemuneracao({
      nome: "FULANO",
      tipo_folha: "Servidores",
      remuneracao_basica: 10000,
      vantagens_pessoais: 500.5,
      funcao_comissionada: 1000,
      gratificacao_natalina: 0,
      horas_extras: 250.25,
      outras_eventuais: 0,
      abono_permanencia: 0,
      diarias: 300,
      auxilios: 100,
    });
    expect(result.bruto).toBe(11750.75);
    expect(result.diarias).toBe(300);
    expect(result.tipoFolha).toBe("Servidores");
  });

  it("treats non-numeric fields as zero", () => {
    const result = resumoRemuneracao({ nome: "X", remuneracao_basica: "n/a" });
    expect(result.bruto).toBe(0);
  });

  // BUG-001: the API returns pt-BR strings ("20.529,64", "-2.777,41"); num() returned 0.
  it("parses real pt-BR string amounts (BUG-001)", () => {
    const result = resumoRemuneracao({
      nome: "ADRIANA",
      tipo_folha: "Suplementar",
      remuneracao_basica: "-2.777,41",
      vantagens_pessoais: "2.777,41",
      funcao_comissionada: "0,00",
      gratificacao_natalina: "20.529,64",
      horas_extras: "0,00",
      outras_eventuais: "0,00",
      abono_permanencia: "0,00",
    });
    expect(result.remuneracaoBasica).toBe(-2777.41);
    expect(result.gratificacaoNatalina).toBe(20529.64);
    expect(result.bruto).toBe(20529.64); // sum of components, no longer 0
  });
});

describe("normalizarRemuneracao", () => {
  it("parses every value column and derives bruto (unrounded) + liquida", () => {
    const rec = normalizarRemuneracao({
      sequencial: 42,
      nome: "FULANA",
      tipo_folha: "Normal",
      remuneracao_basica: "10.000,00",
      vantagens_pessoais: "500,50",
      funcao_comissionada: "1.000,00",
      gratificacao_natalina: "0,00",
      horas_extras: "250,25",
      outras_eventuais: "0,00",
      abono_permanencia: "0,00",
      diarias: "300,00",
      auxilios: "100,00",
      remuneracao_liquida: "9.123,45",
    });
    expect(rec.sequencial).toBe(42);
    expect(rec.remuneracaoBasica).toBe(10000);
    expect(rec.bruto).toBe(11750.75); // 10000 + 500.5 + 1000 + 250.25
    expect(rec.liquida).toBe(9123.45);
    expect(rec.diarias).toBe(300);
  });

  it("coerces a string sequencial to a number and null when absent", () => {
    expect(normalizarRemuneracao({ sequencial: "7", nome: "A" }).sequencial).toBe(7);
    expect(normalizarRemuneracao({ nome: "B" }).sequencial).toBeNull();
  });
});

describe("consolidarPorSequencial", () => {
  it("nets Normal + Suplementar (estorno) rows of the same servant into one", () => {
    // Same person, two rows sharing sequencial 100; Suplementar is a negative estorno.
    const linhas = [
      { sequencial: 100, nome: "MARIA", tipo_folha: "Normal", remuneracao_basica: "40.000,00", remuneracao_liquida: "30.000,00" },
      { sequencial: 100, nome: "MARIA", tipo_folha: "Suplementar", remuneracao_basica: "-5.000,00", remuneracao_liquida: "-4.000,00" },
      { sequencial: 200, nome: "JOÃO", tipo_folha: "Normal", remuneracao_basica: "20.000,00", remuneracao_liquida: "15.000,00" },
    ].map(normalizarRemuneracao);

    const consolidado = consolidarPorSequencial(linhas);
    expect(consolidado).toHaveLength(2);
    const maria = consolidado.find((r) => r.sequencial === 100)!;
    expect(maria.remuneracaoBasica).toBe(35000); // 40000 - 5000
    expect(maria.bruto).toBe(35000);
    expect(maria.liquida).toBe(26000); // 30000 - 4000
    expect(maria.tipoFolha).toBe("consolidado");
  });

  it("keeps rows with a missing sequencial un-merged", () => {
    const linhas = [
      { nome: "X", tipo_folha: "Normal", remuneracao_basica: "1.000,00" },
      { nome: "Y", tipo_folha: "Normal", remuneracao_basica: "2.000,00" },
    ].map(normalizarRemuneracao);
    expect(consolidarPorSequencial(linhas)).toHaveLength(2);
  });
});

describe("estatisticasRemuneracoes", () => {
  // Two servants, each with a Normal + Suplementar line. Consolidated brutos: seq 1 = 30000, seq 2 = 12000.
  const folha = [
    { sequencial: 1, nome: "ALICE", tipo_folha: "Normal", remuneracao_basica: "35.000,00" },
    { sequencial: 1, nome: "ALICE", tipo_folha: "Suplementar", remuneracao_basica: "-5.000,00" },
    { sequencial: 2, nome: "BRUNO", tipo_folha: "Normal", remuneracao_basica: "10.000,00" },
    { sequencial: 2, nome: "BRUNO", tipo_folha: "Suplementar", remuneracao_basica: "2.000,00" },
  ];

  it("consolidates by servant and ranks the top by bruto", () => {
    const out = estatisticasRemuneracoes(folha, { campo: "bruto", consolidar: true, topN: 10 }) as any;
    expect(out.consolidadoPorServidor).toBe(true);
    expect(out.totalServidores).toBe(2);
    expect(out.estatisticas.maximo).toBe(30000);
    expect(out.estatisticas.minimo).toBe(12000);
    expect(out.estatisticas.media).toBe(21000);
    expect(out.top[0]).toMatchObject({ sequencial: 1, nome: "ALICE", valor: 30000 });
    expect(out.bottom[0]).toMatchObject({ sequencial: 2, valor: 12000 });
  });

  it("per-line (não consolidado) sees the 4 raw rows and their max", () => {
    const out = estatisticasRemuneracoes(folha, { campo: "bruto", consolidar: false, topN: 10 }) as any;
    expect(out.consolidadoPorServidor).toBe(false);
    expect(out.totalRegistros).toBe(4);
    expect(out.estatisticas.maximo).toBe(35000); // ALICE's Normal line, un-netted
  });

  it("agruparPor=tipoFolha forces per-line and returns groups", () => {
    const out = estatisticasRemuneracoes(folha, { campo: "bruto", consolidar: true, agruparPor: "tipoFolha", topN: 5 }) as any;
    expect(out.consolidadoPorServidor).toBe(false); // agruparPor overrides consolidation
    expect(out.agrupadoPor).toBe("tipoFolha");
    expect(out.totalGrupos).toBe(2);
    const grupos = Object.fromEntries(out.grupos.map((g: any) => [g.grupo, g]));
    expect(grupos["Normal"].estatisticas.soma).toBe(45000); // 35000 + 10000
    expect(grupos["Suplementar"].estatisticas.soma).toBe(-3000); // -5000 + 2000
  });
});

describe("horas_extras aggregate (BUG-002)", () => {
  // valorTotal comes as a pt-BR string; the aggregate summed only numbers -> 0.
  it("sums parsed pt-BR valorTotal values", () => {
    const itens = [{ valorTotal: "127,50" }, { valorTotal: "1.953,14" }, { valorTotal: "0,00" }]
      .map((h) => ({ valorTotal: parseBRL(h.valorTotal) }));
    const total = Math.round(itens.reduce((s, h) => s + h.valorTotal, 0) * 100) / 100;
    expect(itens[1].valorTotal).toBe(1953.14); // individual is now a number
    expect(total).toBe(2080.64);
  });
});

describe("parseHoraExtra", () => {
  it("maps the adm snake_case row and parses the pt-BR valorTotal", () => {
    const out = parseHoraExtra({
      nome: "ALICE",
      valorTotal: "1.638,51",
      mes_ano_prestacao: "02/2024",
      mes_ano_pagamento: "03/2024",
      horas_extras: [{ dia: "26/02/2024", quantidade: "01h30" }],
    });
    expect(out.valorTotal).toBe(1638.51); // pt-BR string -> number
    expect(out).toMatchObject({ nome: "ALICE", competencia: "02/2024", pagamento: "03/2024" });
    expect(out.horasExtras).toHaveLength(1); // raw detail kept as-is, not the value
  });

  it("defaults missing fields to null / empty", () => {
    const out = parseHoraExtra({ valorTotal: "0,00" });
    expect(out).toMatchObject({ nome: "", competencia: null, pagamento: null, horasExtras: null });
    expect(out.valorTotal).toBe(0);
  });
});

describe("estatisticasHorasExtras", () => {
  // Four paid lines; BRUNO holds two (different competências paid together) -> 700 when summed by name.
  const itens = [
    { valorTotal: "1.000,00", mes_ano_prestacao: "02/2024", mes_ano_pagamento: "03/2024", nome: "ALICE" },
    { valorTotal: "300,00", mes_ano_prestacao: "02/2024", mes_ano_pagamento: "03/2024", nome: "BRUNO" },
    { valorTotal: "400,00", mes_ano_prestacao: "01/2024", mes_ano_pagamento: "03/2024", nome: "BRUNO" },
    { valorTotal: "200,00", mes_ano_prestacao: "02/2024", mes_ano_pagamento: "03/2024", nome: "CARLA" },
  ].map(parseHoraExtra);

  it("without agruparPor crunches the whole-set distribution over valorTotal", () => {
    const out = estatisticasHorasExtras(itens, { topN: 10 }) as any;
    expect(out.distribuicao.n).toBe(4);
    expect(out.distribuicao.maximo).toBe(1000);
    expect(out.distribuicao.minimo).toBe(200);
    expect(out.distribuicao.media).toBe(475); // (1000+300+400+200)/4
    expect(out.distribuicao.soma).toBe(1900);
    expect(out.top[0]).toMatchObject({ nome: "ALICE", valor: 1000 });
    expect(out.bottom[0]).toMatchObject({ nome: "CARLA", valor: 200 });
  });

  it("agruparPor=nome sums the lines per servant and ranks by total desc", () => {
    const out = estatisticasHorasExtras(itens, { agruparPor: "nome", topN: 10 }) as any;
    expect(out.agrupadoPor).toBe("nome");
    expect(out.totalGrupos).toBe(3); // ALICE, BRUNO, CARLA
    expect(out.grupos[0]).toMatchObject({ grupo: "ALICE" }); // 1000 = biggest
    const bruno = out.grupos.find((g: any) => g.grupo === "BRUNO");
    expect(bruno.soma).toBe(700); // 300 + 400 merged
    // total across groups reconciles with the whole-set sum
    expect(out.grupos.reduce((s: number, g: any) => s + g.soma, 0)).toBe(1900);
  });

  it("agruparPor=competencia groups by month of prestação", () => {
    const out = estatisticasHorasExtras(itens, { agruparPor: "competencia", topN: 10 }) as any;
    expect(out.agrupadoPor).toBe("competencia");
    expect(out.totalGrupos).toBe(2); // 02/2024 and 01/2024
    const grupos = Object.fromEntries(out.grupos.map((g: any) => [g.grupo, g]));
    expect(grupos["02/2024"].soma).toBe(1500); // 1000 + 300 + 200
    expect(grupos["01/2024"].soma).toBe(400);
  });
});
