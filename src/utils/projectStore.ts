import type { CanvasSnapshot } from "@/utils/canvasSnapshot";

const DB_NAME = "image-editor";
const STORE_NAME = "projects";
const AUTOSAVE_KEY = "autosave";

export interface SavedProject {
  snapshot: CanvasSnapshot;
  uploadedImage: string;
  savedAt: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
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
      const request = run(tx.objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export const saveProject = (project: SavedProject): Promise<IDBValidKey> =>
  withStore("readwrite", (store) => store.put(project, AUTOSAVE_KEY));

export const loadProject = (): Promise<SavedProject | undefined> =>
  withStore("readonly", (store) =>
    store.get(AUTOSAVE_KEY)
  ) as Promise<SavedProject | undefined>;

export const clearProject = (): Promise<undefined> =>
  withStore("readwrite", (store) => store.delete(AUTOSAVE_KEY));
