import type { ArtisAdapter, ArtisDepot, ArtisStockPage } from "./interface";
import { artisStockPageSchema, artisDepotListSchema } from "./validation";
import { z } from "zod";

const NORMAL_DEPOTS: ArtisDepot[] = [
  { code: "PAR01", name: "Paris - Atelier 1" },
  { code: "LYO01", name: "Lyon - Dépôt central" },
];

const NORMAL_LINES = [
  { articleRef: "ART-001", designation: "Imprimante UV", supplierRef: null, qty: 12 },
  { articleRef: "ART-002", designation: "Encre cyan", supplierRef: null, qty: 48 },
  { articleRef: "ART-003", designation: "Plaque aluminium", supplierRef: null, qty: 24 },
];

const LARGE_LINES = Array.from({ length: 1200 }, (_, index) => ({
  articleRef: `ART-${(1000 + index).toString().padStart(4, "0")}`,
  designation: `Article grand volume ${index + 1}`,
  supplierRef: null,
  qty: 10 + (index % 5),
}));

/**
 * Lets a single running mock server serve different fixtures per depot,
 * keyed by an "E2E-" code prefix that can never collide with a real depot
 * code. Needed because ARTIS_FIXTURE is a single process-wide env var, but
 * E2E specs (one long-lived `next dev` per Playwright run) need several
 * fixture behaviors available at once. Falls back to the env-driven
 * constructor fixture when the depot code doesn't match the convention.
 */
function fixtureOverrideForDepot(depotCode: string): string | null {
  const match = /^E2E-(EMPTY|MALFORMED|PAGINATED|NORMAL)/.exec(depotCode);
  return match ? match[1].toLowerCase() : null;
}

export class ArtisMockAdapter implements ArtisAdapter {
  private fixture: string;

  constructor(fixture = "normal") {
    this.fixture = fixture;
  }

  async listDepots(): Promise<ArtisDepot[]> {
    return artisDepotListSchema.parse(NORMAL_DEPOTS);
  }

  async getTheoreticalStock(depotCode: string, page: number): Promise<ArtisStockPage> {
    const pageSize = 50;
    const fixture = fixtureOverrideForDepot(depotCode) ?? this.fixture;
    switch (fixture) {
      case "empty":
        return {
          depotCode,
          page: 1,
          pageCount: 1,
          items: [],
        };
      case "malformed":
        return {
          depotCode,
          page: 1,
          pageCount: 1,
          items: [{ articleRef: "", qty: -1 }],
        } as unknown as ArtisStockPage;
      case "paginated": {
        const pages = Math.ceil(LARGE_LINES.length / pageSize);
        const start = (page - 1) * pageSize;
        return {
          depotCode,
          page,
          pageCount: pages,
          items: LARGE_LINES.slice(start, start + pageSize),
        };
      }
      case "normal":
      default:
        return {
          depotCode,
          page: 1,
          pageCount: 1,
          items: artisStockPageSchema.parse({
            depotCode,
            page: 1,
            pageCount: 1,
            items: NORMAL_LINES,
          }).items,
        };
    }
  }
}
