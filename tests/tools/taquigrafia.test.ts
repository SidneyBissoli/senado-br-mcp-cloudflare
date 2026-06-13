import { describe, it, expect } from "vitest";
import { parseQuartoResumo, parseQuartoTexto, parseVideoUnidade } from "../../src/tools/taquigrafia.js";

describe("parseQuartoResumo", () => {
  it("truncates long texts into a trecho", () => {
    const longo = "A".repeat(500);
    const result = parseQuartoResumo({
      sequencia: "1",
      dataInicio: "2025-06-10T14:00:00-03:00",
      dataFim: "2025-06-10T14:04:00-03:00",
      texto: longo,
      linkAudio: "https://audio.mp3",
    });
    expect(result.sequencia).toBe(1);
    expect(result.trecho).toHaveLength(201); // 200 + ellipsis
    expect(result.trecho.endsWith("…")).toBe(true);
    expect(result.caracteres).toBe(500);
    expect(result.linkAudio).toBe("https://audio.mp3");
  });

  it("keeps short texts intact without ellipsis", () => {
    const result = parseQuartoResumo({ sequencia: "2", texto: "Fala curta." });
    expect(result.trecho).toBe("Fala curta.");
    expect(result.caracteres).toBe(11);
  });

  it("handles missing texto", () => {
    const result = parseQuartoResumo({ sequencia: "3" });
    expect(result.trecho).toBe("");
    expect(result.caracteres).toBe(0);
  });
});

describe("parseQuartoTexto", () => {
  it("returns the full text", () => {
    const result = parseQuartoTexto({
      sequencia: "5",
      texto: "O SR. PRESIDENTE – Declaro aberta a sessão.",
    });
    expect(result.sequencia).toBe(5);
    expect(result.texto).toContain("Declaro aberta");
  });
});

describe("parseVideoUnidade", () => {
  it("parses a video descriptive unit", () => {
    const result = parseVideoUnidade({
      codigo: 3650238,
      dataUnidade: "2025-06-10T14:00:36-03:00",
      descricao: "Abertura",
      descricaoOrador: "Confúcio Moura (Senador MDB-RO)",
      duracaoAudio: "99",
      duracaoVideo: "99",
      enderecoAudio: "https://a.mp3",
      enderecoVideo: "https://v.mp4",
      enderecoThumbnail: "https://t.jpg",
    });
    expect(result.codigo).toBe(3650238);
    expect(result.orador).toContain("Confúcio Moura");
    expect(result.duracaoSegundos).toBe(99);
    expect(result.urlVideo).toBe("https://v.mp4");
    expect(result.urlAudio).toBe("https://a.mp3");
  });

  it("handles empty input", () => {
    const result = parseVideoUnidade({});
    expect(result.codigo).toBeNull();
    expect(result.duracaoSegundos).toBeNull();
  });
});
