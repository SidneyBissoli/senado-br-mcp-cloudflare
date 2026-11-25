/**
 * Dicionário do dataset 3.0.0 (camada 3, fase D do ROADMAP) — FONTE ÚNICA da descrição das tabelas
 * publicadas: cada tabela, cada coluna, o tipo (vocabulário Frictionless Table Schema, que a D2 usa no
 * manifesto), a página de onde o valor vem e a marca de CALCULADA (decisão 5: as colunas que o projeto
 * calcula ficam, marcadas). `tests/publicacao/dicionario.test.ts` reprova se o dicionário e as colunas
 * gravadas (`gravar.ts`) divergirem em nome, ordem ou tipo.
 *
 * O que mudou desde o 2.0.0 (dicionário `docs/dataset-dictionary.md`, gerado de `src/dataset/schema.ts`):
 *   - fim do envelope por célula: valores puros, e a proveniência vai em colunas de ORIGEM por bloco de
 *     página (`origem<Bloco>` = de onde veio o bloco; `coletadoEm<Bloco>` = quando aquela página foi
 *     lida) — decisões 1 e 2 do desenho da fase D;
 *   - tabelas tidy: listas viram tabelas próprias (proposições, linha do tempo, pauta, convidados,
 *     comentários, votos por UF longos) e as séries no tempo entram (apoios, situação, votos);
 *   - o nome do autor da ideia, como o portal o publica (decisão do dono de 17/10/2026).
 */

export const ESQUEMA_V3 = "3.0.0";

export type TipoFrictionless = "integer" | "number" | "string" | "date" | "time" | "datetime";

export interface ColunaDoDicionario {
  nome: string;
  tipo: TipoFrictionless;
  descricao: string;
  /** De onde o valor vem: a página (bloco) ou o cálculo. */
  fonte: string;
  /** Calculada pelo projeto (não lida da fonte). */
  calculada?: true;
  /** Ressalva de uso. */
  nota?: string;
}

export interface TabelaDoDicionario {
  /** Caminho no balde/pacote: `<entidade>/<tabela>`. */
  caminho: string;
  titulo: string;
  descricao: string;
  /** Uma linha por… (a chave da tabela). */
  chave: string[];
  colunas: ColunaDoDicionario[];
}

// ── Páginas da fonte ──────────────────────────────────────────────────────────────────────────────
const E = "https://www12.senado.leg.br/ecidadania";
const P = {
  listaIdeia: `listagem \`${E}/pesquisaideia?situacao={S}&p={N}\``,
  ideia: `detalhe \`${E}/visualizacaoideia?id={ID}\``,
  listaConsulta: `listagem \`${E}/pesquisamateria?p={N}\``,
  consulta: `detalhe \`${E}/visualizacaomateria?id={ID}\``,
  listaEvento: `listagem \`${E}/principalaudiencia?p={N}\``,
  evento: `detalhe \`${E}/visualizacaoaudiencia?id={ID}\``,
  comentarios: `fragmento \`${E}/ajaxcolecaocomentarioaudiencia?audienciaId={ID}\``,
  csv: "CSV Arquimedes `https://www.senado.gov.br/bi-arqs/Arquimedes/ecidadania/DadosAbertos/Proposi%C3%A7%C3%B5es-com-votos.csv` (windows-1252, lido como UTF-8)",
} as const;

const RESERVA = "; sem leitura no arquivo, o valor guardado no corpus (ver a coluna de origem do bloco)";

