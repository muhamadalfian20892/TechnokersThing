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
  getActiveModel,
  setActiveModel,
  getUsageStats,
  getInjectedNews,
  clearInjectedNews,
  getDailyChatLimit,
  setDailyChatLimit,
  verifyAndConsumeDashboardOtp,
  verifyDashboardSession,
  revokeDashboardSession,
} from './news/memory';
import { generateDailyNewsDigest, getWibInfo } from './news/generator';
import { fetchAllAvailableModels } from './news/models';

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

  // 2. Strict One-Post-Per-Day Lock
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
  const [candidates, injected] = await Promise.all([
    fetchLatestAINews(),
    getInjectedNews(env.AI_NEWS_KV),
  ]);

  const mergedNews = [...injected, ...candidates];
  const unposted = await filterUnpostedNews(env.AI_NEWS_KV, mergedNews);

  const targetCount = isFriday ? 10 : 5;
  let itemsToPost = unposted.slice(0, targetCount);

  if (itemsToPost.length < (isFriday ? 5 : 3) && mergedNews.length > 0) {
    itemsToPost = mergedNews.slice(0, targetCount);
  }

  // Generate in-depth narrative digest
  console.log(`[Scheduler] Generating digest for ${itemsToPost.length} items (isFriday=${isFriday})...`);
  const digestHtml = await generateDailyNewsDigest(env, itemsToPost, isFriday);

  // Publish to Telegram Channel
  console.log(`[Scheduler] Publishing to channel ${env.CHANNEL_ID}...`);
  const sendRes = await sendTelegramMessage(env.TELEGRAM_TOKEN, env.CHANNEL_ID, digestHtml);

  if (sendRes.ok) {
    console.log(`[Scheduler] Successfully posted to ${env.CHANNEL_ID}`);
    await markPostedToday(env.AI_NEWS_KV, dateStr);

    if (itemsToPost.length > 0) {
      await recordPostedNews(
        env.AI_NEWS_KV,
        itemsToPost,
        isFriday ? `Weekly Recap (${formattedDate})` : `Daily Update (${formattedDate})`
      );
    }

    if (injected.length > 0) {
      await clearInjectedNews(env.AI_NEWS_KV);
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

function getSessionTokenFromRequest(request: Request): string {
  const cookieHeader = request.headers.get('Cookie') || '';
  const match = /auth_session=([a-f0-9]+)/.exec(cookieHeader);
  return match ? match[1] : '';
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
    const clientIp = request.headers.get('cf-connecting-ip') || '127.0.0.1';

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

    // 3. Webhook & Bot Diagnostics API
    if (url.pathname === '/telegram/status') {
      const { dateStr, isFriday, formattedDate } = getWibInfo();
      const [botInfo, webhookInfo, history, lastStats, paused, postedToday, activeModel, usage, chatLimit] =
        await Promise.all([
          getTelegramMe(env.TELEGRAM_TOKEN),
          getTelegramWebhookInfo(env.TELEGRAM_TOKEN),
          getRecentPostedHistory(env.AI_NEWS_KV),
          getLastDigestStats(env.AI_NEWS_KV),
          isPostingPaused(env.AI_NEWS_KV),
          hasPostedToday(env.AI_NEWS_KV, dateStr),
          getActiveModel(env.AI_NEWS_KV),
          getUsageStats(env.AI_NEWS_KV),
          getDailyChatLimit(env.AI_NEWS_KV),
        ]);

      return Response.json({
        botInfo,
        webhookInfo,
        activeModel,
        userChatLimit: chatLimit === 0 ? 'Unlimited (0)' : chatLimit,
        postingControl: {
          isPaused: paused,
          status: paused ? 'PAUSED' : 'ACTIVE',
          hasPostedToday: postedToday,
          todayDateWIB: `${formattedDate} (${dateStr})`,
          isFridayWeeklyRecap: isFriday,
        },
        usageMetrics: usage,
        kvMemory: {
          storedNewsCount: history.length,
          lastDigest: lastStats,
          recentItems: history.slice(0, 5),
        },
        channelId: env.CHANNEL_ID,
        scheduledTime: 'Daily at 18:00 WIB (11:00 UTC)',
      });
    }

    // 4. Models Catalog API
    if (url.pathname === '/api/models') {
      const models = await fetchAllAvailableModels(env);
      const activeModel = await getActiveModel(env.AI_NEWS_KV);
      return Response.json({ activeModel, models });
    }

    // 5. Usage & Quota Monitor API
    if (url.pathname === '/api/usage') {
      const stats = await getUsageStats(env.AI_NEWS_KV);
      return Response.json({
        stats,
        freeTierDailyNeuronsQuota: 10000,
        quotaUsedPercentage: Math.min(100, (stats.neuronsEstimated / 10000) * 100),
      });
    }

    // 6. System Health Check API
    if (url.pathname === '/api/health') {
      const t0 = Date.now();
      await env.AI_NEWS_KV.get('config:active_model');
      const kvMs = Date.now() - t0;
      return Response.json({
        status: 'healthy',
        kvLatencyMs: kvMs,
        backupProvider: env.BACKUP_AI_URL,
        uptime: 'Cloudflare Edge Global',
      });
    }

    // 7. Manual Trigger (Force post)
    if (url.pathname === '/api/trigger-news') {
      const force = url.searchParams.get('force') === 'true';
      const result = await executeDailyNewsPosting(env, force);
      return Response.json(result);
    }

    // 8. Dry Run / Preview Digest
    if (url.pathname === '/api/preview-news') {
      const { isFriday, formattedDate } = getWibInfo();
      const candidates = await fetchLatestAINews();
      const unposted = await filterUnpostedNews(env.AI_NEWS_KV, candidates);
      const targetCount = isFriday ? 10 : 5;
      const itemsToPost = unposted.length > 0 ? unposted.slice(0, targetCount) : candidates.slice(0, targetCount);
      const digestHtml = await generateDailyNewsDigest(env, itemsToPost, isFriday);

      return Response.json({
        mode: isFriday ? 'WEEKLY RECAP (Jumat - 10 Gebrakan)' : 'DAILY AI UPDATE (5 Terobosan)',
        dateWIB: formattedDate,
        totalCandidates: candidates.length,
        unpostedCandidates: unposted.length,
        selectedForDigest: itemsToPost.length,
        previewContent: digestHtml,
      });
    }

    // ==========================================
    // 9. DASHBOARD LOGIN & AUTHENTICATION
    // ==========================================

    // Handle Login POST
    if (url.pathname === '/login' && request.method === 'POST') {
      try {
        let code = '';
        const contentType = request.headers.get('content-type') || '';
        if (contentType.includes('application/x-www-form-urlencoded')) {
          const formData = await request.formData();
          code = String(formData.get('code') || '');
        } else {
          const body = (await request.json()) as { code?: string };
          code = body.code || '';
        }

        const verifyRes = await verifyAndConsumeDashboardOtp(env.AI_NEWS_KV, code, clientIp);

        if (!verifyRes.ok) {
          return new Response(renderLoginPage(verifyRes.error), {
            status: 401,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          });
        }

        // Set 24h HTTP-only cookie and redirect to dashboard
        return new Response('', {
          status: 302,
          headers: {
            Location: '/',
            'Set-Cookie': `auth_session=${verifyRes.sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`,
          },
        });
      } catch (err) {
        return new Response(renderLoginPage('Terjadi kesalahan saat memproses login.'), {
          status: 500,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }
    }

    // Handle Logout
    if (url.pathname === '/logout') {
      const sessionToken = getSessionTokenFromRequest(request);
      await revokeDashboardSession(env.AI_NEWS_KV, sessionToken);
      return new Response('', {
        status: 302,
        headers: {
          Location: '/',
          'Set-Cookie': `auth_session=; Path=/; HttpOnly; Max-Age=0`,
        },
      });
    }

    // ==========================================
    // 10. AUTHENTICATED DASHBOARD ACTIONS
    // ==========================================
    const sessionToken = getSessionTokenFromRequest(request);
    const isAuthenticated = await verifyDashboardSession(env.AI_NEWS_KV, sessionToken);

    // Dashboard Action: Switch Model
    if (url.pathname === '/dashboard/set-model' && request.method === 'POST') {
      if (!isAuthenticated) return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
      const body = (await request.json()) as { model: string };
      if (body.model) {
        await setActiveModel(env.AI_NEWS_KV, body.model);
        return Response.json({ ok: true, activeModel: body.model });
      }
      return Response.json({ ok: false, error: 'Model required' }, { status: 400 });
    }

    // Dashboard Action: Set User Chat Limit
    if (url.pathname === '/dashboard/set-limit' && request.method === 'POST') {
      if (!isAuthenticated) return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
      const body = (await request.json()) as { limit: number };
      if (typeof body.limit === 'number') {
        await setDailyChatLimit(env.AI_NEWS_KV, body.limit);
        return Response.json({ ok: true, limit: body.limit });
      }
      return Response.json({ ok: false, error: 'Limit required' }, { status: 400 });
    }

    // Dashboard Action: Toggle Pause
    if (url.pathname === '/dashboard/toggle-pause' && request.method === 'POST') {
      if (!isAuthenticated) return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
      const current = await isPostingPaused(env.AI_NEWS_KV);
      await setPostingPaused(env.AI_NEWS_KV, !current);
      return Response.json({ ok: true, isPaused: !current });
    }

    // ==========================================
    // 11. HOMEPAGE / DASHBOARD RENDER
    // ==========================================
    if (!isAuthenticated) {
      return new Response(renderLoginPage(), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    // Render Authenticated Admin Dashboard
    const { dateStr, isFriday, formattedDate } = getWibInfo();
    const [paused, postedToday, activeModel, currentLimit, usage, models] = await Promise.all([
      isPostingPaused(env.AI_NEWS_KV),
      hasPostedToday(env.AI_NEWS_KV, dateStr),
      getActiveModel(env.AI_NEWS_KV),
      getDailyChatLimit(env.AI_NEWS_KV),
      getUsageStats(env.AI_NEWS_KV),
      fetchAllAvailableModels(env),
    ]);

    const dashboardHtml = renderAdminDashboard({
      channelId: env.CHANNEL_ID,
      activeModel,
      isPaused: paused,
      postedToday,
      formattedDate,
      isFriday,
      currentLimit,
      usage,
      models,
    });

    return new Response(dashboardHtml, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  },
};

// ==========================================
// HTML TEMPLATES
// ==========================================

function renderLoginPage(errorMessage?: string): string {
  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Login - Technokers Admin Dashboard</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0b1329; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 1rem; }
    .card { background: #16203a; border: 1px solid #293859; border-radius: 16px; padding: 2.5rem 2rem; width: 100%; max-width: 440px; box-shadow: 0 20px 40px rgba(0,0,0,0.4); text-align: center; }
    h2 { margin-top: 0; color: #38bdf8; display: flex; align-items: center; justify-content: center; gap: 0.5rem; }
    p { color: #94a3b8; font-size: 0.95rem; line-height: 1.5; }
    .input-group { margin: 1.5rem 0; text-align: left; }
    label { display: block; font-size: 0.85rem; color: #cbd5e1; margin-bottom: 0.5rem; font-weight: 600; }
    input[type="text"] { width: 100%; padding: 0.85rem 1rem; font-size: 1.25rem; letter-spacing: 4px; text-align: center; background: #0b1329; border: 1px solid #38bdf8; border-radius: 10px; color: #38bdf8; font-weight: bold; font-family: monospace; }
    input[type="text"]:focus { outline: none; border-color: #0284c7; box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.25); }
    button { width: 100%; padding: 0.85rem; font-size: 1rem; font-weight: 600; color: white; background: #0284c7; border: none; border-radius: 10px; cursor: pointer; transition: background 0.2s; }
    button:hover { background: #0369a1; }
    .error { background: #7f1d1d; color: #fecaca; border: 1px solid #b91c1c; border-radius: 8px; padding: 0.75rem; margin-bottom: 1.25rem; font-size: 0.9rem; }
    .info-box { background: #0f1d3a; border: 1px dashed #38bdf8; border-radius: 10px; padding: 1rem; margin-top: 1.5rem; text-align: left; font-size: 0.85rem; color: #93c5fd; }
    .info-box code { color: #fef08a; background: #1e293b; padding: 0.2rem 0.4rem; border-radius: 4px; font-weight: bold; }
  </style>
</head>
<body>
  <div class="card">
    <h2>🔐 Admin Authenticator</h2>
    <p>Akses khusus Administrator <b>@alfian04121</b>. Masukkan kode otentikasi sekali pakai.</p>

    ${errorMessage ? `<div class="error">${errorMessage}</div>` : ''}

    <form method="POST" action="/login">
      <div class="input-group">
        <label for="code">KODE AKSES (6 DIGIT)</label>
        <input type="text" id="code" name="code" maxlength="8" placeholder="123456" autofocus required autocomplete="off">
      </div>
      <button type="submit">Verifikasi & Masuk Dashboard</button>
    </form>

    <div class="info-box">
      <b>💡 Cara Mendapatkan Kode:</b><br>
      Buka Telegram dan chat ke <a href="https://t.me/tckn_bot" target="_blank" style="color: #38bdf8;">@tckn_bot</a>, lalu ketik perintah <code>/dashboard_code</code>.<br>
      <i>Kode valid 5 menit dan langsung hangus setelah login (maks 3x percobaan).</i>
    </div>
  </div>
</body>
</html>`;
}

function renderAdminDashboard(data: {
  channelId: string;
  activeModel: string;
  isPaused: boolean;
  postedToday: boolean;
  formattedDate: string;
  isFriday: boolean;
  currentLimit: number;
  usage: any;
  models: any[];
}): string {
  const cfModels = data.models.filter((m) => m.provider === 'cloudflare');
  const backupModels = data.models.filter((m) => m.provider === 'backup');

  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Technokers Admin Console Pro</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0b1329; color: #f8fafc; padding: 2rem 1rem; max-width: 960px; margin: 0 auto; line-height: 1.6; }
    header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #1e293b; padding-bottom: 1rem; margin-bottom: 2rem; }
    h1 { color: #38bdf8; margin: 0; font-size: 1.5rem; display: flex; align-items: center; gap: 0.5rem; }
    .badge { display: inline-block; background: #0284c7; color: white; padding: 0.25rem 0.6rem; border-radius: 9999px; font-size: 0.75rem; font-weight: bold; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1.25rem; margin-bottom: 1.5rem; }
    .card { background: #16203a; border-radius: 12px; padding: 1.25rem; border: 1px solid #293859; }
    .card h3 { margin-top: 0; color: #38bdf8; font-size: 1.1rem; display: flex; align-items: center; justify-content: space-between; }
    .stat-val { font-size: 1.4rem; font-weight: bold; margin: 0.5rem 0; }
    .btn { display: inline-block; background: #0284c7; color: white; padding: 0.5rem 1rem; border-radius: 8px; font-weight: 600; text-decoration: none; border: none; cursor: pointer; transition: 0.2s; font-size: 0.9rem; }
    .btn:hover { background: #0369a1; }
    .btn-danger { background: #dc2626; }
    .btn-danger:hover { background: #b91c1c; }
    .btn-success { background: #16a34a; }
    .btn-success:hover { background: #15803d; }
    .btn-secondary { background: #334155; }
    .btn-secondary:hover { background: #475569; }
    select, input[type="number"] { width: 100%; padding: 0.6rem; background: #0b1329; border: 1px solid #334155; border-radius: 8px; color: #f8fafc; font-size: 0.95rem; margin-bottom: 0.75rem; }
    code { background: #0b1329; padding: 0.2rem 0.4rem; border-radius: 4px; color: #7dd3fc; font-family: monospace; }
  </style>
</head>
<body>
  <header>
    <h1>🤖 Technokers Admin Console <span class="badge">ADMIN</span></h1>
    <div>
      <a class="btn btn-secondary" href="/logout">Logout</a>
    </div>
  </header>

  <div class="grid">
    <div class="card">
      <h3>⏰ Jadwal & Scheduler <span class="badge">${data.isPaused ? 'PAUSED' : 'ACTIVE'}</span></h3>
      <p>Target: <b>${data.channelId}</b></p>
      <p>Jadwal: <b>1x Sehari (18:00 WIB)</b></p>
      <p>Status Hari Ini: <b>${data.postedToday ? '✅ Sudah Diposting' : '⏳ Belum / Menunggu'}</b></p>
      <button class="btn ${data.isPaused ? 'btn-success' : 'btn-danger'}" onclick="togglePause()">
        ${data.isPaused ? '🟢 Resume Posting' : '🛑 Pause Posting'}
      </button>
    </div>

    <div class="card">
      <h3>🧠 Model AI Aktif</h3>
      <p>ID: <code>${data.activeModel}</code></p>
      <p>Provider: <b>${data.activeModel.startsWith('@cf/') ? 'Cloudflare Workers AI' : 'Backup OpenAI API'}</b></p>
      <p>Edisi Hari Ini: <b>${data.isFriday ? 'Weekly Tech Recap (10 Berita)' : 'Daily Update (5 Berita)'}</b></p>
    </div>

    <div class="card">
      <h3>🛡️ Limit Chat User (Anti-Abuse)</h3>
      <p>Batas Saat Ini: <b>${data.currentLimit === 0 ? 'Disabled (Unlimited)' : `${data.currentLimit} chat/hari`}</b></p>
      <div style="display: flex; gap: 0.5rem;">
        <input type="number" id="newLimit" value="${data.currentLimit}" min="0" max="200" style="margin-bottom: 0;">
        <button class="btn" onclick="saveLimit()">Simpan</button>
      </div>
      <small style="color: #94a3b8; display: block; margin-top: 0.4rem;">Masukkan <code>0</code> untuk menonaktifkan limit.</small>
    </div>

    <div class="card">
      <h3>📊 Pemakaian Kuota Hari Ini</h3>
      <p>Cloudflare AI Runs: <b>${data.usage.aiGenerations || 0} kali</b></p>
      <p>Backup AI Runs: <b>${data.usage.backupAiRequests || 0} kali</b></p>
      <p>Estimasi Neurons: <b>${data.usage.neuronsEstimated || 0} / 10.000</b></p>
      <small style="color: #94a3b8;">*Otomatis failover ke Backup API jika limit habis.</small>
    </div>
  </div>

  <div class="card" style="margin-bottom: 1.5rem;">
    <h3>🔄 Ganti Model AI (Cloudflare & Backup Provider)</h3>
    <label style="display:block; margin-bottom: 0.5rem; font-size: 0.9rem; color: #94a3b8;">Pilih model untuk posting harian dan chat bot:</label>
    <select id="modelSelector">
      <optgroup label="☁️ Cloudflare Workers AI">
        ${cfModels.map((m) => `<option value="${m.id}" ${m.id === data.activeModel ? 'selected' : ''}>${m.id} (${m.author})</option>`).join('')}
      </optgroup>
      <optgroup label="🔄 Backup OpenAI Compatible API (api.mrido1.my.id)">
        ${backupModels.map((m) => `<option value="${m.id}" ${m.id === data.activeModel ? 'selected' : ''}>${m.id} (${m.author})</option>`).join('')}
      </optgroup>
    </select>
    <button class="btn" onclick="switchModel()">Terapkan Model Ini</button>
  </div>

  <div class="card">
    <h3>⚡ Aksi Cepat Berita</h3>
    <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
      <a class="btn" href="/api/preview-news" target="_blank">🔍 Preview Draf Berita Hari Ini</a>
      <button class="btn btn-danger" onclick="triggerPostNow()">🚀 Paksa Posting Sekarang ke Channel</button>
      <a class="btn btn-secondary" href="/telegram/status" target="_blank">📊 Raw Status API</a>
      <a class="btn btn-secondary" href="https://t.me/tckn_bot" target="_blank">Buka Telegram @tckn_bot</a>
    </div>
  </div>

  <script>
    async function togglePause() {
      const res = await fetch('/dashboard/toggle-pause', { method: 'POST' });
      if (res.ok) location.reload();
    }

    async function saveLimit() {
      const limit = parseInt(document.getElementById('newLimit').value, 10);
      const res = await fetch('/dashboard/set-limit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit })
      });
      if (res.ok) {
        alert('Limit berhasil diperbarui menjadi: ' + (limit === 0 ? 'Unlimited' : limit + ' chat/hari'));
        location.reload();
      }
    }

    async function switchModel() {
      const model = document.getElementById('modelSelector').value;
      const res = await fetch('/dashboard/set-model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model })
      });
      if (res.ok) {
        alert('Model berhasil diubah menjadi: ' + model);
        location.reload();
      }
    }

    async function triggerPostNow() {
      if (confirm('Kirim digest berita sekarang juga ke channel ${data.channelId}?')) {
        const res = await fetch('/api/trigger-news?force=true');
        const json = await res.json();
        alert(json.message);
        location.reload();
      }
    }
  </script>
</body>
</html>`;
}
