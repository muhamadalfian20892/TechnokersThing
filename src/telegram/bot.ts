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
  getUserChatHistory,
  saveUserChatHistory,
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
import { ChatMessage } from '../news/types';

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: {
      id: number;
      is_bot: boolean;
      first_name?: string;
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
  const text = msg.text.trim();
  const userName = msg.from?.first_name || 'Teman';
  const token = env.TELEGRAM_TOKEN;

  // Rate Limiting Protection (Anti-Flood in private chat)
  const rateLimit = await checkRateLimit(env.AI_NEWS_KV, userId, 25);
  if (!rateLimit.allowed) {
    await sendTelegramMessage(
      token,
      chatId,
      `⚠️ <b>Rate Limit Exceeded</b>\nAnda mengirim pesan terlalu cepat. Harap tunggu sebentar sebelum mencoba kembali.`
    );
    return;
  }

  const userIsAdmin = await isUserAdmin(env.AI_NEWS_KV, userId);
  const { dateStr, formattedDate, isFriday } = getWibInfo();

  // ==========================================
  // NON-ADMIN RESTRICTION CHECK
  // ==========================================
  // Non-admin can ONLY use: /start, /help, /news, and regular chat.
  const isPublicCommand =
    text.startsWith('/start') || text.startsWith('/help') || text.startsWith('/news');

  if (text.startsWith('/') && !isPublicCommand && !userIsAdmin) {
    await sendTelegramMessage(
      token,
      chatId,
      `⛔ <b>Akses Dibatasi</b>\n\n` +
        `Akun Anda belum terdaftar sebagai Admin (@alfian04121).\n` +
        `Pengguna umum hanya dapat menggunakan fitur chat tanya-jawab AI dan perintah /news.\n\n` +
        `📢 Ikuti update berita AI terlengkap di channel <a href="https://t.me/aicomindo">@aicomindo</a>!`
    );
    return;
  }

  // ==========================================
  // PUBLIC COMMAND 1: /start
  // ==========================================
  if (text.startsWith('/start')) {
    if (userIsAdmin) {
      await sendTelegramMessage(
        token,
        chatId,
        `Halo, Admin <b>${userName}</b>! 👑 (@alfian04121)\n\n` +
          `Selamat datang di konsol kontrol <b>Technokers AI Bot Pro</b>! 🤖⚡\n\n` +
          `🔑 <b>Perintah Khusus Admin:</b>\n` +
          `• /dashboard_code - Generate kode OTP 5 menit login Web Dashboard\n` +
          `• /models - Pilih model (Cloudflare AI & Backup OpenAI API)\n` +
          `• /setlimit &lt;angka&gt; - Atur batas chat user (0 = disable limit)\n` +
          `• /preview - Preview draf berita hari ini\n` +
          `• /post_now - Paksa posting sekarang ke channel @aicomindo\n` +
          `• /stop_posting & /resume_posting - Kontrol jeda jadwal posting\n` +
          `• /status & /usage - Pantau sistem & kuota Neurons\n\n` +
          `Ketik /help untuk panduan lengkap semua perintah.`
      );
    } else {
      const dailyLimit = await getDailyChatLimit(env.AI_NEWS_KV);
      const limitText = dailyLimit > 0 ? `${dailyLimit} chat/hari` : 'Unlimited';
      await sendTelegramMessage(
        token,
        chatId,
        `Halo, <b>${userName}</b>! 👋\n\n` +
          `Selamat datang di <b>Technokers AI Bot</b>! 🤖\n` +
          `Asisten cerdas komunitas <a href="https://t.me/aicomindo">@aicomindo</a> (AI Community News Indonesia).\n\n` +
          `✨ <b>Layanan yang Tersedia:</b>\n` +
          `• <b>Tanya AI:</b> Tanyakan apa saja seputar AI, coding, atau tools teknologi (Kuota: ${limitText}).\n` +
          `• <b>/news:</b> Baca ringkasan berita AI terkini kapan saja secara instan!\n\n` +
          `📢 Jangan lupa gabung ke channel resmi kami di <a href="https://t.me/aicomindo">@aicomindo</a> untuk update berita harian jam 18:00 WIB!`
      );
    }
    return;
  }

  // ==========================================
  // PUBLIC COMMAND 2: /help
  // ==========================================
  if (text.startsWith('/help')) {
    if (userIsAdmin) {
      await sendTelegramMessage(
        token,
        chatId,
        `📖 <b>Panduan Lengkap Admin:</b>\n\n` +
          `🔑 <b>Otentikasi & Web Dashboard:</b>\n` +
          `• /dashboard_code - Buat kode OTP masuk dashboard (Valid 5 menit, 1x pakai)\n\n` +
          `🧠 <b>Model & Kuota:</b>\n` +
          `• /models - Daftar model Cloudflare & Backup Provider\n` +
          `• /setmodel &lt;id&gt; - Ganti model AI aktif\n` +
          `• /usage - Cek pemakaian Neurons & Requests\n` +
          `• /health - Uji latensi roundtrip Cloudflare & AI\n\n` +
          `🛡️ <b>Manajemen Limit User:</b>\n` +
          `• /setlimit &lt;n&gt; - Atur batas chat harian (Contoh: /setlimit 40, /setlimit 0)\n` +
          `• /getlimit - Cek batas limit chat yang aktif\n\n` +
          `📢 <b>Kontrol Channel @aicomindo:</b>\n` +
          `• /preview - Preview berita AI hari ini\n` +
          `• /post_now - Kirim langsung postingan ke channel\n` +
          `• /stop_posting - Pause posting otomatis jam 18:00 WIB\n` +
          `• /resume_posting - Aktifkan kembali posting otomatis\n` +
          `• /unlock_today - Buka kunci harian\n` +
          `• /addnews &lt;j&gt; | &lt;l&gt; | &lt;i&gt; - Tambah berita manual breaking news\n` +
          `• /search &lt;kata&gt; - Cari arsip berita di KV\n` +
          `• /logs & /backup - Audit log & ekspor metadata`
      );
    } else {
      await sendTelegramMessage(
        token,
        chatId,
        `📖 <b>Panduan Penggunaan Bot:</b>\n\n` +
          `• <b>Chat Bebas:</b> Kamu bisa langsung mengirim pertanyaan apapun seperti <i>"Apa itu LoRA dalam fine-tuning?"</i> atau <i>"Rekomendasi tool AI buat presentasi"</i>.\n` +
          `• <b>/news:</b> Dapatkan rangkuman berita AI terpanas hari ini.\n\n` +
          `📢 Gabung channel resmi kami di <a href="https://t.me/aicomindo">@aicomindo</a>!`
      );
    }
    return;
  }

  // ==========================================
  // PUBLIC COMMAND 3: /news
  // ==========================================
  if (text.startsWith('/news')) {
    await sendChatAction(token, chatId, 'typing');
    await sendTelegramMessage(
      token,
      chatId,
      `🔍 <i>Sedang mengumpulkan berita AI global terbaru dan menyusun rangkuman mendalam untukmu...</i>`
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
      await sendTelegramMessage(token, chatId, `⚠️ Maaf, ada kendala saat menyusun berita. Silakan coba lagi.`);
    }
    return;
  }

  // ==========================================
  // ADMIN COMMAND 1: /dashboard_code
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
        `🌐 Buka Dashboard:\nhttps://technokersthing.hafiyanajah.workers.dev`
    );
    return;
  }

  // ==========================================
  // ADMIN COMMAND 2: /setlimit <number> & /getlimit
  // ==========================================
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
    await sendTelegramMessage(
      token,
      chatId,
      `📊 <b>Pengaturan Limit Saat Ini:</b> <b>${desc}</b>.`
    );
    return;
  }

  // ==========================================
  // ADMIN COMMAND 3: /models (Cloudflare & Backup)
  // ==========================================
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

  // ==========================================
  // ADMIN COMMAND 4: /setmodel <id>
  // ==========================================
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

  // ==========================================
  // ADMIN COMMAND 5: /usage
  // ==========================================
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

  // ==========================================
  // ADMIN COMMAND 6: /health atau /ping
  // ==========================================
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

  // ==========================================
  // ADMIN COMMAND 7: /stop_posting & /resume_posting
  // ==========================================
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

  // ==========================================
  // ADMIN COMMAND 8: /post_now
  // ==========================================
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

  // ==========================================
  // ADMIN COMMAND 9: /preview
  // ==========================================
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

  // ==========================================
  // ADMIN COMMAND 10: /unlock_today
  // ==========================================
  if (text === '/unlock_today') {
    await clearPostedTodayLock(env.AI_NEWS_KV, dateStr);
    await sendTelegramMessage(
      token,
      chatId,
      `🔓 <b>Kunci Harian Dibuka!</b>\n\nKunci untuk tanggal ${dateStr} telah direset.`
    );
    return;
  }

  // ==========================================
  // ADMIN COMMAND 11: /search <query>
  // ==========================================
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

  // ==========================================
  // ADMIN COMMAND 12: /addnews <title> | <url> | <snippet>
  // ==========================================
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

  // ==========================================
  // ADMIN COMMAND 13: /logs
  // ==========================================
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

  // ==========================================
  // ADMIN COMMAND 14: /status
  // ==========================================
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
  // REGULAR CONVERSATION CHAT (With Daily Limit Check)
  // ==========================================
  // Check user daily chat limit (Admin is exempt)
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

  // Increment user daily count if non-admin
  if (!chatPerm.isAdmin) {
    await incrementUserDailyChat(env.AI_NEWS_KV, userId, dateStr);
  }

  await sendChatAction(token, chatId, 'typing');

  try {
    const history = await getUserChatHistory(env.AI_NEWS_KV, userId);
    const activeModel = await getActiveModel(env.AI_NEWS_KV);

    const systemPrompt = `Kamu adalah Technokers AI Assistant, asisten cerdas yang ramah, berwawasan luas, dan ahli di bidang Artificial Intelligence, Machine Learning, teknologi masa depan, dan pemrograman.
Panduan:
1. Jawab dalam Bahasa Indonesia yang alami, bersahabat, jelas, edukatif, dan menarik.
2. Gunakan tag format HTML Telegram yang valid (<b>tebal</b>, <i>miring</i>, <code>kode</code>) jika diperlukan. Hindari markdown asterisks (** atau ##).
3. Jika ditanya seputar channel atau bot, jelaskan bahwa kamu adalah bot resmi komunitas @aicomindo yang membagikan update AI setiap hari jam 18:00 WIB.`;

    const messagesToSend: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: text },
    ];

    const aiRes = await runUnifiedAiCompletion(env, activeModel, messagesToSend, 1200);
    const replyText = aiRes.text;

    // Save multi-turn conversation memory
    const updatedHistory: ChatMessage[] = [
      ...history,
      { role: 'user', content: text },
      { role: 'assistant', content: replyText },
    ];
    await saveUserChatHistory(env.AI_NEWS_KV, userId, updatedHistory);

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
