export type VocabEntry = {
  text: string;
  reading: string;
  meaning: string;
  pos: string;
  addedAt: number;
};

export function saveWord(videoId: string, word: VocabEntry) {
  if (typeof window === 'undefined') return;
  const key = `vocab:${videoId}`;
  const list = JSON.parse(localStorage.getItem(key) || '[]');
  list.push({ ...word, addedAt: Date.now() });
  localStorage.setItem(key, JSON.stringify(list));
}

export function getSavedWords(videoId: string) {
  if (typeof window === 'undefined') return [];
  return JSON.parse(localStorage.getItem(`vocab:${videoId}`) || '[]');
}
