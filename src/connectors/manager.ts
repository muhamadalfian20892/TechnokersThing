import {
  ConnectorConfig,
  ConnectorExecutionResult,
  ConnectorType,
} from './types';

export const DEFAULT_CONNECTOR_TEMPLATES: ConnectorConfig[] = [
  {
    id: 'google-blogger',
    name: 'Google Blogger',
    type: 'blogger',
    enabled: false,
    description: 'Publikasikan postingan berita AI otomatis langsung ke blog Google Blogger.',
    auth: {
      accessToken: '',
      apiKey: '',
    },
    params: {
      blogId: '',
    },
    createdAt: new Date().toISOString(),
  },
  {
    id: 'google-gmail',
    name: 'Google Gmail',
    type: 'gmail',
    enabled: false,
    description: 'Kirim buletin berita atau notifikasi via Google Gmail API.',
    auth: {
      accessToken: '',
    },
    params: {
      recipientEmail: '',
    },
    createdAt: new Date().toISOString(),
  },
  {
    id: 'custom-webhook',
    name: 'Custom Webhook (Discord / Slack / N8N)',
    type: 'webhook',
    enabled: false,
    description: 'Kirimkan payload berita AI ke URL webhook eksternal.',
    auth: {},
    params: {
      webhookUrl: '',
    },
    createdAt: new Date().toISOString(),
  },
];

// 1. Storage Helpers
export async function getAllConnectors(kv: KVNamespace): Promise<ConnectorConfig[]> {
  const raw = await kv.get('config:connectors_list');
  if (!raw) {
    return DEFAULT_CONNECTOR_TEMPLATES;
  }
  try {
    const list = JSON.parse(raw) as ConnectorConfig[];
    const ids = new Set(list.map((c) => c.id));
    for (const def of DEFAULT_CONNECTOR_TEMPLATES) {
      if (!ids.has(def.id)) {
        list.push(def);
      }
    }
    return list;
  } catch {
    return DEFAULT_CONNECTOR_TEMPLATES;
  }
}

export async function getConnector(kv: KVNamespace, id: string): Promise<ConnectorConfig | null> {
  const all = await getAllConnectors(kv);
  return all.find((c) => c.id === id) || null;
}

export async function saveConnector(kv: KVNamespace, connector: ConnectorConfig): Promise<void> {
  const all = await getAllConnectors(kv);
  const index = all.findIndex((c) => c.id === connector.id);
  if (index >= 0) {
    all[index] = connector;
  } else {
    all.push(connector);
  }
  await kv.put('config:connectors_list', JSON.stringify(all));
}

// 2. Connector Executors
export async function executeBloggerPost(
  connector: ConnectorConfig,
  title: string,
  contentHtml: string,
  labels: string[] = ['AI', 'TechNews', 'aicomindo'],
  isDraft: boolean = false
): Promise<ConnectorExecutionResult> {
  const blogId = connector.params.blogId;
  const token = connector.auth.accessToken;

  if (!blogId || !token) {
    return {
      success: false,
      message: 'Blogger belum aktif: Blog ID dan Google OAuth Token harus diisi di Dashboard Web.',
    };
  }

  const endpoint = `https://www.googleapis.com/blogger/v3/blogs/${blogId}/posts${isDraft ? '?isDraft=true' : ''}`;

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        kind: 'blogger#post',
        title,
        content: contentHtml,
        labels,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      return {
        success: false,
        message: `Blogger API Error: ${(data as any).error?.message || res.statusText}`,
        data,
      };
    }

    return {
      success: true,
      message: `Artikel berhasil dipublikasikan ke Blogger! Judul: "${title}"`,
      data,
    };
  } catch (err) {
    return {
      success: false,
      message: `Network error ke Blogger API: ${String(err)}`,
    };
  }
}

export async function executeGmailSend(
  connector: ConnectorConfig,
  toEmail: string,
  subject: string,
  bodyHtml: string
): Promise<ConnectorExecutionResult> {
  const token = connector.auth.accessToken;
  const recipient = toEmail || connector.params.recipientEmail;

  if (!recipient || !token) {
    return {
      success: false,
      message: 'Gmail belum aktif: Email penerima dan Google OAuth Token harus diisi di Dashboard Web.',
    };
  }

  const utf8Subject = `=?utf-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`;
  const messageParts = [
    `To: ${recipient}`,
    'Content-Type: text/html; charset=utf-8',
    'MIME-Version: 1.0',
    `Subject: ${utf8Subject}`,
    '',
    bodyHtml,
  ];
  const message = messageParts.join('\r\n');
  const encodedMessage = btoa(unescape(encodeURIComponent(message)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const endpoint = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw: encodedMessage }),
    });

    const data = await res.json();
    if (!res.ok) {
      return {
        success: false,
        message: `Gmail API Error: ${(data as any).error?.message || res.statusText}`,
        data,
      };
    }

    return {
      success: true,
      message: `Email berhasil terkirim via Gmail ke ${recipient}!`,
      data,
    };
  } catch (err) {
    return {
      success: false,
      message: `Network error ke Gmail API: ${String(err)}`,
    };
  }
}