// ── Colunas repetidas ─────────────────────────────────────────────────────────────────────────────
const id = (descricao: string): ColunaDoDicionario => ({ nome: "id", tipo: "integer", descricao, fonte: "parâmetro `id` da URL da página" });
const url = (pagina: string): ColunaDoDicionario => ({
  nome: "url", tipo: "string", descricao: "Endereço da página no portal, para conferir a linha na fonte.", fonte: `montada pelo projeto: \`${pagina}\``, calculada: true,
  nota: "Montada a partir do id, não lida da página; se o portal mudar o padrão de endereço, as antigas deixam de abrir.",
});
const firstSeen: ColunaDoDicionario = {
  nome: "firstSeenAt", tipo: "datetime", descricao: "Primeira vez que o robô do projeto viu o registro (UTC).", fonte: "MIN(scraped_at) no histórico do corpus (`ecidadania_history`)", calculada: true,
  nota: "Observação do robô, não data do Senado. Censurada à esquerda: o corpus começa em 14/06/2026 e a primeira varredura completa de cada entidade (16/06 consultas; 29/06 ideias e eventos) marca quase todo o acervo antigo; exclua essas datas de análises de ritmo de entrada.",
};
const origem = (bloco: string, paginas: string, valores: string): ColunaDoDicionario[] => [
  {
    nome: `origem${bloco}`, tipo: "string", descricao: `De onde vieram as colunas do bloco ${bloco.toLowerCase()}: ${valores}.`, fonte: "projeto (decisão 2 da fase D)", calculada: true,
    nota: `"corpus" = o arquivo de páginas (desde 30/10/2026 nas ideias, 20/11/2026 nas demais) ainda não leu ${paginas} deste registro, ou nunca vai ler (fora da listagem, removido); vale o último valor que o corpus guardou.`,
  },
  {
    nome: `coletadoEm${bloco}`, tipo: "datetime", descricao: `Quando foi lida a página de onde veio o bloco ${bloco.toLowerCase()} (UTC).`, fonte: "índice do arquivo de páginas, ou `scraped_at` do corpus", calculada: true,
    nota: "Na origem corpus é o instante da última gravação da linha no corpus, que pode ser posterior à leitura daquele bloco.",
  },
];
const serie = (o: { origens: string }): ColunaDoDicionario[] => [
  { nome: "desde", tipo: "datetime", descricao: "Primeira leitura em que o valor foi visto (UTC).", fonte: "arquivo de páginas ou corpus" },
  { nome: "ate", tipo: "datetime", descricao: "Última leitura seguida em que o mesmo valor foi visto (UTC).", fonte: "arquivo de páginas ou corpus", nota: "Entre `desde` e `ate` o valor foi visto em todas as leituras daquela série; fora delas, nada se afirma. No corpus, `desde = ate` (um ponto por mudança)." },
  { nome: "leituras", tipo: "integer", descricao: "Quantas leituras seguidas mostraram o valor.", fonte: "arquivo de páginas (1 no corpus)" },
  { nome: "sha", tipo: "string", descricao: "sha256 da primeira página guardada que mostrou o valor (o arquivo bruto é privado; o hash prova a leitura).", fonte: "arquivo de páginas (null no corpus)" },
  { nome: "origem", tipo: "string", descricao: `De onde vem a linha: ${o.origens}.`, fonte: "projeto", calculada: true },
];

