/**
 * The server icon is declared in TWO places that must never disagree:
 *
 *   1. `src/server.ts` — `serverInfo.icons`, what every MCP client sees on the
 *      handshake;
 *   2. `server.json`   — what the MCP Registry publishes and what every
 *      directory mirrors.
 *
 * WHY THIS EXISTS. Until 3.5.1 only (1) declared the icon; `server.json` was
 * silent, so the registry — and therefore mcpindex.ai, which snapshots it —
 * believed this server had no icon and docked 5 completeness points from a
 * server that has a perfectly good one. Now both declare it, and the failure
 * mode flips: someone edits one and not the other, and the handshake starts
 * advertising a different image from the directories. Neither side errors; they
 * just quietly disagree.
 *
 * Unlike the sibling repos (bcb-br-mcp, ibge-br-mcp), the bytes live in exactly
 * ONE place here — `src/icon.ts`, inlined as base64 and served by `/icon.jpg`.
 * There is no `assets/` copy to drift from, which is the better arrangement;
 * what this file guards is the URL and the metadata around it.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ICON_JPEG_BASE64 } from "../src/icon.js";

const raiz = join(__dirname, "..");
const bytesDoIcone = (): Buffer => Buffer.from(ICON_JPEG_BASE64, "base64");

/** Dimensions read from the JPEG SOF marker — no image dependency. */
function dimensoesJpeg(buf: Buffer): { largura: number; altura: number } {
  if (buf.readUInt16BE(0) !== 0xffd8) throw new Error("not a JPEG");
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marcador = buf[i + 1]!;
    // SOF0..SOF15, minus the markers that are not frame headers.
    if (marcador >= 0xc0 && marcador <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marcador)) {
      return { altura: buf.readUInt16BE(i + 5), largura: buf.readUInt16BE(i + 7) };
    }
    if (marcador === 0xd8 || marcador === 0xd9 || (marcador >= 0xd0 && marcador <= 0xd7)) {
      i += 2;
      continue;
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  throw new Error("SOF marker not found");
}

interface ManifestoIcone {
  src: string;
  mimeType?: string;
  sizes?: string[];
}

const manifesto = (): ManifestoIcone[] | undefined =>
  (JSON.parse(readFileSync(join(raiz, "server.json"), "utf8")) as { icons?: ManifestoIcone[] })
    .icons;

describe("server icon: serverInfo x manifest x route", () => {
  it("server.json declares the same URL as serverInfo.icons", () => {
    const icone = manifesto()?.[0];
    expect(
      icone,
      "server.json must declare icons — that is 5 completeness points in the directories",
    ).toBeDefined();
    const serverTs = readFileSync(join(raiz, "src", "server.ts"), "utf8");
    expect(
      serverTs,
      "serverInfo.icons and server.json point at different images",
    ).toContain(icone!.src);
  });

  it("the declared URL is served by the server's own domain, on a public route", () => {
    const icone = manifesto()![0]!;
    expect(icone.src).toBe("https://senado.sidneybissoli.com/icon.jpg");
    const indexTs = readFileSync(join(raiz, "src", "index.ts"), "utf8");
    // Public and BEFORE the Bearer check: whoever fetches the icon is a
    // directory crawler, never an authenticated client.
    expect(indexTs).toContain('url.pathname === "/icon.jpg"');
  });

  it("mimeType and sizes describe the image that exists, not a promise", () => {
    const { largura, altura } = dimensoesJpeg(bytesDoIcone());
    expect(manifesto()![0]!.mimeType).toBe("image/jpeg");
    expect(manifesto()![0]!.sizes).toEqual([`${largura}x${altura}`]);
  });

  it("the icon fits under Smithery's 1 MB ceiling", () => {
    expect(bytesDoIcone().byteLength).toBeLessThan(1024 * 1024);
  });
});
