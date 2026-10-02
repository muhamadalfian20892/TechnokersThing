import { sendTelegramMessage, sendChatAction } from './api';
import { fetchLatestAINews } from '../news/fetcher';
import {
  filterUnpostedNews,
  getRecentPostedHistory,
  getLastDigestStats,
  isPostingPaused,
  setPostingPaused,
  clearPostedTodayLock,
  getActiveModel,
  setActiveModel,
  getUsageStats,
  getStyleMemory,
  resetStyleMemory,
  getAdminList,
  isUserAdmin,
  SUPER_ADMIN_ID,
  buildChatSessionKey,
  upsertUserProfile,
  getIsolatedChatHistory,
  saveIsolatedChatHistory,
  clearIsolatedChatHistory,
  checkRateLimit,
  getAuditLogs,
  addInjectedNews,
  searchPostedNews,
  getDailyChatLimit,
  setDailyChatLimit,
  checkUserChatPermission,
  incrementUserDailyChat,
  generateDashboardOtp,
} from '../news/memory';
import { generateDailyNewsDigest, getWibInfo } from '../news/generator';
import { fetchAllAvailableModels } from '../news/models';
import { runUnifiedAiCompletion } from '../news/ai_client';
import { executeDailyNewsPosting } from '../index';
import { processConnectorIntent, getAllConnectors } from '../connectors/manager';
import {
  processReminderIntent,
  getAllJobs,
  getUserJobs,
  deleteJob,
  saveJob,
} from '../scheduler/manager';
import { parseScheduleInput } from '../scheduler/parser';
import { ScheduledJob } from '../scheduler/types';
import { ChatMessage } from '../news/types';

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    message_thread_id?: number;
    from?: {
      id: number;
      is_bot: boolean;
      first_name?: string;
      last_name?: string;
      username?: string;
    };
    chat: {
      id: number;
      type: 'private' | 'group' | 'supergroup' | 'channel';
      title?: string;
      username?: string;
    };
    date: number;
    text?: string;
  };
}