// ── As tabelas ────────────────────────────────────────────────────────────────────────────────────
export const DICIONARIO: TabelaDoDicionario[] = [
  {
    caminho: "ideias/ideias", titulo: "Ideias legislativas", chave: ["id"],
    descricao: "Uma linha por ideia legislativa, com o estado mais recente lido. Bloco RESUMO (título, apoios): a leitura mais recente da listagem de qualquer situação ou do detalhe. Bloco DETALHE (o resto): a última página de detalhe que o leitor abriu.",
    colunas: [
      id("Id da ideia no portal."),
      { nome: "titulo", tipo: "string", descricao: "Título da ideia.", fonte: `bloco resumo: ${P.listaIdeia} ou ${P.ideia}${RESERVA}` },
      { nome: "descricao", tipo: "string", descricao: "Texto da ideia, escrito pelo cidadão.", fonte: `bloco detalhe: ${P.ideia}${RESERVA}`, nota: "No corpus o texto foi cortado em 2.000 caracteres; do arquivo vem inteiro." },
      { nome: "status", tipo: "string", descricao: "Classificação do projeto: aberta | encerrada | convertida | removida.", fonte: "corpus (classificação calculada a partir da situação do portal, da linha do tempo e da resposta 410)", calculada: true, nota: "Não é a situação do portal: para ela, ver `situacoes-portal` e `historico-situacao`." },
      { nome: "dataProposta", tipo: "date", descricao: "Data em que a ideia foi proposta.", fonte: `bloco detalhe: ${P.ideia}, data do acontecimento "Ideia proposta por NOME (UF)" da linha do tempo`, nota: "Null quando o detalhe ainda vem do corpus (o corpus não a guardava)." },
      { nome: "autorNome", tipo: "string", descricao: "Nome do cidadão autor, como o portal o publica (já abreviado, ex.: \"PEDRO H. S. V.\").", fonte: `bloco detalhe: ${P.ideia}`, nota: "Dado pessoal: finalidade e direitos do titular na seção \"Dado pessoal\" deste dicionário (decisão do dono de 17/10/2026; nota de 22/11/2026). Null quando o detalhe ainda vem do corpus (o corpus nunca guardou o nome) ou quando o titular pediu a omissão. Comentaristas de eventos seguem sem nome." },
      { nome: "autorUf", tipo: "string", descricao: "Localidade do autor como publicada: sigla da UF ou \"Exterior\".", fonte: `bloco detalhe: ${P.ideia}, o parêntese depois do nome${RESERVA}`, nota: "Null = a página não publica localidade (há páginas de autor \"USUARIO …\" sem parêntese)." },
      { nome: "oficinaNivel", tipo: "string", descricao: "Nível da Oficina Legislativa, quando a ideia veio de uma.", fonte: `bloco detalhe: ${P.ideia}, acontecimento da oficina` },
      { nome: "oficinaDataCadastro", tipo: "string", descricao: "Data e hora do cadastro na Oficina Legislativa, como publicada (AAAA-MM-DDTHH:MM, hora local, SEM fuso).", fonte: `bloco detalhe: ${P.ideia}, acontecimento da oficina`, nota: "Texto, não instante: a página não diz o fuso." },
      { nome: "apoios", tipo: "integer", descricao: "Número de apoios confirmados.", fonte: `bloco resumo: ${P.listaIdeia} (span.contabilizacao) ou ${P.ideia}${RESERVA}` },
      { nome: "prazoApoios", tipo: "date", descricao: "Último dia para receber apoios.", fonte: `bloco detalhe: ${P.ideia}, "Essa ideia pode receber apoios até DD/MM/AAAA"${RESERVA}`, nota: "Em ideia aberta está no futuro. Regra do portal medida (C4): prazo = proposta + 120 dias." },
      { nome: "data20mil", tipo: "date", descricao: "Data em que a ideia atingiu 20.000 apoios.", fonte: `bloco detalhe: ${P.ideia}, acontecimento da meta` },
      { nome: "dataSugestao", tipo: "date", descricao: "Data em que a ideia virou Sugestão na CDH.", fonte: `bloco detalhe: ${P.ideia}, "Essa ideia gerou a Sugestão nº N, de AAAA"` },
      { nome: "sugestaoNumero", tipo: "integer", descricao: "Número da Sugestão gerada.", fonte: `bloco detalhe: ${P.ideia}, mesmo acontecimento${RESERVA} (campo \`plConvertido\` do 2.0.0)` },
      { nome: "sugestaoAno", tipo: "integer", descricao: "Ano da Sugestão gerada.", fonte: `bloco detalhe: ${P.ideia}, mesmo acontecimento${RESERVA}` },
      { nome: "dataDecisaoCdh", tipo: "date", descricao: "Data da decisão da CDH sobre a Sugestão.", fonte: `bloco detalhe: ${P.ideia}, acontecimento da decisão` },
      { nome: "decisaoCdh", tipo: "string", descricao: "Decisão da CDH: transformou | não transformou.", fonte: `bloco detalhe: ${P.ideia}, acontecimento da decisão` },
      { nome: "dataPublicacao", tipo: "date", descricao: "LEGADO do 2.0.0, igual a `prazoApoios`.", fonte: "cópia de `prazoApoios`", nota: "Nome histórico enganoso (não é a data de publicação); mantido para quem já usa." },
      url(`${E}/visualizacaoideia?id={id}`),
      firstSeen,
      ...origem("Resumo", "título e apoios", "listagem | detalhe (arquivo de páginas) | corpus"),
      ...origem("Detalhe", "a página de detalhe", "arquivo | corpus"),
    ],
  },
  {
    caminho: "ideias/proposicoes", titulo: "Proposições geradas por ideias", chave: ["id", "data", "tipoSigla", "numero", "ano"],
    descricao: "Uma linha por proposição em que a ideia foi transformada (pela CDH ou adotada por parlamentar), na ordem cronológica da linha do tempo.",
    colunas: [
      id("Id da ideia."),
      { nome: "data", tipo: "date", descricao: "Data do acontecimento de transformação.", fonte: P.ideia },
      { nome: "transformadaPor", tipo: "string", descricao: "Quem transformou, como publicado: Comissão | Senador | Deputado.", fonte: P.ideia },
      { nome: "sexo", tipo: "string", descricao: "Gênero gramatical do cargo publicado: feminino (Senadora, Deputada) | masculino | null (Comissão).", fonte: P.ideia, nota: "Lido do cargo, não de cadastro." },
      { nome: "parlamentar", tipo: "string", descricao: "Nome do parlamentar (agente público). Em coautoria, a lista inteira como o portal a publica (ex.: \"Senador A (SE), Senadora B (SP), …\").", fonte: P.ideia, nota: "Coautoria não é separada aqui: o projeto não recorta a lista do portal. Os autores um a um, com código oficial, estão na autoria da matéria publicada pelo Senado (API de dados abertos, /processo) ou pela Câmara, a partir do link em url." },
      { nome: "parlamentarUf", tipo: "string", descricao: "UF do parlamentar.", fonte: P.ideia, nota: "Null em coautoria: cada coautor tem a sua UF dentro do texto de parlamentar." },
      { nome: "tipoSigla", tipo: "string", descricao: "Sigla do tipo de proposição (PL, PEC, PLP…).", fonte: P.ideia },
      { nome: "tipoNome", tipo: "string", descricao: "Nome do tipo, como publicado.", fonte: P.ideia },
      { nome: "numero", tipo: "string", descricao: "Número da proposição.", fonte: P.ideia },
      { nome: "ano", tipo: "integer", descricao: "Ano da proposição.", fonte: P.ideia },
      { nome: "complemento", tipo: "string", descricao: "Complemento publicado (ex.: casa de origem).", fonte: P.ideia },
      { nome: "url", tipo: "string", descricao: "Link da proposição publicado na linha do tempo (Senado ou Câmara).", fonte: P.ideia },
      { nome: "origem", tipo: "string", descricao: "arquivo | corpus.", fonte: "projeto", calculada: true },
    ],
  },
  {
    caminho: "ideias/linha-do-tempo", titulo: "Linha do tempo das ideias", chave: ["id", "ordem"],
    descricao: "Uma linha por acontecimento da linha do tempo da página de detalhe, da última leitura aberta. Só ideias com detalhe no arquivo de páginas (o corpus nunca guardou a linha do tempo).",
    colunas: [
      id("Id da ideia."),
      { nome: "ordem", tipo: "integer", descricao: "Posição na página: 0 = o do topo (o mais recente).", fonte: P.ideia },
      { nome: "data", tipo: "date", descricao: "Data do acontecimento.", fonte: P.ideia },
      { nome: "tipo", tipo: "string", descricao: "Tipo, pelo vocabulário fechado do leitor: proposta, prazo, oficina, meta, prazoEncerrado, sugestao, cdhNaoTransformou, cdhTransformou, adocao, transformadaEm, naoReconhecido.", fonte: "leitor do projeto (`lerIdeiaDetalhe`)", calculada: true, nota: "\"naoReconhecido\" = texto fora do vocabulário; o texto vai inteiro." },
      { nome: "texto", tipo: "string", descricao: "Texto do acontecimento, verbatim.", fonte: P.ideia },
    ],
  },
  {
    caminho: "ideias/situacoes-portal", titulo: "Situação atual das ideias no portal", chave: ["id", "situacaoCodigo"],
    descricao: "A(s) situação(ões) do portal em que a ideia está agora: as vistas no DIA da sua avistagem mais recente em qualquer listagem. Duas ao mesmo tempo = duas linhas (o portal lista a mesma ideia em duas situações).",
    colunas: [
      id("Id da ideia."),
      { nome: "situacaoCodigo", tipo: "string", descricao: "Código da situação no portal (5, 6, 7, 8, 9, 10, 99).", fonte: P.listaIdeia, calculada: true, nota: "Regra do projeto (decisão 6 da fase D). As encerradas (7) são varridas aos poucos, não todo dia: veja `vistaEm`. As 30 ideias da 99 também estão na 7 no portal, mas aparecem só como 99." },
      { nome: "situacaoNome", tipo: "string", descricao: "Nome da situação, como no menu do portal.", fonte: P.listaIdeia },
      { nome: "vistaEm", tipo: "datetime", descricao: "Última vez que a ideia foi vista nessa listagem (UTC).", fonte: "arquivo de páginas" },
    ],
  },
  {
    caminho: "ideias/historico-situacao", titulo: "Histórico de situação das ideias", chave: ["entity_id", "origem", "desde"],
    descricao: "Situação ao longo do tempo, de duas origens que não se misturam: a situação do PORTAL vista no arquivo de páginas (desde 30/10/2026) e o status de 3 valores do corpus (desde 14/06/2026, um ponto por mudança).",
    colunas: [
      { nome: "entity_id", tipo: "string", descricao: "Id da ideia.", fonte: "parâmetro `id`" },
      { nome: "origem", tipo: "string", descricao: "listagem (arquivo) | corpus.", fonte: "projeto", calculada: true },
      { nome: "situacao_codigo", tipo: "string", descricao: "Código da situação do portal (só origem listagem).", fonte: P.listaIdeia },
      { nome: "situacao_nome", tipo: "string", descricao: "Nome da situação do portal (só origem listagem).", fonte: P.listaIdeia },
      { nome: "status", tipo: "string", descricao: "Status de 3 valores do projeto (só origem corpus).", fonte: "corpus", calculada: true },
      { nome: "desde", tipo: "datetime", descricao: "Primeira vez vista (UTC).", fonte: "arquivo de páginas ou corpus" },
      { nome: "ate", tipo: "datetime", descricao: "Última vez vista (UTC).", fonte: "arquivo de páginas ou corpus", nota: "A ausência de uma listagem não é leitura: se a ideia some de uma situação e volta, o intervalo cobre o meio." },
      { nome: "leituras", tipo: "integer", descricao: "Leituras que a sustentam.", fonte: "arquivo de páginas (1 no corpus)" },
      { nome: "sha", tipo: "string", descricao: "sha256 da primeira página que a mostrou.", fonte: "arquivo de páginas (null no corpus)" },
    ],
  },
  {
    caminho: "ideias/serie-apoios", titulo: "Série de apoios das ideias", chave: ["entity_id", "origem", "desde"],
    descricao: "Apoios ao longo do tempo: do arquivo de páginas por série (listagem de cada situação, detalhe) e do corpus (um ponto por mudança, desde 14/06/2026), lado a lado.",
    colunas: [
      { nome: "entity_id", tipo: "string", descricao: "Id da ideia.", fonte: "parâmetro `id`" },
      { nome: "origem", tipo: "string", descricao: "A série: listagem-sN (listagem da situação N), detalhe, ou corpus.", fonte: "projeto", calculada: true },
      { nome: "apoios", tipo: "integer", descricao: "Apoios vistos.", fonte: `${P.listaIdeia} | ${P.ideia} | corpus`, nota: "No corpus, antes de 18/10/2026, 0 pode ser contagem AUSENTE lida como 0 (38.454 pontos)." },
      { nome: "desde", tipo: "datetime", descricao: "Primeira leitura com esse valor (UTC).", fonte: "arquivo de páginas ou corpus" },
      { nome: "ate", tipo: "datetime", descricao: "Última leitura seguida com esse valor (UTC).", fonte: "arquivo de páginas ou corpus" },
      { nome: "leituras", tipo: "integer", descricao: "Leituras seguidas com esse valor.", fonte: "arquivo de páginas (1 no corpus)" },
      { nome: "sha", tipo: "string", descricao: "sha256 da primeira página com esse valor.", fonte: "arquivo de páginas (null no corpus)" },
    ],
  },
  {
    caminho: "consultas/consultas", titulo: "Consultas públicas", chave: ["id"],
    descricao: "Uma linha por consulta pública. Bloco RESUMO: a listagem (matéria, ementa, votos). Bloco DETALHE: a página da consulta (autoria). As encerradas saíram da listagem e vêm do corpus.",
    colunas: [
      id("Código da matéria em consulta."),
      { nome: "materia", tipo: "string", descricao: "Identificação da matéria (ex.: \"PL 5064/2023\").", fonte: `bloco resumo: ${P.listaConsulta}${RESERVA}` },
      { nome: "ementa", tipo: "string", descricao: "Ementa da matéria.", fonte: `bloco resumo: ${P.listaConsulta}${RESERVA}` },
      { nome: "votosSim", tipo: "integer", descricao: "Votos SIM.", fonte: `bloco resumo: ${P.listaConsulta}${RESERVA}` },
      { nome: "votosNao", tipo: "integer", descricao: "Votos NÃO.", fonte: `bloco resumo: ${P.listaConsulta}${RESERVA}` },
      { nome: "totalVotos", tipo: "integer", descricao: "votosSim + votosNao.", fonte: "soma das duas colunas", calculada: true },
      { nome: "percentualSim", tipo: "number", descricao: "Percentual de SIM, com uma casa decimal.", fonte: "votosSim / totalVotos × 100", calculada: true, nota: "Null sem votos (0/0 não é 0%). No 2.0.0 era inteiro e 0 sem votos." },
      { nome: "percentualNao", tipo: "number", descricao: "Percentual de NÃO, com uma casa decimal.", fonte: "votosNao / totalVotos × 100", calculada: true, nota: "Null sem votos." },
      { nome: "autoria", tipo: "string", descricao: "Autoria da matéria (agente público).", fonte: `bloco detalhe: ${P.consulta}${RESERVA}` },
      { nome: "relator", tipo: "string", descricao: "SEMPRE null: a página da consulta não publica relatoria.", fonte: P.consulta, nota: "Mantida pelo formato. O relator está na API legislativa (/processo/relatoria). Não use como dado." },
      { nome: "status", tipo: "string", descricao: "aberta | encerrada (a matéria está ou não em tramitação).", fonte: "corpus, derivado de `/processo?tramitando=S` da API legislativa", calculada: true },
      url(`${E}/visualizacaomateria?id={id}`),
      firstSeen,
      ...origem("Resumo", "a listagem", "arquivo | corpus"),
      ...origem("Detalhe", "a página da consulta", "arquivo | corpus"),
    ],
  },
  {
    caminho: "consultas/serie-votos", titulo: "Série de votos das consultas", chave: ["id", "voto", "origem", "desde"],
    descricao: "Votos SIM e NÃO de cada consulta ao longo do tempo, em formato longo: arquivo de páginas (desde 20/11/2026) e corpus (desde 14/06/2026, um ponto por mudança).",
    colunas: [
      id("Código da matéria."),
      { nome: "voto", tipo: "string", descricao: "SIM | NAO.", fonte: P.listaConsulta },
      { nome: "votos", tipo: "integer", descricao: "Contagem vista.", fonte: `${P.listaConsulta} | corpus`, nota: "O corpus também recebe a contagem dos destaques a cada 2 h sem guardar a página: pode ter pontos que o arquivo não tem." },
      ...serie({ origens: "listagem (arquivo) | corpus" }),
    ],
  },
  {
    caminho: "eventos/eventos", titulo: "Eventos interativos (audiências)", chave: ["id"],
    descricao: "Uma linha por evento. Bloco RESUMO (título, comissão, situação): a leitura mais recente da listagem ou do detalhe. Bloco DETALHE: a página do evento. Bloco COMENTÁRIOS: o fragmento de comentários.",
    colunas: [
      id("Id do evento."),
      { nome: "titulo", tipo: "string", descricao: "Título do evento.", fonte: `bloco resumo: ${P.listaEvento} ou ${P.evento}${RESERVA}` },
      { nome: "data", tipo: "date", descricao: "Data do evento (canônica, do detalhe).", fonte: `bloco detalhe: ${P.evento}${RESERVA}`, nota: "No corpus, eventos nunca enriquecidos carregam a data da listagem (provisória; estudo A3)." },
      { nome: "hora", tipo: "time", descricao: "Hora do evento, HH:MM (canônica, do detalhe).", fonte: `bloco detalhe: ${P.evento}${RESERVA}`, nota: "A hora da listagem é degradada (estudo A3); no corpus pode ser ela." },
      { nome: "comissao", tipo: "string", descricao: "Sigla da comissão.", fonte: `bloco resumo: ${P.listaEvento} ou ${P.evento}${RESERVA}` },
      { nome: "comissaoNomeCompleto", tipo: "string", descricao: "Nome da comissão por extenso.", fonte: `bloco detalhe: ${P.evento}${RESERVA}` },
      { nome: "local", tipo: "string", descricao: "Local do evento.", fonte: `bloco detalhe: ${P.evento}${RESERVA}` },
      { nome: "descricao", tipo: "string", descricao: "Finalidade do evento.", fonte: `bloco detalhe: ${P.evento}${RESERVA}` },
      { nome: "videoUrl", tipo: "string", descricao: "Vídeo do evento (YouTube), quando houver.", fonte: `bloco detalhe: ${P.evento}${RESERVA}` },
      { nome: "comentarios", tipo: "integer", descricao: "Número de comentários (contagem canônica, do fragmento).", fonte: `bloco comentários: ${P.comentarios}${RESERVA}` },
      { nome: "status", tipo: "string", descricao: "agendado | encerrado | cancelado.", fonte: `bloco resumo: classe da listagem ou do detalhe${RESERVA}`, calculada: true, nota: "REGISTRADO (\"sem data prevista\") é dobrado em agendado (Recon §4.1)." },
      url(`${E}/visualizacaoaudiencia?id={id}`),
      firstSeen,
      ...origem("Resumo", "título, comissão e situação", "listagem | detalhe (arquivo de páginas) | corpus"),
      ...origem("Detalhe", "a página do evento", "arquivo | corpus"),
      ...origem("Comentarios", "o fragmento de comentários", "arquivo | corpus"),
    ],
  },
  {
    caminho: "eventos/pauta", titulo: "Pauta dos eventos", chave: ["id", "ordem"],
    descricao: "Uma linha por item de pauta, na ordem da página.",
    colunas: [
      id("Id do evento."),
      { nome: "ordem", tipo: "integer", descricao: "Posição na página (0 = o primeiro).", fonte: P.evento },
      { nome: "texto", tipo: "string", descricao: "Item de pauta.", fonte: P.evento },
      { nome: "origem", tipo: "string", descricao: "arquivo | corpus.", fonte: "projeto", calculada: true },
    ],
  },
  {
    caminho: "eventos/convidados", titulo: "Convidados dos eventos", chave: ["id", "ordem"],
    descricao: "Uma linha por convidado (agente público na função; nome mantido), na ordem da página.",
    colunas: [
      id("Id do evento."),
      { nome: "ordem", tipo: "integer", descricao: "Posição na página (0 = o primeiro).", fonte: P.evento },
      { nome: "texto", tipo: "string", descricao: "Convidado, como publicado (nome e cargo).", fonte: P.evento },
      { nome: "origem", tipo: "string", descricao: "arquivo | corpus.", fonte: "projeto", calculada: true },
    ],
  },
  {
    caminho: "eventos/comentarios", titulo: "Comentários dos eventos", chave: ["eventoId", "comentarioId"],
    descricao: "Um comentário por linha, da última leitura do fragmento. Conteúdo de cidadão: só UF e texto, SEM nome.",
    colunas: [
      { nome: "eventoId", tipo: "integer", descricao: "Id do evento.", fonte: "parâmetro `audienciaId`" },
      { nome: "comentarioId", tipo: "integer", descricao: "Id do comentário no portal.", fonte: `${P.comentarios}, atributo data-id` },
      { nome: "uf", tipo: "string", descricao: "UF do comentarista.", fonte: P.comentarios, nota: "O nome é descartado na origem (nunca gravado)." },
      { nome: "data", tipo: "date", descricao: "Data do comentário.", fonte: P.comentarios },
      { nome: "hora", tipo: "time", descricao: "Hora do comentário, HH:MM.", fonte: P.comentarios },
      { nome: "texto", tipo: "string", descricao: "Texto do comentário, verbatim.", fonte: P.comentarios },
      { nome: "momentoVideoUrl", tipo: "string", descricao: "Momento do vídeo a que o comentário se ancora, quando houver.", fonte: P.comentarios },
      { nome: "convidadoAssociado", tipo: "string", descricao: "Convidado a quem o comentário se dirige, quando houver.", fonte: P.comentarios },
      { nome: "origem", tipo: "string", descricao: "arquivo | corpus.", fonte: "projeto", calculada: true },
    ],
  },
  {
    caminho: "consultas_votos/materias", titulo: "Matérias do acervo de votos por UF", chave: ["codigo"],
    descricao: "Uma linha por matéria do acervo histórico (CSV Arquimedes), na versão mais recente do CSV.",
    colunas: [
      { nome: "codigo", tipo: "integer", descricao: "Código da matéria.", fonte: `${P.csv}, coluna CÓD. MATÉRIA` },
      { nome: "materia", tipo: "string", descricao: "Identificação da matéria.", fonte: `${P.csv}, coluna NOME DA MATÉRIA` },
      { nome: "ementa", tipo: "string", descricao: "Ementa.", fonte: `${P.csv}, coluna EMENTA` },
      { nome: "autoria", tipo: "string", descricao: "Autoria.", fonte: `${P.csv}, coluna AUTORIA` },
      { nome: "status", tipo: "string", descricao: "Situação segundo o CSV (uniformemente \"Descontinuado\").", fonte: `${P.csv}, coluna STATUS ATUAL` },
      { nome: "referencePeriod", tipo: "date", descricao: "Carimbo \"Dados atualizados até\" da versão do CSV.", fonte: `${P.csv}, linha 1` },
      { nome: "votosSim", tipo: "integer", descricao: "SIM somados sobre as UFs.", fonte: "soma da tabela `votos-uf` na versão mais recente", calculada: true, nota: "Null se alguma UF não traz o número." },
      { nome: "votosNao", tipo: "integer", descricao: "NÃO somados sobre as UFs.", fonte: "soma da tabela `votos-uf` na versão mais recente", calculada: true },
      { nome: "totalVotos", tipo: "integer", descricao: "votosSim + votosNao.", fonte: "soma", calculada: true },
      url(`${E}/visualizacaomateria?id={codigo}`),
      { nome: "origem", tipo: "string", descricao: "csv (arquivo de páginas) | corpus.", fonte: "projeto", calculada: true },
      { nome: "coletadoEm", tipo: "datetime", descricao: "Quando a versão do CSV foi baixada (UTC).", fonte: "índice do arquivo de páginas, ou `scraped_at` do corpus" },
    ],
  },
  {
    caminho: "consultas_votos/votos-uf", titulo: "Votos por UF do acervo", chave: ["codigo", "uf", "desde"],
    descricao: "Formato longo: uma linha por matéria × UF × valor visto, com o intervalo de versões do CSV em que ele valeu.",
    colunas: [
      { nome: "codigo", tipo: "integer", descricao: "Código da matéria.", fonte: `${P.csv}, coluna CÓD. MATÉRIA` },
      { nome: "uf", tipo: "string", descricao: "UF do cidadão votante.", fonte: `${P.csv}, coluna UF DO CIDADÃO` },
      { nome: "sim", tipo: "integer", descricao: "Votos SIM dessa UF.", fonte: `${P.csv}, coluna VOTO SIM` },
      { nome: "nao", tipo: "integer", descricao: "Votos NÃO dessa UF.", fonte: `${P.csv}, coluna VOTO NÃO` },
      ...serie({ origens: "csv (arquivo de páginas) | corpus" }),
    ],
  },
];

