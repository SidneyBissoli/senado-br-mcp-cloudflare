/**
 * Group H — Reference/metadata tools (4 tools)
 * senado_legislatura_atual, senado_tipos_materia, senado_partidos, senado_ufs
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { cachedFetch } from "../cache/manager.js";
import { upstreamFetch } from "../throttle/upstream.js";
import { toolResult, toolError, ensureArray } from "../utils/validation.js";
import { CACHE_STATIC } from "../types.js";

const TIPOS_MATERIA = [
  { sigla: "PEC", nome: "Proposta de Emenda à Constituição", descricao: "Altera a Constituição Federal" },
  { sigla: "PL", nome: "Projeto de Lei", descricao: "Projeto de lei ordinária" },
  { sigla: "PLP", nome: "Projeto de Lei Complementar", descricao: "Regulamenta dispositivos constitucionais" },
  { sigla: "MPV", nome: "Medida Provisória", descricao: "Medida com força de lei editada pelo Executivo" },
  { sigla: "PDL", nome: "Projeto de Decreto Legislativo", descricao: "Matéria de competência exclusiva do Congresso" },
  { sigla: "PRS", nome: "Projeto de Resolução do Senado", descricao: "Matéria de competência privativa do Senado" },
  { sigla: "PLC", nome: "Projeto de Lei da Câmara", descricao: "Projeto de lei originário da Câmara dos Deputados" },
  { sigla: "PLS", nome: "Projeto de Lei do Senado", descricao: "Projeto de lei originário do Senado (nomenclatura antiga)" },
  { sigla: "REQ", nome: "Requerimento", descricao: "Solicitação de providência ou informação" },
  { sigla: "RQS", nome: "Requerimento do Senado", descricao: "Requerimento de competência do Senado" },
  { sigla: "INC", nome: "Indicação", descricao: "Sugestão a outro Poder ou órgão" },
  { sigla: "SUG", nome: "Sugestão Legislativa", descricao: "Sugestão da sociedade civil" },
];

const UFS = [
  { sigla: "AC", nome: "Acre" }, { sigla: "AL", nome: "Alagoas" }, { sigla: "AP", nome: "Amapá" },
  { sigla: "AM", nome: "Amazonas" }, { sigla: "BA", nome: "Bahia" }, { sigla: "CE", nome: "Ceará" },
  { sigla: "DF", nome: "Distrito Federal" }, { sigla: "ES", nome: "Espírito Santo" }, { sigla: "GO", nome: "Goiás" },
  { sigla: "MA", nome: "Maranhão" }, { sigla: "MT", nome: "Mato Grosso" }, { sigla: "MS", nome: "Mato Grosso do Sul" },
  { sigla: "MG", nome: "Minas Gerais" }, { sigla: "PA", nome: "Pará" }, { sigla: "PB", nome: "Paraíba" },
  { sigla: "PR", nome: "Paraná" }, { sigla: "PE", nome: "Pernambuco" }, { sigla: "PI", nome: "Piauí" },
  { sigla: "RJ", nome: "Rio de Janeiro" }, { sigla: "RN", nome: "Rio Grande do Norte" },
  { sigla: "RS", nome: "Rio Grande do Sul" }, { sigla: "RO", nome: "Rondônia" }, { sigla: "RR", nome: "Roraima" },
  { sigla: "SC", nome: "Santa Catarina" }, { sigla: "SP", nome: "São Paulo" }, { sigla: "SE", nome: "Sergipe" },
  { sigla: "TO", nome: "Tocantins" },
];

/** Shared fetcher for the current senators list (used by partidos, ufs, legislatura). */
async function fetchSenadoresAtuais(baseUrl: string) {
  return cachedFetch("_senadores_atuais", {}, CACHE_STATIC, () =>
    upstreamFetch("/senador/lista/atual", {}, baseUrl),
  );
}

function extractParlamentares(response: any): any[] {
  const list =
    response?.ListaParlamentarEmExercicio?.Parlamentares?.Parlamentar ??
    response?.ListaParlamentarLegislatura?.Parlamentares?.Parlamentar;
  return ensureArray(list);
}

export function registerReferenciaTools(server: McpServer, baseUrl: string) {
  // H1. senado_legislatura_atual
  server.tool(
    "senado_legislatura_atual",
    "Retorna informações sobre a legislatura vigente, incluindo número, período e datas de início/fim.",
    {},
    async () => {
      try {
        const response = await fetchSenadoresAtuais(baseUrl);
        const parlamentares = extractParlamentares(response);
        const primeiro = parlamentares[0];
        let legislatura = primeiro?.Mandato?.PrimeiraLegislaturaDoMandato?.NumeroLegislatura;
        if (legislatura) {
          legislatura = parseInt(legislatura);
          const anoInicio = 2023 - (57 - legislatura) * 4;
          return toolResult({
            numero: legislatura,
            periodo: `${anoInicio}-${anoInicio + 4}`,
            dataInicio: `${anoInicio}-02-01`,
            dataFim: `${anoInicio + 4}-01-31`,
          });
        }
        // Fallback
        return toolResult({ numero: 57, periodo: "2023-2027", dataInicio: "2023-02-01", dataFim: "2027-01-31" });
      } catch (e) {
        return toolError(e instanceof Error ? e.message : "Erro ao obter legislatura");
      }
    },
  );

  // H2/B5. senado_tipos_materia
  server.tool(
    "senado_tipos_materia",
    "Lista os tipos de matérias legislativas válidos com sigla, nome completo e descrição. Útil para usar em buscas.",
    {},
    async () => toolResult({ count: TIPOS_MATERIA.length, tipos: TIPOS_MATERIA }),
  );

  // H3. senado_partidos
  server.tool(
    "senado_partidos",
    "Lista partidos com representação atual no Senado, incluindo sigla, nome completo e número de senadores.",
    {},
    async () => {
      try {
        const response = await fetchSenadoresAtuais(baseUrl);
        const parlamentares = extractParlamentares(response);
        const counts: Record<string, { sigla: string; nome: string; senadores: number }> = {};
        for (const p of parlamentares) {
          const m = p.Mandato || {};
          const sigla = m.Partido?.SiglaPartido || p.IdentificacaoParlamentar?.SiglaPartidoParlamentar || "S/Partido";
          const nome = m.Partido?.NomePartido || sigla;
          if (!counts[sigla]) counts[sigla] = { sigla, nome, senadores: 0 };
          counts[sigla].senadores++;
        }
        const partidos = Object.values(counts).sort((a, b) => b.senadores - a.senadores);
        return toolResult({ count: partidos.length, totalSenadores: parlamentares.length, partidos });
      } catch (e) {
        return toolError(e instanceof Error ? e.message : "Erro ao obter partidos");
      }
    },
  );

  // H4. senado_ufs
  server.tool(
    "senado_ufs",
    "Lista unidades federativas com número de senadores atualmente em exercício por estado.",
    {},
    async () => {
      try {
        const response = await fetchSenadoresAtuais(baseUrl);
        const parlamentares = extractParlamentares(response);
        const ufCount: Record<string, number> = {};
        for (const p of parlamentares) {
          const uf = p.Mandato?.UfParlamentar || p.IdentificacaoParlamentar?.UfParlamentar || "";
          if (uf) ufCount[uf] = (ufCount[uf] || 0) + 1;
        }
        const ufs = UFS.map((u) => ({ ...u, senadores: ufCount[u.sigla] || 0 }));
        return toolResult({ count: ufs.length, totalSenadores: parlamentares.length, ufs });
      } catch (e) {
        return toolError(e instanceof Error ? e.message : "Erro ao obter UFs");
      }
    },
  );
}
