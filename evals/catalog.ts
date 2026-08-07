/**
 * Catalog — the single source of truth for the eval harness.
 *
 * The extractor machinery (fake `CapturingServer`, zod → JSON-schema conversion,
 * memoized build) lives in `@sbissoli/mcp-evals`; the only server-specific part is the
 * GROUPS list below, mirroring `src/server.ts`. Each entry tags the tools it registers
 * with a coarse `area` used for per-area accuracy reporting. A group missing here
 * silently shrinks the eval — keep it in sync with `src/server.ts`.
 *
 * No network, no Worker runtime needed: the `registerXTools` functions only read params
 * and call `server.tool(...)` synchronously; the tool *callbacks* (which would touch
 * upstream/cache/D1) are captured but never invoked. Fixtures (`expectedTools`) are
 * validated against THIS catalog, so when a tool is renamed/removed the offline unit
 * test fails immediately.
 */

import { buildCatalog, type CatalogGroup } from "@sbissoli/mcp-evals";

import { registerReferenciaTools } from "../src/tools/referencia.js";
import { registerSenadoresTools } from "../src/tools/senadores.js";
import { registerMateriasTools } from "../src/tools/materias.js";
import { registerVotacoesTools } from "../src/tools/votacoes.js";
import { registerComissoesTools } from "../src/tools/comissoes.js";
import { registerPlenarioTools } from "../src/tools/plenario.js";
import { registerProcessosTools } from "../src/tools/processos.js";
import { registerECidadaniaTools } from "../src/tools/ecidadania.js";
import { registerDiscursosTools } from "../src/tools/discursos.js";
import { registerComposicaoTools } from "../src/tools/composicao.js";
import { registerOrcamentoTools } from "../src/tools/orcamento.js";
import { registerLegislacaoTools } from "../src/tools/legislacao.js";
import { registerVotacaoComissaoTools } from "../src/tools/votacao-comissao.js";
import { registerTaquigrafiaTools } from "../src/tools/taquigrafia.js";
import { registerSenadoresAdminTools } from "../src/tools/senadores-admin.js";
import { registerContratacoesTools } from "../src/tools/contratacoes.js";
import { registerServidoresTools } from "../src/tools/servidores.js";
import { registerSupridosTools } from "../src/tools/supridos.js";
import { registerOrcamentoSenadoTools } from "../src/tools/orcamento-senado.js";
import { registerEstruturaTools } from "../src/tools/estrutura.js";

/**
 * Minimal stub Env. The only group that reads `env` at registration time is e-Cidadania,
 * and it only reads optional fields (ECIDADANIA_DB, ECIDADANIA_CORPUS_STALE_MAX_MIN) — both
 * fine as `undefined`. No binding is exercised because callbacks are never invoked.
 */
const STUB_ENV = {} as unknown as Parameters<typeof registerECidadaniaTools>[2];

const LEGIS_BASE = "https://legis.senado.leg.br/dadosabertos";
const ADM_BASE = "https://adm.senado.gov.br/adm-dadosabertos";

const GROUPS: CatalogGroup[] = [
  { area: "referencia", register: (s) => registerReferenciaTools(s as never, LEGIS_BASE) },
  { area: "senadores", register: (s) => registerSenadoresTools(s as never, LEGIS_BASE) },
  { area: "materias", register: (s) => registerMateriasTools(s as never, LEGIS_BASE) },
  { area: "votacoes", register: (s) => registerVotacoesTools(s as never, LEGIS_BASE) },
  { area: "comissoes", register: (s) => registerComissoesTools(s as never, LEGIS_BASE) },
  { area: "plenario", register: (s) => registerPlenarioTools(s as never, LEGIS_BASE) },
  { area: "processos", register: (s) => registerProcessosTools(s as never, LEGIS_BASE) },
  { area: "ecidadania", register: (s) => registerECidadaniaTools(s as never, LEGIS_BASE, STUB_ENV) },
  { area: "discursos", register: (s) => registerDiscursosTools(s as never, LEGIS_BASE) },
  { area: "composicao", register: (s) => registerComposicaoTools(s as never, LEGIS_BASE) },
  { area: "orcamento", register: (s) => registerOrcamentoTools(s as never, LEGIS_BASE) },
  { area: "legislacao", register: (s) => registerLegislacaoTools(s as never, LEGIS_BASE) },
  { area: "votacao-comissao", register: (s) => registerVotacaoComissaoTools(s as never, LEGIS_BASE) },
  { area: "taquigrafia", register: (s) => registerTaquigrafiaTools(s as never, LEGIS_BASE) },
  { area: "senadores-admin", register: (s) => registerSenadoresAdminTools(s as never, ADM_BASE) },
  { area: "servidores", register: (s) => registerServidoresTools(s as never, ADM_BASE) },
  { area: "contratacoes", register: (s) => registerContratacoesTools(s as never, ADM_BASE) },
  { area: "supridos", register: (s) => registerSupridosTools(s as never, ADM_BASE) },
  { area: "orcamento-senado", register: (s) => registerOrcamentoSenadoTools(s as never) },
  { area: "estrutura", register: (s) => registerEstruturaTools(s as never) },
];

/** The live catalog (tools + toolNames + areaByName), built once at module load. */
export const CATALOG = buildCatalog(GROUPS);