/**
 * Nome do recurso no `datapackage.json` e do arquivo no pacote (`<nome>.parquet`), sem pastas: o
 * Zenodo não guarda pastas, e o pacote plano deixa o manifesto válido solto ou dentro do tarball
 * (decisão do dono de 22/11/2026). Único por tabela (testado).
 */
export const nomeDoRecurso = (t: TabelaDoDicionario): string => t.caminho.replace(/[/_]/g, "-");
export const arquivoDaTabela = (t: TabelaDoDicionario): string => `${nomeDoRecurso(t)}.parquet`;

const linhaDaColuna = (c: ColunaDoDicionario) =>
  `| \`${c.nome}\`${c.calculada ? " ⚙️" : ""} | ${c.tipo} | ${c.descricao} | ${c.fonte} | ${c.nota ?? "—"} |`;

/**
 * Finalidade do único dado pessoal do dataset — o nome do autor da ideia — e os direitos do titular
 * (decisão do dono de 22/11/2026). Base: LGPD, art. 7º, §§ 3º, 6º e 7º, lidos em planalto.gov.br em
 * 22/11/2026. NÃO se invoca o § 4º (quem publica o nome é o portal, não comprovadamente o titular) nem o
 * inciso IV (o projeto não é "órgão de pesquisa" no sentido do art. 5º, XVIII). A omissão prometida
 * está implementada em `omissoes.ts`.
 */
