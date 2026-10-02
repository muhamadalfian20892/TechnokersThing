import { ChatMessage } from './types';
import { recordUsage, addAuditLog } from './memory';

export interface AiCompletionResult {
  text: string;
  provider: 'cloudflare' | 'backup';
  modelUsed: string;
}

export async function callBackupOpenAi(
  url: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  maxTokens: number = 2000
): Promise<string> {
  const endpoint = `${url.replace(/\/+$/, '')}/chat/completions`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      stream: false,
      temperature: 0.7,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Backup AI API returned ${res.status}: ${errorText}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error('Empty response from Backup AI API');
  }

  return content;
}

export async function runUnifiedAiCompletion(
  env: Env,
  targetModel: string,
  messages: ChatMessage[],
  maxTokens: number = 2000
): Promise<AiCompletionResult> {
  const isCloudflareModel = targetModel.startsWith('@cf/');

  // If a backup model is explicitly selected
  if (!isCloudflareModel) {
    console.log(`[AI Engine] Executing via Backup OpenAI Endpoint (Model: ${targetModel})...`);
    try {
      const text = await callBackupOpenAi(
        env.BACKUP_AI_URL,
        env.BACKUP_AI_KEY,
        targetModel,
        messages,
        maxTokens
      );
      const estTokens = Math.round(text.length / 4);
      await recordUsage(env.AI_NEWS_KV, estTokens, true, true);
      return { text, provider: 'backup', modelUsed: targetModel };
    } catch (backupErr) {
      console.error('[AI Engine] Primary backup model failed:', backupErr);
      // Fallback to ag/gemini-3.8-flash-high on backup provider
      if (targetModel !== 'ag/gemini-3.8-flash-high') {
        const text = await callBackupOpenAi(
          env.BACKUP_AI_URL,
          env.BACKUP_AI_KEY,
          'ag/gemini-3.8-flash-high',
          messages,
          maxTokens
        );
        const estTokens = Math.round(text.length / 4);
        await recordUsage(env.AI_NEWS_KV, estTokens, true, true);
        return { text, provider: 'backup', modelUsed: 'ag/gemini-3.8-flash-high' };
      }
      throw backupErr;
    }
  }

  // Target model is Cloudflare Workers AI
  console.log(`[AI Engine] Executing via Cloudflare Workers AI (Model: ${targetModel})...`);
  try {
    const response = (await env.AI.run(targetModel as any, {
      messages,
      max_tokens: maxTokens,
      temperature: 0.7,
    })) as { response?: string };

    if (response && response.response && response.response.trim().length > 0) {
      const text = response.response.trim();
      const estTokens = Math.round(text.length / 4);
      await recordUsage(env.AI_NEWS_KV, estTokens, true, false);
      return { text, provider: 'cloudflare', modelUsed: targetModel };
    }
    throw new Error('Cloudflare Workers AI returned empty response');
  } catch (cfErr) {
    console.warn(`[AI Engine] Cloudflare model ${targetModel} failed or exhausted limit:`, cfErr);
    await addAuditLog(
      env.AI_NEWS_KV,
      'CF_AI_FAILOVER_TO_BACKUP',
      'System',
      `Model ${targetModel} error: ${String(cfErr).slice(0, 100)}`
    );

    // AUTOMATIC FAILOVER TO BACKUP OPENAI PROVIDER!
    console.log('[AI Engine] Seamlessly failing over to Backup OpenAI Provider (ag/gemini-3.8-flash-high)...');
    try {
      const text = await callBackupOpenAi(
        env.BACKUP_AI_URL,
        env.BACKUP_AI_KEY,
        'ag/gemini-3.8-flash-high',
        messages,
        maxTokens
      );
      const estTokens = Math.round(text.length / 4);
      await recordUsage(env.AI_NEWS_KV, estTokens, true, true);
      return { text, provider: 'backup', modelUsed: 'ag/gemini-3.8-flash-high (Auto Failover)' };
    } catch (backupFailoverErr) {
      console.error('[AI Engine] Both Cloudflare AI and Backup AI failed:', backupFailoverErr);
      throw backupFailoverErr;
    }
  }
}
