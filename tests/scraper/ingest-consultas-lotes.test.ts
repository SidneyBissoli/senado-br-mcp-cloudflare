/**
 * Gravação em lotes do job de consultas (18/10/2026, pedido do dono: falha no meio não pode perder o
 * que já foi lido) e linha de andamento. Puro: sem rede, sem D1.
 */
import { describe, it, expect } from "vitest";
import { registroConsultaListada, syncRecordDeConsulta, loteParcial } from "../../scripts/ingest-ecidadania/consultas-registro.js";
import { descreverAndamento } from "../../scripts/ingest-ecidadania/andamento.js";
import { buildConsultaResumo } from "../../src/scraper/ecidadania.js";
import { planEntitySync } from "../../src/scraper/pipeline.js";
import type { ListingItem } from "../../scripts/ingest-ecidadania/listing.js";

const item: ListingItem = { codigoMateria: 7, identificacao: "PL 7/2026", ementa: "Ementa", votosSim: 3, votosNao: 1 };
const guardado = JSON.stringify(
  buildConsultaResumo({ id: 7, materia: "PL 7/2026", ementa: "Ementa", votosSim: 3, votosNao: 1, autoria: null, status: "aberta" }),
);
const lido = { autoria: "Senador Fulano (PT/BA)", relator: null };

describe("registroConsultaListada", () => {
  it("detalhe lido grava a autoria; sem detalhe, mantém a guardada", () => {
    expect(registroConsultaListada(item, "aberta", guardado, lido).autoria).toBe("Senador Fulano (PT/BA)");
    const comAutoria = JSON.stringify(registroConsultaListada(item, "aberta", guardado, lido));
    expect(registroConsultaListada(item, "aberta", comAutoria).autoria).toBe("Senador Fulano (PT/BA)");
  });

  it("leitura vazia da listagem não apaga o guardado (mesclarCampo)", () => {
    const vazio: ListingItem = { ...item, identificacao: null, ementa: null, votosSim: null, votosNao: null };
    const r = registroConsultaListada(vazio, "aberta", guardado);
    expect(r.materia).toBe("PL 7/2026");
    expect(r.votosSim).toBe(3);
  });
});

describe("loteParcial", () => {
  it("o que o lote gravou volta na gravação final com o mesmo hash: nenhuma versão nova no histórico", () => {
    const hashes = new Map([[7, planEntitySync([syncRecordDeConsulta(JSON.parse(guardado))], new Map()).annotated[0].rec.contentHash]]);
    const payloads = new Map([[7, guardado]]);
    const rec = syncRecordDeConsulta(registroConsultaListada(item, "aberta", payloads.get(7), lido));

    const { arquivos, alteradas } = loteParcial([rec], hashes, payloads, "2026-10-19T05:30:00.000Z");
    expect(alteradas).toBe(1);
    expect(arquivos.join("")).toContain("INSERT INTO ecidadania_current");
    expect(arquivos.join("")).toContain("INSERT OR IGNORE INTO ecidadania_history");
    expect(arquivos.join("")).not.toContain("ecidadania_scrape_runs"); // run row só na gravação final

    // gravação final: monta de novo pela mesma função, a partir do payload já atualizado pelo lote
    const final = syncRecordDeConsulta(registroConsultaListada(item, "aberta", payloads.get(7), lido));
    expect(planEntitySync([final], hashes).rowsChanged).toBe(0);
  });

  it("lote sem mudança não gera histórico", () => {
    const rec = syncRecordDeConsulta(JSON.parse(guardado));
    const hashes = new Map([[7, rec.contentHash]]);
    const { arquivos, alteradas } = loteParcial([rec], hashes, new Map(), "2026-10-19T05:30:00.000Z");
    expect(alteradas).toBe(0);
    expect(arquivos.join("")).not.toContain("ecidadania_history");
  });
});

describe("descreverAndamento", () => {
  it("diz quantas, quantas gravadas, ritmo e término previsto em UTC e em Brasília", () => {
    const inicio = Date.UTC(2026, 9, 19, 5, 0, 0);
    const linha = descreverAndamento({
      rotulo: "detalhe lido", feitos: 750, total: 3000, gravados: 750,
      inicioMs: inicio, agoraMs: inicio + 750 * 2000, // 2 s por item
    });
    // faltam 2250 × 2 s = 75 min a partir de 05:25 → 06:40 UTC = 03:40 em Brasília
    expect(linha).toBe(
      "detalhe lido: 750 de 3000 · 750 gravadas no banco · 2,0 s por item · término previsto 06:40 UTC (03:40 em Brasília)",
    );
  });

  it("sem item feito ainda, não inventa previsão", () => {
    expect(descreverAndamento({ rotulo: "x", feitos: 0, total: 10, inicioMs: 0, agoraMs: 5 })).toBe("x: 0 de 10");
  });
});
