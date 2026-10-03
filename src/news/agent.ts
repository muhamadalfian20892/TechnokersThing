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
import { stripEmojis } from '../utils/text';

export interface AgentResponse {
  replyText: string;
  toolCallsExecuted: string[];
}

/**
 * Unified Conversational Agent with Intelligent Tool & Function Calling
 * Screen-reader friendly, WCAG 2.1 AAA compliant (zero emojis, natural spoken confirmation).
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

STANDAR AKSESIBILITAS WCAG 2.1 AAA & SCREEN READER:
- DILARANG KERAS MENGGUNAKAN EMOJI SAMA SEKALI (tidak boleh ada simbol grafis/emoticon). Ini wajib demi kenyamanan pengguna tuna netra / screen reader.
- JANGAN menyebutkan kode hash, job ID, atau nomor teknis internal apa pun saat mengonfirmasi pengingat atau jadwal kepada pengguna! Berbicaralah santai dan alami seperti teman (misal: "Siap, kamu bakal aku ingetin 1 menit lagi ya!").
- Format jawaban dengan hierarki rapi, kontras, gunakan format HTML resmi jika perlu (<b>tebal</b>, <i>miring</i>, <code>kode</code>).
- Berikan respon yang hangat, cerdas, bersahabat, to-the-point, dan edukatif.

ATURAN MENYAPA (PENTING):
- JANGAN PERNAH mengulang salam atau sapaan nama ("Halo ${context.userName}", "Hai ${context.userName}") di setiap respon jika percakapan sedang berjalan!
- Hanya sapa nama jika pengguna baru pertama kali memulai obrolan atau baru menyapa salam di pesan pembuka. Jika obrolan sedang berlangsung atau pengguna menanyakan sesuatu, LANGSUNG jawab intinya secara cerdas, ramah, dan to-the-point.
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
        replyText: stripEmojis(needsClarificationMessage),
        toolCallsExecuted,
      };
    }

    // Generate natural, friendly confirmation without technical IDs or emojis
    const toolSummary = toolResults.join('\n');
    const followupMessages: ChatMessage[] = [
      ...messagesToSend,
      { role: 'assistant', content: aiRes.text || `Memproses permintaan...` },
      {
        role: 'system',
        content: `Hasil eksekusi alat: ${toolSummary}

TUGASMU:
Sampaikan konfirmasi ini kepada pengguna secara santai, ramah, mengalir, dan alami dalam Bahasa Indonesia.
ATURAN MUTLAK AKSESIBILITAS WCAG 2.1 AAA:
1. DILARANG MENGGUNAKAN EMOJI SAMA SEKALI (demi pembaca layar/screen reader).
2. JANGAN SEBUTKAN nomor ID/hash teknis atau kode sistem apa pun.
3. Bicaralah wajar dan bersahabat (misal: "Oke, kamu bakal aku ingetin 1 menit lagi ya!", atau "Beres, pengingat buat makan sudah aku pasang ya.").`,
      },
    ];

    try {
      const followupRes = await runUnifiedAiCompletion(env, activeModel, followupMessages, 400);
      const cleanReply = stripEmojis(followupRes.text.trim()) || stripEmojis(toolSummary);
      return {
        replyText: cleanReply,
        toolCallsExecuted,
      };
    } catch {
      return {
        replyText: stripEmojis(toolSummary),
        toolCallsExecuted,
      };
    }
  }

  // When AI decides to converse normally (or ask "kamu mau diingetin gak?")
  return {
    replyText: stripEmojis(aiRes.text),
    toolCallsExecuted: [],
  };
}
