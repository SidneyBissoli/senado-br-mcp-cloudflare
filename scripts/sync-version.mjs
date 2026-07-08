// Single source of truth for the release version is package.json.
// This mirrors that version into the two other files that cannot derive it:
//   - server.json     (static MCP Registry manifest, read by mcp-publisher)
//   - src/version.ts  (runtime VERSION constant used by the Worker and the stdio CLI)
// package-lock.json is handled by npm itself.
//
// Run automatically by the npm "version" lifecycle hook, so a single
// `npm version <major|minor|patch|x.y.z>` updates every file at once.
// Can also be run standalone after editing package.json: `node scripts/sync-version.mjs`.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
if (!/^\d+\.\d+\.\d+/.test(version)) {
  throw new Error(`package.json version looks invalid: ${JSON.stringify(version)}`);
}

// Targeted regex replaces (not full re-serialization) so formatting stays byte-stable
// and diffs show only the version bump.
const targets = [
  // server.json: top-level "version" AND each npm package "version"
  { file: "server.json", re: /("version":\s*")\d+\.\d+\.\d+[^"]*(")/g },
  // src/version.ts: the exported constant
  { file: "src/version.ts", re: /(export const VERSION = ")\d+\.\d+\.\d+[^"]*(")/ },
];

let changed = 0;
for (const { file, re } of targets) {
  const path = join(root, file);
  const before = readFileSync(path, "utf8");
  const after = before.replace(re, `$1${version}$2`);
  if (after !== before) {
    writeFileSync(path, after);
    console.log(`synced ${file} → ${version}`);
    changed++;
  } else {
    console.log(`${file} already at ${version}`);
  }
}
console.log(changed ? `done (${changed} file(s) updated)` : "done (nothing to update)");
