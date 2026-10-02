import { handleTelegramUpdate, TelegramUpdate } from './telegram/bot';
import {
  sendTelegramMessage,
  setTelegramWebhook,
  getTelegramWebhookInfo,
  getTelegramMe,
} from './telegram/api';
import { fetchLatestAINews } from './news/fetcher';
import {
  filterUnpostedNews,
  recordPostedNews,
  getRecentPostedHistory,
  getLastDigestStats,
} from './news/memory';
import { generateDailyNewsDigest } from './news/generator';

// Pipeline to execute daily news posting to the channel
export async function executeDailyNewsPosting(env: Env): Promise<{
  success: boolean;
  postedCount: number;
  message?: string;
}> {
  console.log('Starting daily AI news aggregation pipeline...');
  const candidates = await fetchLatestAINews();
  console.log(`Fetched ${candidates.length} news candidates from sources.`);

  // Filter against KV memory to eliminate duplicate news
  const unposted = await filterUnpostedNews(env.AI_NEWS_KV, candidates);
  console.log(`Identified ${unposted.length} unposted news candidates.`);

  const itemsToPost = unposted.length > 0 ? unposted.slice(0, 5) : candidates.slice(0, 3);

  // Generate engaging Indonesian digest with Workers AI
  const digestHtml = await generateDailyNewsDigest(env.AI, itemsToPost);

  // Publish to Telegram Channel
  const sendRes = await sendTelegramMessage(env.TELEGRAM_TOKEN, env.CHANNEL_ID, digestHtml);

  if (sendRes.ok) {
    console.log(`Successfully posted digest to ${env.CHANNEL_ID}`);
    if (unposted.length > 0) {
      await recordPostedNews(env.AI_NEWS_KV, itemsToPost, 'Daily AI Digest');
    }
    return {
      success: true,
      postedCount: itemsToPost.length,
      message: 'Digest posted successfully',
    };
  } else {
    console.error('Failed to post digest:', sendRes.description);
    return {
      success: false,
      postedCount: 0,
      message: sendRes.description,
    };
  }
}

export default {
  // Cloudflare Scheduled Event (Cron Trigger: 0 11 * * * = 18:00 WIB)
  async scheduled(
    event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    console.log(`Cron triggered at: ${new Date().toISOString()} (cron: ${event.cron})`);
    ctx.waitUntil(executeDailyNewsPosting(env));
  },

  // HTTP Request Handler
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

    // 1. Telegram Webhook Endpoint
    if (url.pathname === '/telegram/webhook' && request.method === 'POST') {
      try {
        const update = (await request.json()) as TelegramUpdate;
        ctx.waitUntil(handleTelegramUpdate(update, env));
        return Response.json({ ok: true });
      } catch (err) {
        console.error('Webhook payload error:', err);
        return Response.json({ ok: false, error: 'Invalid payload' }, { status: 400 });
      }
    }

    // 2. Set Webhook Endpoint (Easy setup)
    if (url.pathname === '/telegram/set-webhook') {
      const webhookUrl = `${url.origin}/telegram/webhook`;
      const res = await setTelegramWebhook(env.TELEGRAM_TOKEN, webhookUrl);
      return Response.json({
        webhookUrl,
        telegramResponse: res,
      });
    }

    // 3. Webhook & Bot Diagnostics
    if (url.pathname === '/telegram/status') {
      const [botInfo, webhookInfo, history, lastStats] = await Promise.all([
        getTelegramMe(env.TELEGRAM_TOKEN),
        getTelegramWebhookInfo(env.TELEGRAM_TOKEN),
        getRecentPostedHistory(env.AI_NEWS_KV),
        getLastDigestStats(env.AI_NEWS_KV),
      ]);

      return Response.json({
        botInfo,
        webhookInfo,
        kvMemory: {
          storedNewsCount: history.length,
          lastDigest: lastStats,
          recentItems: history.slice(0, 5),
        },
        channelId: env.CHANNEL_ID,
        scheduledTime: 'Daily at 18:00 WIB (11:00 UTC)',
      });
    }

    // 4. Manual Trigger for Testing Digest (Posts to channel)
    if (url.pathname === '/api/trigger-news') {
      const result = await executeDailyNewsPosting(env);
      return Response.json(result);
    }

    // 5. Dry Run / Preview Digest (Does not post or save to KV)
    if (url.pathname === '/api/preview-news') {
      const candidates = await fetchLatestAINews();
      const unposted = await filterUnpostedNews(env.AI_NEWS_KV, candidates);
      const itemsToPost = unposted.length > 0 ? unposted.slice(0, 5) : candidates.slice(0, 3);
      const digestHtml = await generateDailyNewsDigest(env.AI, itemsToPost);

      return Response.json({
        totalCandidates: candidates.length,
        unpostedCandidates: unposted.length,
        selectedForDigest: itemsToPost,
        previewContent: digestHtml,
      });
    }

    // 6. Homepage Dashboard
    return new Response(
      `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Technokers AI Bot & News Digest</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; padding: 2rem; max-width: 800px; margin: 0 auto; line-height: 1.6; }
    h1 { color: #38bdf8; display: flex; align-items: center; gap: 0.5rem; }
    .card { background: #1e293b; border-radius: 12px; padding: 1.5rem; margin-bottom: 1.5rem; border: 1px solid #334155; }
    .badge { display: inline-block; background: #0284c7; color: white; padding: 0.25rem 0.75rem; border-radius: 9999px; font-size: 0.875rem; font-weight: bold; }
    a { color: #38bdf8; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .btn { display: inline-block; background: #2563eb; color: white; padding: 0.5rem 1rem; border-radius: 8px; font-weight: 500; margin-right: 0.5rem; margin-top: 0.5rem; }
    .btn:hover { background: #1d4ed8; text-decoration: none; }
    code { background: #0f172a; padding: 0.2rem 0.4rem; border-radius: 4px; font-size: 0.9em; color: #a5f3fc; }
  </style>
</head>
<body>
  <h1>🤖 Technokers AI Worker</h1>
  <div class="card">
    <p><span class="badge">ONLINE</span> Cloudflare Workers & Workers AI</p>
    <p>Bot ini aktif mengkurasi berita AI global setiap hari secara otomatis untuk komunitas Telegram <a href="https://t.me/aicomindo" target="_blank"><b>@aicomindo</b></a>.</p>
    <p>⏰ <b>Jadwal Posting Otomatis:</b> Setiap hari pukul <b>18:00 WIB</b> (11:00 UTC).</p>
    <p>🧠 <b>Sistem Anti-Duplikasi:</b> Terintegrasi dengan Cloudflare KV (<code>AI_NEWS_KV</code>) untuk mencegah berita duplikat.</p>
  </div>

  <div class="card">
    <h3>🔗 Quick Action Endpoints</h3>
    <a class="btn" href="/telegram/status" target="_blank">Cek Status & Memory KV</a>
    <a class="btn" href="/telegram/set-webhook" target="_blank">Set Telegram Webhook</a>
    <a class="btn" href="/api/preview-news" target="_blank">Preview Berita Hari Ini (Dry Run)</a>
    <a class="btn" href="https://t.me/tckn_bot" target="_blank">Chat dengan Bot di Telegram</a>
  </div>
</body>
</html>`,
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  },
};
