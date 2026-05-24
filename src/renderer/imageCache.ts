interface CacheEntry {
  promise: Promise<string>;
  blobUrl: string | null;
  refcount: number;
}

const cache = new Map<string, CacheEntry>();

export async function acquireBlob(key: string, factory: () => Promise<Blob>): Promise<string> {
  const existing = cache.get(key);
  if (existing) {
    existing.refcount += 1;
    return existing.promise;
  }
  const entry: CacheEntry = {
    promise: factory().then((blob) => {
      const url = URL.createObjectURL(blob);
      if (cache.get(key) !== entry) {
        URL.revokeObjectURL(url);
        return url;
      }
      entry.blobUrl = url;
      return url;
    }),
    blobUrl: null,
    refcount: 1,
  };
  cache.set(key, entry);
  try {
    return await entry.promise;
  } catch (err) {
    cache.delete(key);
    throw err;
  }
}

export function releaseBlob(key: string): void {
  const entry = cache.get(key);
  if (!entry) return;
  entry.refcount -= 1;
  if (entry.refcount <= 0) {
    if (entry.blobUrl) URL.revokeObjectURL(entry.blobUrl);
    cache.delete(key);
  }
}
