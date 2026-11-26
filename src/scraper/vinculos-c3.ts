/**
 * E1.d do ROADMAP — o servidor lê os vínculos do e-Cidadania com as matérias oficiais (`vinculos/materias`
 * e `vinculos/autores` do dataset 3.0.0, projetados no D1 pelo job das observações). Decisão 6 do dono
 * (24/11/2026): sem ferramenta nova — `obter_consulta` e `obter_ideia` levam o código oficial da matéria
 * e os autores com código e papel, para o cliente seguir a `senado_obter_materia`/`senado_obter_processo`
 * (matéria) e `senado_obter_senador` (autor).
 *
 * Tudo devolve `null` quando as tabelas não estão no banco (canal stdio, cópia ainda não projetada): a
 * ferramenta responde como antes, sem o campo. Mapeamento puro e exportado para os testes; SQL estático
 * com parâmetros ligados.
 */

import { tabelaC3, TABELA_CONTROLE_C3 } from "./camada3-tabelas.js";

type Txt = string | null;
type Num = number | null;

export interface VinculoC3 {
  entidade: string;
  itemId: number;
  casa: "SF" | "CD";
  codigo: number;
  metodo: string;
  linkPublicado: Txt;
  situacao: "lida" | "sem-processo" | "nao-encontrada" | "pendente";
  processos: Txt;
  identificacao: Txt;
  resumoAutoria: Txt;
  confereComPortal: Txt;
  conferidoEm: Txt;
}

export interface AutorC3 {
  casa: "SF" | "CD";
  codigo: number;
  processo: Num;
  papel: "iniciativa" | "texto" | "camara";
  posicao: number;
  autor: Txt;
  tipo: Txt;
  codigoParlamentar: Num;
  idDeputado: Num;
  uf: Txt;
  siglaPartido: Txt;
  proponente: Num;
}

/** Um autor como a ferramenta o mostra. */
export interface AutorOficial {
  papel: AutorC3["papel"];
  posicao: number;
  autor: Txt;
  tipo: Txt;
  codigoParlamentar: Num;
  idDeputado: Num;
  uf: Txt;
  siglaPartido: Txt;
}

/** Uma matéria oficial ligada ao item, como a ferramenta a mostra. */
export interface MateriaOficial {
  casa: "SF" | "CD";
  codigo: number;
  identificacao: Txt;
  metodo: string;
  linkPublicado: Txt;
  situacao: VinculoC3["situacao"];
  processos: number[];
  resumoAutoria: Txt;
  conferidoEm: Txt;
  fonte: string;
  autores: AutorOficial[];
}

const SENADO = "https://legis.senado.leg.br/dadosabertos";
const CAMARA = "https://dadosabertos.camara.leg.br/api/v2";

/** Endereço da fonte oficial de onde vieram a matéria e os autores. */
export const fonteDaMateria = (casa: "SF" | "CD", codigo: number): string =>
  casa === "SF" ? `${SENADO}/processo?codigoMateria=${codigo}` : `${CAMARA}/proposicoes/${codigo}/autores`;

const ORDEM_PAPEL: Record<AutorC3["papel"], number> = { iniciativa: 0, texto: 1, camara: 2 };

/** Vínculos + autores → as matérias oficiais do item, na ordem dos vínculos. Puro. */
export function materiasOficiais(vinculos: readonly VinculoC3[], autores: readonly AutorC3[]): MateriaOficial[] {
  return vinculos.map((v) => ({
    casa: v.casa,
    codigo: v.codigo,
    identificacao: v.identificacao,
    metodo: v.metodo,
    linkPublicado: v.linkPublicado,
    situacao: v.situacao,
    processos: v.processos ? v.processos.split(",").map(Number) : [],
    resumoAutoria: v.resumoAutoria,
    conferidoEm: v.conferidoEm,
    fonte: fonteDaMateria(v.casa, v.codigo),
    autores: autores
      .filter((a) => a.casa === v.casa && a.codigo === v.codigo)
      .sort((a, b) => (a.processo ?? 0) - (b.processo ?? 0) || ORDEM_PAPEL[a.papel] - ORDEM_PAPEL[b.papel] || a.posicao - b.posicao)
      .map((a) => ({
        papel: a.papel, posicao: a.posicao, autor: a.autor, tipo: a.tipo, codigoParlamentar: a.codigoParlamentar,
        idDeputado: a.idDeputado, uf: a.uf, siglaPartido: a.siglaPartido,
      })),
  }));
}

const TV = { materias: tabelaC3("vinculos/materias"), autores: tabelaC3("vinculos/autores") };
export const COLS_VINCULO =
  "entidade, itemId, casa, codigo, metodo, linkPublicado, situacao, processos, identificacao, resumoAutoria, confereComPortal, conferidoEm";
export const COLS_AUTOR = "casa, codigo, processo, papel, posicao, autor, tipo, codigoParlamentar, idDeputado, uf, siglaPartido, proponente";

/**
 * As matérias oficiais de um item (consulta ou ideia), ou null quando os vínculos não estão no banco
 * (tabelas ausentes ou vazias, D1 ausente). Item sem vínculo → lista vazia.
 */
export async function materiasOficiaisDaC3(db: D1Database | undefined, entidade: "consultas" | "ideias", itemId: number): Promise<MateriaOficial[] | null> {
  if (!db) return null;
  try {
    const ctl = await db
      .prepare(`SELECT COUNT(*) AS n FROM ${TABELA_CONTROLE_C3} WHERE tabela IN (?, ?) AND linhas > 0`)
      .bind(TV.materias, TV.autores)
      .first<{ n: number }>();
    if ((ctl?.n ?? 0) < 2) return null;
    const vs = await db
      .prepare(`SELECT ${COLS_VINCULO} FROM ${TV.materias} WHERE entidade = ? AND itemId = ? ORDER BY casa, codigo`)
      .bind(entidade, itemId)
      .all<VinculoC3>();
    const vinculos = vs.results ?? [];
    if (vinculos.length === 0) return [];
    const marcas = vinculos.map(() => "(casa = ? AND codigo = ?)").join(" OR ");
    const as = await db
      .prepare(`SELECT ${COLS_AUTOR} FROM ${TV.autores} WHERE ${marcas}`)
      .bind(...vinculos.flatMap((v) => [v.casa, v.codigo]))
      .all<AutorC3>();
    return materiasOficiais(vinculos, as.results ?? []);
  } catch {
    return null;
  }
}
