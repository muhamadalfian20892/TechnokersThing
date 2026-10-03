import { stripEmojis } from '../utils/text';

export interface TelegramResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

export async function sendTelegramMessage(
  token: string,
  chatId: string | number,
  text: string,
  options?: {
    parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2';
    disableWebPagePreview?: boolean;
    replyToMessageId?: number;
  }
): Promise<{ ok: boolean; messageId?: number; description?: string }> {
  // If text is within Telegram's safe limit, send directly
  if (text.length <= 4000) {
    return sendSingleMessage(token, chatId, text, options);
  }

  // Split into chunks if text exceeds limit (e.g. detailed 10-item Weekly Recap)
  const chunks = splitMessageIntoChunks(text, 3900);
  let lastResult: { ok: boolean; messageId?: number; description?: string } = {
    ok: true,
  };

  for (const chunk of chunks) {
    lastResult = await sendSingleMessage(token, chatId, chunk, options);
    if (!lastResult.ok) {
      break;
    }
    // Small delay between chunks
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  return lastResult;
}

async function sendSingleMessage(
  token: string,
  chatId: string | number,
  text: string,
  options?: {
    parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2';
    disableWebPagePreview?: boolean;
    replyToMessageId?: number;
  }
): Promise<{ ok: boolean; messageId?: number; description?: string }> {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  const cleanText = stripEmojis(text);

  const payload: Record<string, unknown> = {
    chat_id: chatId,
    text: cleanText,
    parse_mode: options?.parseMode ?? 'HTML',
    disable_web_page_preview: options?.disableWebPagePreview ?? true,
  };

  if (options?.replyToMessageId) {
    payload.reply_to_message_id = options.replyToMessageId;
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = (await res.json()) as TelegramResponse<{ message_id: number }>;

    if (!data.ok) {
      console.error('Failed to send Telegram message:', data.description);
      // Fallback: If parse_mode fails due to unclosed tags, retry once with plain text
      if (options?.parseMode && data.description?.includes('can\'t parse entities')) {
        console.warn('Retrying message without HTML parsing...');
        const plainRes = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: stripBasicHtml(text),
            disable_web_page_preview: true,
          }),
        });
        const plainData = (await plainRes.json()) as TelegramResponse<{ message_id: number }>;
        return {
          ok: plainData.ok,
          messageId: plainData.result?.message_id,
          description: plainData.description,
        };
      }
    }

    return {
      ok: data.ok,
      messageId: data.result?.message_id,
      description: data.description,
    };
  } catch (err) {
    console.error('Network error sending Telegram message:', err);
    return { ok: false, description: String(err) };
  }
}

function splitMessageIntoChunks(text: string, maxChunkLength: number): string[] {
  const chunks: string[] = [];
  const paragraphs = text.split('\n\n');
  let currentChunk = '';

  for (const para of paragraphs) {
    if ((currentChunk + '\n\n' + para).length <= maxChunkLength) {
      currentChunk = currentChunk ? currentChunk + '\n\n' + para : para;
    } else {
      if (currentChunk) {
        chunks.push(currentChunk);
      }
      if (para.length > maxChunkLength) {
        // If single paragraph is too large, split by lines
        const lines = para.split('\n');
        let lineChunk = '';
        for (const line of lines) {
          if ((lineChunk + '\n' + line).length <= maxChunkLength) {
            lineChunk = lineChunk ? lineChunk + '\n' + line : line;
          } else {
            if (lineChunk) chunks.push(lineChunk);
            lineChunk = line;
          }
        }
        if (lineChunk) currentChunk = lineChunk;
        else currentChunk = '';
      } else {
        currentChunk = para;
      }
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks;
}

export interface TelegramFile {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_path?: string;
}

export async function sendChatAction(
  token: string,
  chatId: string | number,
  action:
    | 'typing'
    | 'upload_photo'
    | 'record_video'
    | 'upload_video'
    | 'record_voice'
    | 'upload_voice'
    | 'choose_sticker' = 'typing'
): Promise<void> {
  const url = `https://api.telegram.org/bot${token}/sendChatAction`;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, action }),
    });
  } catch (err) {
    console.error('Error sending chat action:', err);
  }
}

export async function getTelegramFile(
  token: string,
  fileId: string
): Promise<TelegramResponse<TelegramFile>> {
  const url = `https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`;
  try {
    const res = await fetch(url);
    return (await res.json()) as TelegramResponse<TelegramFile>;
  } catch (err) {
    console.error('Error in getTelegramFile:', err);
    return { ok: false, description: String(err) };
  }
}

export async function downloadTelegramFile(
  token: string,
  filePath: string
): Promise<{ ok: boolean; buffer?: ArrayBuffer; error?: string }> {
  const url = `https://api.telegram.org/file/bot${token}/${filePath}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      return { ok: false, error: `Telegram file download failed: ${res.status} ${res.statusText}` };
    }
    const buffer = await res.arrayBuffer();
    return { ok: true, buffer };
  } catch (err) {
    console.error('Error downloading Telegram file:', err);
    return { ok: false, error: String(err) };
  }
}

export async function setTelegramWebhook(
  token: string,
  webhookUrl: string,
  secretToken?: string
): Promise<TelegramResponse<boolean>> {
  const url = `https://api.telegram.org/bot${token}/setWebhook`;
  const body: Record<string, unknown> = {
    url: webhookUrl,
    allowed_updates: ['message', 'channel_post'],
  };

  if (secretToken) {
    body.secret_token = secretToken;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  return (await res.json()) as TelegramResponse<boolean>;
}

export async function getTelegramWebhookInfo(
  token: string
): Promise<TelegramResponse<Record<string, unknown>>> {
  const url = `https://api.telegram.org/bot${token}/getWebhookInfo`;
  const res = await fetch(url);
  return (await res.json()) as TelegramResponse<Record<string, unknown>>;
}

export async function getTelegramMe(
  token: string
): Promise<TelegramResponse<Record<string, unknown>>> {
  const url = `https://api.telegram.org/bot${token}/getMe`;
  const res = await fetch(url);
  return (await res.json()) as TelegramResponse<Record<string, unknown>>;
}

function stripBasicHtml(html: string): string {
  return html.replace(/<[^>]*>?/gm, '');
}
