import { runUnifiedAiCompletion } from './ai_client';
import { getActiveModel } from './memory';
import { ChatMessage } from './types';
import {
  SCHEDULER_TOOLS_SCHEMA,
  SCHEDULER_SYSTEM_PROMPT_INSTRUCTIONS,
  executeSchedulerTool,
  ToolExecutionContext,
} from '../scheduler/tools';
import { getWibDate } from '../scheduler/parser';
import { BOT_SYSTEM_INSTRUCTION } from './prompts';

export interface AgentResponse {
  replyText: string;
  toolCallsExecuted: string[];
}

/**
 * Unified Conversational Agent with Intelligent Tool & Function Calling
 * Supports CHAT MODE and NEWS MODE with natural, human-like persona.
 */
export async function runConversationalAgent(
  env: Env,
  history: ChatMessage[],
  userPrompt: string,
  context: ToolExecutionContext,
  baseSystemPrompt?: string
): Promise<AgentResponse> {
  const activeModel = await getActiveModel(env.AI_NEWS_KV);
  const wibNow = getWibDate();
  const timeStr = `${wibNow.getUTCFullYear()}-${String(wibNow.getUTCMonth() + 1).padStart(2, '0')}-${String(wibNow.getUTCDate()).padStart(2, '0')} ${String(wibNow.getUTCHours()).padStart(2, '0')}:${String(wibNow.getUTCMinutes()).padStart(2, '0')} WIB`;

  const platformContext =
    context.sourcePlatform === 'web_dashboard'
      ? `KONTEKS RUANG CHAT: Pengguna sedang berada di KONSOL WEB DASHBOARD. Jika pengguna minta pengingat "disini", tujuannya adalah Web Dashboard ini.`
      : `KONTEKS RUANG CHAT: Pengguna sedang berada di TELEGRAM BOT (@tckn_bot). Segala pengingat "disini" otomatis masuk ke chat Telegram saat ini.`;

  const fullSystemPrompt = `
${baseSystemPrompt || BOT_SYSTEM_INSTRUCTION}

WAKTU SAAT INI (WIB): ${timeStr}
${platformContext}
USER: ${context.userName} (ID: ${context.userId}, Admin: ${context.isAdmin ? 'YA' : 'TIDAK'})

${SCHEDULER_SYSTEM_PROMPT_INSTRUCTIONS}
`.trim();

  const messagesToSend: ChatMessage[] = [
    { role: 'system', content: fullSystemPrompt },
    ...history.slice(-10), // keep recent conversation context
    { role: 'user', content: userPrompt },
  ];

  // Call AI with scheduler tools enabled
  const aiRes = await runUnifiedAiCompletion(
    env,
    activeModel,
    messagesToSend,
    1500,
    SCHEDULER_TOOLS_SCHEMA
  );

  const toolCalls = aiRes.toolCalls || [];
  const toolCallsExecuted: string[] = [];

  // When AI decides to call functions/tools
  if (toolCalls.length > 0) {
    const toolResults: string[] = [];
    let needsClarificationMessage = '';

    for (const tc of toolCalls) {
      toolCallsExecuted.push(tc.name);
      const res = await executeSchedulerTool(tc.name, tc.arguments, context);

      if (res.needsClarification && res.clarificationQuestion) {
        needsClarificationMessage = res.clarificationQuestion;
      } else if (res.message) {
        toolResults.push(res.message);
      }
    }

    if (needsClarificationMessage) {
      return {
        replyText: needsClarificationMessage.trim(),
        toolCallsExecuted,
      };
    }

    // Generate natural, friendly confirmation without technical IDs
    const toolSummary = toolResults.join('\n');
    const followupMessages: ChatMessage[] = [
      ...messagesToSend,
      { role: 'assistant', content: aiRes.text || `Memproses permintaan...` },
      {
        role: 'system',
        content: `Hasil eksekusi alat: ${toolSummary}

TUGASMU:
Sampaikan konfirmasi ini kepada pengguna secara santai, ramah, mengalir, dan alami dalam Bahasa Indonesia seperti ngobrol dengan teman.
JANGAN SEBUTKAN nomor ID/hash teknis atau kode sistem internal apa pun (misal: "Oke, kamu bakal aku ingetin 1 menit lagi ya!", atau "Beres, pengingat buat makan sudah aku pasang ya.").`,
      },
    ];

    try {
      const followupRes = await runUnifiedAiCompletion(env, activeModel, followupMessages, 400);
      const cleanReply = followupRes.text.trim() || toolSummary;
      return {
        replyText: cleanReply,
        toolCallsExecuted,
      };
    } catch {
      return {
        replyText: toolSummary,
        toolCallsExecuted,
      };
    }
  }

  // When AI decides to converse normally (or ask "kamu mau diingetin gak?")
  return {
    replyText: (aiRes.text || '').trim(),
    toolCallsExecuted: [],
  };
}
