import { RawNewsItem, PostedNewsRecord } from './types';

// Fast SHA-256 for Web Crypto API supported in Cloudflare Workers
async function hashText(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`.toLowerCase();
  } catch {
    return url.toLowerCase().split('?')[0];
  }
}

// 1. Admin Kill Switch (Pause / Resume Posting)
export async function isPostingPaused(kv: KVNamespace): Promise<boolean> {
  const val = await kv.get('config:posting_paused');
  return val === 'true';
}

export async function setPostingPaused(kv: KVNamespace, paused: boolean): Promise<void> {
  await kv.put('config:posting_paused', paused ? 'true' : 'false');
}

// 2. Strict Single Post Per Day Lock (YYYY-MM-DD WIB)
export async function hasPostedToday(kv: KVNamespace, wibDateStr: string): Promise<boolean> {
  const key = `daily_posted:${wibDateStr}`;
  const val = await kv.get(key);
  return val !== null;
}

export async function markPostedToday(kv: KVNamespace, wibDateStr: string): Promise<void> {
  const key = `daily_posted:${wibDateStr}`;
  // Expire after 3 days to keep KV clean
  await kv.put(key, new Date().toISOString(), { expirationTtl: 3 * 24 * 60 * 60 });
}

// 3. Deduplication Check for individual news items
export async function isNewsAlreadyPosted(kv: KVNamespace, item: RawNewsItem): Promise<boolean> {
  const normUrl = normalizeUrl(item.url);
  const urlHash = await hashText(normUrl);
  const urlKey = `seen:url:${urlHash}`;

  const existingUrl = await kv.get(urlKey);
  if (existingUrl) return true;

  const normTitle = normalizeTitle(item.title);
  const titleHash = await hashText(normTitle);
  const titleKey = `seen:title:${titleHash}`;

  const existingTitle = await kv.get(titleKey);
  return existingTitle !== null;
}

export async function filterUnpostedNews(kv: KVNamespace, items: RawNewsItem[]): Promise<RawNewsItem[]> {
  const unposted: RawNewsItem[] = [];

  for (const item of items) {
    const alreadyPosted = await isNewsAlreadyPosted(kv, item);
    if (!alreadyPosted) {
      unposted.push(item);
    }
  }

  return unposted;
}

export async function recordPostedNews(
  kv: KVNamespace,
  items: RawNewsItem[],
  headline: string = ''
): Promise<void> {
  const now = new Date().toISOString();
  const expirationTtl = 60 * 24 * 60 * 60; // 60 days

  for (const item of items) {
    const normUrl = normalizeUrl(item.url);
    const urlHash = await hashText(normUrl);
    await kv.put(`seen:url:${urlHash}`, now, { expirationTtl });

    const normTitle = normalizeTitle(item.title);
    const titleHash = await hashText(normTitle);
    await kv.put(`seen:title:${titleHash}`, now, { expirationTtl });
  }

  // Update rolling history of last 100 posted stories
  const historyKey = 'history:posted';
  const existingHistoryJson = await kv.get(historyKey);
  let history: PostedNewsRecord[] = [];

  if (existingHistoryJson) {
    try {
      history = JSON.parse(existingHistoryJson);
    } catch {
      history = [];
    }
  }

  const newRecords: PostedNewsRecord[] = items.map((item) => ({
    id: item.id,
    title: item.title,
    url: item.url,
    postedAt: now,
  }));

  const updatedHistory = [...newRecords, ...history].slice(0, 100);
  await kv.put(historyKey, JSON.stringify(updatedHistory));

  await kv.put(
    'stats:last_digest',
    JSON.stringify({
      timestamp: now,
      headline,
      count: items.length,
    })
  );
}

export async function getRecentPostedHistory(kv: KVNamespace): Promise<PostedNewsRecord[]> {
  const historyKey = 'history:posted';
  const historyJson = await kv.get(historyKey);
  if (!historyJson) return [];

  try {
    return JSON.parse(historyJson);
  } catch {
    return [];
  }
}

export async function getLastDigestStats(kv: KVNamespace): Promise<{
  timestamp: string;
  headline: string;
  count: number;
} | null> {
  const raw = await kv.get('stats:last_digest');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
