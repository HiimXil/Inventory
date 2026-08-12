export class ArtisImportError extends Error {}

export class ArtisTimeoutError extends ArtisImportError {}

export class ArtisNetworkError extends ArtisImportError {}

export class ArtisHttpError extends ArtisImportError {
  status: number;

  constructor(status: number, message = `ARTIS returned HTTP ${status}`) {
    super(message);
    this.status = status;
  }
}

export class EmptyTheoreticalStockError extends ArtisImportError {}

/**
 * File-mode errors (ArtisFileAdapter). Unlike the network error classes
 * above, these already carry a precise, user-facing French message from the
 * adapter itself (which column is missing, which row/code is the problem) —
 * prepare-session.ts's mapArtisError() passes `.message` straight through
 * instead of substituting a generic translation.
 */
export class ArtisFileFormatError extends ArtisImportError {}

export class ArtisFileValidationError extends ArtisImportError {}