export async function executeWebhookDispatch(
  connector: ConnectorConfig,
  payload: Record<string, any>
): Promise<ConnectorExecutionResult> {
  const url = connector.params.webhookUrl;
  if (!url) {
    return {
      success: false,
      message: 'Webhook belum dikonfigurasi: Webhook URL belum diisi.',
    };
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(connector.params.customHeaders || {}),
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      return {
        success: false,
        message: `Webhook returned status ${res.status}: ${res.statusText}`,
      };
    }

    return {
      success: true,
      message: `Webhook berhasil dikirim ke ${url}!`,
    };
  } catch (err) {
    return {
      success: false,
      message: `Network error mengirim webhook: ${String(err)}`,
    };
  }
}

// 3. Natural Language Connector Intent Handler
export async function processConnectorIntent(
  kv: KVNamespace,
  text: string
): Promise<{ handled: boolean; replyText?: string }> {
  const lower = text.toLowerCase();

  // 1. Intent: Blogger
  if (lower.includes('blogger') || lower.includes('blog')) {
    const blogger = await getConnector(kv, 'google-blogger');
    const isConfigured = blogger && blogger.params.blogId && blogger.auth.accessToken;

    if (lower.includes('publish') || lower.includes('posting')) {
      if (!isConfigured) {
        return {
          handled: true,
          replyText: `<b>Konektor Google Blogger Belum Dikonfigurasi</b>\n\nUntuk mempublikasikan artikel ke Blogger otomatis:\n1. Buka <b>Dashboard Web</b> di https://technokersthing.hafiyanajah.workers.dev\n2. Masuk ke tab <b>Connectors</b>\n3. Masukkan <b>Blog ID</b> dan <b>Google OAuth Access Token</b> Anda.\n\nSetelah tersambung, Anda bisa menyuruh saya memposting artikel kapan saja!`,
        };
      }
      return {
        handled: true,
        replyText: `<b>Konektor Google Blogger Siap!</b>\nBlog ID terhubung: <code>${blogger.params.blogId}</code>.\nAnda bisa memicu publikasi artikel digest harian langsung ke Blogger melalui Dashboard atau perintah admin.`,
      };
    }

    return {
      handled: true,
      replyText: `<b>Status Konektor Google Blogger</b>\n\nStatus: <b>${isConfigured ? '[Tersambung & Aktif]' : '[Belum Lengkap (Perlu Konfigurasi)]'}</b>\nBlog ID: <code>${blogger?.params.blogId || '(belum diisi)'}</code>\n\n<b>Cara Setup:</b>\nAnda dapat mengonfigurasi Blog ID dan Access Token Google langsung di <b>Dashboard Web</b> (tab Connectors). Setelah aktif, bot dapat langsung membuat dan menerbitkan postingan blog AI otomatis!`,
    };
  }

  // 2. Intent: Gmail
  if (lower.includes('gmail') || lower.includes('email')) {
    const gmail = await getConnector(kv, 'google-gmail');
    const isConfigured = gmail && gmail.auth.accessToken;

    return {
      handled: true,
      replyText: `<b>Status Konektor Google Gmail</b>\n\nStatus: <b>${isConfigured ? '[Tersambung & Aktif]' : '[Belum Diaktifkan]'}</b>\nEmail Tujuan: <code>${gmail?.params.recipientEmail || '(belum disetel)'}</code>\n\n<b>Cara Setup:</b>\nAnda dapat menghubungkan akun Google Anda di Dashboard Web untuk mengirimkan notifikasi atau digest harian ke inbox email Anda.`,
    };
  }

  // 3. Intent: Google General
  if (lower.includes('sambungin ke google') || lower.includes('konek google') || lower.includes('connect google')) {
    return {
      handled: true,
      replyText: `<b>Universal Google Connectors</b>\n\nBot ini siap disambungkan ke berbagai layanan Google:\n1. <b>Google Blogger:</b> Publikasikan berita dan artikel AI langsung ke blog Anda.\n2. <b>Google Gmail:</b> Kirim rangkuman dan notifikasi ke email.\n3. <b>Google Webhook:</b> Kirim data ke Google Apps Script atau Google Cloud Pub/Sub.\n\n<i>Anda dapat mengaktifkan dan mengisi kredensial masing-masing layanan dengan mudah di Dashboard Web pada menu <b>Connectors</b>!</i>`,
    };
  }

  // 4. Intent: Connectors List
  if (lower.includes('connectors') || lower.includes('konektor')) {
    const list = await getAllConnectors(kv);
    const summary = list.map((c) => `• <b>${c.name}</b> (${c.type}): ${c.enabled ? '[Aktif]' : '[Nonaktif]'}`).join('\n');
    return {
      handled: true,
      replyText: `<b>Daftar Universal Connectors Tersedia:</b>\n\n${summary}\n\nKunjungi Dashboard Web untuk mengonfigurasi atau menambahkan konektor baru secara mandiri!`,
    };
  }

  return { handled: false };
}

// 4. Auto-Syndication Helper
export async function syndicateDigestToConnectors(
  kv: KVNamespace,
  headline: string,
  digestHtml: string
): Promise<string[]> {
  const connectors = await getAllConnectors(kv);
  const logs: string[] = [];

  for (const c of connectors) {
    if (!c.enabled) continue;

    if (c.type === 'blogger' && c.params.blogId && c.auth.accessToken) {
      const res = await executeBloggerPost(c, headline, digestHtml);
      logs.push(`[Blogger] ${res.message}`);
    } else if (c.type === 'webhook' && c.params.webhookUrl) {
      const res = await executeWebhookDispatch(c, {
        title: headline,
        content: digestHtml,
        publishedAt: new Date().toISOString(),
      });
      logs.push(`[Webhook] ${res.message}`);
    }
  }

  return logs;
}
