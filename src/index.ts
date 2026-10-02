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
  isPostingPaused,
  setPostingPaused,
  hasPostedToday,
  markPostedToday,
} from './news/memory';
import { generateDailyNewsDigest, getWibInfo } from './news/generator';

// Pipeline to execute daily news posting to the channel
export async function executeDailyNewsPosting(
  env: Env,
  force: boolean = false
): Promise<{
  success: boolean;
  postedCount: number;
  message: string;
}> {
  const { dateStr, isFriday, formattedDate } = getWibInfo();
  console.log(`[Scheduler] Checking daily post pipeline for ${formattedDate} (${dateStr} WIB)...`);

  // 1. Check if posting has been paused by admin
  const paused = await isPostingPaused(env.AI_NEWS_KV);
  if (paused && !force) {
    console.log('[Scheduler] Posting is currently PAUSED by admin. Skipping post.');
    return {
      success: false,
      postedCount: 0,
      message: 'Posting dibatalkan: Jadwal sedang di-pause oleh admin via /stop_posting.',
    };
  }

  // 2. Strict One-Post-Per-Day Lock (Prevents duplicate posts or spamming)
  const alreadyPosted = await hasPostedToday(env.AI_NEWS_KV, dateStr);
  if (alreadyPosted && !force) {
    console.log(`[Scheduler] Already posted digest today (${dateStr}). Skipping.`);
    return {
      success: false,
      postedCount: 0,
      message: `Posting dibatalkan: Digest untuk hari ini (${formattedDate}) sudah pernah diposting.`,
    };
  }

  console.log('[Scheduler] Fetching latest AI news...');
  const candidates = await fetchLatestAINews();
  console.log(`[Scheduler] Fetched ${candidates.length} news candidates.`);

  // Filter against KV memory to eliminate duplicate news
  const unposted = await filterUnpostedNews(env.AI_NEWS_KV, candidates);
  console.log(`[Scheduler] Identified ${unposted.length} unposted news candidates.`);

  // On Friday (Weekly Recap), take up to 10 items; on regular days, take up to 5 items
  const targetCount = isFriday ? 10 : 5;
  let itemsToPost = unposted.slice(0, targetCount);

  // If unposted pool is smaller than target, supplement with top candidate stories
  if (itemsToPost.length < (isFriday ? 5 : 3) && candidates.length > 0) {
    itemsToPost = candidates.slice(0, targetCount);
  }

  // Generate in-depth narrative digest
  console.log(`[Scheduler] Generating digest for ${itemsToPost.length} items (isFriday=${isFriday})...`);
  const digestHtml = await generateDailyNewsDigest(env.AI, itemsToPost, isFriday);

  // Publish to Telegram Channel
  console.log(`[Scheduler] Publishing to channel ${env.CHANNEL_ID}...`);
  const sendRes = await sendTelegramMessage(env.TELEGRAM_TOKEN, env.CHANNEL_ID, digestHtml);

  if (sendRes.ok) {
    console.log(`[Scheduler] Successfully posted to ${env.CHANNEL_ID}`);

    // Set lock so it will NEVER post again today
    await markPostedToday(env.AI_NEWS_KV, dateStr);

    // Save posted items to deduplication memory
    if (itemsToPost.length > 0) {
      await recordPostedNews(
        env.AI_NEWS_KV,
        itemsToPost,
        isFriday ? `Weekly Recap (${formattedDate})` : `Daily Update (${formattedDate})`
      );
    }

    return {
      success: true,
      postedCount: itemsToPost.length,
      message: `Digest berhasil diposting ke ${env.CHANNEL_ID} (${isFriday ? 'Edisi Recap Jumat' : 'Edisi Harian'}).`,
    };
  } else {
    console.error('[Scheduler] Failed to send to channel:', sendRes.description);
    return {
      success: false,
      postedCount: 0,
      message: `Gagal mengirim ke channel: ${sendRes.description}`,
    };
  }
}

