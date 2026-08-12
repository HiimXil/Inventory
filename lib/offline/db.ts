import Dexie from "dexie";

export type OfflineSessionStatus = "PREPARED" | "SYNCED" | "CLOSED" | "CANCELLED";

export type OfflineTheoreticalLine = {
  articleRef: string;
  designation: string | null;
  theoreticalQty: number;
};

export type OfflineCountEntry = {
  countedQty: number;
  isOffReferential: boolean;
};

export type OfflineSessionMeta = {
  sessionId: string;
  depotCode: string;
  depotName: string;
  status: OfflineSessionStatus;
};

export type OfflineSession = {
  /** Primary key; duplicated from `meta.sessionId` so Dexie can index it directly. */
  sessionId: string;
  meta: OfflineSessionMeta;
  theoreticalLines: OfflineTheoreticalLine[];
  /** Keyed by articleRef so a scan/correction is an O(1) local lookup. */
  countLines: Record<string, OfflineCountEntry>;
  dirty: boolean;
  lastLocalUpdate: string;
};

class OfflineDatabase extends Dexie {
  sessions!: Dexie.Table<OfflineSession, string>;

  constructor() {
    super("SqpInventaireOfflineDB");
    this.version(1).stores({
      sessions: "sessionId, dirty",
    });
  }
}

export const offlineDB = new OfflineDatabase();
