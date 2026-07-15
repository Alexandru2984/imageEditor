import type { CanvasSnapshot } from "@/utils/canvasSnapshot";
import {
  assertProjectSnapshotStorageLimits,
  validateProjectSnapshot,
} from "@/utils/projectFile";

const DB_NAME = "image-editor";
const STORE_NAME = "projects";
const AUTOSAVE_KEY = "autosave";
const MAX_FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1_000;

export interface SavedProject {
  snapshot: CanvasSnapshot;
  savedAt: number;
}

interface ClearedAutosave {
  clearedAt: number;
}

interface AutosaveRevision {
  timestamp: number;
  kind: "save" | "clear";
}

export class InvalidAutosaveError extends Error {
  override name = "InvalidAutosaveError";
}

let writeQueue: Promise<void> = Promise.resolve();

const isValidTimestamp = (value: unknown, now = Date.now()): value is number =>
  Number.isSafeInteger(value) &&
  (value as number) >= 0 &&
  (value as number) <= now + MAX_FUTURE_CLOCK_SKEW_MS;

function storedRevision(value: unknown): AutosaveRevision | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length === 1 &&
    isValidTimestamp(record.clearedAt)
  ) {
    return { timestamp: record.clearedAt, kind: "clear" };
  }
  if (isValidTimestamp(record.savedAt)) {
    return { timestamp: record.savedAt, kind: "save" };
  }
  return null;
}

function shouldReplaceRevision(
  existing: AutosaveRevision | null,
  incoming: AutosaveRevision
): boolean {
  if (!existing || incoming.timestamp > existing.timestamp) return true;
  return (
    incoming.timestamp === existing.timestamp &&
    incoming.kind === "clear" &&
    existing.kind === "save"
  );
}

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

/**
 * IndexedDB serializes read/write transactions across tabs. Comparing the
 * revision and writing in the same transaction prevents a delayed older save
 * from resurrecting a document after a newer save or clear in another tab.
 */
async function writeLatestRecord(
  record: SavedProject | ClearedAutosave,
  revision: AutosaveRevision
): Promise<boolean> {
  const db = await openDB();
  try {
    return await new Promise<boolean>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const readRequest = store.get(AUTOSAVE_KEY);
      let wrote = false;
      let requestError: DOMException | null = null;

      readRequest.onsuccess = () => {
        if (!shouldReplaceRevision(storedRevision(readRequest.result), revision)) {
          return;
        }
        const putRequest = store.put(record, AUTOSAVE_KEY);
        putRequest.onsuccess = () => {
          wrote = true;
        };
        putRequest.onerror = () => {
          requestError = putRequest.error;
        };
      };
      readRequest.onerror = () => {
        requestError = readRequest.error;
      };
      tx.oncomplete = () => resolve(wrote);
      tx.onabort = () =>
        reject(
          tx.error ?? requestError ?? new Error("Autosave transaction aborted")
        );
      tx.onerror = () => {
        // `abort` supplies the final error and prevents double rejection.
      };
    });
  } finally {
    db.close();
  }
}

export const saveProject = (project: SavedProject): Promise<boolean> => {
  try {
    assertProjectSnapshotStorageLimits(project.snapshot);
    if (!isValidTimestamp(project.savedAt)) {
      throw new Error("Autosave timestamp is invalid");
    }
  } catch (error) {
    return Promise.reject(error);
  }
  return enqueueWrite(() =>
    writeLatestRecord(project, {
      timestamp: project.savedAt,
      kind: "save",
    })
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
    Object.keys(record).length === 1 &&
    isValidTimestamp(record.clearedAt)
  ) {
    return undefined;
  }
  if (!isValidTimestamp(record.savedAt)) {
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

export const clearProject = (): Promise<undefined> => {
  const clearedAt = Date.now();
  return enqueueWrite(() =>
    writeLatestRecord(
      { clearedAt },
      { timestamp: clearedAt, kind: "clear" }
    ).then(() => undefined)
  );
};
