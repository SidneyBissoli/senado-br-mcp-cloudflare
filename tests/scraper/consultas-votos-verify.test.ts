/**
 * Unit tests for the consultas_votos weekly integrity-check verdict (ROADMAP Etapa 2, "Cron diário").
 *
 * The frozen acervo is `integro` only when the freshly-parsed CSV changed nothing AND kept the same
 * matéria count. Any hash change (edited votes / a new matéria) OR a count change (a deleted matéria,
 * which leaves rowsChanged 0) is a `divergente` verdict that must alert instead of overwriting.
 */

import { describe, it, expect } from "vitest";
import { verifyAcervoIntegrity } from "../../scripts/ingest-ecidadania/verify.js";

describe("verifyAcervoIntegrity", () => {
  it("is integro when nothing changed and the count is identical", () => {
    expect(verifyAcervoIntegrity({ rowsScraped: 15085, existingCount: 15085, rowsChanged: 0 })).toBe("integro");
  });

  it("is divergente when any matéria hash changed", () => {
    expect(verifyAcervoIntegrity({ rowsScraped: 15085, existingCount: 15085, rowsChanged: 1 })).toBe("divergente");
  });

  it("is divergente when a matéria was added (count grows, new id counts as changed)", () => {
    expect(verifyAcervoIntegrity({ rowsScraped: 15086, existingCount: 15085, rowsChanged: 1 })).toBe("divergente");
  });

  it("is divergente when a matéria was deleted (count shrinks even though rowsChanged is 0)", () => {
    expect(verifyAcervoIntegrity({ rowsScraped: 15084, existingCount: 15085, rowsChanged: 0 })).toBe("divergente");
  });

  it("is divergente against an empty baseline (no vintage registered yet)", () => {
    expect(verifyAcervoIntegrity({ rowsScraped: 15085, existingCount: 0, rowsChanged: 15085 })).toBe("divergente");
  });
});
