/**
 * Group T — Estrutura Organizacional (1 tool)
 * senado_estrutura_organizacional
 *
 * Diferente das demais tools administrativas, esta NÃO consulta a API de dados abertos: a
 * hierarquia até o nível de serviço só é publicada no portal institucional, então ela lê o
 * snapshot bundlado (`src/data/estrutura-organizacional.ts`, congelado pelo crawler
 * `scripts/ingest-estrutura`). Resolve uma unidade pela sigla ou nome e devolve seu caminho na
 * hierarquia (ancestrais) e todas as unidades subordinadas (subárvore). É a peça que permite
 * responder "quantas/quais unidades estão sob a DGER" — e alimenta o filtro `subordinadasA` de
 * `senado_servidores`.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toolError, errorFrom } from "../utils/validation.js";
import { buildProvenance, resultWithProvenance, SOURCES } from "../utils/provenance.js";
import {
  construirIndice,
  resolverOrgao,
  sugerirOrgaos,
  ancestrais,
  subarvore,
  ESTRUTURA_VINTAGE,
  ESTRUTURA_FONTE_URL,
  type IndiceEstrutura,
} from "../estrutura/resolver.js";

/** Índice construído uma vez por isolate (o snapshot é imutável). */
let indiceCache: IndiceEstrutura | null = null;
export function indiceEstrutura(): IndiceEstrutura {
  if (!indiceCache) indiceCache = construirIndice();
  return indiceCache;
}

/** Proveniência estática da estrutura (fonte = portal institucional; vintage = extração do snapshot). */
export function provenanceEstrutura() {
  return buildProvenance({
    source: SOURCES.SENADO_INSTITUCIONAL.source,
    citation: SOURCES.SENADO_INSTITUCIONAL.citation,
    license: SOURCES.SENADO_INSTITUCIONAL.license,
    source_url: ESTRUTURA_FONTE_URL,
    dataset_id: "estrutura-organizacional",
    reference_period: ESTRUTURA_VINTAGE.slice(0, 10),
    retrieved_at: ESTRUTURA_VINTAGE,
  });
}

/** Forma pública de um órgão (nunca expõe o código interno). */
const formaOrgao = (o: { sigla: string | null; nome: string }) => ({ sigla: o.sigla, nome: o.nome });

export function registerEstruturaTools(server: McpServer) {
  // T1. senado_estrutura_organizacional
  server.tool(
    "senado_estrutura_organizacional",
    "Estrutura organizacional (organograma) do Senado Federal até o nível de serviço. Dada uma `unidade` (sigla como 'DGER' ou nome como 'Diretoria-Geral'), retorna `{ unidade, caminho[], totalSubordinadas, subordinadas[] }`: `caminho` são os órgãos superiores (da cúpula até o superior imediato) e `subordinadas` são TODAS as unidades da subárvore (secretarias, coordenações, serviços e núcleos), cada uma com `sigla`, `nome` e `nivel` (profundidade relativa). Use para responder 'o que está sob a DGER', 'quais secretarias/serviços pertencem a X' ou para entender a hierarquia administrativa. Para CONTAR ou LISTAR servidores sob uma unidade, use `senado_servidores` com `subordinadasA`. Fonte: portal institucional (a API de dados abertos não publica a árvore completa).",
    {
      unidade: z.string().describe("Sigla (ex.: 'DGER', 'SEGRAF') ou nome (ex.: 'Diretoria-Geral') da unidade"),
      limite: z.number().int().min(1).max(1000).optional().default(200).describe("Máximo de subordinadas listadas (padrão: 200)"),
    },
    async (params) => {
      try {
        const indice = indiceEstrutura();
        const alvo = resolverOrgao(indice, params.unidade);
        if (!alvo) {
          const sugestoes = sugerirOrgaos(indice, params.unidade);
          const dica = sugestoes.length
            ? ` Você quis dizer: ${sugestoes.map((s) => (s.sigla ? `${s.sigla} (${s.nome})` : s.nome)).join("; ")}?`
            : "";
          return toolError(`Unidade '${params.unidade}' não encontrada na estrutura organizacional.${dica}`);
        }

        const caminho = ancestrais(indice, alvo.cod).reverse().map(formaOrgao); // da cúpula até o superior imediato
        // Subárvore com nível relativo (BFS a partir do alvo; nível 0 = o próprio alvo, omitido da lista).
        const nivelPorCod = new Map<number, number>([[alvo.cod, 0]]);
        const fila = [alvo.cod];
        while (fila.length) {
          const c = fila.shift()!;
          const nv = nivelPorCod.get(c)!;
          for (const f of indice.filhosPorCod.get(c) ?? []) {
            if (!nivelPorCod.has(f)) {
              nivelPorCod.set(f, nv + 1);
              fila.push(f);
            }
          }
        }
        const todas = subarvore(indice, alvo.cod).filter((o) => o.cod !== alvo.cod);
        todas.sort((a, b) => (nivelPorCod.get(a.cod)! - nivelPorCod.get(b.cod)!) || a.nome.localeCompare(b.nome, "pt"));
        const limite = params.limite ?? 200;
        const subordinadas = todas.slice(0, limite).map((o) => ({ ...formaOrgao(o), nivel: nivelPorCod.get(o.cod)! }));

        return resultWithProvenance(
          {
            unidade: formaOrgao(alvo),
            caminho,
            totalSubordinadas: todas.length,
            ...(todas.length > limite
              ? { aviso: `Exibindo ${limite} de ${todas.length} unidades subordinadas. Aumente 'limite' ou consulte uma subunidade específica.` }
              : {}),
            subordinadas,
          },
          provenanceEstrutura(),
        );
      } catch (e) {
        return errorFrom(e, "Erro ao consultar a estrutura organizacional");
      }
    },
  );
}
