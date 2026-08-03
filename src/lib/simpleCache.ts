const cache = new Map<string, { data: any; expiry: number }>();
const MAX_CACHE_SIZE = 100;

export function getCache(key: string) {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() > item.expiry) {
    cache.delete(key);
    return null;
  }
  return item.data;
}

export function setCache(key: string, data: any, ttlHours = 1) {
  if (cache.size >= MAX_CACHE_SIZE) {
    const now = Date.now();
    for (const [k, v] of cache.entries()) {
      if (now > v.expiry) cache.delete(k);
    }
    if (cache.size >= MAX_CACHE_SIZE) {
      const firstKey = cache.keys().next().value;
      if (firstKey !== undefined) cache.delete(firstKey);
    }
  }

  cache.set(key, {
    data,
    expiry: Date.now() + ttlHours * 60 * 60 * 1000,
  });
}
