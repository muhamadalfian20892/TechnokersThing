import { sendTelegramMessage, sendChatAction } from './api';
import { fetchLatestAINews } from '../news/fetcher';
import {
  filterUnpostedNews,
  recordPostedNews,
  getRecentPostedHistory,
  getLastDigestStats,
} from '../news/memory';
import { generateDailyNewsDigest } from '../news/generator';

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

  // Handle Commands
  if (text.startsWith('/start')) {
    await sendTelegramMessage(
      token,
      chatId,
      `Halo, <b>${userName}</b>! 👋\n\n` +
        `Selamat datang di <b>Technokers AI Bot</b>! 🤖\n` +
        `Saya adalah asisten AI yang bertugas mengkurasi berita & tren AI global terkini setiap hari untuk komunitas <a href="https://t.me/aicomindo">@aicomindo</a>.\n\n` +
        `✨ <b>Fitur Utama:</b>\n` +
        `• <b>Update Berita Harian:</b> Diposting otomatis setiap hari jam <b>18:00 WIB</b> di channel @aicomindo.\n` +
        `• <b>Sistem Anti-Duplikasi:</b> Saya mengingat berita yang sudah diposting sehingga kamu selalu mendapatkan topik baru & segar.\n` +
        `• <b>Tanya Jawab AI Interaktif:</b> Tanyakan apa saja tentang kecerdasan buatan, model LLM, prompt engineering, atau coding langsung di chat ini!\n\n` +
        `🚀 <b>Daftar Perintah:</b>\n` +
        `• /news - Baca ringkasan berita AI terkini sekarang juga\n` +
        `• /status - Cek status bot, memory KV, dan jadwal rilis\n` +
        `• /help - Panduan penggunaan bot\n\n` +
        `<i>Silakan ketik pertanyaan Anda atau pilih perintah di atas!</i>`
    );
    return;
  }

  if (text.startsWith('/help')) {
    await sendTelegramMessage(
      token,
      chatId,
      `📖 <b>Panduan Penggunaan Technokers AI Bot</b>\n\n` +
        `• <b>Chat Bebas:</b> Kamu bisa langsung mengirim pertanyaan apapun seperti <i>"Apa perbedaan Llama 3 dan GPT-4o?"</i> atau <i>"Bagaimana cara kerja RAG?"</i>, dan bot akan langsung menjawabnya.\n` +
        `• <b>/news:</b> Mengambil berita AI terbaru dari berbagai sumber global dan merangkumnya secara instan untukmu.\n` +
        `• <b>/status:</b> Memeriksa status kesehatan bot, total memori KV anti-duplikasi, dan riwayat posting.\n\n` +
        `📢 Jangan lupa gabung ke channel resmi kami di <a href="https://t.me/aicomindo">@aicomindo</a>!`
    );
    return;
  }

  if (text.startsWith('/status')) {
    const history = await getRecentPostedHistory(env.AI_NEWS_KV);
    const lastStats = await getLastDigestStats(env.AI_NEWS_KV);

    const lastPostedText = lastStats
      ? `${new Date(lastStats.timestamp).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB (${lastStats.count} berita)`
      : 'Belum ada catatan postingan';

    await sendTelegramMessage(
      token,
      chatId,
      `📊 <b>Status Sistem Technokers AI Bot</b>\n\n` +
        `🟢 <b>Status:</b> Online & Siap\n` +
        `☁️ <b>Platform:</b> Cloudflare Workers & Workers AI\n` +
        `📢 <b>Channel Target:</b> ${env.CHANNEL_ID}\n` +
        `⏰ <b>Jadwal Posting Otomatis:</b> Setiap 18:00 WIB (11:00 UTC)\n` +
        `🧠 <b>Jumlah Berita di Memori KV:</b> ${history.length} item tersimpan\n` +
        `🕒 <b>Digest Terakhir:</b> ${lastPostedText}\n`
    );
    return;
  }

  if (text.startsWith('/news')) {
    await sendChatAction(token, chatId, 'typing');
    await sendTelegramMessage(
      token,
      chatId,
      `🔍 <i>Sedang mengumpulkan dan merangkum berita AI terbaru untukmu... Mohon tunggu sebentar.</i>`
    );

    try {
      const candidates = await fetchLatestAINews();
      const digest = await generateDailyNewsDigest(env.AI, candidates);
      await sendTelegramMessage(token, chatId, digest);
    } catch (err) {
      console.error('Error generating on-demand news:', err);
      await sendTelegramMessage(
        token,
        chatId,
        `⚠️ Maaf, terjadi kesalahan saat mengambil berita terbaru. Silakan coba lagi nanti.`
      );
    }
    return;
  }

  // Interactive AI Conversation for free-form queries
  await sendChatAction(token, chatId, 'typing');

  try {
    const systemPrompt = `Kamu adalah Technokers AI Assistant, asisten cerdas yang ramah, berwawasan luas, dan ahli di bidang Artificial Intelligence, Machine Learning, pemrograman, dan teknologi.
Panduan Menjawab:
1. Jawab dalam Bahasa Indonesia yang alami, bersahabat, jelas, dan edukatif.
2. Format jawaban menggunakan tag HTML Telegram yang valid (<b>tebal</b>, <i>miring</i>, <code>kode</code>) jika diperlukan. Hindari markdown syntax seperti ** atau ##.
3. Jawab secara ringkas, to the point, dan tidak bertele-tele agar nyaman dibaca di layar smartphone Telegram.
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
    // Fallback to Llama 3.1 8B
    try {
      const fallbackRes = (await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
        messages: [
          {
            role: 'system',
            content:
              'Kamu adalah AI assistant ramah berbahasa Indonesia dari @aicomindo. Jawab singkat dan jelas.',
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
    } catch (fallbackErr) {
      await sendTelegramMessage(
        token,
        chatId,
        '⚠️ Maaf, layanan AI sedang sibuk. Silakan coba kirim pesan beberapa saat lagi.',
        { replyToMessageId: msg.message_id }
      );
    }
  }
}