export const FINALIDADE_DO_NOME: readonly string[] = [
  "## Dado pessoal: o nome do autor da ideia (LGPD)",
  "",
  "- **O que é:** `autorNome` e `autorUf` em `ideias/ideias`, e o mesmo nome no acontecimento \"Ideia proposta por NOME (UF)\" de `ideias/linha-do-tempo`. Nenhum outro campo traz nome de cidadão; comentaristas de eventos seguem sem nome.",
  "- **De onde vem:** o portal e-Cidadania publica, em página aberta e junto da ideia, o nome do autor já abreviado pelo próprio Senado (ex.: \"PEDRO H. S. V.\") e a UF. O dataset copia o que está publicado: não completa o nome, não infere identidade e não cruza com outras bases.",
  "- **Finalidade:** pesquisa sobre participação cidadã no Senado (quem propõe, de onde e com que desfecho), compatível com a finalidade e o interesse público que justificaram a publicação no portal (LGPD, art. 7º, § 3º). Como tratamento posterior de dado de acesso público, segue o art. 7º, § 7º: propósito legítimo e específico e preservação dos direitos do titular.",
  "- **Para quem reutiliza:** ao usar o nome, você também trata dado pessoal e responde pela sua própria finalidade; dispensar o consentimento não dispensa os princípios da LGPD (art. 7º, § 6º). O projeto pede que o nome não seja usado para identificar, contatar ou perfilar pessoas, nem cruzado com outras bases.",
  "- **Direitos do titular:** quem estiver nomeado e quiser o nome omitido escreve para sbissoli76@gmail.com informando o número da ideia. O nome sai a partir da edição seguinte do dataset: autor e UF ficam nulos, e a linha do tempo mostra \"[nome omitido a pedido do titular]\". Versões já publicadas no Zenodo não podem ser alteradas.",
  "",
];

