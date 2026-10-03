import { recordUsage, addAuditLog } from './memory';
import { stripEmojis } from '../utils/text';

export interface TranscriptionResult {
  text: string;
  provider: 'cloudflare' | 'cloudflare-turbo' | 'backup';
  modelUsed: string;
}

// Known repetitive hallucination artifacts produced by Whisper on silent or low-noise audio
const WHISPER_HALLUCINATIONS = [
  'thank you for watching',
  'terima kasih telah menonton',
  'terima kasih sudah menonton',
  'subtitles by the amara.org community',
  'transcription by',
  'mbc 뉴스',
  '[blank_audio]',
  '[music]',
  '[applause]',
  '[laughter]',
  '(silence)',
  '(music)',
  'you',
  '.',
  '..',
  '...',
  'bye',
  'bye-bye',
];

/**
 * Checks if the transcribed text is a false positive / Whisper hallucination artifact.
 * Accurately handles short words (like 'you' or 'bye') with exact match so legitimate
 * words starting with those prefixes (e.g. 'youtube', 'you are') are never wrongly discarded.
 */
export function isHallucinationOrEmpty(text: string): boolean {
  const normalized = text.toLowerCase().trim().replace(/[.,!?;:"]/g, '');
  if (!normalized) return true;
  return WHISPER_HALLUCINATIONS.some((h) => {
    if (h.length <= 4) {
      return normalized === h;
    }
    return normalized === h || normalized.startsWith(h);
  });
}

/**
 * Helper to convert an ArrayBuffer to a Base64 string safely without call stack overflow.
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
}

/**
 * High-performance speech-to-text transcription engine.
 * Supports Cloudflare Workers AI Whisper with automatic multi-tiered failover.
 * Strictly WCAG 2.1 AAA compliant (zero emojis, cleaned accessible text).
 */
export async function transcribeAudio(
  env: Env,
  audioBuffer: ArrayBuffer,
  mimeType?: string
): Promise<TranscriptionResult> {
  const uint8 = new Uint8Array(audioBuffer);
  const audioBytes = Array.from(uint8);
  const base64Audio = arrayBufferToBase64(audioBuffer);

  // 1. Primary: Cloudflare Workers AI Whisper (@cf/openai/whisper)
  try {
    console.log('[Transcriber] Running primary Cloudflare Workers AI Whisper (@cf/openai/whisper)...');
    const cfResponse = (await env.AI.run('@cf/openai/whisper', {
      audio: audioBytes,
    })) as { text?: string };

    if (cfResponse && typeof cfResponse.text === 'string' && cfResponse.text.trim().length > 0) {
      const rawText = cfResponse.text.trim();
      if (!isHallucinationOrEmpty(rawText)) {
        const clean = stripEmojis(rawText);
        const estTokens = Math.max(10, Math.round(clean.length / 4));
        await recordUsage(env.AI_NEWS_KV, estTokens, true, false);
        return {
          text: clean,
          provider: 'cloudflare',
          modelUsed: '@cf/openai/whisper',
        };
      }
    }
  } catch (cfErr) {
    console.warn('[Transcriber] Primary @cf/openai/whisper failed or unavailable:', cfErr);
  }

  // 2. Secondary: Cloudflare Workers AI Whisper Large V3 Turbo (@cf/openai/whisper-large-v3-turbo)
  // Whisper Large V3 Turbo expects base64 string audio
  try {
    console.log('[Transcriber] Falling back to @cf/openai/whisper-large-v3-turbo...');
    const turboResponse = (await env.AI.run('@cf/openai/whisper-large-v3-turbo' as any, {
      audio: base64Audio,
    })) as { text?: string };

    if (turboResponse && typeof turboResponse.text === 'string' && turboResponse.text.trim().length > 0) {
      const rawText = turboResponse.text.trim();
      if (!isHallucinationOrEmpty(rawText)) {
        const clean = stripEmojis(rawText);
        const estTokens = Math.max(10, Math.round(clean.length / 4));
        await recordUsage(env.AI_NEWS_KV, estTokens, true, false);
        return {
          text: clean,
          provider: 'cloudflare-turbo',
          modelUsed: '@cf/openai/whisper-large-v3-turbo',
        };
      }
    }
  } catch (turboErr) {
    console.warn('[Transcriber] Secondary @cf/openai/whisper-large-v3-turbo failed:', turboErr);
  }

  // 3. Multimodal Backup Provider Fallback (ag/gemini-3.8-flash-high)
  // Uses input_audio to transcribe speech with high resilience
  try {
    console.log('[Transcriber] Falling back to Backup Provider ag/gemini-3.8-flash-high with input_audio...');
    const backupEndpoint = `${env.BACKUP_AI_URL.replace(/\/+$/, '')}/chat/completions`;
    const format = mimeType && mimeType.includes('wav') ? 'wav' : 'mp3';

    const res = await fetch(backupEndpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.BACKUP_AI_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'ag/gemini-3.8-flash-high',
        stream: false,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Transkripsikan seluruh ucapan atau isi dari audio ini secara akurat dalam bahasa yang diucapkan. Jangan tambahkan komentar pengantar, tanda kutip, atau penjelasan apa pun. Jika audio hening atau tidak ada suara manusia yang dapat dimengerti, balas HANYA dengan [KOSONG].',
              },
              {
                type: 'input_audio',
                input_audio: {
                  data: base64Audio,
                  format: format,
                },
              },
            ],
          },
        ],
      }),
    });

    if (res.ok) {
      const rawBody = await res.text();
      let text = '';

      // Safely handle both standard JSON response and SSE data stream lines
      try {
        const data = JSON.parse(rawBody);
        text = data.choices?.[0]?.message?.content?.trim() || '';
      } catch {
        const lines = rawBody.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data:') && !trimmed.includes('[DONE]')) {
            try {
              const chunkJson = JSON.parse(trimmed.slice(5).trim());
              const delta = chunkJson.choices?.[0]?.delta?.content || chunkJson.choices?.[0]?.message?.content || '';
              text += delta;
            } catch {}
          }
        }
        text = text.trim();
      }

      if (text && !text.includes('[KOSONG]') && !isHallucinationOrEmpty(text)) {
        const clean = stripEmojis(text);
        const estTokens = Math.max(10, Math.round(clean.length / 4));
        await recordUsage(env.AI_NEWS_KV, estTokens, true, true);
        await addAuditLog(
          env.AI_NEWS_KV,
          'TRANSCRIBER_BACKUP_USED',
          'System',
          'Used ag/gemini-3.8-flash-high for audio transcription'
        );
        return {
          text: clean,
          provider: 'backup',
          modelUsed: 'ag/gemini-3.8-flash-high',
        };
      }
    } else {
      console.warn('[Transcriber] Backup audio API returned non-OK status:', res.status);
    }
  } catch (backupErr) {
    console.error('[Transcriber] Backup audio transcription error:', backupErr);
  }

  // If all failed or audio was genuinely silent
  return {
    text: '',
    provider: 'cloudflare',
    modelUsed: '@cf/openai/whisper',
  };
}
