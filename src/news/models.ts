import { CloudflareModelItem } from './types';

// Curated base models
export const DEFAULT_MODELS: CloudflareModelItem[] = [
  {
    id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    name: 'Llama 3.3 70B Instruct',
    author: 'Meta',
    task: 'Text Generation',
    provider: 'cloudflare',
    description: 'Flagship Cloudflare AI model, high reasoning & writing capability.',
  },
  {
    id: '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b',
    name: 'DeepSeek R1 Distill Qwen 32B',
    author: 'DeepSeek',
    task: 'Text Generation',
    provider: 'cloudflare',
    description: 'Reasoning model distilled from DeepSeek R1.',
  },
  {
    id: 'ag/gemini-3.8-flash-high',
    name: 'Gemini 3.8 Flash High',
    author: 'Google (Backup Provider)',
    task: 'Text Generation',
    provider: 'backup',
    description: 'Fast, high quality reasoning model on backup OpenAI provider.',
  },
  {
    id: 'ag/claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6',
    author: 'Anthropic (Backup Provider)',
    task: 'Text Generation',
    provider: 'backup',
    description: 'Premium reasoning and nuanced writing on backup provider.',
  },
  {
    id: 'xai/grok-4.6',
    name: 'Grok 4.6',
    author: 'xAI (Backup Provider)',
    task: 'Text Generation',
    provider: 'backup',
    description: 'High performance frontier model on backup provider.',
  },
  {
    id: 'nvidia/deepseek-ai/deepseek-v4-pro',
    name: 'DeepSeek v4 Pro',
    author: 'DeepSeek / NVIDIA (Backup Provider)',
    task: 'Text Generation',
    provider: 'backup',
    description: 'Ultra fast large context model on backup provider.',
  },
];

// Fetch models from Backup OpenAI compatible endpoint
async function fetchBackupModels(url: string, apiKey: string): Promise<CloudflareModelItem[]> {
  try {
    const endpoint = `${url.replace(/\/+$/, '')}/models`;
    const res = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return [];

    const data = (await res.json()) as {
      data?: Array<{ id: string; owned_by?: string; context_length?: number }>;
    };

    if (!data.data) return [];

    // Filter relevant chat / text generation models
    return data.data
      .filter((m) => !m.id.includes('asr') && !m.id.includes('whisper'))
      .map((m) => ({
        id: m.id,
        name: m.id.split('/').pop() || m.id,
        author: m.owned_by ? `${m.owned_by.toUpperCase()} (Backup API)` : 'Backup API',
        task: 'Text Generation',
        provider: 'backup' as const,
        description: `Context: ${m.context_length ? `${(m.context_length / 1000).toFixed(0)}k` : 'Large'}`,
      }));
  } catch (err) {
    console.warn('Error fetching backup models:', err);
    return [];
  }
}

// Fetch live Cloudflare models catalog
async function fetchCloudflareDocsModels(): Promise<CloudflareModelItem[]> {
  try {
    const res = await fetch('https://developers.cloudflare.com/workers-ai/models/', {
      headers: {
        Accept: 'text/markdown',
        'User-Agent': 'TechnokersWorkersAI/1.0',
      },
    });

    if (!res.ok) return [];
    const text = await res.text();
    const extracted: CloudflareModelItem[] = [];

    const regex = /<h3>(.*?)<\/h3>\s*([\s\S]*?)(?=<h3>|$)/gi;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      const rawName = match[1].trim();
      const body = match[2].trim();

      const isTextGen =
        body.toLowerCase().includes('text generation') ||
        rawName.includes('llama') ||
        rawName.includes('deepseek') ||
        rawName.includes('qwen') ||
        rawName.includes('gemma') ||
        rawName.includes('mistral');

      if (isTextGen) {
        let modelId = `@cf/${rawName}`;
        if (rawName.includes('llama')) modelId = `@cf/meta/${rawName}`;
        else if (rawName.includes('deepseek')) modelId = `@cf/deepseek-ai/${rawName}`;
        else if (rawName.includes('qwen')) modelId = `@cf/qwen/${rawName}`;

        extracted.push({
          id: modelId,
          name: rawName,
          author: `${body.split('Text Generation')[0]?.trim() || 'Cloudflare'} (Cloudflare)`,
          task: 'Text Generation',
          provider: 'cloudflare',
          description: body.slice(0, 120).replace(/\n/g, ' '),
        });
      }
    }
    return extracted;
  } catch (err) {
    console.warn('Error fetching Cloudflare docs models:', err);
    return [];
  }
}

// Master model catalog combining Cloudflare AI & Backup Provider
export async function fetchAllAvailableModels(
  env: Env,
  useCache: boolean = true
): Promise<CloudflareModelItem[]> {
  const cacheKey = 'cache:all_available_models_v2';

  if (useCache && env.AI_NEWS_KV) {
    const cached = await env.AI_NEWS_KV.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch {
        // proceed
      }
    }
  }

  const [cfModels, backupModels] = await Promise.all([
    fetchCloudflareDocsModels(),
    fetchBackupModels(env.BACKUP_AI_URL, env.BACKUP_AI_KEY),
  ]);

  const map = new Map<string, CloudflareModelItem>();

  // Add default curated first
  for (const m of DEFAULT_MODELS) map.set(m.id, m);
  for (const m of cfModels) if (!map.has(m.id)) map.set(m.id, m);
  for (const m of backupModels) if (!map.has(m.id)) map.set(m.id, m);

  const combined = Array.from(map.values());

  if (env.AI_NEWS_KV && combined.length > 0) {
    // Cache for 6 hours
    await env.AI_NEWS_KV.put(cacheKey, JSON.stringify(combined), {
      expirationTtl: 6 * 60 * 60,
    });
  }

  return combined;
}
