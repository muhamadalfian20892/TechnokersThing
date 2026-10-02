import { RawNewsItem } from './types';

export function getWibInfo(): {
  dateStr: string;
  isFriday: boolean;
  dayName: string;
  formattedDate: string;
} {
  const now = new Date();
  const wibTime = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const months = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
  ];

  const dayOfWeek = wibTime.getUTCDay();
  const dayName = days[dayOfWeek];
  const date = wibTime.getUTCDate();
  const monthName = months[wibTime.getUTCMonth()];
  const year = wibTime.getUTCFullYear();

  const pad = (n: number) => n.toString().padStart(2, '0');
  const dateStr = `${year}-${pad(wibTime.getUTCMonth() + 1)}-${pad(date)}`;
  const formattedDate = `${dayName}, ${date} ${monthName} ${year}`;

  return {
    dateStr,
    isFriday: dayOfWeek === 5,
    dayName,
    formattedDate,
  };
}

export async function generateDailyNewsDigest(
  ai: Ai,
  newsItems: RawNewsItem[],
  forceRecap: boolean = false
): Promise<string> {
  const { isFriday, formattedDate } = getWibInfo();
  const isWeeklyRecap = isFriday || forceRecap;

  if (newsItems.length === 0) {
    return `⚡ <b>UPDATE AI | @aicomindo</b>\n📅 <i>${formattedDate}</i>\n\nBelum ada pergerakan atau breaking news baru hari ini. Semua perkembangan terbaru sudah terkurasi sebelumnya. Pantau terus @aicomindo untuk update selanjutnya!\n\nLink Channel: t.me/aicomindo\n#AIUpdate #aicomindo`;
  }

  // On Friday (Weekly Recap), select 7-10 stories; on regular days, select 4-5 stories
  const targetCount = isWeeklyRecap ? Math.min(10, Math.max(5, newsItems.length)) : Math.min(5, newsItems.length);
  const selected = newsItems.slice(0, targetCount);

  const newsSummaryList = selected
    .map(
      (item, idx) =>
        `Item ${idx + 1}:
Judul: ${item.title}
Sumber: ${item.source}
Link: ${item.url}
Snippet/Info: ${item.snippet || 'None'}`
    )
    .join('\n\n');

  const editionType = isWeeklyRecap ? 'WEEKLY TECH & AI RECAP (EDISI JUMAT)' : 'DAILY AI UPDATE';

  const systemPrompt = `Kamu adalah Lead Tech Content Creator dan AI Journalist untuk channel Telegram "@aicomindo" (AI Community News Indonesia).
Kamu memiliki gaya penulisan yang SANGAT MENARIK, BOLD, BERBOBOT, DILENGKAPI FAKTA & ANGKA, serta menggunakan bahasa Indonesia gaul-profesional ala tech insider Indonesia (seperti postingan viral di LinkedIn/Twitter tech).

TUGASMU:
Tulis postingan ${editionType} berdasarkan bahan berita yang disediakan.

GAYA PENULISAN WAJIB MENGIKUTI CONTOH BERIKUT SECARA PERSIS:
---
[Headline Bombastis/Viral yang Mewakili Berita Terbesar dengan 2-3 Emoji] 🛡️🤝💰

${isWeeklyRecap ? 'Seminggu terakhir ini dunia tech bener-bener gak kasih kita napas. Buat kalian yang gak mau pusing ketinggalan info, ini rangkuman gebrakan paling gila yang bakal ngerubah masa depan ekosistem digital kita. Langsung sikat:' : 'Perkembangan AI hari ini geraknya kenceng banget! Buat kalian yang mau tetep relevan dan gak mau FOMO, ini update paling gila hari ini yang wajib kalian tahu. Langsung sikat:'}

1. [Judul Poin Berita Singkat Padat Menohok!] [Emoji]
[Tulis 2-3 kalimat substansial dan mendalam! Jangan cuma sebut link. Jelaskan SIAPA, APA AKSI NYA, MENGAPA MEREKA MELAKUKANNYA, ANGKA/NILAINYA jika ada, dan APA DAMPAKNYA bagi ekosistem/pengguna. Sertakan link sumber di akhir kalimat: (Sumber: <a href="LINK">NamaSumber</a>)]

2. [Judul Poin Berita 2] [Emoji]
[Penjelasan mendalam 2-3 kalimat berisi fakta nyata dan implikasi...]

... [Lanjutkan hingga semua ${selected.length} berita]

Pandangan Saya:
[1-2 kalimat opini/analisis tajam tentang tren besar di balik berita-berita ini, misalnya pergeseran ke AI Agentic, perang chip hardware, privasi data, dll.]

Nah, dari berita di atas, mana yang menurut kalian paling ngerubah hidup kedepannya? Coba kasih opini kalian di bawah! 🚀🧪

Link Channel: t.me/aicomindo
#TechRecap #AIUpdate #KecerdasanBuatan #OpenAI #Google #Meta #FutureOfWork #aicomindo
---

ATURAN FORMATTING SANGAT PENTING:
1. Gunakan tag format HTML Telegram:
   - <b>Teks tebal</b> untuk headline dan judul nomor berita
   - <i>Teks miring</i> jika diperlukan
   - <a href="URL">Teks Link</a> untuk tautan sumber asli
   JANGAN gunakan markdown syntax asterisks (** atau * atau #).
2. BERITA HARUS BENAR-BENAR DICERITAKAN (BERBOBOT)! Jangan hanya link pendek tanpa penjelasan. Pembaca harus paham beritanya langsung dari membaca teksmu tanpa harus buka link.
3. Jangan halusinasi link, gunakan URL asli yang diberikan di data.`;

  const userPrompt = `Berikut adalah ${selected.length} berita AI ${isWeeklyRecap ? 'untuk Weekly Recap' : 'hari ini'}:\n\n${newsSummaryList}\n\nTuliskan postingan lengkap sekarang sesuai format dan gaya penulisan di atas:`;

  try {
    const response = (await ai.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 2200,
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
        max_tokens: 1800,
        temperature: 0.7,
      })) as { response?: string };

      if (fallbackResponse && fallbackResponse.response) {
        return fallbackResponse.response.trim();
      }
    } catch (fallbackErr) {
      console.error('All AI models failed:', fallbackErr);
    }
  }

  // Manual fallback structure if AI fails
  const headline = isWeeklyRecap
    ? `🔥 <b>RECAP MINGGUAN AI: Gebrakan Teknologi Paling Gila Minggu Ini!</b>`
    : `⚡ <b>AI DAILY UPDATE: Terobosan Terpanas Hari Ini!</b>`;

  const intro = isWeeklyRecap
    ? `Seminggu terakhir ini dunia tech bener-bener gak kasih kita napas! Ini rangkuman berita penting yang bakal ngerubah masa depan digital kita:`
    : `Dunia AI bergerak super cepat hari ini. Ini rangkuman perkembangan penting yang wajib kamu pantau:`;

  return [
    headline,
    ``,
    intro,
    ``,
    ...selected.map(
      (item, idx) =>
        `<b>${idx + 1}. ${escapeHtml(item.title)}</b>\n${escapeHtml(item.snippet || 'Perkembangan terbaru di industri AI.')} (<a href="${item.url}">Baca di ${escapeHtml(item.source)}</a>)\n`
    ),
    `<b>Pandangan Saya:</b>\nPerkembangan AI kian nyata beralih dari sekadar model obrolan menjadi agen otomatis dan integrasi mendalam ke kehidupan sehari-hari.`,
    ``,
    `Nah, mana menurut kalian yang paling berdampak? Yuk diskusi! 🚀`,
    ``,
    `Link Channel: t.me/aicomindo`,
    `#TechRecap #AIUpdate #aicomindo`,
  ].join('\n');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