/** Dicionário em Markdown, determinístico (sem carimbo de tempo): regenerar e `git diff` acusa deriva. */
export function dicionarioMarkdown(): string {
  const partes = [
    "# Dicionário do dataset 3.0.0 — participação no e-Cidadania (Senado Federal)",
    "",
    "> **Gerado automaticamente** de `scripts/publicacao/dicionario.ts` (fonte única). Não editar à mão.",
    "",
    `- **Esquema:** \`${ESQUEMA_V3}\` (MAJOR sobre o 2.0.0: fim do envelope por célula, tabelas tidy, séries no tempo, nome do autor da ideia).`,
    "- **Licença do dado:** Dados Abertos do Senado Federal — uso livre com atribuição da fonte.",
    "- **Valores puros**, um por célula. Datas em `AAAA-MM-DD`; instantes em UTC; horas `HH:MM` locais de Brasília, como publicadas.",
    "- ⚙️ = coluna **calculada** pelo projeto (não lida da fonte), mantida por conveniência e marcada.",
    "",
    "## De onde vêm os valores",
    "",
    "Três camadas: o **arquivo de páginas** (cada página baixada, guardada inteira, endereçada pelo sha256; privado), as **observações** (o que cada página mostrou e quando) e estas **tabelas**. Cada valor vem da leitura mais recente do arquivo; o que o arquivo ainda não leu — ou nunca vai ler, como as consultas encerradas que saíram da listagem e as ideias removidas — vem do **corpus**, o banco que o projeto mantém desde 14/06/2026. As colunas `origem<Bloco>` e `coletadoEm<Bloco>` dizem, por bloco de página, de onde e de quando veio cada linha.",
    "",
    ...FINALIDADE_DO_NOME,
  ];
  for (const t of DICIONARIO) {
    partes.push(
      `## \`${t.caminho}\` — ${t.titulo}`, "", t.descricao, "", `**Arquivo:** \`${arquivoDaTabela(t)}\``, "", `**Uma linha por:** ${t.chave.map((k) => `\`${k}\``).join(" × ")}`, "",
      "| Coluna | Tipo | Descrição | Fonte | Nota |", "|---|---|---|---|---|", ...t.colunas.map(linhaDaColuna), "",
    );
  }
  return partes.join("\n");
}
