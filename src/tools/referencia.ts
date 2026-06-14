/**
 * Group H — Reference/metadata tools (4 tools)
 * senado_legislatura_atual, senado_tipos_materia, senado_partidos, senado_ufs
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { cachedFetch } from "../cache/manager.js";
import { upstreamFetch } from "../throttle/upstream.js";
import { toolResult, toolError, errorFrom, ensureArray } from "../utils/validation.js";
import { CACHE_STATIC } from "../types.js";

export const TIPOS_MATERIA = [
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

export const UFS = [
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

export function extractParlamentares(response: any): any[] {
  const list =
    response?.ListaParlamentarEmExercicio?.Parlamentares?.Parlamentar ??
    response?.ListaParlamentarLegislatura?.Parlamentares?.Parlamentar;
  return ensureArray(list);
}

export function registerReferenciaTools(server: McpServer, baseUrl: string) {
  // H1. senado_legislatura_atual
  server.tool(
    "senado_legislatura_atual",
    "Retorna a legislatura federal vigente. Não recebe parâmetros e responde um objeto `{ numero, periodo, dataInicio, dataFim }` (período no formato `AAAA-AAAA` e datas ISO), derivado da lista de senadores em exercício; usa fallback para a 57ª legislatura (2023-2027) se o cálculo falhar. Use para obter o número/anos da legislatura corrente antes de filtrar buscas; veja `senado_listar_senadores` para o detalhamento dos parlamentares.",
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
        return errorFrom(e, "Erro ao obter legislatura");
      }
    },
  );

  // H2/B5. senado_tipos_materia
  server.tool(
    "senado_tipos_materia",
    "Lista os tipos de matérias legislativas válidos (tabela de referência fixa). Não recebe parâmetros e responde `{ count, tipos }`, onde cada item de `tipos` traz `sigla` (ex.: `PEC`, `PL`, `MPV`), `nome` completo e `descricao`. Use para descobrir a `sigla` correta de tipo de matéria antes de chamar `senado_buscar_materias` ou `senado_search_processos`.",
    {},
    async () => toolResult({ count: TIPOS_MATERIA.length, tipos: TIPOS_MATERIA }),
  );

  // H3. senado_partidos
  server.tool(
    "senado_partidos",
    "Lista os partidos com representação atual no Senado. Não recebe parâmetros e responde `{ count, totalSenadores, partidos }`, com `partidos` ordenado por bancada decrescente e cada item trazendo `sigla`, `nome` e `senadores` (contagem). Derivado da lista de senadores em exercício; para a relação nominal de parlamentares use `senado_listar_senadores` e para blocos partidários veja `senado_listar_blocos`.",
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
        return errorFrom(e, "Erro ao obter partidos");
      }
    },
  );

  // H4. senado_ufs
  server.tool(
    "senado_ufs",
    "Lista as 27 unidades federativas com a contagem de senadores em exercício por estado. Não recebe parâmetros e responde `{ count, totalSenadores, ufs }`, onde cada item de `ufs` traz `sigla`, `nome` e `senadores` (0 quando não há parlamentar em exercício no momento). Use para obter a `sigla` de UF válida ao filtrar `senado_listar_senadores` ou outras buscas por estado.",
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
        return errorFrom(e, "Erro ao obter UFs");
      }
    },
  );
}
