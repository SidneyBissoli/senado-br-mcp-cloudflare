/**
 * Nomes das tabelas da camada 3 no D1 (fase D3 do ROADMAP) — compartilhados pelo job que as projeta
 * (`scripts/publicacao/projecao.ts`) e pelo servidor que as lê (`src/scraper/camada3.ts`).
 *
 * Só as tabelas que alguma ferramenta lê. Ficam de fora, de propósito (o dono é avesso a crescer o
 * banco sem uso): `eventos/comentarios` (~268 mil linhas; as ferramentas só mostram a contagem, que já
 * está em `eventos/eventos`) e `ideias/situacoes-portal` (a situação do portal no tempo já vem do
 * `historico-situacao`, que o `obter_ideia` mostra).
 *
 * Cada tabela tem as colunas do dicionário 3.0.0 (`scripts/publicacao/dicionario.ts`, fonte única),
 * menos as de `omitir`, mais `chave` (TEXT PRIMARY KEY de tabela WITHOUT ROWID: 16 hex do sha256 da
 * chave do dicionário em JSON — há chaves com colunas que podem ser null, e o SQLite trata nulls como
 * distintos numa chave composta; o hash curto guarda a chave uma vez só, em 16 bytes). `c3_projecao` guarda, por tabela,
 * quando a cópia foi gerada (`gerado_em`, o instante do Parquet) e aplicada.
 */

export const TABELA_CONTROLE_C3 = "c3_projecao";

export interface TabelaC3 {
  /** Caminho no dicionário 3.0.0 (`<entidade>/<tabela>`). */
  caminho: string;
  /** Nome no D1. */
  tabela: string;
  /** Índices além da chave (cada um, uma lista de colunas). */
  indices: string[][];
  /** Colunas do dicionário que NÃO vão ao D1 (nenhuma ferramenta as mostra). */
  omitir?: string[];
  /** Linhas que NÃO vão ao D1: as que têm em `coluna` um dos valores de `excluir` (nenhuma ferramenta as mostra). */
  filtro?: { coluna: string; excluir: string[] };
  /** Só as linhas cujas `colunas` aparecem (mesmos nomes) na tabela `de` já filtrada. */
  somenteCom?: { de: string; colunas: string[] };
}

export const TABELAS_C3: readonly TabelaC3[] = [
  { caminho: "ideias/ideias", tabela: "c3_ideias", indices: [["id"], ["status", "apoios"], ["apoios"]] },
  { caminho: "ideias/proposicoes", tabela: "c3_ideias_proposicoes", indices: [["id"]] },
  { caminho: "ideias/linha-do-tempo", tabela: "c3_ideias_linha_do_tempo", indices: [["id"]] },
  { caminho: "ideias/serie-apoios", tabela: "c3_ideias_serie_apoios", indices: [["entity_id"]], omitir: ["sha"] },
  { caminho: "ideias/historico-situacao", tabela: "c3_ideias_historico_situacao", indices: [["entity_id"]], omitir: ["sha"] },
  { caminho: "consultas/consultas", tabela: "c3_consultas", indices: [["id"], ["status"]] },
  { caminho: "consultas/serie-votos", tabela: "c3_consultas_serie_votos", indices: [["id"]], omitir: ["sha"] },
  { caminho: "eventos/eventos", tabela: "c3_eventos", indices: [["id"], ["status"]] },
  { caminho: "eventos/pauta", tabela: "c3_eventos_pauta", indices: [["id"]] },
  { caminho: "eventos/convidados", tabela: "c3_eventos_convidados", indices: [["id"]] },
  { caminho: "consultas_votos/materias", tabela: "c3_acervo_materias", indices: [["codigo"]] },
  { caminho: "consultas_votos/votos-uf", tabela: "c3_acervo_votos_uf", indices: [["codigo"], ["uf"]], omitir: ["sha"] },
  // E1.d: os vínculos que `obter_consulta`/`obter_ideia` mostram. Sem o texto do portal (já está em
  // `c3_consultas`), sem o sha (prova do arquivo; o dataset o traz) e sem o acervo de votos por UF
  // (nenhuma ferramenta mostra os vínculos dele; medido 26/11/2026: o acervo seria ~60% das linhas, e os
  // autores iriam de ~13 MB a ~25 MB de SQL na carga completa). O dataset publica tudo.
  { caminho: "vinculos/materias", tabela: "c3_vinculos_materias", indices: [["entidade", "itemId"]], omitir: ["autoriaNoPortal"], filtro: { coluna: "entidade", excluir: ["consultas_votos"] } },
  { caminho: "vinculos/autores", tabela: "c3_vinculos_autores", indices: [["casa", "codigo"]], omitir: ["sha"], somenteCom: { de: "vinculos/materias", colunas: ["casa", "codigo"] } },
];

export const tabelaC3 = (caminho: string): string => {
  const t = TABELAS_C3.find((x) => x.caminho === caminho);
  if (!t) throw new Error(`tabela da camada 3 desconhecida: ${caminho}`);
  return t.tabela;
};
