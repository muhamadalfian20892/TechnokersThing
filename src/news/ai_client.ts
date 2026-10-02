import { ChatMessage } from './types';
import { recordUsage, addAuditLog } from './memory';

export interface ToolCall {
  id?: string;
  name: string;
  arguments: Record<string, any>;
}

export interface AiCompletionResult {
  text: string;
  provider: 'cloudflare' | 'backup';
  modelUsed: string;
  toolCalls?: ToolCall[];
}

export function extractToolCallsFromText(text: string): { cleanedText: string; toolCalls: ToolCall[] } {
  const toolCalls: ToolCall[] = [];
  let cleaned = text;

  // 1. Tag format: <tool_call>{"name": "...", "arguments": {...}}</tool_call>
  const tagRegex = /<tool_call>([\s\S]*?)<\/tool_call>/gi;
  let match;
  while ((match = tagRegex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (parsed.name) {
        toolCalls.push({
          name: parsed.name,
          arguments: parsed.arguments || parsed.parameters || {},
        });
      }
    } catch (e) {
      console.warn('[Tool Extractor] Failed to parse tag tool_call:', match[1], e);
    }
  }
  cleaned = cleaned.replace(tagRegex, '').trim();

  // 2. Markdown json codeblock containing tool_call or name/arguments
  const codeBlockRegex = /```(?:json)?\s*(\{[\s\S]*?"(?:name|tool_call)"[\s\S]*?\})\s*```/gi;
  while ((match = codeBlockRegex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (parsed.tool_call?.name) {
        toolCalls.push({
          name: parsed.tool_call.name,
          arguments: parsed.tool_call.arguments || {},
        });
        cleaned = cleaned.replace(match[0], '').trim();
      } else if (parsed.name && (parsed.arguments || parsed.parameters)) {
        toolCalls.push({
          name: parsed.name,
          arguments: parsed.arguments || parsed.parameters || {},
        });
        cleaned = cleaned.replace(match[0], '').trim();
      }
    } catch {}
  }

  return { cleanedText: cleaned, toolCalls };
}

export async function callBackupOpenAi(
  url: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  maxTokens: number = 2000,
  tools?: any[]
): Promise<{ text: string; toolCalls?: ToolCall[] }> {
  const endpoint = `${url.replace(/\/+$/, '')}/chat/completions`;

  const bodyPayload: any = {
    model,
    messages,
    max_tokens: maxTokens,
    stream: false,
    temperature: 0.7,
  };

  if (tools && tools.length > 0) {
    bodyPayload.tools = tools;
    bodyPayload.tool_choice = 'auto';
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(bodyPayload),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Backup AI API returned ${res.status}: ${errorText}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{
      message?: {
        content?: string;
        tool_calls?: Array<{
          id?: string;
          type?: string;
          function?: { name?: string; arguments?: string | Record<string, any> };
        }>;
      };
    }>;
  };

  const choice = data.choices?.[0];
  const messageObj = choice?.message;
  let text = messageObj?.content?.trim() || '';

  const nativeToolCalls: ToolCall[] = [];
  if (Array.isArray(messageObj?.tool_calls) && messageObj.tool_calls.length > 0) {
    for (const tc of messageObj.tool_calls) {
      if (tc.function?.name) {
        let args: Record<string, any> = {};
        if (typeof tc.function.arguments === 'string') {
          try {
            args = JSON.parse(tc.function.arguments);
          } catch {
            args = {};
          }
        } else if (typeof tc.function.arguments === 'object') {
          args = tc.function.arguments || {};
        }

        nativeToolCalls.push({
          id: tc.id,
          name: tc.function.name,
          arguments: args,
        });
      }
    }
  }

  // Also extract text-based tool calls if any
  const textExtraction = extractToolCallsFromText(text);
  const combinedToolCalls = [...nativeToolCalls, ...textExtraction.toolCalls];

  return {
    text: textExtraction.cleanedText || text,
    toolCalls: combinedToolCalls.length > 0 ? combinedToolCalls : undefined,
  };
}

export async function runUnifiedAiCompletion(
  env: Env,
  targetModel: string,
  messages: ChatMessage[],
  maxTokens: number = 2000,
  tools?: any[]
): Promise<AiCompletionResult> {
  const isCloudflareModel = targetModel.startsWith('@cf/');

  // 1. If a backup model is explicitly selected
  if (!isCloudflareModel) {
    console.log(`[AI Engine] Executing via Backup OpenAI Endpoint (Model: ${targetModel})...`);
    try {
      const result = await callBackupOpenAi(
        env.BACKUP_AI_URL,
        env.BACKUP_AI_KEY,
        targetModel,
        messages,
        maxTokens,
        tools
      );
      const estTokens = Math.round((result.text.length + (result.toolCalls ? 200 : 0)) / 4);
      await recordUsage(env.AI_NEWS_KV, estTokens, true, true);
      return {
        text: result.text,
        provider: 'backup',
        modelUsed: targetModel,
        toolCalls: result.toolCalls,
      };
    } catch (backupErr) {
      console.error('[AI Engine] Primary backup model failed:', backupErr);
      if (targetModel !== 'ag/gemini-3.8-flash-high') {
        const result = await callBackupOpenAi(
          env.BACKUP_AI_URL,
          env.BACKUP_AI_KEY,
          'ag/gemini-3.8-flash-high',
          messages,
          maxTokens,
          tools
        );
        const estTokens = Math.round((result.text.length + (result.toolCalls ? 200 : 0)) / 4);
        await recordUsage(env.AI_NEWS_KV, estTokens, true, true);
        return {
          text: result.text,
          provider: 'backup',
          modelUsed: 'ag/gemini-3.8-flash-high',
          toolCalls: result.toolCalls,
        };
      }
      throw backupErr;
    }
  }

  // 2. Target model is Cloudflare Workers AI
  console.log(`[AI Engine] Executing via Cloudflare Workers AI (Model: ${targetModel})...`);
  try {
    const response = (await env.AI.run(targetModel as any, {
      messages,
      max_tokens: maxTokens,
      temperature: 0.7,
    })) as { response?: string };

    if (response && response.response && response.response.trim().length > 0) {
      const rawText = response.response.trim();
      const extracted = extractToolCallsFromText(rawText);
      const estTokens = Math.round(rawText.length / 4);
      await recordUsage(env.AI_NEWS_KV, estTokens, true, false);
      return {
        text: extracted.cleanedText || rawText,
        provider: 'cloudflare',
        modelUsed: targetModel,
        toolCalls: extracted.toolCalls.length > 0 ? extracted.toolCalls : undefined,
      };
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
      const result = await callBackupOpenAi(
        env.BACKUP_AI_URL,
        env.BACKUP_AI_KEY,
        'ag/gemini-3.8-flash-high',
        messages,
        maxTokens,
        tools
      );
      const estTokens = Math.round((result.text.length + (result.toolCalls ? 200 : 0)) / 4);
      await recordUsage(env.AI_NEWS_KV, estTokens, true, true);
      return {
        text: result.text,
        provider: 'backup',
        modelUsed: 'ag/gemini-3.8-flash-high (Auto Failover)',
        toolCalls: result.toolCalls,
      };
    } catch (backupFailoverErr) {
      console.error('[AI Engine] Both Cloudflare AI and Backup AI failed:', backupFailoverErr);
      throw backupFailoverErr;
    }
  }
}
