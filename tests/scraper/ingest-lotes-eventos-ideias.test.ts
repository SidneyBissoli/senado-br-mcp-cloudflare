/**
 * Gravação em lotes dos jobs de eventos e de detalhe das ideias (23/10/2026, extensão do PR #143 das
 * consultas, decidida pelo dono em 18/10): cada lote leva o cursor na cauda, o que o lote gravou não
 * ganha segunda versão no histórico, e o vigia reprova POR LOTE (mín. 50 guardados por campo).
 * Puro: sem rede, sem D1.
 */
import { describe, it, expect } from "vitest";
import { fecharLote, LoteReprovadoError, LOTE_PADRAO, type Leitura } from "../../scripts/ingest-ecidadania/lotes.js";
import { registroDetalheIdeia, CAMPOS_DETALHE_IDEIA, type DetalheIdeiaLido } from "../../scripts/ingest-ecidadania/ideias-registro.js";
import { cursorUpsertStmt } from "../../scripts/ingest-ecidadania/sql.js";
import { buildIdeiaResumo } from "../../src/scraper/ecidadania.js";
import { contentHash, planEntitySync } from "../../src/scraper/pipeline.js";
import { N_MINIMO } from "../../src/scraper/mesclar.js";

const NOW = "2026-10-23T02:00:00.000Z";

function guardada(id: number): string {
  return JSON.stringify(
    buildIdeiaResumo({
      id,
      titulo: `Ideia ${id}`,
      apoios: 10,
      status: "aberta",
      dataPublicacao: "2024-01-02",
      autorUf: "SP",
      descricao: "descrição guardada",
      plConvertido: null,
      proposicoes: [],
    }),
  );
}

const lida: DetalheIdeiaLido = { dataPublicacao: "2024-01-02", autorUf: "RJ", descricao: "descrição nova", plConvertido: null, proposicoes: [] };

/** Um lote de `n` ideias cujo detalhe mudou (autorUf SP → RJ): linhas, leituras cruas e hashes correntes. */
function loteDeIdeias(n: number, lido: Record<string, unknown> = { ...lida }) {
  const ids = Array.from({ length: n }, (_, i) => i + 1);
  const payloads = new Map(ids.map((id) => [id, guardada(id)]));
  const hashes = new Map(ids.map((id) => [id, contentHash(payloads.get(id)!)]));
  const records = ids.map((id) => registroDetalheIdeia(payloads.get(id)!, id, lida));
  const leituras: Leitura[] = ids.map((id) => ({ lido, guardado: JSON.parse(payloads.get(id)!) as Record<string, unknown> }));
  return { ids, records, leituras, hashes };
}

describe("fecharLote — detalhe das ideias", () => {
  it("o lote leva o cursor na cauda do último arquivo, sem run row, e marca as alteradas no histórico", () => {
    const { records, leituras, hashes } = loteDeIdeias(3);
    const tail = cursorUpsertStmt("ideias", 3, 0, NOW);
    const fechado = fecharLote({ leituras, campos: CAMPOS_DETALHE_IDEIA, records, hashes, now: NOW, entidade: "ideias", tailStmt: tail });

    expect(fechado.vigia.ok).toBe(true);
    expect(fechado.alteradas).toBe(3);
    expect(fechado.arquivos).toHaveLength(1);
    const sql = fechado.arquivos[0];
    expect(sql).toContain("INSERT INTO ecidadania_current");
    expect(sql).toContain("INSERT OR IGNORE INTO ecidadania_history");
    expect(sql).not.toContain("ecidadania_scrape_runs"); // o backfill nunca grava run row 'ok'
    expect(sql.trimEnd().endsWith(tail)).toBe(true); // o cursor só avança depois de todas as linhas
  });

  it("o que o lote gravou volta na gravação seguinte com o mesmo hash: nenhuma versão nova", () => {
    const { records, leituras, hashes } = loteDeIdeias(2);
    fecharLote({ leituras, campos: CAMPOS_DETALHE_IDEIA, records, hashes, now: NOW, entidade: "ideias", tailStmt: "-- cauda" });
    expect(planEntitySync(records, hashes).rowsChanged).toBe(0);
  });

  it("lote sem mudança emite só os upserts e a cauda, sem histórico", () => {
    const ids = [1, 2];
    const payloads = new Map(ids.map((id) => [id, guardada(id)]));
    const hashes = new Map(ids.map((id) => [id, contentHash(payloads.get(id)!)]));
    const records = ids.map((id) => registroDetalheIdeia(payloads.get(id)!, id, null)); // fetch falhou: preserva
    const fechado = fecharLote({ leituras: [], campos: CAMPOS_DETALHE_IDEIA, records, hashes, now: NOW, entidade: "ideias", tailStmt: "-- cauda" });
    expect(fechado.alteradas).toBe(0);
    expect(fechado.arquivos.join("")).not.toContain("ecidadania_history");
    expect(fechado.arquivos.join("")).toContain("-- cauda");
  });
});

describe("vigia por lote", () => {
  const vazio = Object.fromEntries(CAMPOS_DETALHE_IDEIA.map((c) => [c, null]));

  it("leitura vazia em massa num lote com n ≥ 50 reprova o lote: nada emitido, hashes intactos", () => {
    const { records, leituras, hashes } = loteDeIdeias(N_MINIMO, vazio);
    const antes = new Map(hashes);
    const fechado = fecharLote({ leituras, campos: CAMPOS_DETALHE_IDEIA, records, hashes, now: NOW, entidade: "ideias", tailStmt: "-- cauda" });
    expect(fechado.vigia.ok).toBe(false);
    expect(fechado.vigia.quedas.map((q) => q.campo)).toEqual(["dataPublicacao", "autorUf", "descricao"]);
    expect(fechado.arquivos).toEqual([]);
    expect(fechado.alteradas).toBe(0);
    expect(hashes).toEqual(antes);

    const erro = new LoteReprovadoError(fechado.vigia, 2, 481);
    expect(erro.message).toContain("lote 2");
    expect(erro.message).toContain("autorUf 0/50 (0.0%)");
    expect(erro.message).toContain("cursor para em 481");
  });

  it("lote pequeno (abaixo do mínimo de guardados) não trava — é o mínimo decidido, 50", () => {
    const { records, leituras, hashes } = loteDeIdeias(N_MINIMO - 1, vazio);
    const fechado = fecharLote({ leituras, campos: CAMPOS_DETALHE_IDEIA, records, hashes, now: NOW, entidade: "ideias", tailStmt: "-- cauda" });
    expect(fechado.vigia.ok).toBe(true);
    expect(fechado.arquivos).toHaveLength(1);
  });

  it("o lote padrão (250) comporta o mínimo do vigia com folga", () => {
    expect(LOTE_PADRAO).toBeGreaterThanOrEqual(N_MINIMO);
  });
});
