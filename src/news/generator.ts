import { RawNewsItem } from './types';

function formatDateWIB(): string {
  // Format current date into Indonesian WIB (UTC+7)
  const now = new Date();
  const wibTime = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const months = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
  ];

  const dayName = days[wibTime.getUTCDay()];
  const date = wibTime.getUTCDate();
  const monthName = months[wibTime.getUTCMonth()];
  const year = wibTime.getUTCFullYear();

  return `${dayName}, ${date} ${monthName} ${year}`;
}

export async function generateDailyNewsDigest(
  ai: Ai,
  newsItems: RawNewsItem[]
): Promise<string> {
  const dateStr = formatDateWIB();

  if (newsItems.length === 0) {
    return `🤖 <b>AI DAILY DIGEST | @aicomindo</b>\n📅 <i>${dateStr}</i>\n\nBelum ada berita baru yang signifikan hari ini atau semua pembaruan telah diposting sebelumnya. Tetap ikuti @aicomindo untuk update seputar AI terkini!\n\n#AINews #aicomindo`;
  }

  // Pick top 3 to 5 most relevant news items
  const selected = newsItems.slice(0, 5);

  const newsSummaryList = selected
    .map(
      (item, idx) =>
        `${idx + 1}. Judul: "${item.title}"\nSumber: ${item.source}\nLink: ${item.url}\nDetail Singkat: ${item.snippet || 'None'}`
    )
    .join('\n\n');

  const systemPrompt = `Kamu adalah AI Tech Journalist dan Lead Editor untuk komunitas "AI Community News Indonesia" (@aicomindo).
Tugasmu adalah merangkum berita-berita AI global terbaru menjadi satu postingan ringkasan harian (AI Daily Digest) berbahasa Indonesia yang:
1. Sangat informatif, akurat, dan mudah dipahami oleh pembaca umum maupun developer/praktisi AI.
2. Menggunakan gaya bahasa profesional, santai, dan modern (tidak kaku seperti koran lama).
3. Gunakan tag format HTML Telegram:
   - <b>Teks tebal</b> untuk judul atau poin penting
   - <i>Teks miring</i> untuk istilah asing atau catatan
   - <a href="URL">Teks Link</a> untuk tautan sumber
   JANGAN gunakan format Markdown seperti ** atau * atau _, gunakan tag HTML Telegram resmi (b, i, a).
4. Struktur postingan:
   - Header: ⚡ <b>AI DAILY DIGEST | @aicomindo</b>
   - Subheader: 📅 <i>${dateStr}</i>
   - Intro singkat yang menarik (1-2 kalimat)
   - 3-5 Poin Berita Utama. Setiap berita harus memiliki:
     🔹 <b>[Judul Berita Bahasa Indonesia Menarik]</b>
     Penjelasan inti berita dan apa dampaknya bagi industri / pengguna biasa (2-3 kalimat jelas).
     🔗 <a href="URL_SUMBER">Baca Selengkapnya</a>
   - 💡 <b>AI Takeaway / Insight:</b> Catatan ringkas tentang arah perkembangan AI hari ini.
   - Penutup ajakan gabung diskusi di channel @aicomindo
   - Hashtag: #AINews #KecerdasanBuatan #AITrend #TechUpdate #aicomindo

PENTING: Jangan buat link palsu. Gunakan URL asli yang diberikan di daftar berita.`;

  const userPrompt = `Berikut adalah berita-berita AI terbaru hari ini:\n\n${newsSummaryList}\n\nTuliskan AI Daily Digest dalam format Telegram HTML sekarang:`;

  try {
    // Attempt with Llama 3.3 70B
    const response = (await ai.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 1500,
      temperature: 0.7,
    })) as { response?: string };

    if (response && response.response) {
      return response.response.trim();
    }
  } catch (err) {
    console.warn('Llama 3.3 failed, falling back to Llama 3.1 8B:', err);
    try {
      const fallbackResponse = (await ai.run('@cf/meta/llama-3.1-8b-instruct', {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 1500,
        temperature: 0.7,
      })) as { response?: string };

      if (fallbackResponse && fallbackResponse.response) {
        return fallbackResponse.response.trim();
      }
    } catch (fallbackErr) {
      console.error('All AI models failed:', fallbackErr);
    }
  }

  // Graceful fallback template if AI model call fails
  const fallbackDigest = [
    `⚡ <b>AI DAILY DIGEST | @aicomindo</b>`,
    `📅 <i>${dateStr}</i>`,
    ``,
    `Berikut adalah ringkasan perkembangan AI terbaru hari ini:`,
    ``,
    ...selected.map(
      (item) =>
        `🔹 <b>${escapeHtml(item.title)}</b>\n${escapeHtml(item.snippet || '')}\n🔗 <a href="${item.url}">Baca di ${escapeHtml(item.source)}</a>\n`
    ),
    `💡 Ikuti terus update dunia AI setiap hari jam 18:00 WIB di @aicomindo!`,
    ``,
    `#AINews #KecerdasanBuatan #aicomindo`,
  ].join('\n');

  return fallbackDigest;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
