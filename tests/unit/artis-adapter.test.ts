import { afterEach, describe, expect, it } from "vitest";
import { getArtisAdapter } from "../../lib/artis/factory";
import { artisStockPageSchema } from "../../lib/artis/validation";

const originalMode = process.env.ARTIS_MODE;
const originalFixture = process.env.ARTIS_FIXTURE;

function setFixture(fixture: string) {
  process.env.ARTIS_MODE = "mock";
  process.env.ARTIS_FIXTURE = fixture;
}

describe("ArtisMockAdapter fixtures via getArtisAdapter() (ARTIS_MODE=mock)", () => {
  afterEach(() => {
    process.env.ARTIS_MODE = originalMode;
    process.env.ARTIS_FIXTURE = originalFixture;
  });

  it("normal fixture: returns a non-empty list of valid stock lines", async () => {
    setFixture("normal");
    const adapter = getArtisAdapter();

    const page = await adapter.getTheoreticalStock("PAR01", 1);
    const parsed = artisStockPageSchema.parse(page);

    expect(parsed.items.length).toBeGreaterThan(0);
  });

  it("empty fixture: theoretical stock is empty (FR-023/FR-029 refusal is enforced upstream in US1's prepareSession, not yet built in Foundations)", async () => {
    setFixture("empty");
    const adapter = getArtisAdapter();

    const page = await adapter.getTheoreticalStock("PAR01", 1);
    const parsed = artisStockPageSchema.parse(page);

    expect(parsed.items).toHaveLength(0);
  });

  it("large depot fixture: aggregating every page reaches the expected total", async () => {
    setFixture("paginated");
    const adapter = getArtisAdapter();

    const first = await adapter.getTheoreticalStock("LYO01", 1);
    expect(first.pageCount).toBeGreaterThan(1);

    const allItems = [...first.items];
    for (let page = 2; page <= first.pageCount; page++) {
      const next = await adapter.getTheoreticalStock("LYO01", page);
      artisStockPageSchema.parse(next);
      allItems.push(...next.items);
    }

    expect(allItems).toHaveLength(1200);
    expect(new Set(allItems.map((item) => item.articleRef)).size).toBe(1200);
  });

  it("malformed fixture: rejected by Zod validation (FR-022)", async () => {
    setFixture("malformed");
    const adapter = getArtisAdapter();

    const page = await adapter.getTheoreticalStock("PAR01", 1);
    const result = artisStockPageSchema.safeParse(page);

    expect(result.success).toBe(false);
  });
});
