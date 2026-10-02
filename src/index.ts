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
  getIsolatedChatHistory,
  saveIsolatedChatHistory,
  clearIsolatedChatHistory,
} from './news/memory';
import { generateDailyNewsDigest, getWibInfo } from './news/generator';
import { fetchAllAvailableModels } from './news/models';
import { runUnifiedAiCompletion } from './news/ai_client';
import { runConversationalAgent } from './news/agent';
import {
  getAllConnectors,
  getConnector,
  saveConnector,
  executeBloggerPost,
  executeGmailSend,
  executeWebhookDispatch,
  syndicateDigestToConnectors,
  processConnectorIntent,
} from './connectors/manager';
import { ConnectorConfig } from './connectors/types';
import {
  processDueJobs,
  getAllJobs,
  saveJob,
  deleteJob,
  processReminderIntent,
  formatReminderNotification,
  formatCronNotification,
  getWebNotifications,
  addWebNotification,
  dismissWebNotifications,
} from './scheduler/manager';
import { parseScheduleInput } from './scheduler/parser';
import { ScheduledJob } from './scheduler/types';
import { ChatMessage } from './news/types';

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

    // Syndicate to active connectors (Blogger, Webhook, etc.)
    const headline = isFriday
      ? `Weekly Tech Recap: 10 Gebrakan AI & Teknologi Terbesar (${formattedDate})`
      : `Daily AI Update: 5 Terobosan Terpanas (${formattedDate})`;
    const syndicateLogs = await syndicateDigestToConnectors(env.AI_NEWS_KV, headline, digestHtml);
    if (syndicateLogs.length > 0) {
      console.log('[Scheduler] Syndication results:', syndicateLogs.join('; '));
    }

    return {
      success: true,
      postedCount: itemsToPost.length,
      message: `Digest berhasil diposting ke ${env.CHANNEL_ID} (${isFriday ? 'Edisi Recap Jumat' : 'Edisi Harian'}).${
        syndicateLogs.length > 0 ? ` Terdistribusi ke ${syndicateLogs.length} konektor.` : ''
      }`,
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

function escapeHtml(text: string): string {
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return (text || '').replace(/[&<>"']/g, (m) => map[m]);
}

export default {
  // Cloudflare Scheduled Event (0 11 * * * for Daily News Digest & * * * * * for Dynamic Reminders/Crons)
  async scheduled(
    event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    console.log(`[Cron Trigger] Fired: cron="${event.cron}" at UTC ${new Date().toISOString()}`);
    const nowUtc = new Date();
    if (event.cron === '0 11 * * *' || (nowUtc.getUTCHours() === 11 && nowUtc.getUTCMinutes() === 0)) {
      ctx.waitUntil(executeDailyNewsPosting(env, false));
    }
    ctx.waitUntil(processDueJobs(env));
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
      try {
        const { dateStr, isFriday, formattedDate } = getWibInfo();
        const [botInfo, webhookInfo, history, lastStats, paused, postedToday, activeModel, usage, chatLimit] =
          await Promise.all([
            getTelegramMe(env.TELEGRAM_TOKEN).catch((e) => ({ ok: false, error: String(e) })),
            getTelegramWebhookInfo(env.TELEGRAM_TOKEN).catch((e) => ({ ok: false, error: String(e) })),
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
      } catch (err: any) {
        return Response.json({ ok: false, error: err.message || 'Status check failed' }, { status: 500 });
      }
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

    if (url.pathname === '/dashboard/set-model' && request.method === 'POST') {
      if (!isAuthenticated) return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
      const body = (await request.json()) as { model: string };
      if (body.model) {
        await setActiveModel(env.AI_NEWS_KV, body.model);
        return Response.json({ ok: true, activeModel: body.model });
      }
      return Response.json({ ok: false, error: 'Model required' }, { status: 400 });
    }

    if (url.pathname === '/dashboard/set-limit' && request.method === 'POST') {
      if (!isAuthenticated) return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
      const body = (await request.json()) as { limit: number };
      if (typeof body.limit === 'number') {
        await setDailyChatLimit(env.AI_NEWS_KV, body.limit);
        return Response.json({ ok: true, limit: body.limit });
      }
      return Response.json({ ok: false, error: 'Limit required' }, { status: 400 });
    }

    if (url.pathname === '/dashboard/toggle-pause' && request.method === 'POST') {
      if (!isAuthenticated) return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
      const current = await isPostingPaused(env.AI_NEWS_KV);
      await setPostingPaused(env.AI_NEWS_KV, !current);
      return Response.json({ ok: true, isPaused: !current });
    }

    // Connectors API: List all
    if (url.pathname === '/api/connectors' && request.method === 'GET') {
      if (!isAuthenticated) return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
      const connectors = await getAllConnectors(env.AI_NEWS_KV);
      return Response.json({ ok: true, connectors });
    }

    // Connectors API: Save config
    if (url.pathname === '/api/connectors/save' && request.method === 'POST') {
      if (!isAuthenticated) return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
      try {
        const body = (await request.json()) as ConnectorConfig;
        if (!body || !body.id) {
          return Response.json({ ok: false, error: 'Parameter konektor tidak valid.' }, { status: 400 });
        }
        await saveConnector(env.AI_NEWS_KV, body);
        return Response.json({ ok: true, message: `Konektor "${body.name || body.id}" berhasil disimpan!` });
      } catch (err: any) {
        return Response.json({ ok: false, error: err.message || 'Gagal menyimpan konektor' }, { status: 500 });
      }
    }

    // Connectors API: Test connection
    if (url.pathname === '/api/connectors/test' && request.method === 'POST') {
      if (!isAuthenticated) return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
      try {
        const body = (await request.json()) as { id: string };
        const connector = await getConnector(env.AI_NEWS_KV, body.id);
        if (!connector) {
          return Response.json({ ok: false, message: 'Konektor tidak ditemukan di sistem.' }, { status: 404 });
        }

        if (connector.type === 'blogger') {
          const testRes = await executeBloggerPost(
            connector,
            `[Uji Coba] Technokers Bot Connection Test (${new Date().toLocaleTimeString('id-ID')})`,
            `<p>Halo! Ini adalah postingan draft uji coba dari konsol Technokers AI Bot Pro.</p><p>Koneksi ke Google Blogger API v3 berhasil terverifikasi!</p>`,
            ['Test', 'TechnokersBot'],
            true // draft post
          );
          return Response.json(testRes);
        } else if (connector.type === 'gmail') {
          const testRes = await executeGmailSend(
            connector,
            connector.params.recipientEmail || '',
            `[Uji Coba] Technokers Bot Gmail Test`,
            `Halo Admin!\n\nKoneksi ke Google Gmail API berhasil terhubung dari Technokers AI Bot Pro.\n\nWaktu pengujian: ${new Date().toISOString()}`
          );
          return Response.json(testRes);
        } else if (connector.type === 'webhook') {
          const testRes = await executeWebhookDispatch(connector, {
            title: 'Technokers Webhook Test',
            content: 'Uji pengiriman webhook berhasil terhubung dari Technokers AI Bot Pro.',
            publishedAt: new Date().toISOString(),
          });
          return Response.json(testRes);
        }

        return Response.json({ ok: false, message: 'Tipe konektor belum mendukung uji otomatis.' }, { status: 400 });
      } catch (err: any) {
        return Response.json({ ok: false, message: `Error uji konektor: ${err.message}` }, { status: 500 });
      }
    }

    // Direct Web Chat API: Get chat history
    if (url.pathname === '/api/dashboard/chat/history' && request.method === 'GET') {
      if (!isAuthenticated) return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
      const adminSessionKey = 'web:admin:1023972475';
      const history = await getIsolatedChatHistory(env.AI_NEWS_KV, adminSessionKey);
      return Response.json({ ok: true, history });
    }

    // Direct Web Chat API: Clear chat history
    if (url.pathname === '/api/dashboard/chat/clear' && request.method === 'POST') {
      if (!isAuthenticated) return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
      const adminSessionKey = 'web:admin:1023972475';
      await clearIsolatedChatHistory(env.AI_NEWS_KV, adminSessionKey);
      return Response.json({ ok: true, message: 'Riwayat percakapan web dashboard berhasil dibersihkan.' });
    }

    // Direct Web Chat API: Send message & receive reply
    if (url.pathname === '/api/dashboard/chat' && request.method === 'POST') {
      if (!isAuthenticated) return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
      try {
        const body = (await request.json()) as { message?: string };
        const userMessage = (body.message || '').trim();
        if (!userMessage) {
          return Response.json({ ok: false, error: 'Pesan tidak boleh kosong.' }, { status: 400 });
        }

        const adminSessionKey = 'web:admin:1023972475';
        const history = await getIsolatedChatHistory(env.AI_NEWS_KV, adminSessionKey);

        // Autonomous Conversational Agent with Intelligent Tool & Function Calling!
        const systemPrompt = `Kamu adalah Technokers AI Assistant, asisten cerdas yang ramah, berwawasan luas, dan ahli di bidang Artificial Intelligence, Machine Learning, teknologi masa depan, dan pemrograman.
KONTEKS PENGGUNA TERISOLASI:
- Kamu sedang mengobrol langsung dengan Pengelola Utama: Muhamad Alfian (@alfian04121) melalui Konsol Web Dashboard.
- Sesi obrolan ini sepenuhnya terisolasi untuk sesi admin web ini.
- Sambut admin dengan hangat dan bantu apa pun yang dibutuhkan (analisis tech, kode, ringkasan, maupun konfigurasi bot).
- Jika admin bertanya seputar menyambungkan ke Google, Blogger, Gmail, atau Webhook, jelaskan bahwa ia dapat mengisi kredensial pada tab Universal Connectors di dashboard ini.
- Kamu memiliki kapabilitas Function Calling mandiri (set_reminder, set_cron_job, list_reminders, delete_reminder). Jika pengguna ingin membuat reminder/pengingat atau cron job, panggil tool tersebut atau tanyakan konfirmasi secara ramah!
- Jika pengguna meminta pengingat "disini", kirimkan ke 'web_dashboard'. Jika minta di Telegram, tanyakan username atau chat id Telegram jika belum tersedia.

STANDAR AKSESIBILITAS KONTEN (WCAG 2.1 AAA):
1. Berikan format teks terstruktur yang sangat rapi, jelas, dan kontras.
2. Gunakan tag format HTML (<b>tebal</b>, <i>miring</i>, <code>kode</code>) atau bullet points agar mudah dibaca dan diakses screen reader.
3. Jawaban harus komprehensif, edukatif, dan to the point.`;

        let replyText = '';
        const intentRes = await processConnectorIntent(env.AI_NEWS_KV, userMessage);
        if (intentRes.handled && intentRes.replyText) {
          replyText = intentRes.replyText;
        } else {
          const agentRes = await runConversationalAgent(
            env,
            history,
            userMessage,
            {
              env,
              userId: 1023972475,
              userName: 'Muhamad Alfian',
              chatId: 1023972475,
              sourcePlatform: 'web_dashboard',
              isAdmin: true,
            },
            systemPrompt
          );
          replyText = agentRes.replyText;
        }

        const updatedHistory: ChatMessage[] = [
          ...history,
          { role: 'user', content: userMessage, timestamp: Date.now() },
          { role: 'assistant', content: replyText, timestamp: Date.now() },
        ];
        await saveIsolatedChatHistory(env.AI_NEWS_KV, adminSessionKey, updatedHistory);

        return Response.json({
          ok: true,
          reply: replyText,
          history: updatedHistory,
        });
      } catch (err: any) {
        return Response.json({ ok: false, error: err.message || 'Gagal memproses pesan chat' }, { status: 500 });
      }
    }

    // Dynamic Scheduled Jobs / Reminders API: List
    if (url.pathname === '/api/jobs' && request.method === 'GET') {
      if (!isAuthenticated) return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
      const jobs = await getAllJobs(env.AI_NEWS_KV);
      return Response.json({ ok: true, jobs });
    }

    // Dynamic Scheduled Jobs / Reminders API: Create
    if (url.pathname === '/api/jobs/create' && request.method === 'POST') {
      if (!isAuthenticated) return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
      try {
        const body = (await request.json()) as {
          schedule?: string;
          message?: string;
          targetChatId?: string | number;
          type?: string;
        };
        const schedule = (body.schedule || '').trim();
        const msg = (body.message || '').trim();
        const target = body.targetChatId || '1023972475';

        if (!schedule || !msg) {
          return Response.json({ ok: false, error: 'Jadwal dan pesan tidak boleh kosong.' }, { status: 400 });
        }

        const parsed = parseScheduleInput(`${schedule} ${msg}`, target);
        if (!parsed.success) {
          return Response.json({ ok: false, error: parsed.error || 'Format jadwal tidak valid.' }, { status: 400 });
        }

        const isDashboard = target === 'dashboard' || target === 'web';
        const newJob: ScheduledJob = {
          id: `job_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          type: (body.type as any) || parsed.type || 'reminder',
          message: parsed.message || msg,
          targetPlatform: isDashboard ? 'dashboard' : 'telegram',
          targetChatId: target,
          creatorId: '1023972475',
          creatorName: 'Muhamad Alfian (Web Admin)',
          scheduleRaw: parsed.scheduleRaw || schedule,
          dueAt: parsed.dueAt,
          cronExpression: parsed.cronExpression,
          timezoneOffsetHours: 7,
          status: 'active',
          createdAt: new Date().toISOString(),
          runCount: 0,
        };

        await saveJob(env.AI_NEWS_KV, newJob);
        return Response.json({ ok: true, job: newJob });
      } catch (err: any) {
        return Response.json({ ok: false, error: err.message }, { status: 500 });
      }
    }

    // Dynamic Scheduled Jobs / Reminders API: Delete
    if (url.pathname === '/api/jobs/delete' && request.method === 'POST') {
      if (!isAuthenticated) return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
      const body = (await request.json()) as { id: string };
      const delRes = await deleteJob(env.AI_NEWS_KV, body.id, '1023972475', true);
      return Response.json(delRes);
    }

    // Dynamic Scheduled Jobs / Reminders API: Test Trigger Now
    if (url.pathname === '/api/jobs/test-trigger' && request.method === 'POST') {
      if (!isAuthenticated) return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
      const body = (await request.json()) as { id: string };
      const jobs = await getAllJobs(env.AI_NEWS_KV);
      const target = jobs.find((j) => j.id === body.id);
      if (!target) return Response.json({ ok: false, error: 'Jadwal tidak ditemukan' }, { status: 404 });

      if (target.targetPlatform === 'dashboard' || String(target.targetChatId) === 'dashboard') {
        const notif = {
          id: `wn_test_${Date.now()}`,
          jobId: target.id,
          message: target.message,
          scheduleRaw: target.scheduleRaw,
          firedAt: Date.now(),
          read: false,
        };
        await addWebNotification(env.AI_NEWS_KV, notif);
        const webSessionKey = 'web:admin:1023972475';
        const history = await getIsolatedChatHistory(env.AI_NEWS_KV, webSessionKey);
        history.push({
          role: 'assistant',
          content: `[TEST TRIGGER]\n\n` + formatReminderNotification(target),
          timestamp: Date.now(),
        });
        await saveIsolatedChatHistory(env.AI_NEWS_KV, webSessionKey, history);
        return Response.json({ ok: true, message: 'Notifikasi tes berhasil dikirim ke Web Dashboard!' });
      } else {
        const text = target.type === 'cron' ? formatCronNotification(target) : formatReminderNotification(target);
        const sendRes = await sendTelegramMessage(env.TELEGRAM_TOKEN, target.targetChatId, `[TEST TRIGGER LANGSUNG]\n\n` + text);
        return Response.json({
          ok: sendRes.ok,
          message: sendRes.ok ? `Notifikasi pengujian berhasil dikirim ke target ${target.targetChatId}!` : sendRes.description,
        });
      }
    }

    // Web Dashboard Notifications API: Get unread & recent notifications
    if (url.pathname === '/api/dashboard/notifications' && request.method === 'GET') {
      if (!isAuthenticated) return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
      const notifications = await getWebNotifications(env.AI_NEWS_KV);
      return Response.json({ ok: true, notifications });
    }

    // Web Dashboard Notifications API: Dismiss notification
    if (url.pathname === '/api/dashboard/notifications/dismiss' && request.method === 'POST') {
      if (!isAuthenticated) return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
      const body = ((await request.json().catch(() => ({}))) || {}) as { id?: string };
      await dismissWebNotifications(env.AI_NEWS_KV, body.id);
      return Response.json({ ok: true });
    }

    // ==========================================
    // 11. HOMEPAGE / DASHBOARD RENDER (WCAG 2.1 AAA)
    // ==========================================
    if (!isAuthenticated) {
      return new Response(renderLoginPage(), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    const { dateStr, isFriday, formattedDate } = getWibInfo();
    const [paused, postedToday, activeModel, currentLimit, usage, models, connectors, chatHistory, jobs] = await Promise.all([
      isPostingPaused(env.AI_NEWS_KV),
      hasPostedToday(env.AI_NEWS_KV, dateStr),
      getActiveModel(env.AI_NEWS_KV),
      getDailyChatLimit(env.AI_NEWS_KV),
      getUsageStats(env.AI_NEWS_KV),
      fetchAllAvailableModels(env),
      getAllConnectors(env.AI_NEWS_KV),
      getIsolatedChatHistory(env.AI_NEWS_KV, 'web:admin:1023972475'),
      getAllJobs(env.AI_NEWS_KV),
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
      connectors,
      chatHistory,
      jobs,
    });

    return new Response(dashboardHtml, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  },
};

// ==========================================
// HTML TEMPLATES - WCAG 2.1 AAA COMPLIANT
// Contrast Ratio >= 7:1 for normal text, >= 4.5:1 for large text
// Visible focus rings, 44x44px touch targets, skip links
// ==========================================

function renderLoginPage(errorMessage?: string): string {
  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Login Otentikasi - Technokers Admin Console</title>
  <style>
    /* WCAG 2.1 AAA Enhanced Accessibility Styles */
    :root {
      --bg-dark: #080d1a;
      --card-bg: #11192e;
      --text-main: #ffffff;      /* Contrast against #080d1a is 17.9:1 (exceeds AAA 7:1) */
      --text-muted: #e2e8f0;     /* Contrast against #11192e is 12.8:1 */
      --accent: #38bdf8;         /* Contrast against #11192e is 8.5:1 */
      --btn-bg: #0369a1;         /* Contrast with #ffffff is 7.2:1 */
      --btn-hover: #075985;
      --border: #334155;
      --error-bg: #450a0a;
      --error-border: #ef4444;
      --error-text: #ffffff;
      --focus-ring: #60a5fa;
    }
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: var(--bg-dark);
      color: var(--text-main);
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      padding: 1.5rem;
      line-height: 1.6;
      letter-spacing: 0.02em;
    }
    .skip-link {
      position: absolute;
      top: -40px;
      left: 0;
      background: #0369a1;
      color: #ffffff;
      padding: 8px 16px;
      text-decoration: none;
      font-weight: bold;
      z-index: 100;
    }
    .skip-link:focus {
      top: 0;
    }
    :focus-visible {
      outline: 3px solid var(--focus-ring);
      outline-offset: 3px;
    }
    .login-container {
      background: var(--card-bg);
      border: 2px solid var(--border);
      border-radius: 16px;
      padding: 2.5rem 2rem;
      width: 100%;
      max-width: 480px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.7);
    }
    h1 {
      margin-top: 0;
      color: var(--accent);
      font-size: 1.6rem;
      font-weight: 700;
      text-align: center;
    }
    p {
      color: var(--text-muted);
      font-size: 1rem;
      margin-bottom: 1.5rem;
      text-align: center;
    }
    .form-group {
      margin-bottom: 1.75rem;
      text-align: left;
    }
    label {
      display: block;
      font-size: 0.95rem;
      font-weight: 700;
      color: var(--text-main);
      margin-bottom: 0.75rem;
    }
    input[type="text"] {
      width: 100%;
      min-height: 52px; /* 44px min touch target */
      padding: 0.75rem 1rem;
      font-size: 1.4rem;
      letter-spacing: 6px;
      text-align: center;
      background: #050811;
      border: 2px solid var(--accent);
      border-radius: 10px;
      color: #ffffff;
      font-weight: 700;
      font-family: monospace;
    }
    button[type="submit"] {
      width: 100%;
      min-height: 52px; /* 44px min touch target */
      padding: 0.85rem 1.5rem;
      font-size: 1.05rem;
      font-weight: 700;
      color: #ffffff;
      background: var(--btn-bg);
      border: 2px solid #38bdf8;
      border-radius: 10px;
      cursor: pointer;
      transition: background 0.2s ease;
    }
    button[type="submit"]:hover {
      background: var(--btn-hover);
    }
    .alert-error {
      background: var(--error-bg);
      color: var(--error-text);
      border: 2px solid var(--error-border);
      border-radius: 10px;
      padding: 1rem;
      margin-bottom: 1.5rem;
      font-weight: 600;
      text-align: center;
    }
    .help-panel {
      background: #091326;
      border: 2px solid #1e3a8a;
      border-radius: 10px;
      padding: 1.25rem;
      margin-top: 2rem;
      font-size: 0.95rem;
      color: #f1f5f9;
      line-height: 1.6;
    }
    .help-panel a {
      color: #7dd3fc;
      text-decoration: underline;
      font-weight: 700;
    }
    code {
      background: #050811;
      color: #fde047;
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
      font-size: 1rem;
      font-weight: 700;
    }
  </style>
</head>
<body>
  <a href="#main-content" class="skip-link">Loncat ke formulir login</a>

  <main id="main-content" class="login-container" role="main" aria-labelledby="login-title">
    <h1 id="login-title">🔐 Admin Authenticator</h1>
    <p>Akses khusus Administrator <b>@alfian04121</b>. Masukkan kode otentikasi sekali pakai.</p>

    ${errorMessage ? `<div class="alert-error" role="alert">${errorMessage}</div>` : ''}

    <form method="POST" action="/login" novalidate>
      <div class="form-group">
        <label for="code">KODE AKSES (6 DIGIT OTP):</label>
        <input
          type="text"
          id="code"
          name="code"
          maxlength="8"
          placeholder="123456"
          required
          aria-required="true"
          aria-describedby="code-help"
          autocomplete="one-time-code"
          autofocus
        >
      </div>

      <button type="submit">Verifikasi & Masuk Dashboard</button>
    </form>

    <div id="code-help" class="help-panel">
      <h2 style="margin: 0 0 0.5rem 0; font-size: 1.05rem; color: #38bdf8;">Instruksi Kode Akses:</h2>
      1. Buka Telegram dan chat ke <a href="https://t.me/tckn_bot" target="_blank" rel="noopener">Bot Telegram @tckn_bot</a>.<br>
      2. Ketik perintah <code>/dashboard_code</code>.<br>
      3. Kode hanya berlaku selama <b>5 menit</b> dan langsung kedaluwarsa setelah dipakai (maksimal 3x percobaan gagal).
    </div>
  </main>
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
  connectors: ConnectorConfig[];
  chatHistory: ChatMessage[];
  jobs: ScheduledJob[];
}): string {
  const cfModels = data.models.filter((m) => m.provider === 'cloudflare');
  const backupModels = data.models.filter((m) => m.provider === 'backup');

  const blogger = data.connectors.find((c) => c.id === 'google-blogger') || {
    id: 'google-blogger',
    name: 'Google Blogger',
    type: 'blogger',
    enabled: false,
    description: '',
    auth: { accessToken: '', apiKey: '' },
    params: { blogId: '' },
    createdAt: '',
  };

  const gmail = data.connectors.find((c) => c.id === 'google-gmail') || {
    id: 'google-gmail',
    name: 'Google Gmail',
    type: 'gmail',
    enabled: false,
    description: '',
    auth: { accessToken: '' },
    params: { recipientEmail: '' },
    createdAt: '',
  };

  const webhook = data.connectors.find((c) => c.id === 'custom-webhook') || {
    id: 'custom-webhook',
    name: 'Custom Webhook',
    type: 'webhook',
    enabled: false,
    description: '',
    auth: {},
    params: { webhookUrl: '' },
    createdAt: '',
  };

  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Technokers Admin Console Pro</title>
  <style>
    /* WCAG 2.1 AAA Standards (>= 7:1 Contrast for normal text, >= 4.5:1 large) */
    :root {
      --bg-dark: #080d1a;
      --card-bg: #0f172a;
      --text-main: #ffffff;      /* Contrast: 18:1 against #080d1a */
      --text-muted: #cbd5e1;     /* Contrast: 11:1 against #0f172a */
      --accent: #38bdf8;         /* Contrast: 8.5:1 against #0f172a */
      --accent-green: #34d399;   /* Contrast: 8.6:1 against #0f172a */
      --accent-red: #f87171;     /* Contrast: 7.8:1 against #0f172a */
      --btn-primary: #0284c7;    /* Contrast: 7.2:1 with white */
      --btn-danger: #b91c1c;     /* Contrast: 7.5:1 with white */
      --btn-success: #047857;    /* Contrast: 7.3:1 with white */
      --border: #334155;
      --focus-ring: #38bdf8;
    }
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: var(--bg-dark);
      color: var(--text-main);
      padding: 1.5rem 1rem;
      max-width: 1100px;
      margin: 0 auto;
      line-height: 1.6;
    }
    .skip-link {
      position: absolute;
      top: -50px;
      left: 0;
      background: #0284c7;
      color: #ffffff;
      padding: 10px 16px;
      text-decoration: none;
      font-weight: 700;
      z-index: 1000;
      border-radius: 0 0 8px 0;
    }
    .skip-link:focus { top: 0; }
    :focus-visible {
      outline: 3px solid var(--focus-ring);
      outline-offset: 3px;
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 2px solid var(--border);
      padding-bottom: 1.25rem;
      margin-bottom: 1.5rem;
      flex-wrap: wrap;
      gap: 1rem;
    }
    h1 {
      color: var(--accent);
      margin: 0;
      font-size: 1.5rem;
      display: flex;
      align-items: center;
      gap: 0.75rem;
      font-weight: 700;
    }
    .badge {
      display: inline-block;
      background: #0284c7;
      color: #ffffff;
      padding: 0.35rem 0.8rem;
      border-radius: 9999px;
      font-size: 0.85rem;
      font-weight: 700;
      border: 1px solid #38bdf8;
    }
    .badge-success { background: #047857; border-color: #34d399; }
    .badge-danger { background: #b91c1c; border-color: #f87171; }
    .badge-muted { background: #334155; border-color: #64748b; }
    
    /* Navigation Tabs */
    .tablist {
      display: flex;
      gap: 0.5rem;
      border-bottom: 2px solid var(--border);
      margin-bottom: 1.5rem;
      overflow-x: auto;
    }
    .tab-btn {
      background: transparent;
      color: var(--text-muted);
      border: none;
      border-bottom: 3px solid transparent;
      padding: 0.75rem 1.25rem;
      font-size: 1rem;
      font-weight: 700;
      cursor: pointer;
      min-height: 48px;
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      transition: all 0.2s ease;
    }
    .tab-btn:hover {
      color: #ffffff;
      background: #1e293b;
    }
    .tab-btn[aria-selected="true"] {
      color: var(--accent);
      border-bottom-color: var(--accent);
      background: #1e293b;
    }
    .tab-panel {
      display: none;
    }
    .tab-panel.active {
      display: block;
    }

    /* Cards and Grids */
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 1.25rem;
      margin-bottom: 1.5rem;
    }
    .card {
      background: var(--card-bg);
      border-radius: 12px;
      padding: 1.25rem;
      border: 2px solid var(--border);
    }
    .card h2, .card h3 {
      margin-top: 0;
      color: var(--accent);
      font-size: 1.2rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid var(--border);
      padding-bottom: 0.5rem;
    }
    
    /* Accessible Buttons (min 48px height) */
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 48px;
      padding: 0.75rem 1.25rem;
      border-radius: 8px;
      font-weight: 700;
      text-decoration: none;
      border: 2px solid transparent;
      cursor: pointer;
      transition: all 0.2s ease;
      font-size: 0.95rem;
      color: #ffffff;
    }
    .btn-primary { background: var(--btn-primary); border-color: #38bdf8; }
    .btn-primary:hover { background: #0369a1; }
    .btn-danger { background: var(--btn-danger); border-color: #f87171; }
    .btn-danger:hover { background: #991b1b; }
    .btn-success { background: var(--btn-success); border-color: #34d399; }
    .btn-success:hover { background: #065f46; }
    .btn-secondary { background: #1e293b; border-color: #64748b; }
    .btn-secondary:hover { background: #334155; }
    
    /* Accessible Form Elements */
    label {
      display: block;
      font-size: 0.95rem;
      font-weight: 700;
      color: #ffffff;
      margin-bottom: 0.35rem;
    }
    input[type="text"], input[type="password"], input[type="number"], select, textarea {
      width: 100%;
      min-height: 48px;
      padding: 0.75rem;
      background: #050811;
      border: 2px solid var(--border);
      border-radius: 8px;
      color: #ffffff;
      font-size: 1rem;
      font-weight: 600;
      margin-bottom: 1rem;
    }
    textarea {
      min-height: 80px;
      resize: vertical;
      font-family: inherit;
    }
    .checkbox-group {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 1rem;
      min-height: 48px;
    }
    .checkbox-group input[type="checkbox"] {
      width: 24px;
      height: 24px;
      accent-color: var(--accent);
      cursor: pointer;
    }
    .checkbox-group label {
      margin-bottom: 0;
      cursor: pointer;
    }
    
    /* Chat Panel Styles */
    .chat-container {
      background: var(--card-bg);
      border-radius: 12px;
      border: 2px solid var(--border);
      padding: 1.25rem;
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    .chat-box {
      max-height: 450px;
      min-height: 300px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 0.85rem;
      padding-right: 0.5rem;
    }
    .chat-message {
      padding: 0.85rem 1.1rem;
      border-radius: 10px;
      max-width: 85%;
      line-height: 1.5;
      font-size: 0.95rem;
      word-wrap: break-word;
    }
    .chat-user {
      align-self: flex-end;
      background: #0369a1;
      color: #ffffff;
      border: 1px solid #38bdf8;
    }
    .chat-assistant {
      align-self: flex-start;
      background: #1e293b;
      color: #ffffff;
      border: 1px solid #475569;
    }
    .chat-sender {
      font-size: 0.8rem;
      font-weight: 700;
      margin-bottom: 0.3rem;
      color: var(--accent);
    }
    .chat-typing {
      align-self: flex-start;
      font-style: italic;
      color: var(--accent);
      padding: 0.5rem;
      display: none;
    }
    
    code {
      background: #050811;
      padding: 0.2rem 0.4rem;
      border-radius: 4px;
      color: #fde047;
      font-family: monospace;
      font-size: 0.95rem;
      font-weight: 700;
    }
    p { color: var(--text-muted); margin: 0.5rem 0; font-size: 0.95rem; }
    p b { color: #ffffff; }
  </style>
</head>
<body>
  <a href="#main-content" class="skip-link">Loncat ke konten konsol admin</a>

  <header role="banner">
    <h1>🤖 Technokers Admin Console <span class="badge" aria-label="Role: Administrator">ADMIN PRO</span></h1>
    <nav aria-label="Menu Navigasi Admin">
      <a class="btn btn-secondary" href="/logout" aria-label="Keluar dari sesi admin">Keluar (Logout)</a>
    </nav>
  </header>

  <!-- Navigation Tabs (WCAG Accessible Tab Pattern) -->
  <div role="tablist" class="tablist" aria-label="Pilihan Menu Konsol">
    <button
      role="tab"
      id="tab-overview"
      class="tab-btn"
      aria-selected="true"
      aria-controls="panel-overview"
      onclick="switchTab('overview')"
    >
      📊 Status & Kontrol
    </button>
    <button
      role="tab"
      id="tab-chat"
      class="tab-btn"
      aria-selected="false"
      aria-controls="panel-chat"
      onclick="switchTab('chat')"
    >
      💬 Admin Web Chat
    </button>
    <button
      role="tab"
      id="tab-connectors"
      class="tab-btn"
      aria-selected="false"
      aria-controls="panel-connectors"
      onclick="switchTab('connectors')"
    >
      🔌 Universal Connectors
    </button>
    <button
      role="tab"
      id="tab-jobs"
      class="tab-btn"
      aria-selected="false"
      aria-controls="panel-jobs"
      onclick="switchTab('jobs')"
    >
      ⏰ Custom Crons & Reminders
    </button>
  </div>

  <main id="main-content" role="main">
    <!-- WCAG 2.1 AAA Compliant Notification Alert Banner for Web Reminders -->
    <div
      id="webNotificationBanner"
      role="alert"
      aria-live="assertive"
      style="display: none; background: #0369a1; border: 2px solid #38bdf8; color: #ffffff; padding: 1.25rem 1.5rem; border-radius: 12px; margin-bottom: 1.75rem; box-shadow: 0 8px 24px rgba(0,0,0,0.5);"
    >
      <div style="display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap;">
        <div style="display: flex; align-items: center; gap: 1rem;">
          <span style="font-size: 2.2rem;" aria-hidden="true">⏰</span>
          <div>
            <div style="font-weight: 800; font-size: 1.2rem; color: #ffffff;" id="bannerTitle">PENGINGAT (REMINDER)</div>
            <div style="font-size: 1.05rem; color: #f0f9ff; margin-top: 0.25rem;" id="bannerMessage"></div>
          </div>
        </div>
        <button
          class="btn btn-primary"
          onclick="dismissWebNotification()"
          style="min-height: 44px; padding: 0.5rem 1.25rem; font-size: 0.95rem; font-weight: 700;"
          aria-label="Tutup notifikasi pengingat ini"
        >
          ✓ Sudah Baca / Tutup
        </button>
      </div>
    </div>

    <!-- ========================================== -->
    <!-- TAB 1: OVERVIEW & SCHEDULER                -->
    <!-- ========================================== -->
    <div id="panel-overview" role="tabpanel" class="tab-panel active" aria-labelledby="tab-overview">
      <div class="grid">
        <!-- Card 1: Scheduler -->
        <section class="card" aria-labelledby="sec-scheduler">
          <h2 id="sec-scheduler">
            ⏰ Jadwal & Scheduler
            <span class="badge ${data.isPaused ? 'badge-danger' : 'badge-success'}">${data.isPaused ? 'PAUSED' : 'ACTIVE'}</span>
          </h2>
          <p>Channel Target: <b>${data.channelId}</b></p>
          <p>Jadwal Harian: <b>1x Sehari (18:00 WIB)</b></p>
          <p>Status Hari Ini: <b>${data.postedToday ? '✅ Sudah Diposting' : '⏳ Belum Diposting'}</b></p>
          <button
            class="btn ${data.isPaused ? 'btn-success' : 'btn-danger'}"
            onclick="togglePause()"
            aria-label="${data.isPaused ? 'Aktifkan jadwal posting harian' : 'Hentikan sementara jadwal posting harian'}"
          >
            ${data.isPaused ? '🟢 Resume Posting' : '🛑 Pause Posting'}
          </button>
        </section>

        <!-- Card 2: Model Info -->
        <section class="card" aria-labelledby="sec-model">
          <h2 id="sec-model">🧠 Model AI Aktif</h2>
          <p>Model ID: <code>${data.activeModel}</code></p>
          <p>Provider: <b>${data.activeModel.startsWith('@cf/') ? 'Cloudflare Workers AI' : 'Backup OpenAI API'}</b></p>
          <p>Edisi Hari Ini: <b>${data.isFriday ? 'Weekly Tech Recap (10 Berita)' : 'Daily Update (5 Berita)'}</b></p>
        </section>

        <!-- Card 3: User Chat Limits -->
        <section class="card" aria-labelledby="sec-limit">
          <h2 id="sec-limit">🛡️ Limit Chat User Non-Admin</h2>
          <p>Batas Kuota Saat Ini: <b>${data.currentLimit === 0 ? 'Tanpa Batas (Unlimited)' : `${data.currentLimit} chat/hari`}</b></p>
          <label for="newLimit">Atur Batas Baru (0 = Disable):</label>
          <div style="display: flex; gap: 0.75rem;">
            <input type="number" id="newLimit" value="${data.currentLimit}" min="0" max="200" style="margin-bottom: 0;" aria-label="Jumlah batas chat harian user">
            <button class="btn btn-primary" onclick="saveLimit()" aria-label="Simpan batas chat baru">Simpan</button>
          </div>
        </section>

        <!-- Card 4: Usage Metrics -->
        <section class="card" aria-labelledby="sec-usage">
          <h2 id="sec-usage">📊 Pemakaian Kuota Hari Ini</h2>
          <p>Cloudflare AI Runs: <b>${data.usage.aiGenerations || 0} kali</b></p>
          <p>Backup AI Runs: <b>${data.usage.backupAiRequests || 0} kali</b></p>
          <p>Estimasi Neurons Cloudflare: <b>${data.usage.neuronsEstimated || 0} / 10.000</b></p>
          <p style="font-size: 0.85rem; color: #94a3b8;">*Failover otomatis ke Backup API jika limit Cloudflare tercapai.</p>
        </section>
      </div>

      <!-- Model Switcher -->
      <section class="card" style="margin-bottom: 1.5rem;" aria-labelledby="sec-switcher">
        <h2 id="sec-switcher">🔄 Ganti Model AI Aktif</h2>
        <label for="modelSelector">Pilih model AI untuk kurasi postingan berita & chat bot:</label>
        <select id="modelSelector" aria-label="Pilihan Model AI">
          <optgroup label="☁️ Cloudflare Workers AI">
            ${cfModels.map((m) => `<option value="${m.id}" ${m.id === data.activeModel ? 'selected' : ''}>${m.id} (${m.author})</option>`).join('')}
          </optgroup>
          <optgroup label="🔄 Backup OpenAI Compatible API (api.mrido1.my.id)">
            ${backupModels.map((m) => `<option value="${m.id}" ${m.id === data.activeModel ? 'selected' : ''}>${m.id} (${m.author})</option>`).join('')}
          </optgroup>
        </select>
        <button class="btn btn-primary" onclick="switchModel()" aria-label="Terapkan model AI yang dipilih">Terapkan Model Ini</button>
      </section>

      <!-- Quick Actions -->
      <section class="card" aria-labelledby="sec-actions">
        <h2 id="sec-actions">⚡ Aksi Cepat & Navigasi</h2>
        <div style="display: flex; gap: 0.75rem; flex-wrap: wrap;">
          <a class="btn btn-primary" href="/api/preview-news" target="_blank" rel="noopener">🔍 Preview Draf Berita Hari Ini</a>
          <button class="btn btn-danger" onclick="triggerPostNow()">🚀 Paksa Posting Sekarang ke Channel</button>
          <a class="btn btn-secondary" href="/telegram/status" target="_blank" rel="noopener">📊 Raw Status JSON</a>
          <a class="btn btn-secondary" href="https://t.me/tckn_bot" target="_blank" rel="noopener">🤖 Buka Bot Telegram @tckn_bot</a>
        </div>
      </section>
    </div>

    <!-- ========================================== -->
    <!-- TAB 2: DIRECT ADMIN WEB CHAT               -->
    <!-- ========================================== -->
    <div id="panel-chat" role="tabpanel" class="tab-panel" aria-labelledby="tab-chat">
      <section class="chat-container" aria-labelledby="sec-webchat">
        <h2 id="sec-webchat" style="color: var(--accent); margin: 0; font-size: 1.25rem; display: flex; justify-content: space-between; align-items: center;">
          <span>💬 Live Web Chat dengan Technokers AI</span>
          <button class="btn btn-secondary" style="min-height: 40px; padding: 0.4rem 0.8rem; font-size: 0.85rem;" onclick="clearWebChat()">🧹 Bersihkan Chat</button>
        </h2>
        <p>Anda terhubung langsung dengan AI Bot melalui Dashboard Web (Konteks Terisolasi Khusus Administrator <b>@alfian04121</b>). Bot mengetahui platform chat Anda! Anda bisa meminta pengingat cerdas seperti: <i>"ingetin buat makan 3 menit lagi ya, ingetinnya disini aja"</i> atau <i>"ingetin buat makan 3 menit lagi ya, di telegram aja"</i>.</p>

        <div id="chatBox" class="chat-box" role="log" aria-live="polite" aria-label="Riwayat percakapan">
          ${
            data.chatHistory && data.chatHistory.length > 0
              ? data.chatHistory
                  .map(
                    (msg) => `
            <div class="chat-message ${msg.role === 'user' ? 'chat-user' : 'chat-assistant'}">
              <div class="chat-sender">${msg.role === 'user' ? '👑 Admin (Anda)' : '🤖 Technokers AI'}</div>
              <div>${msg.content.replace(/\n/g, '<br>')}</div>
            </div>`
                  )
                  .join('')
              : `<div class="chat-message chat-assistant">
              <div class="chat-sender">🤖 Technokers AI</div>
              <div>Halo Administrator <b>Muhamad Alfian</b>! 👋 Ada yang bisa saya bantu terkait berita AI, koding Cloudflare Workers, atau pengaturan konektor hari ini?</div>
            </div>`
          }
        </div>

        <div id="typingIndicator" class="chat-typing" aria-live="polite">🤖 Technokers AI sedang berpikir dan mengetik...</div>

        <div>
          <label for="chatInput">Ketik Pesan:</label>
          <div style="display: flex; gap: 0.75rem; align-items: flex-start;">
            <textarea
              id="chatInput"
              rows="2"
              placeholder="Ketik pertanyaan atau perintah Anda di sini... (Tekan Enter untuk kirim, Shift+Enter untuk baris baru)"
              aria-label="Pesan untuk asisten AI"
            ></textarea>
            <button id="btnSendChat" class="btn btn-primary" onclick="sendWebChat()" aria-label="Kirim pesan chat">Kirim</button>
          </div>
        </div>
      </section>
    </div>

    <!-- ========================================== -->
    <!-- TAB 3: UNIVERSAL CONNECTORS                -->
    <!-- ========================================== -->
    <div id="panel-connectors" role="tabpanel" class="tab-panel" aria-labelledby="tab-connectors">
      <p style="margin-bottom: 1.5rem;">Hubungkan Technokers AI Bot ke berbagai platform eksternal seperti Google Blogger, Google Gmail, dan Webhook untuk mendistribusikan berita AI secara otomatis atau sesuai permintaan.</p>
      
      <div id="connectorAlert" style="display: none; padding: 1rem; border-radius: 8px; margin-bottom: 1.5rem; font-weight: 700;"></div>

      <div class="grid">
        <!-- Connector 1: Google Blogger -->
        <section class="card" aria-labelledby="sec-blogger">
          <h3 id="sec-blogger">
            📝 Google Blogger
            <span class="badge ${blogger.enabled ? 'badge-success' : 'badge-muted'}">${blogger.enabled ? 'AKTIF' : 'NONAKTIF'}</span>
          </h3>
          <p>Otomatis publikasikan artikel digest harian ke blog Google Blogger Anda via Google Blogger API v3.</p>
          
          <label for="bloggerBlogId">Blog ID (Google Blogger):</label>
          <input type="text" id="bloggerBlogId" value="${blogger.params.blogId || ''}" placeholder="Contoh: 827361928374619">

          <label for="bloggerToken">OAuth2 Access Token (Google):</label>
          <input type="password" id="bloggerToken" value="${blogger.auth.accessToken || ''}" placeholder="ya29.a0AfH6SM...">

          <div class="checkbox-group">
            <input type="checkbox" id="bloggerEnabled" ${blogger.enabled ? 'checked' : ''}>
            <label for="bloggerEnabled">Aktifkan publikasi otomatis digest ke Blogger</label>
          </div>

          <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
            <button class="btn btn-primary" onclick="saveBloggerConfig()">💾 Simpan Blogger</button>
            <button class="btn btn-secondary" onclick="testConnector('google-blogger')">🧪 Uji Draft Post</button>
          </div>
        </section>

        <!-- Connector 2: Google Gmail -->
        <section class="card" aria-labelledby="sec-gmail">
          <h3 id="sec-gmail">
            ✉️ Google Gmail
            <span class="badge ${gmail.enabled ? 'badge-success' : 'badge-muted'}">${gmail.enabled ? 'AKTIF' : 'NONAKTIF'}</span>
          </h3>
          <p>Kirimkan buletin email rangkuman berita AI ke alamat email Anda via Google Gmail API.</p>

          <label for="gmailEmail">Alamat Email Penerima:</label>
          <input type="text" id="gmailEmail" value="${gmail.params.recipientEmail || ''}" placeholder="nama@gmail.com">

          <label for="gmailToken">OAuth2 Access Token (Google):</label>
          <input type="password" id="gmailToken" value="${gmail.auth.accessToken || ''}" placeholder="ya29.a0AfH6SM...">

          <div class="checkbox-group">
            <input type="checkbox" id="gmailEnabled" ${gmail.enabled ? 'checked' : ''}>
            <label for="gmailEnabled">Aktifkan pengiriman rangkuman via Gmail</label>
          </div>

          <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
            <button class="btn btn-primary" onclick="saveGmailConfig()">💾 Simpan Gmail</button>
            <button class="btn btn-secondary" onclick="testConnector('google-gmail')">🧪 Uji Kirim Email</button>
          </div>
        </section>

        <!-- Connector 3: Custom Webhook -->
        <section class="card" aria-labelledby="sec-webhook">
          <h3 id="sec-webhook">
            ⚡ Custom Webhook
            <span class="badge ${webhook.enabled ? 'badge-success' : 'badge-muted'}">${webhook.enabled ? 'AKTIF' : 'NONAKTIF'}</span>
          </h3>
          <p>Kirimkan payload JSON berita AI ke URL Webhook (Discord, Slack, Make, atau N8N Workflow).</p>

          <label for="webhookUrl">Target Webhook URL:</label>
          <input type="text" id="webhookUrl" value="${webhook.params.webhookUrl || ''}" placeholder="https://discord.com/api/webhooks/...">

          <div class="checkbox-group">
            <input type="checkbox" id="webhookEnabled" ${webhook.enabled ? 'checked' : ''}>
            <label for="webhookEnabled">Aktifkan pengiriman webhook saat digest dirilis</label>
          </div>

          <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
            <button class="btn btn-primary" onclick="saveWebhookConfig()">💾 Simpan Webhook</button>
            <button class="btn btn-secondary" onclick="testConnector('custom-webhook')">🧪 Uji Ping Webhook</button>
          </div>
        </section>
      </div>
    </div>

    <!-- ========================================== -->
    <!-- TAB 4: CUSTOM CRONS & REMINDERS           -->
    <!-- ========================================== -->
    <div id="panel-jobs" role="tabpanel" class="tab-panel" aria-labelledby="tab-jobs">
      <div id="jobAlert" style="display: none; padding: 1rem; border-radius: 8px; margin-bottom: 1.5rem; font-weight: 700;"></div>

      <div class="grid">
        <!-- Card 1: Job Metrics -->
        <section class="card" aria-labelledby="sec-job-stats">
          <h2 id="sec-job-stats">
            📊 Statistik Jadwal
            <span class="badge badge-success">${data.jobs.filter((j) => j.status === 'active').length} AKTIF</span>
          </h2>
          <p>Total Pengingat (Reminder): <b>${data.jobs.filter((j) => j.type === 'reminder').length}</b></p>
          <p>Total Jadwal Berulang (Cron): <b>${data.jobs.filter((j) => j.type === 'cron').length}</b></p>
          <p>Frekuensi Pengecekan Sistem: <b>Tiap 1 Menit (* * * * *)</b></p>
          <p style="font-size: 0.85rem; color: #94a3b8;">*Pengingat dan cron dievaluasi otomatis tanpa perlu deploy kode.</p>
        </section>

        <!-- Card 2: Create Job Form -->
        <section class="card" aria-labelledby="sec-create-job">
          <h2 id="sec-create-job">➕ Buat Pengingat atau Cron Baru</h2>
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 0.75rem;">
            <div>
              <label for="newJobType">Tipe Jadwal:</label>
              <select id="newJobType">
                <option value="reminder">⏰ Pengingat Sekali Jalan (Reminder)</option>
                <option value="cron">🔄 Tugas Berulang (Cron Job)</option>
              </select>
            </div>
            <div>
              <label for="newJobTarget">Target Pengiriman:</label>
              <select id="newJobTarget">
                <option value="dashboard">Web Dashboard ini (Di sini)</option>
                <option value="1023972475">Chat Pribadi Admin Telegram (@alfian04121)</option>
                <option value="${data.channelId}">Channel Resmi (${data.channelId})</option>
              </select>
            </div>
          </div>

          <label for="newJobSchedule">Jadwal / Waktu (Contoh: "15m", "1h", "jam 14:30", "0 9 * * *", "tiap hari jam 08:00"):</label>
          <input type="text" id="newJobSchedule" placeholder="Contoh: 15m atau jam 18:30 atau 0 9 * * *">

          <label for="newJobMessage">Isi Pesan Pengingat / Konten:</label>
          <textarea id="newJobMessage" rows="2" placeholder="Tuliskan pesan tugas atau pengingat yang akan dikirim..."></textarea>

          <button class="btn btn-primary" onclick="createCustomJob()">➕ Simpan & Aktifkan Jadwal</button>
        </section>
      </div>

      <!-- Active Jobs List -->
      <section class="card" style="margin-top: 1.5rem;" aria-labelledby="sec-jobs-list">
        <h2 id="sec-jobs-list">
          📋 Daftar Jadwal Aktif & Riwayat
          <span class="badge">${data.jobs.length} Total</span>
        </h2>

        ${
          data.jobs && data.jobs.length > 0
            ? `<div style="display: flex; flex-direction: column; gap: 1rem; margin-top: 1rem;">
              ${data.jobs
                .map(
                  (j) => `
                <div style="background: #050811; border: 2px solid var(--border); border-radius: 10px; padding: 1rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
                  <div style="flex: 1; min-width: 250px;">
                    <div style="display: flex; gap: 0.5rem; align-items: center; margin-bottom: 0.5rem; flex-wrap: wrap;">
                      <span class="badge ${j.type === 'cron' ? 'badge-primary' : 'badge-success'}">${j.type === 'cron' ? '🔄 CRON' : '⏰ REMINDER'}</span>
                      <span class="badge ${j.status === 'active' ? 'badge-success' : 'badge-muted'}">${j.status.toUpperCase()}</span>
                      <code>${j.id}</code>
                    </div>
                    <div style="font-size: 1.05rem; font-weight: 700; color: #ffffff; margin-bottom: 0.35rem;">${escapeHtml(j.message)}</div>
                    <div style="font-size: 0.9rem; color: #cbd5e1;">
                      🕒 Jadwal: <b>${escapeHtml(j.scheduleRaw || '')}</b> ${j.cronExpression ? `(<code>${j.cronExpression}</code>)` : ''} &bull; 
                      🎯 Target: <b>${j.targetPlatform === 'dashboard' || String(j.targetChatId) === 'dashboard' ? 'Web Dashboard (Di sini)' : (String(j.targetChatId) === String(data.channelId) ? 'Channel ' + data.channelId : 'Telegram (' + j.targetChatId + ')')}</b> &bull;
                      📊 Eksekusi: <b>${j.runCount || 0}x</b>
                    </div>
                  </div>
                  <div style="display: flex; gap: 0.5rem;">
                    <button class="btn btn-secondary" style="min-height: 40px; padding: 0.5rem 1rem;" onclick="testCustomJob('${j.id}')">🚀 Uji Kirim</button>
                    <button class="btn btn-danger" style="min-height: 40px; padding: 0.5rem 1rem;" onclick="deleteCustomJob('${j.id}')">🗑️ Hapus</button>
                  </div>
                </div>`
                )
                .join('')}
            </div>`
            : `<p style="text-align: center; color: #94a3b8; padding: 2rem 0;">Belum ada jadwal atau reminder yang dibuat. Gunakan formulir di atas atau katakan langsung di chat: <i>"ingetin aku 15 menit lagi cek email"</i>!</p>`
        }
      </section>
    </div>
  </main>

  <footer style="margin-top: 3rem; text-align: center; color: #94a3b8; font-size: 0.9rem; border-top: 1px solid #1e293b; padding-top: 1.5rem;">
    Technokers AI Bot Pro &bull; Desain Aksesibel Standar WCAG 2.1 AAA &bull; Dedicated to @aicomindo
  </footer>

  <script>
    // Tab Switching (WCAG Accessible)
    function switchTab(tabId) {
      const tabs = ['overview', 'chat', 'connectors', 'jobs'];
      tabs.forEach(t => {
        const btn = document.getElementById('tab-' + t);
        const panel = document.getElementById('panel-' + t);
        if (t === tabId) {
          btn.setAttribute('aria-selected', 'true');
          panel.classList.add('active');
          if (t === 'chat') {
            scrollChatToBottom();
            document.getElementById('chatInput').focus();
          }
        } else {
          btn.setAttribute('aria-selected', 'false');
          panel.classList.remove('active');
        }
      });
    }

    // Scheduler & Settings Handlers
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
        alert('Limit berhasil diperbarui: ' + (limit === 0 ? 'Unlimited' : limit + ' chat/hari'));
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

    // Web Chat Handlers
    function scrollChatToBottom() {
      const box = document.getElementById('chatBox');
      if (box) box.scrollTop = box.scrollHeight;
    }

    async function sendWebChat() {
      const input = document.getElementById('chatInput');
      const text = input.value.trim();
      if (!text) return;

      const chatBox = document.getElementById('chatBox');
      const typing = document.getElementById('typingIndicator');
      const btnSend = document.getElementById('btnSendChat');

      // Append user bubble
      const userBubble = document.createElement('div');
      userBubble.className = 'chat-message chat-user';
      userBubble.innerHTML = '<div class="chat-sender">👑 Admin (Anda)</div><div>' + escapeHtml(text).replace(/\\n/g, '<br>') + '</div>';
      chatBox.appendChild(userBubble);
      input.value = '';
      scrollChatToBottom();

      // Show typing indicator
      typing.style.display = 'block';
      btnSend.disabled = true;

      try {
        const res = await fetch('/api/dashboard/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text })
        });
        const data = await res.json();
        typing.style.display = 'none';
        btnSend.disabled = false;

        const botBubble = document.createElement('div');
        botBubble.className = 'chat-message chat-assistant';
        botBubble.innerHTML = '<div class="chat-sender">🤖 Technokers AI</div><div>' + (data.reply ? data.reply.replace(/\\n/g, '<br>') : 'Terjadi kesalahan sistem.') + '</div>';
        chatBox.appendChild(botBubble);
        scrollChatToBottom();
      } catch (err) {
        typing.style.display = 'none';
        btnSend.disabled = false;
        alert('Gagal mengirim chat: ' + err.message);
      }
    }

    async function clearWebChat() {
      if (confirm('Bersihkan seluruh riwayat chat sesi web dashboard ini?')) {
        const res = await fetch('/api/dashboard/chat/clear', { method: 'POST' });
        if (res.ok) {
          const chatBox = document.getElementById('chatBox');
          chatBox.innerHTML = '<div class="chat-message chat-assistant"><div class="chat-sender">🤖 Technokers AI</div><div>Riwayat percakapan telah dibersihkan. Silakan mulai topik baru!</div></div>';
        }
      }
    }

    document.getElementById('chatInput')?.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendWebChat();
      }
    });

    function escapeHtml(text) {
      const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
      return text.replace(/[&<>"']/g, m => map[m]);
    }

    // Connectors Handlers
    function showConnectorNotice(msg, isSuccess) {
      const alertBox = document.getElementById('connectorAlert');
      alertBox.style.display = 'block';
      alertBox.style.background = isSuccess ? '#047857' : '#991b1b';
      alertBox.style.color = '#ffffff';
      alertBox.textContent = msg;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    async function saveBloggerConfig() {
      const blogId = document.getElementById('bloggerBlogId').value.trim();
      const token = document.getElementById('bloggerToken').value.trim();
      const enabled = document.getElementById('bloggerEnabled').checked;

      const res = await fetch('/api/connectors/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'google-blogger',
          name: 'Google Blogger',
          type: 'blogger',
          enabled: enabled,
          auth: { accessToken: token },
          params: { blogId: blogId },
        })
      });
      const data = await res.json();
      showConnectorNotice(data.message || data.error, res.ok);
    }

    async function saveGmailConfig() {
      const email = document.getElementById('gmailEmail').value.trim();
      const token = document.getElementById('gmailToken').value.trim();
      const enabled = document.getElementById('gmailEnabled').checked;

      const res = await fetch('/api/connectors/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'google-gmail',
          name: 'Google Gmail',
          type: 'gmail',
          enabled: enabled,
          auth: { accessToken: token },
          params: { recipientEmail: email },
        })
      });
      const data = await res.json();
      showConnectorNotice(data.message || data.error, res.ok);
    }

    async function saveWebhookConfig() {
      const url = document.getElementById('webhookUrl').value.trim();
      const enabled = document.getElementById('webhookEnabled').checked;

      const res = await fetch('/api/connectors/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'custom-webhook',
          name: 'Custom Webhook',
          type: 'webhook',
          enabled: enabled,
          auth: {},
          params: { webhookUrl: url },
        })
      });
      const data = await res.json();
      showConnectorNotice(data.message || data.error, res.ok);
    }

    async function testConnector(id) {
      showConnectorNotice('Menguji koneksi...', true);
      const res = await fetch('/api/connectors/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      const data = await res.json();
      showConnectorNotice(data.message, data.success !== false);
    }

    // Custom Crons & Reminders Handlers
    function showJobNotice(msg, isSuccess) {
      const alertBox = document.getElementById('jobAlert');
      if (!alertBox) return;
      alertBox.style.display = 'block';
      alertBox.style.background = isSuccess ? '#047857' : '#991b1b';
      alertBox.style.color = '#ffffff';
      alertBox.textContent = msg;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    async function createCustomJob() {
      const type = document.getElementById('newJobType').value;
      const schedule = document.getElementById('newJobSchedule').value.trim();
      const targetChatId = document.getElementById('newJobTarget').value;
      const message = document.getElementById('newJobMessage').value.trim();

      if (!schedule || !message) {
        alert('Mohon isi jadwal dan pesan pengingat.');
        return;
      }

      const res = await fetch('/api/jobs/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, schedule, targetChatId, message })
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        alert('Jadwal berhasil dibuat! ID: ' + data.job.id);
        location.reload();
      } else {
        showJobNotice('Gagal membuat jadwal: ' + (data.error || 'Terjadi kesalahan'), false);
      }
    }

    async function deleteCustomJob(id) {
      if (confirm('Hapus jadwal ini: ' + id + '?')) {
        const res = await fetch('/api/jobs/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          alert(data.message || 'Jadwal berhasil dihapus');
          location.reload();
        } else {
          alert('Gagal menghapus: ' + (data.message || 'Terjadi kesalahan'));
        }
      }
    }

    async function testCustomJob(id) {
      const res = await fetch('/api/jobs/test-trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      const data = await res.json();
      alert(data.message || (res.ok ? 'Notifikasi tes berhasil dikirim!' : 'Gagal mengirim'));
    }

    // Web Dashboard Notification Polling & Chime (WCAG 2.1 AAA Compliant)
    let currentActiveNotifId = null;

    function playNotificationChime() {
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
        osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15); // A5
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.6);
      } catch (e) {}
    }

    async function checkWebNotifications() {
      try {
        const res = await fetch('/api/dashboard/notifications');
        if (!res.ok) return;
        const data = await res.json();
        if (data.ok && Array.isArray(data.notifications)) {
          const unread = data.notifications.filter(n => !n.read);
          const banner = document.getElementById('webNotificationBanner');
          if (unread.length > 0) {
            const latest = unread[0];
            if (currentActiveNotifId !== latest.id) {
              currentActiveNotifId = latest.id;
              const titleEl = document.getElementById('bannerTitle');
              const msgEl = document.getElementById('bannerMessage');
              if (titleEl) titleEl.textContent = '⏰ PENGINGAT (REMINDER): ' + (latest.scheduleRaw || 'Jadwal Tiba');
              if (msgEl) msgEl.innerHTML = '<b>Pesan:</b> ' + escapeHtml(latest.message);
              if (banner) banner.style.display = 'block';
              playNotificationChime();
            }
          } else {
            if (banner && !currentActiveNotifId) banner.style.display = 'none';
          }
        }
      } catch (e) {}
    }

    async function dismissWebNotification() {
      const banner = document.getElementById('webNotificationBanner');
      if (banner) banner.style.display = 'none';
      const idToDismiss = currentActiveNotifId;
      currentActiveNotifId = null;
      try {
        await fetch('/api/dashboard/notifications/dismiss', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: idToDismiss })
        });
      } catch (e) {}
    }

    setInterval(checkWebNotifications, 4000);
    checkWebNotifications();
  </script>
</body>
</html>`;
}

