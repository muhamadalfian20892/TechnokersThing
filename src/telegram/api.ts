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
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  const payload: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: options?.parseMode ?? 'HTML',
    disable_web_page_preview: options?.disableWebPagePreview ?? false,
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
      // Fallback: If parse_mode fails due to unclosed tags, retry once without parse_mode
      if (options?.parseMode && data.description?.includes('can\'t parse entities')) {
        console.warn('Retrying message without HTML parsing formatting...');
        const plainRes = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: stripBasicHtml(text),
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

export async function sendChatAction(
  token: string,
  chatId: string | number,
  action: 'typing' | 'upload_photo' | 'record_video' = 'typing'
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
