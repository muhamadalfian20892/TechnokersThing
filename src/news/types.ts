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

export interface UsageMetric {
  date: string;
  totalRequests: number;
  aiGenerations: number;
  totalTokensEstimated: number;
  neuronsEstimated: number;
}

export interface AuditLogEntry {
  timestamp: string;
  action: string;
  actor: string;
  details?: string;
}

export interface CloudflareModelItem {
  id: string;
  name: string;
  author: string;
  task: string;
  description?: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}