export async function handleTelegramUpdate(
  update: TelegramUpdate,
  env: Env
): Promise<void> {
  const msg = update.message;
  if (!msg || !msg.text) return;

  const chatId = msg.chat.id;
  const userId = msg.from?.id || chatId;
  const threadId = msg.message_thread_id;
  const text = msg.text.trim();
  const userName = msg.from?.first_name || 'Teman';
  const userHandle = msg.from?.username ? `@${msg.from.username}` : '';
  const token = env.TELEGRAM_TOKEN;

  // Track profile and isolated session key per user and per thread
  await upsertUserProfile(env.AI_NEWS_KV, userId, {
    firstName: msg.from?.first_name,
    lastName: msg.from?.last_name,
    username: msg.from?.username,
  });

  const sessionKey = buildChatSessionKey(chatId, userId, threadId);

  // Rate Limiting Protection (Anti-Flood)
  const rateLimit = await checkRateLimit(env.AI_NEWS_KV, userId, 25);
  if (!rateLimit.allowed) {
    await sendTelegramMessage(
      token,
      chatId,
      `⚠️ <b>Batas Kecepatan Terlampaui</b>\n\nAnda mengirim pesan terlalu cepat. Harap beri jeda sejenak sebelum mengirim pesan kembali.`
    );
    return;
  }

  const userIsAdmin = await isUserAdmin(env.AI_NEWS_KV, userId);
  const { dateStr, formattedDate, isFriday } = getWibInfo();

  // ==========================================
  // NON-ADMIN RESTRICTION CHECK
  // ==========================================
  const isPublicCommand =
    text.startsWith('/start') ||
    text.startsWith('/help') ||
    text.startsWith('/news') ||
    text.startsWith('/reset') ||
    text.startsWith('/clearchat') ||
    text.startsWith('/remind') ||
    text.startsWith('/reminders') ||
    text.startsWith('/myreminders') ||
    text.startsWith('/delremind') ||
    text.startsWith('/cron') ||
    text.startsWith('/crons') ||
    text.startsWith('/delcron');

  if (text.startsWith('/') && !isPublicCommand && !userIsAdmin) {
    await sendTelegramMessage(
      token,
      chatId,
      `⛔ <b>Akses Dibatasi</b>\n\n` +
        `Perintah administratif ini khusus untuk Pengelola (@alfian04121).\n` +
        `Pengguna umum dapat menggunakan chat interaktif AI dan perintah <code>/news</code>.\n\n` +
        `📢 Kunjungi channel resmi: <a href="https://t.me/aicomindo">Komunitas AI Indonesia @aicomindo</a>.`
    );
    return;
  }

  // ==========================================
  // PUBLIC COMMAND: /reset & /clearchat
  // ==========================================
  if (text.startsWith('/reset') || text.startsWith('/clearchat')) {
    await clearIsolatedChatHistory(env.AI_NEWS_KV, sessionKey);
    await sendTelegramMessage(
      token,
      chatId,
      `🧹 <b>Memori Obrolan Direset</b>\n\n` +
        `Riwayat percakapan khusus untuk Anda di sesi ini telah dibersihkan. Anda dapat memulai topik obrolan baru dengan asisten AI!`
    );
    return;
  }

  // ==========================================
  // PUBLIC COMMAND: /start
  // ==========================================
  if (text.startsWith('/start')) {
    if (userIsAdmin) {
      await sendTelegramMessage(
        token,
        chatId,
        `Halo, Administrator <b>${userName}</b>! 👑 (@alfian04121)\n\n` +
          `Selamat datang di konsol kendali <b>Technokers AI Bot Pro</b>.\n\n` +
          `🔑 <b>Perintah Khusus Admin:</b>\n` +
          `• <code>/dashboard_code</code> - Buat kode OTP masuk Web Dashboard (Valid 5 Menit)\n` +
          `• <code>/connectors</code> - Kelola integrasi Blogger, Gmail, & Webhook\n` +
          `• <code>/models</code> - Daftar model Cloudflare & Backup OpenAI API\n` +
          `• <code>/setlimit &lt;angka&gt;</code> - Atur batas chat harian user (0 = disable limit)\n` +
          `• <code>/preview</code> - Pratinjau draf berita hari ini\n` +
          `• <code>/post_now</code> - Kirim langsung digest ke channel @aicomindo\n` +
          `• <code>/stop_posting</code> & <code>/resume_posting</code> - Pause / resume scheduler\n` +
          `• <code>/status</code> & <code>/usage</code> - Pantau kuota & metrik sistem\n\n` +
          `Ketik <code>/help</code> untuk panduan lengkap semua perintah.`
      );
    } else {
      const dailyLimit = await getDailyChatLimit(env.AI_NEWS_KV);
      const limitText = dailyLimit > 0 ? `${dailyLimit} pesan per hari` : 'Tanpa batas (Unlimited)';
      await sendTelegramMessage(
        token,
        chatId,
        `Halo, <b>${userName}</b>! 👋\n\n` +
          `Selamat datang di <b>Technokers AI Bot</b>! 🤖\n` +
          `Asisten cerdas resmi dari komunitas <a href="https://t.me/aicomindo">@aicomindo (AI Community News Indonesia)</a>.\n\n` +
          `✨ <b>Layanan yang Tersedia:</b>\n` +
          `• <b>Tanya AI:</b> Tanyakan konsep kecerdasan buatan, coding, atau model LLM (Kuota: ${limitText}). Bot mengingat alur percakapan Anda secara terisolasi.\n` +
          `• <b>/news:</b> Baca ringkasan berita AI terhangat kapan saja secara instan.\n` +
          `• <b>/reset:</b> Hapus memori percakapan untuk memulai topik baru.\n\n` +
          `📢 Dapatkan rangkuman harian setiap jam 18:00 WIB di <a href="https://t.me/aicomindo">Channel Telegram @aicomindo</a>!`
      );
    }
    return;
  }

  // ==========================================
  // PUBLIC COMMAND: /help
  // ==========================================
  if (text.startsWith('/help')) {
    if (userIsAdmin) {
      await sendTelegramMessage(
        token,
        chatId,
        `📖 <b>Panduan Lengkap Administrator:</b>\n\n` +
          `🔑 <b>Otentikasi & Web Dashboard:</b>\n` +
          `• <code>/dashboard_code</code> - Buat kode OTP masuk dashboard (Valid 5 menit, 1x pakai)\n` +
          `• <code>/connectors</code> - Cek status konektor (Google Blogger, Gmail, Webhooks)\n\n` +
          `🧠 <b>Model & Kuota:</b>\n` +
          `• <code>/models</code> - Daftar model Cloudflare & Backup Provider\n` +
          `• <code>/setmodel &lt;id&gt;</code> - Ganti model AI aktif\n` +
          `• <code>/usage</code> - Pantau pemakaian Neurons & kuota harian\n` +
          `• <code>/health</code> - Uji latensi Cloudflare & AI\n\n` +
          `🛡️ <b>Manajemen Limit User:</b>\n` +
          `• <code>/setlimit &lt;n&gt;</code> - Atur batas chat harian (Contoh: /setlimit 40, /setlimit 0)\n` +
          `• <code>/getlimit</code> - Periksa pengaturan limit aktif\n\n` +
          `📢 <b>Kontrol Channel @aicomindo:</b>\n` +
          `• <code>/preview</code> - Pratinjau draf berita hari ini\n` +
          `• <code>/post_now</code> - Kirim langsung postingan ke channel\n` +
          `• <code>/stop_posting</code> - Hentikan posting otomatis jam 18:00 WIB\n` +
          `• <code>/resume_posting</code> - Aktifkan kembali posting otomatis\n` +
          `• <code>/unlock_today</code> - Buka kunci harian\n` +
          `• <code>/addnews &lt;j&gt; | &lt;l&gt; | &lt;i&gt;</code> - Suntik berita manual\n` +
          `• <code>/search &lt;kata&gt;</code> - Cari arsip berita di KV\n` +
          `• <code>/reset</code> - Bersihkan riwayat chat sesi ini`
      );
    } else {
      await sendTelegramMessage(
        token,
        chatId,
        `📖 <b>Panduan Penggunaan Bot:</b>\n\n` +
          `• <b>Chat Interaktif:</b> Kirimkan pertanyaan apa saja seputar AI, pemrograman, atau teknologi. Asisten memiliki memori khusus percakapan Anda.\n` +
          `• <b>/news:</b> Dapatkan rangkuman kurasi berita AI terbaru hari ini.\n` +
          `• <b>/reset:</b> Hapus riwayat percakapan sesi Anda untuk memulai topik baru.\n\n` +
          `📢 Gabung channel resmi: <a href="https://t.me/aicomindo">Komunitas AI Indonesia @aicomindo</a>.`
      );
    }
    return;
  }

  // ==========================================
  // PUBLIC COMMAND: /news
  // ==========================================
  if (text.startsWith('/news')) {
    await sendChatAction(token, chatId, 'typing');
    await sendTelegramMessage(
      token,
      chatId,
      `🔍 <i>Sedang mengumpulkan berita AI global terbaru dan menyusun rangkuman mendalam...</i>`
    );

    try {
      const candidates = await fetchLatestAINews();
      const unposted = await filterUnpostedNews(env.AI_NEWS_KV, candidates);
      const targetCount = isFriday ? 10 : 5;
      const itemsToPost = unposted.length > 0 ? unposted.slice(0, targetCount) : candidates.slice(0, targetCount);
      const digest = await generateDailyNewsDigest(env, itemsToPost, isFriday);

      await sendTelegramMessage(token, chatId, digest);
    } catch (err) {
      console.error('Error in /news command:', err);
      await sendTelegramMessage(token, chatId, `⚠️ Maaf, ada kendala saat menyusun berita. Silakan coba kembali nanti.`);
    }
    return;
  }

  // ==========================================
  // ADMIN COMMAND: /connectors
  // ==========================================
  if (text.startsWith('/connectors')) {
    const list = await getAllConnectors(env.AI_NEWS_KV);
    const summary = list
      .map((c) => `• <b>${c.name}</b> (${c.type}): ${c.enabled ? '🟢 Aktif' : '⚪ Nonaktif'}\n  <i>${c.description || ''}</i>`)
      .join('\n\n');

    await sendTelegramMessage(
      token,
      chatId,
      `🔌 <b>Universal Connectors Status:</b>\n\n${summary}\n\n` +
        `💡 <b>Pengaturan Mandiri:</b>\n` +
        `Anda dapat mengonfigurasi Blog ID, Access Token Google Blogger, dan Webhooks langsung di <b>Web Dashboard</b> (tab Connectors).\n` +
        `Atau katakan saja di chat: <i>"sambungin ke blogger"</i> atau <i>"sambungin ke gmail"</i>!`
    );
    return;
  }

  // ==========================================
  // REMINDERS & CUSTOM CRON COMMANDS
  // ==========================================
  if (text.startsWith('/remind')) {
    const input = text.replace(/^\/remind/i, '').trim();
    if (!input) {
      await sendTelegramMessage(
        token,
        chatId,
        `⏰ <b>Format Perintah /remind:</b>\n\n` +
          `• <code>/remind 10m Minum kopi</code> (10 menit lagi)\n` +
          `• <code>/remind 1h Cek server</code> (1 jam lagi)\n` +
          `• <code>/remind 14:30 Meeting tim</code> (Jam 14:30 WIB)\n` +
          `• <code>/remind besok 08:00 Berangkat kerja</code>\n\n` +
          `💡 <i>Atau Anda bisa langsung ngobrol santai: "ingetin aku 15 menit lagi angkat jemuran".</i>`
      );
      return;
    }

    const parsed = parseScheduleInput(input, chatId);
    if (!parsed.success || !parsed.message) {
      await sendTelegramMessage(token, chatId, `⚠️ ${parsed.error || 'Waktu atau pesan pengingat tidak valid.'}`);
      return;
    }

    const newJob: ScheduledJob = {
      id: `job_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      type: 'reminder',
      message: parsed.message,
      targetChatId: chatId,
      threadId: threadId,
      creatorId: userId,
      creatorName: userName,
      scheduleRaw: parsed.scheduleRaw || 'Reminder',
      dueAt: parsed.dueAt,
      timezoneOffsetHours: 7,
      status: 'active',
      createdAt: new Date().toISOString(),
      runCount: 0,
    };

    await saveJob(env.AI_NEWS_KV, newJob);

    await sendTelegramMessage(
      token,
      chatId,
      `✅ <b>Pengingat (Reminder) Berhasil Diatur!</b>\n\n` +
        `📌 <b>Pesan:</b> ${escapeHtml(newJob.message)}\n` +
        `⏰ <b>Waktu:</b> ${parsed.humanDescription || parsed.scheduleRaw}\n` +
        `🆔 <b>Job ID:</b> <code>${newJob.id}</code>\n\n` +
        `🔔 Saya akan mengirim notifikasi langsung ke chat ini tepat waktu.\n` +
        `💡 <i>Ketik <code>/delremind ${newJob.id}</code> untuk membatalkan pengingat ini.</i>`
    );
    return;
  }

  if (text.startsWith('/cron')) {
    const input = text.replace(/^\/cron/i, '').trim();
    if (!input) {
      await sendTelegramMessage(
        token,
        chatId,
        `🔄 <b>Format Perintah /cron (Jadwal Berulang):</b>\n\n` +
          `• <code>/cron 0 9 * * * Minum air pagi</code> (Tiap jam 09:00 WIB)\n` +
          `• <code>/cron tiap hari jam 08:30 Standup meeting</code>\n` +
          `• <code>/cron tiap senin jam 10:00 Evaluasi mingguan</code>` +
          (userIsAdmin ? `\n• Tambahkan <code>--channel</code> untuk posting otomatis ke @aicomindo` : '')
      );
      return;
    }

    const toChannel = userIsAdmin && input.includes('--channel');
    const cleanInput = input.replace('--channel', '').trim();
    const targetChat = toChannel ? env.CHANNEL_ID : chatId;

    const parsed = parseScheduleInput(cleanInput, targetChat);
    if (!parsed.success || !parsed.message || parsed.type !== 'cron') {
      await sendTelegramMessage(
        token,
        chatId,
        `⚠️ Format jadwal berulang tidak dikenali. Contoh: <code>/cron 0 9 * * * Cek server</code> atau <code>/cron tiap hari jam 09:00 Cek email</code>.`
      );
      return;
    }

    const newJob: ScheduledJob = {
      id: `job_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      type: 'cron',
      message: parsed.message,
      targetChatId: targetChat,
      threadId: toChannel ? undefined : threadId,
      creatorId: userId,
      creatorName: userName,
      scheduleRaw: parsed.scheduleRaw || 'Cron Job',
      cronExpression: parsed.cronExpression || '0 9 * * *',
      timezoneOffsetHours: 7,
      status: 'active',
      createdAt: new Date().toISOString(),
      runCount: 0,
    };

    await saveJob(env.AI_NEWS_KV, newJob);

    await sendTelegramMessage(
      token,
      chatId,
      `🎉 <b>Jadwal Otomatis (Cron Job) Aktif!</b>\n\n` +
        `📌 <b>Pesan:</b> ${escapeHtml(newJob.message)}\n` +
        `⏰ <b>Jadwal:</b> ${parsed.humanDescription || parsed.scheduleRaw}\n` +
        `🔄 <b>Pola Cron:</b> <code>${newJob.cronExpression}</code>\n` +
        `🎯 <b>Tujuan:</b> ${toChannel ? `Channel <b>${env.CHANNEL_ID}</b>` : 'Chat pribadi ini'}\n` +
        `🆔 <b>Job ID:</b> <code>${newJob.id}</code>\n\n` +
        `💡 <i>Ketik <code>/delremind ${newJob.id}</code> untuk membatalkan jadwal ini.</i>`
    );
    return;
  }

  if (text.startsWith('/reminders') || text.startsWith('/myreminders') || text.startsWith('/crons')) {
    const jobs = userIsAdmin ? await getAllJobs(env.AI_NEWS_KV) : await getUserJobs(env.AI_NEWS_KV, userId);
    const activeJobs = jobs.filter((j) => j.status === 'active');

    if (activeJobs.length === 0) {
      await sendTelegramMessage(
        token,
        chatId,
        `📭 <b>Tidak Ada Pengingat / Cron Aktif</b>\n\n` +
          `Anda belum memiliki pengingat aktif.\n` +
          `Coba buat dengan: <code>/remind 10m Minum air</code> atau katakan <i>"ingetin aku 20 menit lagi cek tugas"</i>!`
      );
      return;
    }

    const listStr = activeJobs
      .map((j) => {
        const typeIcon = j.type === 'cron' ? '🔄 [CRON]' : '⏰ [REMINDER]';
        const targetStr = String(j.targetChatId) === String(env.CHANNEL_ID) ? 'Channel @aicomindo' : 'Private';
        return `• ${typeIcon} <b>${escapeHtml(j.message)}</b>\n  🕒 Waktu: <i>${j.scheduleRaw}</i>\n  🎯 Target: ${targetStr}\n  🆔 ID: <code>${j.id}</code> (Batal: <code>/delremind ${j.id}</code>)`;
      })
      .join('\n\n');

    await sendTelegramMessage(
      token,
      chatId,
      `📋 <b>Daftar Pengingat & Cron Aktif (${activeJobs.length} item):</b>\n\n${listStr}`
    );
    return;
  }

  if (text.startsWith('/delremind') || text.startsWith('/delcron')) {
    const idArg = text.replace(/^\/(?:delremind|delcron)/i, '').trim();
    if (!idArg) {
      await sendTelegramMessage(token, chatId, `⚠️ Masukkan ID jadwal. Contoh: <code>/delremind job_12345</code>`);
      return;
    }

    const delRes = await deleteJob(env.AI_NEWS_KV, idArg, userId, userIsAdmin);
    await sendTelegramMessage(token, chatId, delRes.message);
    return;
  }

  // Check Natural Language Connector Intent (e.g. "sambungin ke blogger", "sambungin ke gmail")
  if (userIsAdmin) {
    const connectorIntent = await processConnectorIntent(env.AI_NEWS_KV, text);
    if (connectorIntent.handled && connectorIntent.replyText) {
      await sendTelegramMessage(token, chatId, connectorIntent.replyText);
      return;
    }
  }

  // ==========================================
  // ADMIN COMMANDS
  // ==========================================
  if (text === '/dashboard_code' || text === '/admin_code' || text === '/code') {
    const otpCode = await generateDashboardOtp(env.AI_NEWS_KV, userId);
    await sendTelegramMessage(
      token,
      chatId,
      `🔑 <b>Kode Otentikasi Web Dashboard</b>\n\n` +
        `Kode Akses Anda:\n👉 <code>${otpCode}</code>\n\n` +
        `⏳ <b>Masa Berlaku:</b> 5 Menit\n` +
        `🛡️ <b>Keamanan:</b> Sekali pakai (langsung hangus setelah login). Maksimal 3x percobaan gagal sebelum dikunci.\n\n` +
        `🌐 Buka Dashboard:\n<a href="https://technokersthing.hafiyanajah.workers.dev">Akses Dashboard Web di Sini</a>`
    );
    return;
  }

  if (text.startsWith('/setlimit')) {
    const arg = text.replace('/setlimit', '').trim();
    const newLimit = parseInt(arg, 10);
    if (isNaN(newLimit) || newLimit < 0) {
      await sendTelegramMessage(
        token,
        chatId,
        `⚠️ Format salah. Contoh:\n<code>/setlimit 40</code> (40 chat/hari)\n<code>/setlimit 0</code> (Nonaktifkan limit)`
      );
      return;
    }

    await setDailyChatLimit(env.AI_NEWS_KV, newLimit);
    const desc = newLimit === 0 ? 'dinonaktifkan (Unlimited)' : `${newLimit} chat per hari`;
    await sendTelegramMessage(
      token,
      chatId,
      `✅ <b>Limit Chat Berhasil Diperbarui!</b>\n\nBatas chat untuk pengguna umum sekarang: <b>${desc}</b>.`
    );
    return;
  }

  if (text.startsWith('/getlimit')) {
    const currentLimit = await getDailyChatLimit(env.AI_NEWS_KV);
    const desc = currentLimit === 0 ? 'Nonaktif (Unlimited)' : `${currentLimit} chat per hari`;
    await sendTelegramMessage(token, chatId, `📊 <b>Pengaturan Limit Saat Ini:</b> <b>${desc}</b>.`);
    return;
  }

  if (text.startsWith('/models')) {
    await sendChatAction(token, chatId, 'typing');
    const [models, activeModel] = await Promise.all([
      fetchAllAvailableModels(env),
      getActiveModel(env.AI_NEWS_KV),
    ]);

    const cfModels = models.filter((m) => m.provider === 'cloudflare');
    const backupModels = models.filter((m) => m.provider === 'backup');

    const formatList = (list: typeof models) =>
      list.slice(0, 8).map((m) => {
        const isActive = m.id === activeModel ? ' 🟢 [AKTIF]' : '';
        return `• <code>${m.id}</code>${isActive}\n  <i>${m.author} (${m.description || ''})</i>`;
      }).join('\n\n');

    await sendTelegramMessage(
      token,
      chatId,
      `🌐 <b>Katalog Model AI (Cloudflare & Backup Provider)</b>\n\n` +
        `Model Aktif Saat Ini:\n👉 <code>${activeModel}</code>\n\n` +
        `☁️ <b>Cloudflare Workers AI:</b>\n${formatList(cfModels)}\n\n` +
        `🔄 <b>Backup OpenAI Endpoint (api.mrido1.my.id):</b>\n${formatList(backupModels)}\n\n` +
        `💡 <b>Cara Ganti Model:</b>\nKetik: <code>/setmodel ag/gemini-3.8-flash-high</code> atau <code>/setmodel @cf/meta/llama-3.3-70b-instruct-fp8-fast</code>`
    );
    return;
  }

  if (text.startsWith('/setmodel')) {
    const modelArg = text.replace('/setmodel', '').trim();
    if (!modelArg) {
      await sendTelegramMessage(
        token,
        chatId,
        `⚠️ Masukkan ID model. Contoh:\n<code>/setmodel ag/gemini-3.8-flash-high</code>\natau\n<code>/setmodel @cf/meta/llama-3.3-70b-instruct-fp8-fast</code>`
      );
      return;
    }

    await setActiveModel(env.AI_NEWS_KV, modelArg);
    const provider = modelArg.startsWith('@cf/') ? 'Cloudflare Workers AI' : 'Backup OpenAI API';
    await sendTelegramMessage(
      token,
      chatId,
      `✅ <b>Model AI Berhasil Diperbarui!</b>\n\nModel aktif: <code>${modelArg}</code>\nProvider: <b>${provider}</b>.`
    );
    return;
  }

  if (text.startsWith('/usage')) {
    const stats = await getUsageStats(env.AI_NEWS_KV);
    const freeTierDailyNeurons = 10000;
    const pct = Math.min(100, Math.round((stats.neuronsEstimated / freeTierDailyNeurons) * 100));
    const progressBar = '█'.repeat(Math.floor(pct / 10)) + '░'.repeat(10 - Math.floor(pct / 10));

    await sendTelegramMessage(
      token,
      chatId,
      `📊 <b>Pemakaian & Kuota Sistem AI</b>\n📅 <i>Hari Ini (${stats.date})</i>\n\n` +
        `☁️ <b>Cloudflare AI Calls:</b> ${stats.aiGenerations} kali\n` +
        `🔄 <b>Backup AI Calls:</b> ${stats.backupAiRequests || 0} kali\n` +
        `🌐 <b>Total HTTP Requests:</b> ${stats.totalRequests}\n` +
        `🔤 <b>Total Token Diproses:</b> ${stats.totalTokensEstimated.toLocaleString('id-ID')} token\n` +
        `🧠 <b>Estimasi Neurons Cloudflare:</b> ${stats.neuronsEstimated.toLocaleString('id-ID')} / ${freeTierDailyNeurons.toLocaleString('id-ID')} Neurons\n\n` +
        `[${progressBar}] <b>${pct}%</b>\n\n` +
        `💡 <i>Jika limit Cloudflare habis, sistem otomatis beralih ke Backup API!</i>`
    );
    return;
  }

  if (text.startsWith('/health') || text.startsWith('/ping')) {
    const t0 = Date.now();
    await env.AI_NEWS_KV.get('config:active_model');
    const kvLatency = Date.now() - t0;

    await sendTelegramMessage(
      token,
      chatId,
      `🏓 <b>Pong! Status Kesehatan Sistem:</b>\n\n` +
        `🟢 <b>Worker Core:</b> Online & Stabil\n` +
        `💾 <b>Cloudflare KV Latency:</b> ${kvLatency} ms\n` +
        `🔄 <b>Backup AI Endpoint:</b> Terhubung (${env.BACKUP_AI_URL})`
    );
    return;
  }

  if (text === '/stop_posting' || text === '/pause' || text === '/stop') {
    await setPostingPaused(env.AI_NEWS_KV, true);
    await sendTelegramMessage(
      token,
      chatId,
      `🛑 <b>Posting Otomatis Diberhentikan (PAUSED)!</b>\n\nJadwal harian jam 18:00 WIB tidak akan mengirim apa pun ke ${env.CHANNEL_ID}.\nKetik /resume_posting untuk mengaktifkan kembali.`
    );
    return;
  }

  if (text === '/resume_posting' || text === '/resume' || text === '/start_posting') {
    await setPostingPaused(env.AI_NEWS_KV, false);
    await sendTelegramMessage(
      token,
      chatId,
      `🟢 <b>Posting Otomatis Diaktifkan Kembali (ACTIVE)!</b>\n\nBot akan kembali memposting setiap hari pukul <b>18:00 WIB</b> ke ${env.CHANNEL_ID}.`
    );
    return;
  }

  if (text === '/post_now' || text === '/broadcast_now') {
    await sendChatAction(token, chatId, 'typing');
    await sendTelegramMessage(
      token,
      chatId,
      `⏳ <i>Sedang menyusun berita panjang & memposting langsung ke channel ${env.CHANNEL_ID}...</i>`
    );

    const result = await executeDailyNewsPosting(env, true);
    if (result.success) {
      await sendTelegramMessage(
        token,
        chatId,
        `✅ <b>Berhasil Terkirim ke Channel!</b>\n\n${result.message}\nJumlah item: ${result.postedCount} berita.`
      );
    } else {
      await sendTelegramMessage(token, chatId, `⚠️ <b>Gagal Posting:</b>\n${result.message}`);
    }
    return;
  }

  if (text === '/preview') {
    await sendChatAction(token, chatId, 'typing');
    await sendTelegramMessage(
      token,
      chatId,
      `🔍 <i>Sedang menyusun draf berita AI berbobot sesuai format hari ini...</i>`
    );

    try {
      const candidates = await fetchLatestAINews();
      const unposted = await filterUnpostedNews(env.AI_NEWS_KV, candidates);
      const targetCount = isFriday ? 10 : 5;
      const itemsToPost = unposted.length > 0 ? unposted.slice(0, targetCount) : candidates.slice(0, targetCount);
      const digest = await generateDailyNewsDigest(env, itemsToPost, isFriday);

      await sendTelegramMessage(token, chatId, digest);
    } catch (err) {
      console.error('Error generating preview:', err);
      await sendTelegramMessage(token, chatId, `⚠️ Gagal menghasilkan preview: ${String(err)}`);
    }
    return;
  }

  if (text === '/unlock_today') {
    await clearPostedTodayLock(env.AI_NEWS_KV, dateStr);
    await sendTelegramMessage(
      token,
      chatId,
      `🔓 <b>Kunci Harian Dibuka!</b>\n\nKunci untuk tanggal ${dateStr} telah direset.`
    );
    return;
  }

  if (text.startsWith('/search')) {
    const query = text.replace('/search', '').trim();
    if (!query) {
      await sendTelegramMessage(token, chatId, `⚠️ Masukkan kata kunci pencarian. Contoh: <code>/search Google</code>`);
      return;
    }

    const results = await searchPostedNews(env.AI_NEWS_KV, query);
    if (results.length === 0) {
      await sendTelegramMessage(token, chatId, `🔍 Tidak ditemukan berita dengan kata kunci "<b>${query}</b>" di arsip KV.`);
      return;
    }

    const lines = results.slice(0, 7).map((r, i) => `${i + 1}. <a href="${r.url}">${r.title}</a>\n   <i>(${new Date(r.postedAt).toLocaleDateString('id-ID')})</i>`);
    await sendTelegramMessage(
      token,
      chatId,
      `🔍 <b>Hasil Pencarian Arsip ("${query}"):</b>\n\n${lines.join('\n\n')}`
    );
    return;
  }

  if (text.startsWith('/addnews')) {
    const raw = text.replace('/addnews', '').trim();
    const parts = raw.split('|').map((p) => p.trim());
    if (parts.length < 2) {
      await sendTelegramMessage(
        token,
        chatId,
        `⚠️ Format: <code>/addnews Judul Berita | https://link-sumber.com | Detail singkat</code>`
      );
      return;
    }

    await addInjectedNews(env.AI_NEWS_KV, {
      id: `manual_${Date.now()}`,
      title: parts[0],
      url: parts[1],
      source: 'Admin Manual',
      snippet: parts[2] || 'Breaking news',
      publishedAt: new Date().toISOString(),
    });

    await sendTelegramMessage(
      token,
      chatId,
      `✅ <b>Berita Manual Tersimpan!</b>\n\nBerita ini akan diprioritaskan masuk ke postingan digest berikutnya.`
    );
    return;
  }

  if (text.startsWith('/logs')) {
    const logs = await getAuditLogs(env.AI_NEWS_KV);
    const logLines = logs.slice(0, 8).map(
      (l) => `• <b>[${l.action}]</b> by ${l.actor}\n  <i>${new Date(l.timestamp).toLocaleTimeString('id-ID')}</i> - ${l.details || ''}`
    );
    await sendTelegramMessage(
      token,
      chatId,
      `📜 <b>Log Audit Aktivitas Sistem:</b>\n\n${logLines.join('\n\n') || 'Belum ada log'}`
    );
    return;
  }

  if (text.startsWith('/status')) {
    const [history, lastStats, paused, activeModel, currentLimit] = await Promise.all([
      getRecentPostedHistory(env.AI_NEWS_KV),
      getLastDigestStats(env.AI_NEWS_KV),
      isPostingPaused(env.AI_NEWS_KV),
      getActiveModel(env.AI_NEWS_KV),
      getDailyChatLimit(env.AI_NEWS_KV),
    ]);

    const postStatus = paused ? '🛑 PAUSED' : '🟢 ACTIVE';
    const limitDesc = currentLimit === 0 ? 'Disabled (Unlimited)' : `${currentLimit} chat/hari`;

    await sendTelegramMessage(
      token,
      chatId,
      `📊 <b>Status Sistem Technokers AI Bot Pro</b>\n\n` +
        `⚙️ <b>Status Scheduler:</b> ${postStatus}\n` +
        `🧠 <b>Model Aktif:</b> <code>${activeModel}</code>\n` +
        `📅 <b>Waktu Saat Ini:</b> ${formattedDate}\n` +
        `📑 <b>Format Edisi:</b> ${isFriday ? 'Weekly Tech Recap (10 Berita)' : 'Daily AI Update (5 Berita)'}\n` +
        `🛡️ <b>User Daily Limit:</b> ${limitDesc}\n` +
        `📢 <b>Channel Target:</b> ${env.CHANNEL_ID}\n` +
        `⏰ <b>Jadwal:</b> 1x Sehari (18:00 WIB)\n` +
        `💾 <b>Arsip KV:</b> ${history.length} item tersimpan\n` +
        `🕒 <b>Post Terakhir:</b> ${lastStats ? `${new Date(lastStats.timestamp).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB` : '-'}`
    );
    return;
  }

  // ==========================================
  // NATURAL LANGUAGE REMINDER & CRON INTENT
  // e.g. "ingetin aku 15 menit lagi...", "bikin reminder besok jam 7 pagi..."
  // ==========================================
  const reminderIntent = await processReminderIntent(
    env,
    text,
    userId,
    userName,
    chatId,
    userIsAdmin
  );
  if (reminderIntent.handled && reminderIntent.replyText) {
    await sendTelegramMessage(token, chatId, reminderIntent.replyText, {
      replyToMessageId: msg.message_id,
    });
    return;
  }

  // ==========================================
  // REGULAR CONVERSATION CHAT (With Thread / User Isolation & Daily Limit)
  // ==========================================
  const chatPerm = await checkUserChatPermission(env.AI_NEWS_KV, userId, dateStr);
  if (!chatPerm.allowed) {
    await sendTelegramMessage(
      token,
      chatId,
      `⚠️ <b>Batas Chat Harian Tercapai (${chatPerm.count}/${chatPerm.limit})</b>\n\n` +
        `Anda telah menggunakan seluruh kuota chat (${chatPerm.limit} pesan) untuk hari ini.\n` +
        `Kuota akan direset kembali besok pada pukul 00:00 WIB.\n\n` +
        `Tetap ikuti perkembangan berita AI terlengkap di channel <a href="https://t.me/aicomindo">@aicomindo</a>!`
    );
    return;
  }

  if (!chatPerm.isAdmin) {
    await incrementUserDailyChat(env.AI_NEWS_KV, userId, dateStr);
  }

  await sendChatAction(token, chatId, 'typing');

  try {
    const history = await getIsolatedChatHistory(env.AI_NEWS_KV, sessionKey);
    const activeModel = await getActiveModel(env.AI_NEWS_KV);

    const systemPrompt = `Kamu adalah Technokers AI Assistant, asisten cerdas yang ramah, berwawasan luas, dan ahli di bidang Artificial Intelligence, Machine Learning, teknologi masa depan, dan pemrograman.
KONTEKS PENGGUNA TERISOLASI:
- Kamu sedang berbicara secara privat dengan pengguna bernama "${userName}" (${userHandle || 'ID: ' + userId}).
- Sesi percakapan ini sepenuhnya terisolasi dan spesifik untuk pengguna ini. JANGAN PERNAH mencampur adukkan topik atau data dari pengguna lain!
- Panggil nama pengguna dengan ramah jika relevan ("Halo ${userName}", dll).

STANDAR AKSESIBILITAS TEKS (WCAG 2.1 AAA):
1. Jawab dalam Bahasa Indonesia yang alami, bersahabat, jelas, edukatif, dan mudah dipahami.
2. Gunakan tag format HTML Telegram yang valid (<b>tebal</b> untuk poin penting, <i>miring</i> untuk istilah asing, <code>kode</code> untuk sintaks teknis).
3. Buat teks memiliki hierarki visual yang kontras, terstruktur rapi, dan nyaman dibaca oleh pengguna maupun screen reader.
4. Jika ditanya seputar channel atau bot, jelaskan bahwa kamu adalah bot resmi komunitas @aicomindo yang membagikan update AI setiap hari jam 18:00 WIB.
5. Jika ditanya tentang menghubungkan ke Blogger, Gmail, atau Google, informasikan bahwa admin bisa mengonfigurasi kredensialnya di Web Dashboard menu Connectors!`;

    const messagesToSend: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: text },
    ];

    const aiRes = await runUnifiedAiCompletion(env, activeModel, messagesToSend, 1200);
    const replyText = aiRes.text;

    const updatedHistory: ChatMessage[] = [
      ...history,
      { role: 'user', content: text, timestamp: Date.now() },
      { role: 'assistant', content: replyText, timestamp: Date.now() },
    ];
    await saveIsolatedChatHistory(env.AI_NEWS_KV, sessionKey, updatedHistory);

    await sendTelegramMessage(token, chatId, replyText, {
      replyToMessageId: msg.message_id,
    });
  } catch (err) {
    console.error('Error in conversation chat:', err);
    await sendTelegramMessage(
      token,
      chatId,
      '⚠️ Maaf, layanan AI sedang sibuk atau mengalami kendala jaringan. Silakan coba beberapa saat lagi.',
      { replyToMessageId: msg.message_id }
    );
  }
}

function escapeHtml(text: string): string {
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}
