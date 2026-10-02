import { sendTelegramMessage, sendChatAction } from './api';
import { fetchLatestAINews } from '../news/fetcher';
import {
  filterUnpostedNews,
  getRecentPostedHistory,
  getLastDigestStats,
  isPostingPaused,
  setPostingPaused,
  hasPostedToday,
  clearPostedTodayLock,
  getActiveModel,
  setActiveModel,
  getUsageStats,
  recordUsage,
  getStyleMemory,
  setStyleMemory,
  resetStyleMemory,
  getAdminList,
  addAdmin,
  isUserAdmin,
  getUserChatHistory,
  saveUserChatHistory,
  checkRateLimit,
  getAuditLogs,
  addAuditLog,
  addInjectedNews,
  searchPostedNews,
} from '../news/memory';
import { generateDailyNewsDigest, getWibInfo } from '../news/generator';
import { fetchLiveCloudflareModels } from '../news/models';
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

  // Track overall request
  await recordUsage(env.AI_NEWS_KV, 0, false);

  // Rate Limiting Protection (Anti-Flood in private chat)
  const rateLimit = await checkRateLimit(env.AI_NEWS_KV, userId, 20);
  if (!rateLimit.allowed) {
    await sendTelegramMessage(
      token,
      chatId,
      `⚠️ <b>Rate Limit Exceeded</b>\nAnda mengirim pesan terlalu cepat. Harap tunggu 1 menit sebelum mencoba kembali.`
    );
    return;
  }

  // Auto-register first user as admin if admin list is empty
  const admins = await getAdminList(env.AI_NEWS_KV);
  if (admins.length === 0) {
    await addAdmin(env.AI_NEWS_KV, userId);
  }

  const userIsAdmin = await isUserAdmin(env.AI_NEWS_KV, userId);

  // ==========================================
  // COMMAND 1: /start
  // ==========================================
  if (text.startsWith('/start')) {
    await sendTelegramMessage(
      token,
      chatId,
      `Halo, <b>${userName}</b>! 👋\n\n` +
        `Selamat datang di <b>Technokers AI Bot Pro</b>! 🤖⚡\n` +
        `Sistem AI cerdas & otomatis untuk kurasi berita teknologi dan AI di channel <a href="https://t.me/aicomindo">@aicomindo</a>.\n\n` +
        `🌟 <b>Fitur Utama:</b>\n` +
        `• <b>Posting Otomatis 18:00 WIB:</b> Tepat 1x sehari, anti-spam, format panjang & berbobot.\n` +
        `• <b>Jumat Tech Recap:</b> Rangkuman 10 gebrakan paling gila dalam seminggu.\n` +
        `• <b>Model Switcher:</b> Ganti model AI Cloudflare secara dinamis (/models).\n` +
        `• <b>Usage Monitor:</b> Pantau kuota neurons & estimasi limit harian (/usage).\n` +
        `• <b>Chat Interaktif Berkelanjutan:</b> Tanya apa saja dengan memori konteks chat!\n\n` +
        `Ketik /help untuk melihat 20+ perintah lengkap.`
    );
    return;
  }

  // ==========================================
  // COMMAND 2: /help
  // ==========================================
  if (text.startsWith('/help')) {
    await sendTelegramMessage(
      token,
      chatId,
      `📖 <b>Daftar Perintah Technokers AI Bot</b>\n\n` +
        `🤖 <b>Umum & Berita:</b>\n` +
        `• /news - Ringkasan berita terkini on-demand\n` +
        `• /preview - Preview draf postingan hari ini\n` +
        `• /search &lt;kata&gt; - Cari arsip berita yang pernah diposting\n` +
        `• /status - Status lengkap sistem, memori, & jadwal\n` +
        `• /health atau /ping - Uji latensi Cloudflare AI & KV\n` +
        `• /usage - Monitor estimasi penggunaan Neurons & limit\n\n` +
        `🧠 <b>Manajemen AI Model & Gaya:</b>\n` +
        `• /models - Lihat daftar model resmi dari Cloudflare\n` +
        `• /setmodel &lt;id&gt; - Ganti model AI aktif\n` +
        `• /getstyle - Cek template gaya penulisan few-shot\n` +
        `• /resetstyle - Kembalikan template gaya ke default\n\n` +
        `🛡️ <b>Kontrol Admin:</b>\n` +
        `• /stop_posting - 🛑 Hentikan posting harian (Pause)\n` +
        `• /resume_posting - 🟢 Aktifkan kembali posting harian\n` +
        `• /post_now - 🚀 Paksa posting sekarang ke channel\n` +
        `• /unlock_today - Buka kunci harian jika ingin re-test\n` +
        `• /addnews &lt;judul&gt; | &lt;link&gt; | &lt;info&gt; - Suntikkan berita manual\n` +
        `• /logs - Lihat log aktivitas audit sistem\n` +
        `• /backup - Ekspor riwayat berita KV\n` +
        `• /admins - Cek daftar admin bot\n\n` +
        `<i>Atau ketik pesan apapun langsung untuk mengobrol dengan asisten AI!</i>`
    );
    return;
  }

  // ==========================================
  // COMMAND 3: /models (Live Cloudflare Catalog)
  // ==========================================
  if (text.startsWith('/models')) {
    await sendChatAction(token, chatId, 'typing');
    const [models, activeModel] = await Promise.all([
      fetchLiveCloudflareModels(env.AI_NEWS_KV),
      getActiveModel(env.AI_NEWS_KV),
    ]);

    const modelLines = models.slice(0, 12).map((m) => {
      const isActive = m.id === activeModel ? ' 🟢 [AKTIF]' : '';
      return `• <code>${m.id}</code>${isActive}\n  <i>${m.author} - ${m.description?.slice(0, 60)}...</i>`;
    });

    await sendTelegramMessage(
      token,
      chatId,
      `🌐 <b>Daftar Model Cloudflare Workers AI</b> (Live Catalog)\n\n` +
        `Model Aktif Saat Ini:\n👉 <code>${activeModel}</code>\n\n` +
        modelLines.join('\n\n') +
        `\n\n💡 <b>Cara Mengganti Model:</b>\nKetik: <code>/setmodel @cf/meta/llama-3.3-70b-instruct-fp8-fast</code>`
    );
    return;
  }

  // ==========================================
  // COMMAND 4: /setmodel <id>
  // ==========================================
  if (text.startsWith('/setmodel')) {
    if (!userIsAdmin) {
      await sendTelegramMessage(token, chatId, '⛔ Perintah ini khusus untuk Admin.');
      return;
    }
    const modelArg = text.replace('/setmodel', '').trim();
    if (!modelArg) {
      await sendTelegramMessage(
        token,
        chatId,
        `⚠️ Format salah. Contoh:\n<code>/setmodel @cf/meta/llama-3.3-70b-instruct-fp8-fast</code>`
      );
      return;
    }

    await setActiveModel(env.AI_NEWS_KV, modelArg);
    await sendTelegramMessage(
      token,
      chatId,
      `✅ <b>Model AI Berhasil Diperbarui!</b>\n\nModel aktif sekarang:\n<code>${modelArg}</code>\n\nSemua digest dan respon chat berikutnya akan diproses menggunakan model ini.`
    );
    return;
  }

  // ==========================================
  // COMMAND 5: /usage (Limits & Quota Monitor)
  // ==========================================
  if (text.startsWith('/usage')) {
    const stats = await getUsageStats(env.AI_NEWS_KV);
    const freeTierDailyNeurons = 10000;
    const pct = Math.min(100, Math.round((stats.neuronsEstimated / freeTierDailyNeurons) * 100));
    const progressBar = '█'.repeat(Math.floor(pct / 10)) + '░'.repeat(10 - Math.floor(pct / 10));

    await sendTelegramMessage(
      token,
      chatId,
      `📊 <b>Pemakaian & Kuota Cloudflare Workers AI</b>\n📅 <i>Hari Ini (${stats.date})</i>\n\n` +
        `⚡ <b>Generasi AI Selesai:</b> ${stats.aiGenerations} kali\n` +
        `🌐 <b>Total HTTP Requests:</b> ${stats.totalRequests}\n` +
        `🔤 <b>Estimasi Token Diproses:</b> ${stats.totalTokensEstimated.toLocaleString('id-ID')} token\n` +
        `🧠 <b>Estimasi Neurons Terpakai:</b> ${stats.neuronsEstimated.toLocaleString('id-ID')} / ${freeTierDailyNeurons.toLocaleString('id-ID')} Neurons\n\n` +
        `[${progressBar}] <b>${pct}%</b>\n\n` +
        `💡 <i>Cloudflare Free Tier mencakup 10.000 Neurons/hari gratis. Bot otomatis menerapkan deduplikasi dan caching agar kuota Anda sangat hemat!</i>`
    );
    return;
  }

  // ==========================================
  // COMMAND 6: /health atau /ping
  // ==========================================
  if (text.startsWith('/health') || text.startsWith('/ping')) {
    const t0 = Date.now();
    // Test KV latency
    await env.AI_NEWS_KV.get('config:active_model');
    const kvLatency = Date.now() - t0;

    // Test Workers AI latency
    const t1 = Date.now();
    let aiStatus = 'OK';
    try {
      await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
        prompt: 'hi',
        max_tokens: 2,
      });
    } catch (e) {
      aiStatus = 'Degraded';
    }
    const aiLatency = Date.now() - t1;

    await sendTelegramMessage(
      token,
      chatId,
      `🏓 <b>Pong! Status Kesehatan Sistem:</b>\n\n` +
        `🟢 <b>Worker Core:</b> Online\n` +
        `💾 <b>Cloudflare KV Latency:</b> ${kvLatency} ms\n` +
        `⚡ <b>Workers AI Latency:</b> ${aiLatency} ms (${aiStatus})\n` +
        `⏱️ <b>Total Roundtrip:</b> ${Date.now() - t0} ms`
    );
    return;
  }

  // ==========================================
  // COMMAND 7: /stop_posting /pause
  // ==========================================
  if (text === '/stop_posting' || text === '/pause' || text === '/stop') {
    if (!userIsAdmin) {
      await sendTelegramMessage(token, chatId, '⛔ Perintah ini khusus untuk Admin.');
      return;
    }
    await setPostingPaused(env.AI_NEWS_KV, true);
    await sendTelegramMessage(
      token,
      chatId,
      `🛑 <b>Posting Otomatis Diberhentikan (PAUSED)!</b>\n\nJadwal harian jam 18:00 WIB tidak akan mengirim apa pun ke ${env.CHANNEL_ID}.\nKetik /resume_posting untuk mengaktifkan kembali.`
    );
    return;
  }

  // ==========================================
  // COMMAND 8: /resume_posting /resume
  // ==========================================
  if (text === '/resume_posting' || text === '/resume' || text === '/start_posting') {
    if (!userIsAdmin) {
      await sendTelegramMessage(token, chatId, '⛔ Perintah ini khusus untuk Admin.');
      return;
    }
    await setPostingPaused(env.AI_NEWS_KV, false);
    await sendTelegramMessage(
      token,
      chatId,
      `🟢 <b>Posting Otomatis Diaktifkan Kembali (ACTIVE)!</b>\n\nBot akan kembali memposting setiap hari pukul <b>18:00 WIB</b> ke ${env.CHANNEL_ID}.`
    );
    return;
  }

  // ==========================================
  // COMMAND 9: /post_now
  // ==========================================
  if (text === '/post_now' || text === '/broadcast_now') {
    if (!userIsAdmin) {
      await sendTelegramMessage(token, chatId, '⛔ Perintah ini khusus untuk Admin.');
      return;
    }
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
  // COMMAND 10: /preview
  // ==========================================
  if (text === '/preview') {
    await sendChatAction(token, chatId, 'typing');
    await sendTelegramMessage(
      token,
      chatId,
      `🔍 <i>Sedang menyusun draf berita AI berbobot sesuai format hari ini...</i>`
    );

    try {
      const { isFriday } = getWibInfo();
      const candidates = await fetchLatestAINews();
      const unposted = await filterUnpostedNews(env.AI_NEWS_KV, candidates);
      const targetCount = isFriday ? 10 : 5;
      const itemsToPost = unposted.length > 0 ? unposted.slice(0, targetCount) : candidates.slice(0, targetCount);
      const digest = await generateDailyNewsDigest(env.AI, env.AI_NEWS_KV, itemsToPost, isFriday);

      await sendTelegramMessage(token, chatId, digest);
    } catch (err) {
      console.error('Error generating preview:', err);
      await sendTelegramMessage(token, chatId, `⚠️ Gagal menghasilkan preview: ${String(err)}`);
    }
    return;
  }

  // ==========================================
  // COMMAND 11: /unlock_today
  // ==========================================
  if (text === '/unlock_today') {
    if (!userIsAdmin) {
      await sendTelegramMessage(token, chatId, '⛔ Perintah ini khusus untuk Admin.');
      return;
    }
    const { dateStr } = getWibInfo();
    await clearPostedTodayLock(env.AI_NEWS_KV, dateStr);
    await sendTelegramMessage(
      token,
      chatId,
      `🔓 <b>Kunci Harian Dibuka!</b>\n\nKunci untuk tanggal ${dateStr} telah direset. Scheduler atau /post_now bisa kembali dijalankan hari ini.`
    );
    return;
  }

  // ==========================================
  // COMMAND 12: /getstyle & /resetstyle
  // ==========================================
  if (text.startsWith('/getstyle')) {
    const style = await getStyleMemory(env.AI_NEWS_KV);
    await sendTelegramMessage(
      token,
      chatId,
      `📝 <b>Template Few-Shot Style Memory:</b>\n\n<code>${style.slice(0, 1500)}...</code>`
    );
    return;
  }

  if (text.startsWith('/resetstyle')) {
    if (!userIsAdmin) {
      await sendTelegramMessage(token, chatId, '⛔ Perintah ini khusus untuk Admin.');
      return;
    }
    await resetStyleMemory(env.AI_NEWS_KV);
    await sendTelegramMessage(token, chatId, `✅ Template gaya telah direset ke contoh default.`);
    return;
  }

  // ==========================================
  // COMMAND 13: /search <query>
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
  // COMMAND 14: /addnews <title> | <url> | <snippet>
  // ==========================================
  if (text.startsWith('/addnews')) {
    if (!userIsAdmin) {
      await sendTelegramMessage(token, chatId, '⛔ Perintah ini khusus untuk Admin.');
      return;
    }
    const raw = text.replace('/addnews', '').trim();
    const parts = raw.split('|').map((p) => p.trim());
    if (parts.length < 2) {
      await sendTelegramMessage(
        token,
        chatId,
        `⚠️ Format salah. Gunakan:\n<code>/addnews Judul Berita | https://link-sumber.com | Detail singkat</code>`
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
  // COMMAND 15: /logs
  // ==========================================
  if (text.startsWith('/logs')) {
    if (!userIsAdmin) {
      await sendTelegramMessage(token, chatId, '⛔ Perintah ini khusus untuk Admin.');
      return;
    }
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
  // COMMAND 16: /admins & /setadmin
  // ==========================================
  if (text.startsWith('/admins')) {
    const list = await getAdminList(env.AI_NEWS_KV);
    await sendTelegramMessage(
      token,
      chatId,
      `👥 <b>Daftar Admin Bot:</b>\n` + list.map((a) => `• <code>${a}</code>`).join('\n')
    );
    return;
  }

  if (text.startsWith('/setadmin')) {
    await addAdmin(env.AI_NEWS_KV, userId);
    await sendTelegramMessage(token, chatId, `✅ User ID <code>${userId}</code> telah ditambahkan sebagai Admin.`);
    return;
  }

  // ==========================================
  // COMMAND 17: /backup
  // ==========================================
  if (text.startsWith('/backup')) {
    if (!userIsAdmin) {
      await sendTelegramMessage(token, chatId, '⛔ Perintah ini khusus untuk Admin.');
      return;
    }
    const history = await getRecentPostedHistory(env.AI_NEWS_KV);
    const stats = await getLastDigestStats(env.AI_NEWS_KV);
    const payload = JSON.stringify({ totalItems: history.length, lastStats: stats, items: history.slice(0, 15) }, null, 2);
    await sendTelegramMessage(
      token,
      chatId,
      `📦 <b>Backup Metadata KV:</b>\n\n<pre><code>${payload.slice(0, 3500)}</code></pre>`
    );
    return;
  }

  // ==========================================
  // COMMAND 18: /status
  // ==========================================
  if (text.startsWith('/status')) {
    const { dateStr, isFriday, formattedDate } = getWibInfo();
    const [history, lastStats, paused, postedToday, activeModel] = await Promise.all([
      getRecentPostedHistory(env.AI_NEWS_KV),
      getLastDigestStats(env.AI_NEWS_KV),
      isPostingPaused(env.AI_NEWS_KV),
      hasPostedToday(env.AI_NEWS_KV, dateStr),
      getActiveModel(env.AI_NEWS_KV),
    ]);

    const postStatus = paused ? '🛑 PAUSED (Dinonaktifkan)' : '🟢 ACTIVE (Siap posting)';
    const todayStatus = postedToday ? '✅ Sudah diposting hari ini' : '⏳ Menunggu jam 18:00 WIB';

    await sendTelegramMessage(
      token,
      chatId,
      `📊 <b>Status Sistem Technokers AI Bot Pro</b>\n\n` +
        `⚙️ <b>Status Scheduler:</b> ${postStatus}\n` +
        `🧠 <b>Model Aktif:</b> <code>${activeModel}</code>\n` +
        `📅 <b>Waktu Saat Ini:</b> ${formattedDate}\n` +
        `📑 <b>Format Edisi:</b> ${isFriday ? 'Weekly Tech Recap (10 Berita)' : 'Daily AI Update (5 Berita)'}\n` +
        `🔒 <b>Status Hari Ini:</b> ${todayStatus}\n` +
        `📢 <b>Channel Target:</b> ${env.CHANNEL_ID}\n` +
        `⏰ <b>Jadwal:</b> Tepat 1x Sehari (Pukul 18:00 WIB)\n` +
        `💾 <b>Total Berita di Memori KV:</b> ${history.length} item tersimpan\n` +
        `🕒 <b>Postingan Terakhir:</b> ${lastStats ? `${new Date(lastStats.timestamp).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB (${lastStats.count} berita)` : '-'}`
    );
    return;
  }

  // ==========================================
  // COMMAND 19: /news
  // ==========================================
  if (text.startsWith('/news')) {
    await sendChatAction(token, chatId, 'typing');
    await sendTelegramMessage(
      token,
      chatId,
      `🔍 <i>Sedang mengumpulkan berita AI global terbaru dan menyusun rangkuman mendalam... Mohon tunggu sebentar.</i>`
    );

    try {
      const { isFriday } = getWibInfo();
      const candidates = await fetchLatestAINews();
      const unposted = await filterUnpostedNews(env.AI_NEWS_KV, candidates);
      const targetCount = isFriday ? 10 : 5;
      const itemsToPost = unposted.length > 0 ? unposted.slice(0, targetCount) : candidates.slice(0, targetCount);
      const digest = await generateDailyNewsDigest(env.AI, env.AI_NEWS_KV, itemsToPost, isFriday);

      await sendTelegramMessage(token, chatId, digest);
    } catch (err) {
      console.error('Error in /news command:', err);
      await sendTelegramMessage(token, chatId, `⚠️ Maaf, ada kendala saat menyusun berita. Silakan coba lagi.`);
    }
    return;
  }

  // ==========================================
  // ABILITY 20: Conversational Memory Chat (Multi-Turn)
  // ==========================================
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

    const aiRes = (await env.AI.run(activeModel as any, {
      messages: messagesToSend,
      max_tokens: 1000,
      temperature: 0.7,
    })) as { response?: string };

    const replyText =
      aiRes.response?.trim() ||
      'Maaf, saya tidak dapat merespons saat ini. Silakan coba kembali nanti.';

    // Save multi-turn conversation memory
    const updatedHistory: ChatMessage[] = [
      ...history,
      { role: 'user', content: text },
      { role: 'assistant', content: replyText },
    ];
    await saveUserChatHistory(env.AI_NEWS_KV, userId, updatedHistory);

    // Track usage
    await recordUsage(env.AI_NEWS_KV, Math.round((text.length + replyText.length) / 4), true);

    await sendTelegramMessage(token, chatId, replyText, {
      replyToMessageId: msg.message_id,
    });
  } catch (err) {
    console.error('Error in interactive conversation:', err);
    // Fallback to Llama 3.1 8B
    try {
      const fallbackRes = (await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
        messages: [
          {
            role: 'system',
            content: 'Kamu adalah asisten ramah komunitas @aicomindo. Jawab singkat dan jelas dalam bahasa Indonesia.',
          },
          { role: 'user', content: text },
        ],
        max_tokens: 600,
      })) as { response?: string };

      await sendTelegramMessage(
        token,
        chatId,
        fallbackRes.response?.trim() || 'Ada kendala saat memproses tanggapan.',
        { replyToMessageId: msg.message_id }
      );
    } catch {
      await sendTelegramMessage(
        token,
        chatId,
        '⚠️ Maaf, layanan AI sedang sibuk. Silakan coba beberapa saat lagi.',
        { replyToMessageId: msg.message_id }
      );
    }
  }
}
