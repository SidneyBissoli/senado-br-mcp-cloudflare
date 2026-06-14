/**
 * MCP Prompts — reusable pt-BR instruction templates that guide an agent through
 * common Senate-data workflows, chaining the right tools in order.
 *
 * Registered per-request in server.ts via registerPrompts(server). The text builders
 * are exported as pure functions so tests can target them without a transport.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/** Workflow: despesas CEAPS de um senador num ano. */
export function buildGastosSenador(senador: string, ano: string): string {
  return [
    `Tarefa: analisar os gastos da cota parlamentar (CEAPS) do senador "${senador}" no ano de ${ano}.`,
    "",
    "Passos:",
    `1. Resolva o senador com \`senado_listar_senadores\` (parâmetro \`nome: "${senador}"\`) e pegue o \`codigo\`.`,
    `2. Chame \`senado_ceaps\` com \`ano: ${ano}\` e \`codSenador\` do passo 1 no modo \`por-tipo\` para ver a distribuição das despesas por categoria.`,
    "3. Para o maior tipo de despesa, chame `senado_ceaps` novamente com `modo: \"detalhe\"` e `tipoDespesa` correspondente para listar os lançamentos e fornecedores.",
    "4. Apresente um resumo: valor total no ano, top categorias, e quaisquer fornecedores recorrentes. Cite valores em reais.",
  ].join("\n");
}

/** Workflow: situação e histórico de tramitação de uma matéria. */
export function buildTramitacaoMateria(sigla: string, numero: string, ano: string): string {
  const id = `${sigla} ${numero}/${ano}`;
  return [
    `Tarefa: descrever a situação atual e a tramitação da matéria ${id}.`,
    "",
    "Passos:",
    `1. Localize a matéria com \`senado_buscar_materias\` (\`sigla: "${sigla}"\`, \`numero: ${numero}\`, \`ano: ${ano}\`) e pegue o \`codigo\` (codigoMateria).`,
    "2. Chame `senado_obter_materia` com `secao: \"detalhe\"` para situação atual, autor, relator e ementa.",
    "3. Chame `senado_obter_materia` com `secao: \"tramitacao\"` para o histórico cronológico de movimentações.",
    "4. (Opcional) `secao: \"textos\"` para os documentos/pareceres.",
    "5. Resuma: o que a matéria propõe, onde está hoje, relator, e os marcos recentes da tramitação.",
  ].join("\n");
}

/** Workflow: como um senador votou num período. */
export function buildVotosSenador(senador: string, periodo?: string): string {
  const janela = periodo && periodo.trim()
    ? `no período ${periodo}`
    : "no ano corrente";
  return [
    `Tarefa: mostrar como o senador "${senador}" votou ${janela}.`,
    "",
    "Passos:",
    `1. Resolva o senador com \`senado_listar_senadores\` (\`nome: "${senador}"\`) e pegue o \`codigo\`.`,
    `2. Chame \`senado_votacoes_senador\` com esse \`codigoSenador\`${periodo && periodo.trim() ? ` e o período (\`dataInicio\`/\`dataFim\` em YYYYMMDD cobrindo ${periodo})` : ""}.`,
    "3. (Opcional) Para detalhar uma votação específica, use `senado_obter_votacao` com o `codigoVotacao`.",
    "4. Resuma o posicionamento: total de votos Sim/Não/Abstenção, e destaque votações relevantes com a matéria e o resultado.",
  ].join("\n");
}

/** Workflow: panorama da participação cidadã no e-Cidadania. */
export function buildPanoramaEcidadania(): string {
  return [
    "Tarefa: montar um panorama da participação cidadã atual no portal e-Cidadania do Senado.",
    "",
    "Passos:",
    "1. `senado_ecidadania_listar_consultas` para as consultas públicas abertas (votos sim/não).",
    "2. `senado_ecidadania_consultas_analise` com `modo: \"consenso\"` e depois `modo: \"polarizada\"` para os temas de maior concordância e os mais divididos.",
    "3. `senado_ecidadania_listar_ideias` com `ordenarPor: \"apoios\"`, `ordem: \"desc\"`, `status: \"aberta\"` para as ideias legislativas mais apoiadas.",
    "4. `senado_ecidadania_listar_eventos` com `ordenarPor: \"comentarios\"`, `ordem: \"desc\"` para os eventos com mais participação.",
    "5. Sintetize: temas de consenso, temas polêmicos, ideias em destaque e eventos relevantes — com os números de participação.",
  ].join("\n");
}

export function registerPrompts(server: McpServer) {
  server.registerPrompt(
    "senado_gastos_senador",
    {
      title: "Gastos do senador (CEAPS)",
      description: "Guia o passo a passo para analisar as despesas da cota parlamentar (CEAPS) de um senador num ano, usando senado_listar_senadores e senado_ceaps.",
      argsSchema: {
        senador: z.string().describe("Nome (ou parte) do senador"),
        ano: z.string().describe("Ano das despesas (ex: 2025)"),
      },
    },
    (args) => ({
      messages: [{ role: "user", content: { type: "text", text: buildGastosSenador(args.senador, args.ano) } }],
    }),
  );

  server.registerPrompt(
    "senado_tramitacao_materia",
    {
      title: "Tramitação de uma matéria",
      description: "Guia o passo a passo para obter a situação atual e o histórico de tramitação de uma proposição, usando senado_buscar_materias e senado_obter_materia.",
      argsSchema: {
        sigla: z.string().describe("Tipo da proposição (ex: PEC, PL, PLP, MPV)"),
        numero: z.string().describe("Número da proposição"),
        ano: z.string().describe("Ano da proposição"),
      },
    },
    (args) => ({
      messages: [{ role: "user", content: { type: "text", text: buildTramitacaoMateria(args.sigla, args.numero, args.ano) } }],
    }),
  );

  server.registerPrompt(
    "senado_votos_senador",
    {
      title: "Como votou um senador",
      description: "Guia o passo a passo para listar os votos nominais de um senador num período, usando senado_listar_senadores e senado_votacoes_senador.",
      argsSchema: {
        senador: z.string().describe("Nome (ou parte) do senador"),
        periodo: z.string().optional().describe("Período em texto livre (ex: '2024' ou 'jan a jun 2025'); vazio = ano corrente"),
      },
    },
    (args) => ({
      messages: [{ role: "user", content: { type: "text", text: buildVotosSenador(args.senador, args.periodo) } }],
    }),
  );

  server.registerPrompt(
    "senado_panorama_ecidadania",
    {
      title: "Panorama do e-Cidadania",
      description: "Guia o passo a passo para consolidar consultas (consenso/polarização), ideias e eventos populares do portal e-Cidadania.",
    },
    () => ({
      messages: [{ role: "user", content: { type: "text", text: buildPanoramaEcidadania() } }],
    }),
  );
}
