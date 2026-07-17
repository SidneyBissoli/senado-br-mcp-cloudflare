/**
 * Catalog extractor — the single source of truth for the eval harness.
 *
 * We never hit the network. Instead we build a *fake* McpServer that only implements
 * `.tool(name, description, zodShape, cb)` and capture every registration call. We then
 * import each `registerXTools` from `src/tools/*` and run them against the fake server,
 * exactly as `src/server.ts` wires them up. The result is the live list of ~67 tools with
 * their names, descriptions and a JSON-schema view of their input shape.
 *
 * Why this matters: fixtures (`expectedTools`) are validated against THIS catalog, so when
 * a tool is renamed/removed the offline unit test fails immediately — that is the cheap,
 * reusable regression signal the ROADMAP's "rodar evals após mudança de tool" item relies on.
 *
 * No network, no Worker runtime needed: the `registerXTools` functions only read params and
 * call `server.tool(...)` synchronously; the tool *callbacks* (which would touch upstream/
 * cache/D1) are captured but never invoked here.
 */

import { z, type ZodTypeAny } from "zod";

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

/** A minimal JSON-schema (draft 2020-12 subset) describing a tool's input object. */
export interface JsonSchema {
  type: "object";
  properties: Record<string, unknown>;
  required: string[];
  additionalProperties: false;
}

export interface CatalogTool {
  name: string;
  description: string;
  /** Coarse functional area, derived from the registering group module. */
  area: string;
  /** JSON-schema view of the zod input shape (for the model's tool definition). */
  inputSchema: JsonSchema;
}

type ZodShape = Record<string, ZodTypeAny>;

/**
 * Fake McpServer that only records `.tool()` calls. The real server in `src/server.ts`
 * wraps `.tool` with `registerTool`/`instrumentTool`, but the group modules always call
 * the 4-arg `server.tool(name, description, shape, cb)` form — that is all we capture.
 */
class CapturingServer {
  readonly captured: { name: string; description: string; shape: ZodShape }[] = [];
  tool(name: string, description: string, shape: ZodShape, _cb: unknown): void {
    this.captured.push({ name, description, shape });
  }
}

/**
 * Minimal stub Env. The only group that reads `env` at registration time is e-Cidadania,
 * and it only reads optional fields (ECIDADANIA_DB, ECIDADANIA_CORPUS_STALE_MAX_MIN) — both
 * fine as `undefined`. No binding is exercised because callbacks are never invoked.
 */
const STUB_ENV = {} as unknown as Parameters<typeof registerECidadaniaTools>[2];

const LEGIS_BASE = "https://legis.senado.leg.br/dadosabertos";
const ADM_BASE = "https://adm.senado.gov.br/adm-dadosabertos";

/**
 * The group wiring, mirroring `src/server.ts`. Each entry tags the tools it registers with
 * a coarse `area` used for per-area accuracy reporting.
 */
const GROUPS: { area: string; register: (s: CapturingServer) => void }[] = [
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

// ---------------------------------------------------------------------------
// Zod -> JSON-schema conversion.
//
// Zod 4 ships a native, version-stable `z.toJSONSchema` — so the harness still adds no
// extra dependency, but no longer reaches into zod's private internals (which churn
// between majors; the old hand-rolled converter broke on the 3->4 bump). We convert in
// `io: "input"` mode so a param is required iff it is neither `.optional()` nor
// `.default()` (a defaulted field is supplied by the server, so the model need not send
// it). The result is normalized to this harness's JsonSchema contract: native output
// omits `additionalProperties` and drops `required` when empty.
// ---------------------------------------------------------------------------

/** Convert a zod object-shape (the 3rd arg of server.tool) into a JSON schema. */
export function shapeToJsonSchema(shape: ZodShape): JsonSchema {
  const raw = z.toJSONSchema(z.object(shape), { io: "input" }) as {
    properties?: Record<string, unknown>;
    required?: string[];
  };
  return {
    type: "object",
    properties: raw.properties ?? {},
    required: raw.required ?? [],
    additionalProperties: false,
  };
}

let _cache: CatalogTool[] | null = null;

/** Build (and memoize) the full tool catalog by running every group's registrar. */
export function buildCatalog(): CatalogTool[] {
  if (_cache) return _cache;
  const tools: CatalogTool[] = [];
  for (const group of GROUPS) {
    const server = new CapturingServer();
    group.register(server);
    for (const t of server.captured) {
      tools.push({
        name: t.name,
        description: t.description,
        area: group.area,
        inputSchema: shapeToJsonSchema(t.shape),
      });
    }
  }
  _cache = tools;
  return tools;
}

/** Set of all tool names, for O(1) fixture validation. */
export function catalogToolNames(): Set<string> {
  return new Set(buildCatalog().map((t) => t.name));
}

/** Map tool name -> coarse area (used for per-area accuracy reporting). */
export function catalogAreaByName(): Map<string, string> {
  return new Map(buildCatalog().map((t) => [t.name, t.area]));
}

/** Anthropic Messages API `tools` array built from the catalog. */
export function catalogAsAnthropicTools(): {
  name: string;
  description: string;
  input_schema: JsonSchema;
}[] {
  return buildCatalog().map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
  }));
}
