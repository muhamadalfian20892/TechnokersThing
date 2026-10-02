import { sendTelegramMessage, sendChatAction } from './api';
import { fetchLatestAINews } from '../news/fetcher';
import {
  filterUnpostedNews,
  getRecentPostedHistory,
  getLastDigestStats,
  isPostingPaused,
  setPostingPaused,
  hasPostedToday,
} from '../news/memory';
import { generateDailyNewsDigest, getWibInfo } from '../news/generator';
import { executeDailyNewsPosting } from '../index';

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
  const text = msg.text.trim();
  const userName = msg.from?.first_name || 'Teman';
  const token = env.TELEGRAM_TOKEN;

  // 1. Admin Commands: Stop / Pause Posting
  if (text === '/stop_posting' || text === '/pause' || text === '/stop') {
    await setPostingPaused(env.AI_NEWS_KV, true);
    await sendTelegramMessage(
      token,
      chatId,
      `🛑 <b>Posting Otomatis Diberhentikan (PAUSED)!</b>\n\n` +
        `Jadwal posting otomatis jam 18:00 WIB ke channel ${env.CHANNEL_ID} sekarang dalam status <b>PAUSED</b>.\n` +
        `Bot tidak akan mengirimkan postingan apapun sampai Anda mengaktifkannya kembali.\n\n` +
        `Ketik /resume_posting atau /resume untuk mengaktifkan kembali.`
    );
    return;
  }

  // 2. Admin Commands: Resume Posting
  if (text === '/resume_posting' || text === '/resume' || text === '/start_posting') {
    await setPostingPaused(env.AI_NEWS_KV, false);
    await sendTelegramMessage(
      token,
      chatId,
      `🟢 <b>Posting Otomatis Diaktifkan Kembali (ACTIVE)!</b>\n\n` +
        `Bot akan kembali berjalan normal dan memposting digest berita ke channel ${env.CHANNEL_ID} setiap hari pukul <b>18:00 WIB</b> (1x sehari).`
    );
    return;
  }

  // 3. Admin Command: Force Post Now
  if (text === '/post_now' || text === '/broadcast_now') {
    await sendChatAction(token, chatId, 'typing');
    await sendTelegramMessage(
      token,
      chatId,
      `⏳ <i>Sedang memproses dan mengirim postingan berita langsung ke channel ${env.CHANNEL_ID}...</i>`
    );

    const result = await executeDailyNewsPosting(env, true);
    if (result.success) {
      await sendTelegramMessage(
        token,
        chatId,
        `✅ <b>Berhasil Terkirim!</b>\n\n` +
          `${result.message}\n` +
          `Jumlah berita terangkum: ${result.postedCount} berita.`
      );
    } else {
      await sendTelegramMessage(
        token,
        chatId,
        `⚠️ <b>Gagal Posting:</b>\n${result.message}`
      );
    }
    return;
  }

  // 4. Admin Command: Preview Digest
  if (text === '/preview') {
    await sendChatAction(token, chatId, 'typing');
    await sendTelegramMessage(
      token,
      chatId,
      `🔍 <i>Sedang menyusun pratinjau berita AI (sesuai format hari ini)...</i>`
    );

    try {
      const { isFriday } = getWibInfo();
      const candidates = await fetchLatestAINews();
      const unposted = await filterUnpostedNews(env.AI_NEWS_KV, candidates);
      const targetCount = isFriday ? 10 : 5;
      const itemsToPost = unposted.length > 0 ? unposted.slice(0, targetCount) : candidates.slice(0, targetCount);
      const digest = await generateDailyNewsDigest(env.AI, itemsToPost, isFriday);

      await sendTelegramMessage(token, chatId, digest);
    } catch (err) {
      console.error('Error generating preview:', err);
      await sendTelegramMessage(token, chatId, `⚠️ Gagal menghasilkan preview: ${String(err)}`);
    }
    return;
  }

  // 5. User Command: /start
  if (text.startsWith('/start')) {
    await sendTelegramMessage(
      token,
      chatId,
      `Halo, <b>${userName}</b>! 👋\n\n` +
        `Selamat datang di <b>Technokers AI Bot</b>! 🤖\n` +
        `Saya mengkurasi berita & tren AI global terkini secara otomatis untuk komunitas <a href="https://t.me/aicomindo">@aicomindo</a>.\n\n` +
        `✨ <b>Aturan Posting:</b>\n` +
        `• <b>Jadwal:</b> Tepat 1x sehari pukul <b>18:00 WIB</b>.\n` +
        `• <b>Hari Jumat:</b> <i>Weekly Tech & AI Recap</i> (7-10 gebrakan paling gila dalam seminggu).\n` +
        `• <b>Hari Lain:</b> <i>Daily AI Update</i> (3-5 terobosan terpanas hari ini).\n` +
        `• <b>Anti-Spam & Anti-Duplikasi:</b> Terproteksi Cloudflare KV agar berita tidak pernah berulang.\n\n` +
        `🛠️ <b>Perintah Kontrol:</b>\n` +
        `• /news - Baca ringkasan berita AI terkini sekarang\n` +
        `• /preview - Preview draf postingan hari ini\n` +
        `• /status - Cek status bot, memory KV, & jadwal\n` +
        `• /stop_posting - 🛑 Hentikan posting otomatis (Admin)\n` +
        `• /resume_posting - 🟢 Aktifkan kembali posting (Admin)\n` +
        `• /post_now - 🚀 Kirim postingan sekarang ke channel (Admin)\n` +
        `• /help - Panduan lengkap\n\n` +
        `<i>Kamu juga bisa langsung tanya apa saja seputar AI di chat ini!</i>`
    );
    return;
  }

  // 6. User Command: /help
  if (text.startsWith('/help')) {
    await sendTelegramMessage(
      token,
      chatId,
      `📖 <b>Panduan Technokers AI Bot</b>\n\n` +
        `• <b>Tanya AI:</b> Kirim pesan apapun seperti <i>"Jelaskan apa itu Agentic AI"</i> atau <i>"Rekomendasi model LLM coding"</i>.\n` +
        `• <b>/news:</b> Mengambil berita terkini on-demand.\n` +
        `• <b>/preview:</b> Melihat pratinjau berita yang siap dirilis.\n` +
        `• <b>/status:</b> Status sistem & kunci harian.\n\n` +
        `🛡️ <b>Kontrol Admin (Anti-Spam):</b>\n` +
        `• /stop_posting : Menghentikan scheduler posting harian.\n` +
        `• /resume_posting : Mengaktifkan kembali scheduler.\n` +
        `• /post_now : Memaksa pengiriman postingan langsung ke channel.\n\n` +
        `📢 Channel Resmi: <a href="https://t.me/aicomindo">@aicomindo</a>`
    );
    return;
  }

  // 7. System Status: /status
  if (text.startsWith('/status')) {
    const { dateStr, isFriday, formattedDate } = getWibInfo();
    const [history, lastStats, paused, postedToday] = await Promise.all([
      getRecentPostedHistory(env.AI_NEWS_KV),
      getLastDigestStats(env.AI_NEWS_KV),
      isPostingPaused(env.AI_NEWS_KV),
      hasPostedToday(env.AI_NEWS_KV, dateStr),
    ]);

    const postStatus = paused ? '🛑 PAUSED (Dinonaktifkan Admin)' : '🟢 ACTIVE (Siap posting)';
    const todayStatus = postedToday ? '✅ Sudah diposting' : '⏳ Menunggu jam 18:00 WIB';

    await sendTelegramMessage(
      token,
      chatId,
      `📊 <b>Status Sistem Technokers AI Bot</b>\n\n` +
        `⚙️ <b>Status Scheduler:</b> ${postStatus}\n` +
        `📅 <b>Waktu Saat Ini:</b> ${formattedDate}\n` +
        `📑 <b>Format Hari Ini:</b> ${isFriday ? 'Weekly Tech Recap (Jumat)' : 'Daily AI Update'}\n` +
        `🔒 <b>Status Hari Ini:</b> ${todayStatus}\n` +
        `📢 <b>Channel:</b> ${env.CHANNEL_ID}\n` +
        `⏰ <b>Jadwal:</b> 1x Sehari (Pukul 18:00 WIB)\n` +
        `🧠 <b>Riwayat Berita di KV:</b> ${history.length} item tersimpan\n` +
        `🕒 <b>Post Terakhir:</b> ${lastStats ? `${new Date(lastStats.timestamp).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB` : '-'}`
    );
    return;
  }

  // 8. On-demand News: /news
  if (text.startsWith('/news')) {
    await sendChatAction(token, chatId, 'typing');
    await sendTelegramMessage(
      token,
      chatId,
      `🔍 <i>Sedang mengumpulkan berita AI terbaru dan menyusun analisanya untukmu... Mohon tunggu sebentar.</i>`
    );

    try {
      const { isFriday } = getWibInfo();
      const candidates = await fetchLatestAINews();
      const unposted = await filterUnpostedNews(env.AI_NEWS_KV, candidates);
      const targetCount = isFriday ? 10 : 5;
      const itemsToPost = unposted.length > 0 ? unposted.slice(0, targetCount) : candidates.slice(0, targetCount);
      const digest = await generateDailyNewsDigest(env.AI, itemsToPost, isFriday);

      await sendTelegramMessage(token, chatId, digest);
    } catch (err) {
      console.error('Error in /news command:', err);
      await sendTelegramMessage(
        token,
        chatId,
        `⚠️ Maaf, ada kendala saat menyusun berita. Silakan coba kembali nanti.`
      );
    }
    return;
  }

  // 9. Interactive AI Conversation for free-form queries
  await sendChatAction(token, chatId, 'typing');

  try {
    const systemPrompt = `Kamu adalah Technokers AI Assistant, asisten cerdas yang ramah, berwawasan luas, dan ahli di bidang Artificial Intelligence, Machine Learning, pemrograman, dan teknologi.
Panduan Menjawab:
1. Jawab dalam Bahasa Indonesia yang alami, bersahabat, jelas, dan edukatif.
2. Format jawaban menggunakan tag HTML Telegram yang valid (<b>tebal</b>, <i>miring</i>, <code>kode</code>) jika diperlukan. Hindari markdown syntax seperti ** atau ##.
3. Jawab secara ringkas, to the point, dan informatif.
4. Jika ditanya seputar channel atau bot, jelaskan bahwa kamu adalah bot resmi komunitas @aicomindo yang membagikan update AI setiap hari jam 18:00 WIB.`;

    const aiRes = (await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text },
      ],
      max_tokens: 800,
      temperature: 0.7,
    })) as { response?: string };

    const replyText =
      aiRes.response?.trim() ||
      'Maaf, saya tidak dapat merespons saat ini. Silakan coba lagi sebentar.';

    await sendTelegramMessage(token, chatId, replyText, {
      replyToMessageId: msg.message_id,
    });
  } catch (err) {
    console.error('Error in interactive AI chat:', err);
    try {
      const fallbackRes = (await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
        messages: [
          {
            role: 'system',
            content: 'Kamu adalah AI assistant ramah dari @aicomindo. Jawab singkat dan jelas dalam bahasa Indonesia.',
          },
          { role: 'user', content: text },
        ],
        max_tokens: 600,
      })) as { response?: string };

      await sendTelegramMessage(
        token,
        chatId,
        fallbackRes.response?.trim() || 'Ada kendala saat memproses jawaban.',
        { replyToMessageId: msg.message_id }
      );
    } catch {
      await sendTelegramMessage(
        token,
        chatId,
        '⚠️ Maaf, layanan AI sedang sibuk. Silakan coba kirim pesan beberapa saat lagi.',
        { replyToMessageId: msg.message_id }
      );
    }
  }
}
