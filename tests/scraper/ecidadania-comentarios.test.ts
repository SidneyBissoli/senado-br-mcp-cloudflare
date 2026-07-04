/**
 * Unit tests for the v2 detail/comment parsers (ROADMAP ETAPA 5.5). Pure, fixture-based — no network.
 *
 * Covers: the AJAX comment fragment parser (UF-only, no name; canonical count; video-moment fields),
 * the corpus-facing idea detail parser (UF-only), the corpus-facing consulta detail parser
 * (autoria/relator — public, name kept), and the enriched EventoResumo builder (detail overrides
 * listing, with listing fallback).
 */

import { describe, it, expect } from "vitest";
import {
  parseComentariosAudiencia,
  parseIdeiaDetalheCorpus,
  parseConsultaDetalheCorpus,
  parseEventoDetalhe,
  buildEventoResumoEnriquecido,
} from "../../src/scraper/ecidadania.js";
import comentariosHtml from "../fixtures/ecidadania/comentarios-audiencia.html?raw";
import ideiaDetalheHtml from "../fixtures/ecidadania/ideia-detalhe.html?raw";
import consultaDetalheHtml from "../fixtures/ecidadania/consulta-detalhe.html?raw";
import eventoDetalheHtml from "../fixtures/ecidadania/evento-detalhe.html?raw";

describe("parseComentariosAudiencia — nível-comentário (UF-only)", () => {
  const comentarios = parseComentariosAudiencia(comentariosHtml);

  it("um registro por bloco <div class=comentario> (contagem canônica)", () => {
    expect(comentarios).toHaveLength(4);
  });

  it("extrai comentarioId do data-id", () => {
    expect(comentarios.map((c) => c.comentarioId)).toEqual([386637, 386635, 379612, 379395]);
  });

  it("guarda SÓ a UF — o nome do comentarista é descartado na origem", () => {
    expect(comentarios[0].uf).toBe("PA");
    expect(comentarios[1].uf).toBe("GO");
    // Nenhum campo carrega o nome (nem via texto do título).
    for (const c of comentarios) {
      expect(JSON.stringify(c)).not.toContain("RAYLAN");
      expect(JSON.stringify(c)).not.toContain("SAMUEL");
    }
  });

  it("uf é null quando o bloco não traz '(UF)'", () => {
    expect(comentarios[3].uf).toBeNull();
  });

  it("preserva o texto verbatim", () => {
    expect(comentarios[0].texto).toContain("rotulagem clara de ultraprocessados");
  });

  it("parseia data (ISO) e hora (HH:MM) de 'HHhMM - DD/MM/AAAA'", () => {
    expect(comentarios[0].data).toBe("2026-05-28");
    expect(comentarios[0].hora).toBe("07:27");
    expect(comentarios[3].hora).toBe("00:00");
  });

  it("captura momento do vídeo + convidado associado quando presentes", () => {
    expect(comentarios[2].momentoVideoUrl).toContain("youtube.com/watch");
    expect(comentarios[2].convidadoAssociado).toContain("Patrícia Souza");
    // Ausente nos demais.
    expect(comentarios[0].momentoVideoUrl).toBeNull();
    expect(comentarios[0].convidadoAssociado).toBeNull();
  });

  it("fragmento vazio (evento sem comentários) → array vazio", () => {
    expect(parseComentariosAudiencia("")).toEqual([]);
    expect(parseComentariosAudiencia("<div>nada</div>")).toEqual([]);
  });
});

describe("parseIdeiaDetalheCorpus — UF-only, sem nome do autor cidadão", () => {
  const d = parseIdeiaDetalheCorpus(ideiaDetalheHtml);

  it("nunca retorna o nome do autor (só a UF, quando houver)", () => {
    if (d.autorUf !== null) expect(d.autorUf).toMatch(/^[A-Z]{2}$/);
    expect(Object.values(d).every((v) => typeof v !== "string" || !/\bproposta por\b/i.test(v))).toBe(true);
  });
});

describe("parseConsultaDetalheCorpus — autoria/relator (público, nome mantido)", () => {
  const d = parseConsultaDetalheCorpus(consultaDetalheHtml);
  it("retorna autoria/relator como strings ou null (não lança)", () => {
    expect(d).toHaveProperty("autoria");
    expect(d).toHaveProperty("relator");
  });
});

describe("buildEventoResumoEnriquecido — detalhe sobrepõe a listagem, com fallback", () => {
  const detalhe = parseEventoDetalhe(eventoDetalheHtml);

  it("usa data/hora do detalhe (canônicas) quando presentes", () => {
    const ev = buildEventoResumoEnriquecido({
      id: 39529,
      titulo: "T",
      comissao: "CCT",
      status: "encerrado",
      dataListagem: "2026-06-24",
      horaListagem: "10:16", // offset da listagem (estudo A3)
      comentariosListagem: 0,
      detalhe,
      comentariosCanon: 62,
    });
    // data/hora vêm do detalhe se o detalhe as tiver; senão caem no fallback da listagem.
    expect(ev.data).toBe(detalhe.data ?? "2026-06-24");
    expect(ev.hora).toBe(detalhe.hora ?? "10:16");
    expect(ev.comentarios).toBe(62); // contagem canônica
    expect(Object.keys(ev)).toEqual([
      "id", "titulo", "data", "hora", "comissao", "comissaoNomeCompleto", "local",
      "descricao", "pauta", "convidados", "videoUrl", "comentarios", "status", "url",
    ]);
  });

  it("sem detalhe: cai no fallback da listagem e comentarios da listagem", () => {
    const ev = buildEventoResumoEnriquecido({
      id: 7,
      titulo: "T",
      comissao: "CDH",
      status: "agendado",
      dataListagem: "2026-01-02",
      horaListagem: "09:00",
      comentariosListagem: 3,
      detalhe: null,
      comentariosCanon: null,
    });
    expect(ev.data).toBe("2026-01-02");
    expect(ev.hora).toBe("09:00");
    expect(ev.comentarios).toBe(3);
    expect(ev.comissaoNomeCompleto).toBeNull();
    expect(ev.pauta).toEqual([]);
    expect(ev.convidados).toEqual([]);
  });
});
