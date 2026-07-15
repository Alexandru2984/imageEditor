import type { CanvasSnapshot } from "@/utils/canvasSnapshot";
import {
  assertProjectSnapshotStorageLimits,
  validateProjectSnapshot,
} from "@/utils/projectFile";

const DB_NAME = "image-editor";
const STORE_NAME = "projects";
const AUTOSAVE_KEY = "autosave";

export interface SavedProject {
  snapshot: CanvasSnapshot;
  savedAt: number;
}

export class InvalidAutosaveError extends Error {
  override name = "InvalidAutosaveError";
}

let writeQueue: Promise<void> = Promise.resolve();

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      if (settled) {
        db.close();
        return;
      }
      settled = true;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => fail(request.error);
    request.onblocked = () =>
      fail(new Error("Autosave database upgrade is blocked by another tab"));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDB();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      let request: IDBRequest<T>;
      let result: T;
      try {
        request = run(tx.objectStore(STORE_NAME));
      } catch (error) {
        try {
          tx.abort();
        } catch {
          // The transaction may already have become inactive.
        }
        reject(error);
        return;
      }

      request.onsuccess = () => {
        result = request.result;
      };
      // A request success precedes the durable transaction commit. Resolve only
      // on `complete`; request/transaction errors abort and reject below.
      tx.oncomplete = () => resolve(result);
      tx.onabort = () =>
        reject(
          tx.error ?? request.error ?? new Error("Autosave transaction aborted")
        );
      tx.onerror = () => {
        // `abort` supplies the final error and prevents early/double resolution.
      };
    });
  } finally {
    db.close();
  }
}

function enqueueWrite<T>(operation: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(operation, operation);
  writeQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

export const saveProject = (project: SavedProject): Promise<IDBValidKey> => {
  try {
    assertProjectSnapshotStorageLimits(project.snapshot);
    if (!Number.isSafeInteger(project.savedAt) || project.savedAt < 0) {
      throw new Error("Autosave timestamp is invalid");
    }
  } catch (error) {
    return Promise.reject(error);
  }
  return enqueueWrite(() =>
    withStore("readwrite", (store) => store.put(project, AUTOSAVE_KEY))
  );
};

export const loadProject = async (): Promise<SavedProject | undefined> => {
  const stored = await withStore<unknown | undefined>("readonly", (store) =>
    store.get(AUTOSAVE_KEY)
  );
  if (stored === undefined) return undefined;
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
    throw new InvalidAutosaveError("Autosave record is invalid");
  }
  const record = stored as Record<string, unknown>;
  if (
    !Number.isSafeInteger(record.savedAt) ||
    (record.savedAt as number) < 0
  ) {
    throw new InvalidAutosaveError("Autosave timestamp is invalid");
  }
  try {
    return {
      snapshot: validateProjectSnapshot(record.snapshot),
      savedAt: record.savedAt as number,
    };
  } catch (error) {
    throw new InvalidAutosaveError(
      error instanceof Error ? error.message : "Autosave snapshot is invalid"
    );
  }
};

export const clearProject = (): Promise<undefined> =>
  enqueueWrite(() =>
    withStore("readwrite", (store) => store.delete(AUTOSAVE_KEY))
  );
