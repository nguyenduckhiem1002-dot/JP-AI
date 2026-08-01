const cache = new Map<string, { data: any; expiry: number }>();

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
  cache.set(key, {
    data,
    expiry: Date.now() + ttlHours * 60 * 60 * 1000,
  });
}
