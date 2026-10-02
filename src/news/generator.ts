import { RawNewsItem } from './types';
import { getActiveModel, getStyleMemory } from './memory';
import { runUnifiedAiCompletion } from './ai_client';

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
  env: Env,
  newsItems: RawNewsItem[],
  forceRecap: boolean = false
): Promise<string> {
  const { isFriday, formattedDate } = getWibInfo();
  const isWeeklyRecap = isFriday || forceRecap;

  if (newsItems.length === 0) {
    return `⚡ <b>UPDATE AI | @aicomindo</b>\n📅 <i>${formattedDate}</i>\n\nBelum ada terobosan atau breaking news baru hari ini. Semua perkembangan terbaru sudah terkurasi di edisi sebelumnya. Tetap pantau @aicomindo untuk update selanjutnya!\n\nLink Channel: t.me/aicomindo\n#AIUpdate #aicomindo`;
  }

  // 10 items on Friday, 5 on regular days
  const targetCount = isWeeklyRecap ? Math.min(10, Math.max(5, newsItems.length)) : Math.min(5, newsItems.length);
  const selected = newsItems.slice(0, targetCount);

  // Retrieve style memory and active model from KV
  const [styleTemplate, activeModel] = await Promise.all([
    getStyleMemory(env.AI_NEWS_KV),
    getActiveModel(env.AI_NEWS_KV),
  ]);

  const newsSummaryList = selected
    .map(
      (item, idx) =>
        `Item ${idx + 1}:
Judul: ${item.title}
Sumber: ${item.source}
Link: ${item.url}
Rangkuman Singkat: ${item.snippet || 'None'}`
    )
    .join('\n\n');

  const editionType = isWeeklyRecap
    ? 'WEEKLY TECH & AI RECAP (EDISI JUMAT - 10 GEBRAKAN)'
    : 'DAILY AI UPDATE (EDISI HARIAN - 5 TEROBOSAN)';

  const systemPrompt = `Kamu adalah Lead Tech Content Creator dan Senior AI Journalist untuk channel Telegram "@aicomindo" (AI Community News Indonesia).
Kamu memiliki gaya penulisan yang SANGAT MENARIK, BOLD, DETAIL, BERBOBOT, DILENGKAPI FAKTA & ANGKA, serta menggunakan bahasa Indonesia gaul-profesional khas tech insider (seperti postingan viral di LinkedIn/Twitter tech).

TUGASMU:
Tulis postingan ${editionType} berdasarkan ${selected.length} bahan berita yang diberikan.

PANDUAN UTAMA PANJANG & KUALITAS BERITA (SANGAT PENTING!):
1. JANGAN PERNAH MENULIS BERITA PENDEK ATAU CUMA 1 KALIMAT!
2. Setiap nomor berita WAJIB DITULIS 1 PARAGRAF UTUH (3 hingga 5 kalimat padat dan mendalam).
3. Isi setiap poin berita harus menguraikan:
   - SIAPA dan AKSI NYA (Misal: Google akuisisi Wiz, Meta gandeng Broadcom, dsb.)
   - NILAI / ANGKA jika ada (Misal: $32 Miliar, Rp 500 Triliun, 100 ribu GPU, dsb.)
   - ALASAN KORPORAT / LATAR BELAKANG di balik keputusan tersebut
   - DAMPAK NYATA bagi industri, privasi data, atau pengguna sehari-hari
   - Tautan sumber di akhir paragraf dalam format: (Sumber: <a href="LINK">NamaSumber</a>)

BERIKUT ADALAH MEMORI CONTOH GAYA & KEDALAMAN PENULISAN YANG WAJIB KAMU TIRU PERSIS:
---
${styleTemplate}
---

FORMATTING RULES:
1. Gunakan tag format HTML Telegram:
   - <b>Teks tebal</b> untuk headline utama dan judul nomor berita
   - <i>Teks miring</i> jika perlu
   - <a href="URL">Teks Link</a> untuk tautan sumber asli
   JANGAN gunakan format Markdown asterisks (** atau * atau #).
2. Ikuti struktur persis contoh:
   - Headline Utama Menohok dengan 2-3 Emoji
   - Paragraf Pembuka ("Dua minggu/seminggu terakhir ini dunia tech bener-bener gak kasih kita napas...")
   - Poin-poin berita bernomor 1 sampai ${selected.length} dengan penjelasan panjang dan berbobot
   - Bagian "Pandangan Saya:" (opini/analisis tajam tentang pergeseran tren besar)
   - Pertanyaan pemicu diskusi interaktif
   - Tautan channel: t.me/aicomindo
   - Hashtags relevan
3. Gunakan URL asli yang diberikan di data.`;

  const userPrompt = `Berikut adalah ${selected.length} bahan berita AI:\n\n${newsSummaryList}\n\nTuliskan postingan ${editionType} lengkap, panjang, dan berbobot sekarang mengikuti contoh gaya di atas:`;

  try {
    const result = await runUnifiedAiCompletion(
      env,
      activeModel,
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      3500
    );

    return result.text;
  } catch (err) {
    console.error('[AI Generator] Both active model and fallback failed:', err);
  }

  // Graceful fallback structure
  const headline = isWeeklyRecap
    ? `🔥 <b>RECAP MINGGUAN AI: Gebrakan Teknologi Paling Gila Minggu Ini! 🛡️🤝💰</b>`
    : `⚡ <b>AI DAILY UPDATE: Gebrakan Terpanas Hari Ini! 🚀💡</b>`;

  const intro = isWeeklyRecap
    ? `Seminggu terakhir ini dunia tech bener-bener gak kasih kita napas. Buat kalian yang gak mau pusing ketinggalan info, ini rangkuman gebrakan paling gila yang bakal ngerubah masa depan ekosistem digital kita. Langsung sikat:`
    : `Perkembangan AI hari ini geraknya kenceng banget! Buat kalian yang mau tetep relevan dan gak mau FOMO, ini update paling gila hari ini yang wajib kalian tahu. Langsung sikat:`;

  return [
    headline,
    ``,
    intro,
    ``,
    ...selected.map(
      (item, idx) =>
        `<b>${idx + 1}. ${escapeHtml(item.title)}</b>\n${escapeHtml(item.snippet || 'Perkembangan terbaru di industri AI.')} Langkah strategis ini memperlihatkan bagaimana raksasa teknologi terus berakselerasi untuk mengamankan dominasi di pasar kecerdasan buatan. Implikasinya akan sangat terasa pada ekosistem pengguna dan percepatan adopsi industri. (Sumber: <a href="${item.url}">${escapeHtml(item.source)}</a>)\n`
    ),
    `<b>Pandangan Saya:</b>\nKita bener-bener lagi transisi dari AI yang cuma "pinter jawab" jadi AI yang "pinter kerja" (Agentic). Dari chip sampe software, semuanya lagi berevolusi gila-gilaan.`,
    ``,
    `Nah, dari berita di atas, mana yang menurut kalian paling ngerubah hidup kedepannya? Coba kasih opini kalian di bawah! 🚀🧪`,
    ``,
    `Link Channel: t.me/aicomindo`,
    `#TechRecap #AIUpdate #Google #Meta #OpenAI #aicomindo`,
  ].join('\n');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
