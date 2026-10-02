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

export interface AgentResponse {
  replyText: string;
  toolCallsExecuted: string[];
}

/**
 * Unified Conversational Agent with Intelligent Tool & Function Calling
 * Let the AI decide when to set reminders, ask clarification questions, or reply conversationally!
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
${baseSystemPrompt || 'Kamu adalah Technokers AI Assistant, asisten cerdas berwawasan luas.'}

WAKTU SAAT INI (WIB): ${timeStr}
${platformContext}
USER: ${context.userName} (ID: ${context.userId}, Admin: ${context.isAdmin ? 'YA' : 'TIDAK'})

${SCHEDULER_SYSTEM_PROMPT_INSTRUCTIONS}

STANDAR AKSESIBILITAS WCAG 2.1 AAA:
- Format jawaban dengan hierarki rapi, kontras, gunakan format HTML (<b>tebal</b>, <i>miring</i>, <code>kode</code>).
- Berikan respon yang hangat, cerdas, bersahabat, to-the-point, dan edukatif.
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

    for (const tc of toolCalls) {
      toolCallsExecuted.push(tc.name);
      const res = await executeSchedulerTool(tc.name, tc.arguments, context);

      if (res.needsClarification && res.clarificationQuestion) {
        toolResults.push(res.clarificationQuestion);
      } else if (res.message) {
        toolResults.push(res.message);
      }
    }

    const finalReply = toolResults.join('\n\n') || aiRes.text;
    return {
      replyText: finalReply,
      toolCallsExecuted,
    };
  }

  // When AI decides to converse normally (or ask "kamu mau diingetin gak?")
  return {
    replyText: aiRes.text,
    toolCallsExecuted: [],
  };
}
