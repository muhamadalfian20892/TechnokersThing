export interface RawNewsItem {
  id: string;
  title: string;
  url: string;
  source: string;
  snippet?: string;
  publishedAt: string;
}

export interface PostedNewsRecord {
  id: string;
  title: string;
  url: string;
  postedAt: string;
}

export interface DigestGenerationResult {
  messageText: string;
  selectedNews: RawNewsItem[];
  postedCount: number;
}
