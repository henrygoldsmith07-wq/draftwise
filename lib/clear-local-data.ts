import {
  DOCUMENTS_DB_NAME,
  LocalStorageDocumentBackend,
  type DocumentStoreBackend,
} from "./documents.ts";
import { clearWorkspaceStorage, type WorkspaceStorage } from "../hooks/useDraftPersistence.ts";

/**
 * Everything "Clear all local Draftwise data" must remove. The privacy promise
 * is only trustworthy if this list is complete and tested, so every storage
 * surface the product writes is enumerated here rather than being cleared
 * ad-hoc at the call site.
 */

export const DOCUMENTS_LOCAL_STORAGE_KEY = "draftwise:documents:v1";

export interface ClearLocalDataOptions {
  storage?: WorkspaceStorage & Pick<Storage, "removeItem" | "getItem" | "setItem">;
  documentBackend?: DocumentStoreBackend;
  /** Closes and deletes the IndexedDB database, including snapshots. */
  deleteIndexedDb?: () => Promise<void>;
  /** In-memory caches that must also go (analysis cache, etc). */
  onClearMemory?: () => void;
}

export async function clearAllLocalData(options: ClearLocalDataOptions = {}) {
  const errors: string[] = [];
  const storage = options.storage ?? (typeof localStorage !== "undefined" ? localStorage : null);

  options.onClearMemory?.();

  // 1. Workspace settings, provider/classifier credentials and legacy keys.
  if (storage) {
    const result = clearWorkspaceStorage(storage);
    if (!result.ok) errors.push(result.error);
  }

  // 2. Document store: every document and snapshot.
  try {
    const backend = options.documentBackend ?? (storage ? new LocalStorageDocumentBackend(storage, DOCUMENTS_LOCAL_STORAGE_KEY) : null);
    if (backend) await backend.clear();
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Failed to clear documents");
  }

  // 3. The localStorage fallback key, even if the backend above was a
  //    different implementation (belt and braces: leftovers would otherwise
  //    resurrect documents on reload).
  if (storage) {
    try {
      storage.removeItem(DOCUMENTS_LOCAL_STORAGE_KEY);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Failed to clear document fallback");
    }
  }

  // 4. The whole IndexedDB database: documents and snapshots included.
  //    The live backend holds an open connection, so close it first —
  //    deleteDatabase() blocks on that handle and would otherwise never fire.
  try {
    if (options.documentBackend) await options.documentBackend.close?.();
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Failed to close the document database");
  }
  try {
    if (options.deleteIndexedDb) await options.deleteIndexedDb();
    else if (typeof indexedDB !== "undefined") await deleteDocumentsDatabase();
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Failed to delete local database");
  }

  return errors.length === 0 ? { ok: true as const } : { ok: false as const, errors };
}

/**
 * Rejects unless the database was genuinely deleted.
 *
 * This used to resolve on every outcome, including `onerror` and `onblocked`,
 * so "Clear all local data" reported success while the drafts were still on
 * disk. A blocked delete means some other connection is still open; telling the
 * writer their data is gone is exactly the failure this product cannot afford.
 */
export function deleteDocumentsDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const request = indexedDB.deleteDatabase(DOCUMENTS_DB_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error("The local database could not be deleted."));
      request.onblocked = () => reject(new Error("The local database is still open. Close other Draftwise tabs and try again."));
    } catch (error) {
      reject(error instanceof Error ? error : new Error("The local database could not be deleted."));
    }
  });
}
