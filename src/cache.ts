const DB_NAME = "sentryfi-cache";
const DB_VERSION = 1;
const STORE_NAME = "shard-cache";

type CacheEntry = {
  key: string;
  data: unknown;
  timestamp: number;
};

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
  });

  return dbPromise;
}

export async function getCachedShard(
  shardPath: string,
  updatedAt: string
): Promise<unknown | null> {
  try {
    const db = await openDB();
    const key = `${shardPath}::${updatedAt}`;

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(key);

      request.onsuccess = () => {
        const entry = request.result as CacheEntry | undefined;
        resolve(entry?.data ?? null);
      };
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.warn("Cache read error:", err);
    return null;
  }
}

export async function cacheShard(
  shardPath: string,
  updatedAt: string,
  data: unknown
): Promise<void> {
  try {
    const db = await openDB();
    const key = `${shardPath}::${updatedAt}`;
    const entry: CacheEntry = {
      key,
      data,
      timestamp: Date.now(),
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const request = store.put(entry);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.warn("Cache write error:", err);
  }
}

export async function clearCache(): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.warn("Cache clear error:", err);
  }
}
