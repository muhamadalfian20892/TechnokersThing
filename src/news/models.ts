import { CloudflareModelItem } from './types';

// Curated verified base text models in Cloudflare Workers AI
export const DEFAULT_TEXT_MODELS: CloudflareModelItem[] = [
  {
    id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    name: 'Llama 3.3 70B Instruct (FP8 Fast)',
    author: 'Meta',
    task: 'Text Generation',
    description: 'Flagship open-weights model, super high reasoning and creative writing capability.',
  },
  {
    id: '@cf/meta/llama-3.1-8b-instruct',
    name: 'Llama 3.1 8B Instruct',
    author: 'Meta',
    task: 'Text Generation',
    description: 'Fast, lightweight, efficient general purpose LLM.',
  },
  {
    id: '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b',
    name: 'DeepSeek R1 Distill Qwen 32B',
    author: 'DeepSeek',
    task: 'Text Generation',
    description: 'High-level reasoning and problem-solving model distilled from DeepSeek R1.',
  },
  {
    id: '@cf/qwen/qwen2.5-7b-instruct',
    name: 'Qwen 2.5 7B Instruct',
    author: 'Alibaba Qwen',
    task: 'Text Generation',
    description: 'Strong multilingual and coding performance.',
  },
  {
    id: '@cf/google/gemma-2-9b-it',
    name: 'Gemma 2 9B IT',
    author: 'Google',
    task: 'Text Generation',
    description: 'Google state of the art lightweight open model.',
  },
  {
    id: '@cf/mistral/mistral-7b-instruct-v0.2',
    name: 'Mistral 7B Instruct v0.2',
    author: 'Mistral AI',
    task: 'Text Generation',
    description: 'High efficiency reasoning and concise summarization.',
  },
];

// Fetch live models from Cloudflare official documentation catalog
export async function fetchLiveCloudflareModels(kv?: KVNamespace): Promise<CloudflareModelItem[]> {
  const cacheKey = 'cache:cloudflare_models_catalog';

  if (kv) {
    const cached = await kv.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch {
        // continue fetch
      }
    }
  }

  try {
    const res = await fetch('https://developers.cloudflare.com/workers-ai/models/', {
      headers: {
        Accept: 'text/markdown',
        'User-Agent': 'TechnokersWorkersAI/1.0',
      },
    });

    if (res.ok) {
      const text = await res.text();
      const extracted: CloudflareModelItem[] = [];

      // Extract model blocks from markdown
      // Pattern typically: <h3>model-name</h3>\n\nAuthorTask...
      const regex = /<h3>(.*?)<\/h3>\s*([\s\S]*?)(?=<h3>|$)/gi;
      let match: RegExpExecArray | null;

      while ((match = regex.exec(text)) !== null) {
        const rawName = match[1].trim();
        const body = match[2].trim();

        // Check if related to text generation or language model
        const isTextGen =
          body.toLowerCase().includes('text generation') ||
          rawName.includes('llama') ||
          rawName.includes('deepseek') ||
          rawName.includes('qwen') ||
          rawName.includes('gemma') ||
          rawName.includes('mistral');

        if (isTextGen) {
          // Construct canonical @cf/ id
          let modelId = `@cf/${rawName}`;
          if (rawName.includes('llama')) {
            modelId = `@cf/meta/${rawName}`;
          } else if (rawName.includes('deepseek')) {
            modelId = `@cf/deepseek-ai/${rawName}`;
          } else if (rawName.includes('qwen')) {
            modelId = `@cf/qwen/${rawName}`;
          }

          extracted.push({
            id: modelId,
            name: rawName,
            author: body.split('Text Generation')[0]?.trim() || 'Cloudflare AI',
            task: 'Text Generation',
            description: body.slice(0, 150).replace(/\n/g, ' '),
          });
        }
      }

      if (extracted.length > 0) {
        // Merge with DEFAULT_TEXT_MODELS to ensure primary models are always present
        const combinedMap = new Map<string, CloudflareModelItem>();
        for (const m of DEFAULT_TEXT_MODELS) combinedMap.set(m.id, m);
        for (const m of extracted) {
          if (!combinedMap.has(m.id)) combinedMap.set(m.id, m);
        }

        const result = Array.from(combinedMap.values());
        if (kv) {
          // Cache for 24 hours
          await kv.put(cacheKey, JSON.stringify(result), { expirationTtl: 24 * 60 * 60 });
        }
        return result;
      }
    }
  } catch (err) {
    console.error('Error fetching live Cloudflare models catalog:', err);
  }

  return DEFAULT_TEXT_MODELS;
}
