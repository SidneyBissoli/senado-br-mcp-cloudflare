/** Regrava `docs/dataset-dictionary-v3.md` a partir de `dicionario.ts` (determinístico, sem carimbo). */
import { writeFileSync } from "node:fs";
import { dicionarioMarkdown } from "./dicionario.js";

export const ARQUIVO_DO_DICIONARIO = "docs/dataset-dictionary-v3.md";
writeFileSync(ARQUIVO_DO_DICIONARIO, dicionarioMarkdown(), "utf8");
console.log(`[dicionario] ${ARQUIVO_DO_DICIONARIO} regravado`);
