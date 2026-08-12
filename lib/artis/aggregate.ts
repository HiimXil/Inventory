import type { ArtisAdapter, ArtisStockLine } from "./interface";
import { ArtisTimeoutError } from "./errors";

const DEFAULT_TIMEOUT_MS = 10_000;

export type AggregatedStock = {
  depotCode: string;
  items: ArtisStockLine[];
};

/**
 * Fetches every page of a depot's theoretical stock and merges them into a
 * single list (FR-029: "l'import DOIT agréger l'intégralité des pages avant
 * validation"). Each page fetch is individually time-boxed so a stalled
 * ARTIS call can't hang session preparation indefinitely (plan.md risk:
 * "ARTIS import timeout leaves session in PREPARED but unusable").
 */
export async function aggregateTheoreticalStock(
  adapter: ArtisAdapter,
  depotCode: string,
  options: { timeoutMs?: number } = {},
): Promise<AggregatedStock> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const items: ArtisStockLine[] = [];

  let page = 1;
  let pageCount = 1;

  do {
    const response = await withTimeout(
      adapter.getTheoreticalStock(depotCode, page),
      timeoutMs,
    );
    pageCount = response.pageCount;
    items.push(...response.items);
    page += 1;
  } while (page <= pageCount);

  return { depotCode, items };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new ArtisTimeoutError(`ARTIS import timed out after ${timeoutMs}ms`),
      );
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
