import { RawNewsItem } from './types';

// Simple RSS XML parser for Cloudflare Workers without heavy external DOM dependencies
function parseRssXml(xml: string, sourceName: string): RawNewsItem[] {
  const items: RawNewsItem[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(xml)) !== null) {
    const itemContent = match[1];

    const titleMatch = /<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i.exec(itemContent);
    const linkMatch = /<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/i.exec(itemContent);
    const pubDateMatch = /<pubDate>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/pubDate>/i.exec(itemContent);
    const descMatch = /<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i.exec(itemContent);

    const title = titleMatch ? cleanText(titleMatch[1]) : '';
    const url = linkMatch ? cleanText(linkMatch[1]) : '';
    const pubDate = pubDateMatch ? pubDateMatch[1].trim() : new Date().toISOString();
    const snippet = descMatch ? stripHtml(cleanText(descMatch[1])).slice(0, 300) : '';

    if (title && url) {
      items.push({
        id: `rss_${hashString(url)}`,
        title,
        url,
        source: sourceName,
        snippet,
        publishedAt: pubDate,
      });
    }
  }

  return items;
}

function cleanText(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>?/gm, '').replace(/\s+/g, ' ').trim();
}

function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

// Fetch AI stories from Hacker News Algolia Search API
async function fetchHackerNewsAI(): Promise<RawNewsItem[]> {
  try {
    const query = encodeURIComponent('AI OR LLM OR OpenAI OR Anthropic OR Claude OR DeepSeek OR Gemini OR "Artificial Intelligence"');
    const url = `https://hn.algolia.com/api/v1/search_by_date?tags=story&numericFilters=points>15&query=${query}&hitsPerPage=25`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'TechnokersAIWorker/1.0' },
    });

    if (!response.ok) return [];

    const data = (await response.json()) as {
      hits?: Array<{
        objectID: string;
        title?: string;
        url?: string;
        points?: number;
        created_at?: string;
      }>;
    };

    if (!data.hits) return [];

    return data.hits
      .filter((hit) => hit.title && (hit.url || hit.objectID))
      .map((hit) => ({
        id: `hn_${hit.objectID}`,
        title: hit.title || '',
        url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
        source: 'Hacker News (Tech)',
        snippet: `Upvotes: ${hit.points || 0}`,
        publishedAt: hit.created_at || new Date().toISOString(),
      }));
  } catch (err) {
    console.error('Error fetching Hacker News AI:', err);
    return [];
  }
}

// Fetch Google News AI RSS feed
async function fetchGoogleNewsAI(): Promise<RawNewsItem[]> {
  try {
    const url = 'https://news.google.com/rss/search?q=Artificial+Intelligence+when:24h&hl=en-US&gl=US&ceid=US:en';
    const response = await fetch(url, {
      headers: { 'User-Agent': 'TechnokersAIWorker/1.0' },
    });

    if (!response.ok) return [];
    const xml = await response.text();
    return parseRssXml(xml, 'Google News AI');
  } catch (err) {
    console.error('Error fetching Google News AI:', err);
    return [];
  }
}

// Fetch TechCrunch AI category RSS
async function fetchTechCrunchAI(): Promise<RawNewsItem[]> {
  try {
    const url = 'https://techcrunch.com/category/artificial-intelligence/feed/';
    const response = await fetch(url, {
      headers: { 'User-Agent': 'TechnokersAIWorker/1.0' },
    });

    if (!response.ok) return [];
    const xml = await response.text();
    return parseRssXml(xml, 'TechCrunch AI');
  } catch (err) {
    console.error('Error fetching TechCrunch AI:', err);
    return [];
  }
}

// Master fetcher combining all sources and deduplicating by URL and normalized title
export async function fetchLatestAINews(): Promise<RawNewsItem[]> {
  const [hnNews, gNews, tcNews] = await Promise.all([
    fetchHackerNewsAI(),
    fetchGoogleNewsAI(),
    fetchTechCrunchAI(),
  ]);

  const allNews = [...tcNews, ...hnNews, ...gNews];
  const seenUrls = new Set<string>();
  const seenTitles = new Set<string>();
  const uniqueItems: RawNewsItem[] = [];

  for (const item of allNews) {
    const normUrl = item.url.toLowerCase().split('?')[0];
    const normTitle = item.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40);

    if (!seenUrls.has(normUrl) && !seenTitles.has(normTitle)) {
      seenUrls.add(normUrl);
      seenTitles.add(normTitle);
      uniqueItems.push(item);
    }
  }

  return uniqueItems;
}
