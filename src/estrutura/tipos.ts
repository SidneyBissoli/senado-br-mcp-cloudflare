/**
 * Estrutura organizacional do Senado Federal — tipos do snapshot bundlado.
 *
 * A árvore de órgãos é reconstruída offline a partir do portal institucional
 * (www12.senado.leg.br/institucional/estrutura/orgaosenado?codorgao=…) pelo crawler
 * `scripts/ingest-estrutura/index.ts` e congelada em `src/data/estrutura-organizacional.ts`.
 * A API de dados abertos NÃO publica a hierarquia até o nível de serviço — só o portal
 * institucional desce até lá. Como a estrutura muda raramente, o snapshot é versionado no
 * repositório e atualizado por rodada manual do crawler (não há scraping por request).
 */

/** Um órgão da árvore: código interno, sigla (quando publicada), nome e código do superior. */
export interface OrgaoNode {
  /** Código interno do órgão no portal institucional (COD_ORGAO / `codorgao`). */
  cod: number;
  /** Sigla oficial (ex.: "DGER", "SEGRAF"). `null` quando o portal não a expõe (serviços/núcleos profundos). */
  sigla: string | null;
  /** Nome por extenso do órgão (ex.: "Secretaria de Editoração e Publicações"). */
  nome: string;
  /** Código do órgão imediatamente superior; `null` apenas para a raiz. */
  codSuperior: number | null;
}

/** Metadados do snapshot (carimbo da extração, contagem, fonte). */
export interface EstruturaSnapshot {
  /** ISO-8601 do momento em que o crawler leu o portal. */
  extraidoEm: string;
  /** URL-base das páginas de detalhe de onde a árvore foi reconstruída. */
  fonteUrl: string;
  /** Total de órgãos no snapshot. */
  total: number;
  /** Órgãos da árvore. */
  orgaos: OrgaoNode[];
}