export default {
  // Cloudflare Scheduled Event (Cron: 0 11 * * * = 18:00 WIB)
  async scheduled(
    event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    console.log(`[Cron Trigger] Fired at UTC ${new Date().toISOString()}`);
    ctx.waitUntil(executeDailyNewsPosting(env, false));
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

    // 2. Set Webhook Endpoint
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
      const { dateStr, isFriday, formattedDate } = getWibInfo();
      const [botInfo, webhookInfo, history, lastStats, paused, postedToday] = await Promise.all([
        getTelegramMe(env.TELEGRAM_TOKEN),
        getTelegramWebhookInfo(env.TELEGRAM_TOKEN),
        getRecentPostedHistory(env.AI_NEWS_KV),
        getLastDigestStats(env.AI_NEWS_KV),
        isPostingPaused(env.AI_NEWS_KV),
        hasPostedToday(env.AI_NEWS_KV, dateStr),
      ]);

      return Response.json({
        botInfo,
        webhookInfo,
        postingControl: {
          isPaused: paused,
          status: paused ? 'PAUSED (Posting Dihentikan)' : 'ACTIVE (Aktif)',
          hasPostedToday: postedToday,
          todayDateWIB: `${formattedDate} (${dateStr})`,
          isFridayWeeklyRecap: isFriday,
        },
        kvMemory: {
          storedNewsCount: history.length,
          lastDigest: lastStats,
          recentItems: history.slice(0, 5),
        },
        channelId: env.CHANNEL_ID,
        scheduledTime: 'Daily at 18:00 WIB (11:00 UTC)',
      });
    }

    // 4. Manual Trigger (Force post)
    if (url.pathname === '/api/trigger-news') {
      const force = url.searchParams.get('force') === 'true';
      const result = await executeDailyNewsPosting(env, force);
      return Response.json(result);
    }

    // 5. Dry Run / Preview Digest
    if (url.pathname === '/api/preview-news') {
      const { isFriday, formattedDate } = getWibInfo();
      const candidates = await fetchLatestAINews();
      const unposted = await filterUnpostedNews(env.AI_NEWS_KV, candidates);
      const targetCount = isFriday ? 10 : 5;
      const itemsToPost = unposted.length > 0 ? unposted.slice(0, targetCount) : candidates.slice(0, targetCount);
      const digestHtml = await generateDailyNewsDigest(env.AI, itemsToPost, isFriday);

      return Response.json({
        mode: isFriday ? 'WEEKLY RECAP (Jumat)' : 'DAILY AI UPDATE',
        dateWIB: formattedDate,
        totalCandidates: candidates.length,
        unpostedCandidates: unposted.length,
        selectedForDigest: itemsToPost.length,
        previewContent: digestHtml,
      });
    }

    // 6. Pause / Resume Web API Endpoints
    if (url.pathname === '/api/pause') {
      await setPostingPaused(env.AI_NEWS_KV, true);
      return Response.json({ ok: true, status: 'PAUSED' });
    }

    if (url.pathname === '/api/resume') {
      await setPostingPaused(env.AI_NEWS_KV, false);
      return Response.json({ ok: true, status: 'ACTIVE' });
    }

    // 7. Homepage Dashboard
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
    .btn-danger { background: #dc2626; }
    .btn-danger:hover { background: #b91c1c; }
    .btn-success { background: #16a34a; }
    .btn-success:hover { background: #15803d; }
    code { background: #0f172a; padding: 0.2rem 0.4rem; border-radius: 4px; font-size: 0.9em; color: #a5f3fc; }
  </style>
</head>
<body>
  <h1>🤖 Technokers AI Worker</h1>
  <div class="card">
    <p><span class="badge">ONLINE</span> Cloudflare Workers & Workers AI</p>
    <p>Bot ini aktif mengkurasi berita AI global secara otomatis untuk channel Telegram <a href="https://t.me/aicomindo" target="_blank"><b>@aicomindo</b></a>.</p>
    <p>⏰ <b>Jadwal Posting:</b> Tepat 1x sehari pukul <b>18:00 WIB</b> (11:00 UTC).</p>
    <p>📅 <b>Format Hari:</b></p>
    <ul>
      <li><b>Jumat:</b> Weekly Tech & AI Recap (7-10 Gebrakan AI terbesar seminggu).</li>
      <li><b>Hari Lain:</b> Daily AI Update (3-5 Berita paling berdampak).</li>
    </ul>
    <p>🛡️ <b>Anti-Spam & Kunci Harian:</b> Diproteksi kunci harian di Cloudflare KV agar tidak pernah posting ganda.</p>
  </div>

  <div class="card">
    <h3>🔗 Quick Action Endpoints</h3>
    <a class="btn" href="/telegram/status" target="_blank">Cek Status & Memory KV</a>
    <a class="btn" href="/api/preview-news" target="_blank">Preview Berita Hari Ini</a>
    <a class="btn btn-danger" href="/api/pause" target="_blank">🛑 Pause Posting</a>
    <a class="btn btn-success" href="/api/resume" target="_blank">🟢 Resume Posting</a>
    <a class="btn" href="https://t.me/tckn_bot" target="_blank">Chat @tckn_bot</a>
  </div>
</body>
</html>`,
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  },
};
