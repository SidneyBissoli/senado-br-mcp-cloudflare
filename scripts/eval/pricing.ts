/**
 * Token pricing for the battery's two models (USD per million tokens, from
 * platform.claude.com/docs pricing as of 2026-07). The dry-run cost report
 * produced from these numbers is the budgeting basis for phase F3.
 *
 * Cache multipliers: ephemeral (5-minute TTL) writes bill at 1.25x the input
 * price; cache reads bill at 0.1x. Both cache breakpoints the runner sets
 * (mcp_toolset + stable system prompt) use the 5-minute TTL.
 */

import type { UsageTotals } from "./types.js";

export interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  "claude-sonnet-4-6": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-haiku-4-5": { inputPerMTok: 1, outputPerMTok: 5 },
};

export const CACHE_WRITE_MULTIPLIER = 1.25;
export const CACHE_READ_MULTIPLIER = 0.1;

export function costUSD(model: string, usage: UsageTotals): number {
  const p = MODEL_PRICING[model];
  if (!p) throw new Error(`no pricing entry for model ${model} — update scripts/eval/pricing.ts`);
  const M = 1_000_000;
  return (
    (usage.inputTokens * p.inputPerMTok) / M +
    (usage.cacheCreationInputTokens * p.inputPerMTok * CACHE_WRITE_MULTIPLIER) / M +
    (usage.cacheReadInputTokens * p.inputPerMTok * CACHE_READ_MULTIPLIER) / M +
    (usage.outputTokens * p.outputPerMTok) / M
  );
}
