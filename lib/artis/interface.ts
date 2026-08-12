export type ArtisDepot = {
  code: string;
  name: string;
};

export type ArtisStockLine = {
  articleRef: string;
  designation: string;
  qty: number;
};

export type ArtisStockPage = {
  depotCode: string;
  page: number;
  pageCount: number;
  items: ArtisStockLine[];
};

export interface ArtisAdapter {
  listDepots(): Promise<ArtisDepot[]>;
  getTheoreticalStock(depotCode: string, page: number): Promise<ArtisStockPage>;
}
