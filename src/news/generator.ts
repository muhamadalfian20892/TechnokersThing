import { RawNewsItem } from './types';
import { getActiveModel, getStyleMemory } from './memory';
import { runUnifiedAiCompletion } from './ai_client';
import { stripEmojis } from '../utils/text';

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
    return `<b>UPDATE AI | @aicomindo</b>\n<i>${formattedDate}</i>\n\nBelum ada terobosan atau breaking news baru hari ini. Semua perkembangan terbaru sudah terkurasi di edisi sebelumnya. Tetap pantau @aicomindo untuk update selanjutnya!\n\nLink Channel: <a href="https://t.me/aicomindo">t.me/aicomindo</a>\n#AIUpdate #aicomindo`;
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

  const systemPrompt = `Kamu adalah AI assistant yang sedang berada dalam NEWS MODE untuk channel Telegram "@aicomindo" (AI Community News Indonesia).
Tulis postingan ${editionType} berdasarkan ${selected.length} bahan berita yang diberikan.

TUJUAN UTAMA NEWS MODE:
* Mudah dipahami orang awam
* Tetap informatif
* Terasa natural
* Tidak kaku seperti artikel media formal
* Tidak terlalu teknis
* Tetap akurat terhadap sumber yang diberikan
* Menarik dibaca di Telegram

PANDUAN BAHASA & ISTILAH:
- Anggap pembaca tidak selalu paham teknologi.
- Kalau ada istilah teknis, jelaskan secara singkat dengan bahasa sederhana sebelum atau setelah istilah tersebut digunakan (contoh: "latensi rendah" dijelaskan sebagai "jeda antara kita ngomong dan AI merespons").
- Jangan menganggap pembaca sudah tahu apa itu API, benchmark, inference, neural rendering, multimodal, agent, parameter, dan istilah teknis lainnya. Beri konteks sederhana jika istilah tersebut penting.
- Gunakan bahasa Indonesia yang natural dan modern (boleh gunakan kata: baru aja, ternyata, makin, cukup menarik, yang menarik, intinya, artinya, buat pengguna, buat developer, nggak, bisa dibilang), namun jangan berlebihan slang.

GAYA PENULISAN:
- Berita harus terasa seperti seseorang sedang menceritakan hal menarik yang baru saja terjadi kepada pembaca.
- Gunakan pembuka yang menarik dan langsung ke inti.
- Judul setiap berita boleh menggunakan emoji yang relevan dan gaya sedikit catchy (contoh: "🚀 OpenAI Rilis Model Baru: Kecil-Kecil Cabe Rawit!").
- Setelah judul, jelaskan inti beritanya dalam paragraf pendek yang nyaman dibaca di Telegram.
- Gunakan bagian "Mengapa ini menarik?" untuk menjelaskan dampak nyatanya dalam bahasa manusia.
- Tautan sumber di akhir tiap item berita: (Sumber: <a href="LINK">NamaSumber</a>).

PENTING:
- Bedakan fakta dengan interpretasi. Jika klaim perusahaan, gunakan: "OpenAI mengatakan...", "Menurut Nvidia...", "Perusahaan mengklaim...".
- Jangan mengarang angka, fitur, tanggal, atau kutipan yang tidak tersedia dalam sumber.
- Gunakan antusiasme secukupnya (jangan lebay seperti "INI GILA BANGET!!!").
- Di akhir postingan, sertakan 4-8 hashtag relevan (contoh: #OpenAI #TechNews #AI #aicomindo).
- Gunakan tag HTML Telegram resmi (<b>, <i>, <code>, <a href="...">).`;

  const userPrompt = `Berikut adalah ${selected.length} bahan berita AI:\n\n${newsSummaryList}\n\nTuliskan postingan ${editionType} yang menarik, jelas, dan mengalir sekarang sesuai panduan NEWS MODE di atas:`;

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

    return result.text.trim();
  } catch (err) {
    console.error('[AI Generator] Error generating digest:', err);
  }

  // Fallback (Clean, without emojis)
  const headline = isWeeklyRecap
    ? `<b>RECAP MINGGUAN AI: Gebrakan Teknologi Paling Berpengaruh Minggu Ini</b>`
    : `<b>AI DAILY UPDATE: Terobosan Kecerdasan Buatan Terkini</b>`;

  const intro = isWeeklyRecap
    ? `Seminggu terakhir ini dunia teknologi dipenuhi dinamika penting. Untuk Anda yang tidak ingin tertinggal informasi, berikut adalah rangkuman terobosan yang mengubah ekosistem digital kita:`
    : `Perkembangan kecerdasan buatan bergerak dengan cepat. Berikut adalah rangkuman perkembangan terbaru hari ini yang patut Anda simak:`;

  return [
    headline,
    ``,
    intro,
    ``,
    ...selected.map(
      (item, idx) =>
        `<b>${idx + 1}. ${escapeHtml(item.title)}</b>\n${escapeHtml(item.snippet || 'Perkembangan terbaru di industri AI.')} Langkah strategis ini memperlihatkan akselerasi teknologi untuk mengamankan keunggulan di pasar AI global. (Sumber: <a href="${item.url}">Baca artikel lengkap di ${escapeHtml(item.source)}</a>)\n`
    ),
    `<b>Analisis:</b>\nIndustri saat ini beralih dari model AI yang hanya menjawab menjadi sistem otonom yang mampu mengeksekusi alur kerja rumit secara terpadu.`,
    ``,
    `Bagikan pandangan Anda mengenai perkembangan berita di atas.`,
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
