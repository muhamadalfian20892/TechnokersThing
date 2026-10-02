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
    return `⚡ <b>UPDATE AI | @aicomindo</b>\n📅 <i>${formattedDate}</i>\n\nBelum ada terobosan atau breaking news baru hari ini. Semua perkembangan terbaru sudah terkurasi di edisi sebelumnya. Tetap pantau @aicomindo untuk update selanjutnya!\n\nLink Channel: <a href="https://t.me/aicomindo">t.me/aicomindo</a>\n#AIUpdate #aicomindo`;
  }

  const targetCount = isWeeklyRecap ? Math.min(10, Math.max(5, newsItems.length)) : Math.min(5, newsItems.length);
  const selected = newsItems.slice(0, targetCount);

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

PANDUAN UTAMA PANJANG & KUALITAS BERITA:
1. JANGAN PERNAH MENULIS BERITA PENDEK ATAU CUMA 1 KALIMAT!
2. Setiap nomor berita WAJIB DITULIS 1 PARAGRAF UTUH (3 hingga 5 kalimat padat dan mendalam).
3. Isi setiap poin berita harus menguraikan:
   - SIAPA dan AKSI NYA (Misal: Google akuisisi Wiz, Meta gandeng Broadcom, dsb.)
   - NILAI / ANGKA jika ada (Misal: $32 Miliar, Rp 500 Triliun, 100 ribu GPU, dsb.)
   - ALASAN KORPORAT / LATAR BELAKANG di balik keputusan tersebut
   - DAMPAK NYATA bagi industri, privasi data, atau pengguna sehari-hari
   - Tautan sumber di akhir paragraf dalam format ramah pembaca layar (WCAG 2.1 AAA): (Sumber: <a href="LINK">Baca liputan di NamaSumber</a>)

STANDAR AKSESIBILITAS TELEGRAM (WCAG 2.1 AAA Text Standard):
- Gunakan hierarki semantik yang jelas: Judul tebal <b>...</b>, pemisah paragraf ganda (\n\n) agar nyaman dibaca oleh pengguna maupun screen reader.
- Jangan gunakan simbol atau singkatan yang ambigu.
- Gunakan teks tautan yang deskriptif (misal: "Baca selengkapnya di TechCrunch", BUKAN "klik di sini").
- Gunakan tag HTML Telegram resmi (<b>, <i>, <code>, <a>). Jangan gunakan markdown asterisks.

BERIKUT ADALAH MEMORI CONTOH GAYA & KEDALAMAN PENULISAN:
---
${styleTemplate}
---

Gunakan URL asli yang disediakan. Tulis selengkap dan seberbobot mungkin.`;

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
    console.error('[AI Generator] Error generating digest:', err);
  }

  // Fallback
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
        `<b>${idx + 1}. ${escapeHtml(item.title)}</b>\n${escapeHtml(item.snippet || 'Perkembangan terbaru di industri AI.')} Langkah strategis ini memperlihatkan akselerasi raksasa teknologi untuk mengamankan dominasi di pasar AI global. (Sumber: <a href="${item.url}">Baca artikel lengkap di ${escapeHtml(item.source)}</a>)\n`
    ),
    `<b>Pandangan Saya:</b>\nKita bener-bener lagi transisi dari AI yang cuma "pinter jawab" jadi AI yang "pinter kerja" (Agentic). Dari chip sampe software, semuanya lagi berevolusi gila-gilaan.`,
    ``,
    `Nah, dari berita di atas, mana yang menurut kalian paling ngerubah hidup kedepannya? Coba kasih opini kalian di bawah! 🚀🧪`,
    ``,
    `Link Channel: <a href="https://t.me/aicomindo">t.me/aicomindo</a>`,
    `#TechRecap #AIUpdate #Google #Meta #OpenAI #aicomindo`,
  ].join('\n');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
