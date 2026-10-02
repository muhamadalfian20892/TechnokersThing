import { ScheduledJob, JobType, ParseJobResult } from './types';
import {
  parseScheduleInput,
  extractNaturalLanguageIntent,
  matchesCron,
  getWibDate,
} from './parser';
import { sendTelegramMessage } from '../telegram/api';
import { runUnifiedAiCompletion } from '../news/ai_client';
import { getActiveModel } from '../news/memory';

const KV_JOBS_KEY = 'scheduler:jobs';

// 1. Storage Operations
export async function getAllJobs(kv: KVNamespace): Promise<ScheduledJob[]> {
  const raw = await kv.get(KV_JOBS_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as ScheduledJob[];
  } catch {
    return [];
  }
}

export async function getJobById(kv: KVNamespace, id: string): Promise<ScheduledJob | null> {
  const jobs = await getAllJobs(kv);
  return jobs.find((j) => j.id === id) || null;
}

export async function saveJob(kv: KVNamespace, job: ScheduledJob): Promise<void> {
  const jobs = await getAllJobs(kv);
  const index = jobs.findIndex((j) => j.id === job.id);
  if (index >= 0) {
    jobs[index] = job;
  } else {
    jobs.push(job);
  }
  await kv.put(KV_JOBS_KEY, JSON.stringify(jobs));
}

export async function deleteJob(
  kv: KVNamespace,
  id: string,
  requesterId: string | number,
  isAdmin: boolean = false
): Promise<{ success: boolean; message: string }> {
  const jobs = await getAllJobs(kv);
  const target = jobs.find((j) => j.id === id);
  if (!target) {
    return { success: false, message: `Jadwal dengan ID <code>${id}</code> tidak ditemukan.` };
  }

  if (!isAdmin && String(target.creatorId) !== String(requesterId)) {
    return { success: false, message: '⛔ Anda hanya dapat menghapus jadwal yang Anda buat sendiri.' };
  }

  const updated = jobs.filter((j) => j.id !== id);
  await kv.put(KV_JOBS_KEY, JSON.stringify(updated));
  return { success: true, message: `✅ Jadwal <code>${id}</code> ("${target.message}") berhasil dihapus.` };
}

export async function getUserJobs(kv: KVNamespace, userId: string | number): Promise<ScheduledJob[]> {
  const jobs = await getAllJobs(kv);
  return jobs.filter((j) => String(j.creatorId) === String(userId));
}

// 2. Notification Message Formatters (WCAG 2.1 AAA Compliant)
export function formatReminderNotification(job: ScheduledJob): string {
  return (
    `⏰ <b>PENGINGAT (REMINDER)</b>\n\n` +
    `Halo! Ini adalah pengingat yang Anda jadwalkan:\n` +
    `📌 <b>Pesan:</b> ${escapeHtml(job.message)}\n\n` +
    `🕒 <i>Jadwal: ${job.scheduleRaw}</i>\n` +
    `🆔 <code>${job.id}</code>`
  );
}

export function formatCronNotification(job: ScheduledJob): string {
  const wib = getWibDate();
  const timeStr = `${String(wib.getUTCHours()).padStart(2, '0')}:${String(wib.getUTCMinutes()).padStart(2, '0')} WIB`;
  return (
    `🔔 <b>JADWAL OTOMATIS (CRON JOB)</b>\n\n` +
    `📢 <b>Pesan:</b> ${escapeHtml(job.message)}\n\n` +
    `⏱️ <b>Waktu Eksekusi:</b> ${timeStr}\n` +
    `🔄 <b>Pola:</b> <code>${job.cronExpression || job.scheduleRaw}</code>\n` +
    `📊 <i>Eksekusi ke-${job.runCount + 1}</i> &bull; 🆔 <code>${job.id}</code>`
  );
}

// 3. Minute-by-Minute Scheduled Processor
export async function processDueJobs(
  env: Env
): Promise<{ executedCount: number; logs: string[] }> {
  const jobs = await getAllJobs(env.AI_NEWS_KV);
  if (jobs.length === 0) return { executedCount: 0, logs: [] };

  const now = Date.now();
  const wibNow = getWibDate(now);
  const currentMinuteKey = `${wibNow.getUTCFullYear()}-${wibNow.getUTCMonth() + 1}-${wibNow.getUTCDate()}T${wibNow.getUTCHours()}:${wibNow.getUTCMinutes()}`;

  let executedCount = 0;
  const logs: string[] = [];
  let stateChanged = false;

  for (const job of jobs) {
    if (job.status !== 'active') continue;

    // A. One-time Reminder
    if (job.type === 'reminder') {
      if (job.dueAt && job.dueAt <= now) {
        console.log(`[Scheduler] Firing reminder ${job.id} for target ${job.targetChatId}`);
        const text = formatReminderNotification(job);
        const sendRes = await sendTelegramMessage(env.TELEGRAM_TOKEN, job.targetChatId, text);

        job.status = 'completed';
        job.lastRunAt = new Date().toISOString();
        job.runCount = (job.runCount || 0) + 1;
        stateChanged = true;
        executedCount++;
        logs.push(`[Reminder ${job.id}] Dispatched to ${job.targetChatId}: ${sendRes.ok ? 'OK' : sendRes.description}`);
      }
    }

    // B. Recurring Cron Job
    else if (job.type === 'cron' && job.cronExpression) {
      // Check if already executed in this exact minute
      const lastRunMinuteKey = job.lastRunAt ? getMinuteKey(job.lastRunAt) : '';
      if (lastRunMinuteKey === currentMinuteKey) {
        continue; // Already ran this minute
      }

      if (matchesCron(job.cronExpression, wibNow)) {
        console.log(`[Scheduler] Firing cron job ${job.id} for target ${job.targetChatId}`);
        const text = formatCronNotification(job);
        const sendRes = await sendTelegramMessage(env.TELEGRAM_TOKEN, job.targetChatId, text);

        job.lastRunAt = new Date().toISOString();
        job.runCount = (job.runCount || 0) + 1;
        stateChanged = true;
        executedCount++;
        logs.push(`[Cron ${job.id}] Dispatched to ${job.targetChatId}: ${sendRes.ok ? 'OK' : sendRes.description}`);
      }
    }
  }

  // Prune completed/cancelled jobs older than 3 days to keep KV lean
  const threeDaysAgo = now - 3 * 24 * 60 * 60 * 1000;
  const remainingJobs = jobs.filter((j) => {
    if (j.status === 'completed' || j.status === 'cancelled') {
      const finishedAt = j.lastRunAt ? new Date(j.lastRunAt).getTime() : new Date(j.createdAt).getTime();
      return finishedAt > threeDaysAgo;
    }
    return true;
  });

  if (stateChanged || remainingJobs.length !== jobs.length) {
    await env.AI_NEWS_KV.put(KV_JOBS_KEY, JSON.stringify(remainingJobs));
  }

  return { executedCount, logs };
}

function getMinuteKey(isoString: string): string {
  const d = getWibDate(new Date(isoString).getTime());
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}T${d.getUTCHours()}:${d.getUTCMinutes()}`;
}

// 4. Natural Language Intent Processor for Bot / Chat
export async function processReminderIntent(
  env: Env,
  text: string,
  userId: string | number,
  userName: string,
  defaultChatId: string | number,
  isAdmin: boolean = false
): Promise<{ handled: boolean; replyText?: string }> {
  const intentCheck = extractNaturalLanguageIntent(text);
  if (!intentCheck.isIntent) {
    return { handled: false };
  }

  const cleanInput = intentCheck.cleanInput || text;
  const targetChatId = intentCheck.targetIsChannel && isAdmin ? env.CHANNEL_ID : defaultChatId;

  // 1. Fast deterministic regex parse
  let parseResult = parseScheduleInput(cleanInput, targetChatId);

  // 2. If regex didn't parse, try AI extraction fallback
  if (!parseResult.success) {
    parseResult = await parseWithAiFallback(env, text, targetChatId);
  }

  if (!parseResult.success || !parseResult.message) {
    return {
      handled: true,
      replyText:
        `⚠️ <b>Format Pengingat Kurang Jelas</b>\n\n` +
        `Silakan sebutkan waktu dan pesannya secara spesifik, misalnya:\n` +
        `• <i>"ingetin aku 15 menit lagi buat cek server"</i>\n` +
        `• <i>"ingetin aku besok jam 8 pagi ada meeting"</i>\n` +
        `• <i>"bikin reminder tiap hari jam 09:00 WIB olahraga"</i>\n` +
        `• Atau gunakan perintah: <code>/remind &lt;waktu&gt; &lt;pesan&gt;</code>`,
    };
  }

  // Restrict channel targets to Admin only
  if (String(parseResult.targetChatId) === String(env.CHANNEL_ID) && !isAdmin) {
    parseResult.targetChatId = defaultChatId;
  }

  // Create and save the Scheduled Job
  const newJob: ScheduledJob = {
    id: `job_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    type: parseResult.type || 'reminder',
    message: parseResult.message,
    targetChatId: parseResult.targetChatId || defaultChatId,
    creatorId: userId,
    creatorName: userName,
    scheduleRaw: parseResult.scheduleRaw || 'Custom',
    dueAt: parseResult.dueAt,
    cronExpression: parseResult.cronExpression,
    timezoneOffsetHours: 7, // WIB
    status: 'active',
    createdAt: new Date().toISOString(),
    runCount: 0,
  };

  await saveJob(env.AI_NEWS_KV, newJob);

  const isChannel = String(newJob.targetChatId) === String(env.CHANNEL_ID);
  const targetLabel = isChannel ? `Channel <b>${env.CHANNEL_ID}</b>` : `Chat pribadi ini`;

  if (newJob.type === 'cron') {
    return {
      handled: true,
      replyText:
        `🎉 <b>Jadwal Otomatis (Cron Job) Berhasil Dibuat!</b>\n\n` +
        `📌 <b>Pesan:</b> ${escapeHtml(newJob.message)}\n` +
        `⏰ <b>Jadwal:</b> ${parseResult.humanDescription || newJob.scheduleRaw}\n` +
        `🔄 <b>Pola Cron:</b> <code>${newJob.cronExpression}</code>\n` +
        `🎯 <b>Tujuan:</b> ${targetLabel}\n` +
        `🆔 <b>Job ID:</b> <code>${newJob.id}</code>\n\n` +
        `💡 <i>Ketik <code>/delremind ${newJob.id}</code> jika ingin membatalkan jadwal ini kapan saja.</i>`,
    };
  } else {
    return {
      handled: true,
      replyText:
        `✅ <b>Pengingat (Reminder) Berhasil Diatur!</b>\n\n` +
        `📌 <b>Pesan:</b> ${escapeHtml(newJob.message)}\n` +
        `⏰ <b>Waktu:</b> ${parseResult.humanDescription || newJob.scheduleRaw}\n` +
        `🎯 <b>Tujuan Notifikasi:</b> ${targetLabel}\n` +
        `🆔 <b>Job ID:</b> <code>${newJob.id}</code>\n\n` +
        `🔔 Saya akan mengirimkan notifikasi tepat pada waktunya!\n` +
        `💡 <i>Ketik <code>/delremind ${newJob.id}</code> jika ingin membatalkan pengingat ini.</i>`,
    };
  }
}

// 5. AI-Assisted Parsing Fallback for Complex Natural Language Sentences
async function parseWithAiFallback(
  env: Env,
  userPrompt: string,
  defaultTargetChatId: string | number
): Promise<ParseJobResult> {
  try {
    const activeModel = await getActiveModel(env.AI_NEWS_KV);
    const wibNow = getWibDate();
    const currentTimeStr = `${wibNow.getUTCFullYear()}-${String(wibNow.getUTCMonth() + 1).padStart(2, '0')}-${String(wibNow.getUTCDate()).padStart(2, '0')} ${String(wibNow.getUTCHours()).padStart(2, '0')}:${String(wibNow.getUTCMinutes()).padStart(2, '0')} WIB`;

    const systemPrompt = `Kamu adalah parser jadwal dan reminder cerdas untuk Cloudflare Worker. Waktu sekarang: ${currentTimeStr}.
Tugasmu adalah menganalisis pesan pengguna dan mengembalikan JSON HANYA dalam format berikut:
{
  "isSchedule": true,
  "type": "reminder" atau "cron",
  "delayMinutes": integer atau null (jika relatif seperti "10 menit lagi", dsb),
  "specificHourWib": integer 0-23 atau null,
  "specificMinuteWib": integer 0-59 atau null,
  "isTomorrow": boolean,
  "cronExpression": string 5-field cron (atau null jika reminder sekali jalan),
  "message": "isi tugas/pengingat",
  "humanDescription": "keterangan singkat jadwal"
}
Jika bukan permintaan jadwal/reminder, kembalikan {"isSchedule": false}.
Balas HANYA dengan JSON valid tanpa tanda kutip tiga markdown atau penjelasan lainnya.`;

    const res = await runUnifiedAiCompletion(
      env,
      activeModel,
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      300
    );

    const cleanJson = res.text.replace(/```json/gi, '').replace(/```/g, '').trim();
    const data = JSON.parse(cleanJson);

    if (!data.isSchedule || !data.message) {
      return { success: false, error: 'Bukan pengingat' };
    }

    const now = Date.now();

    if (data.type === 'reminder') {
      let dueAt = now;
      if (typeof data.delayMinutes === 'number' && data.delayMinutes > 0) {
        dueAt = now + data.delayMinutes * 60 * 1000;
      } else if (typeof data.specificHourWib === 'number') {
        const hour = data.specificHourWib;
        const min = typeof data.specificMinuteWib === 'number' ? data.specificMinuteWib : 0;
        let y = wibNow.getUTCFullYear();
        let m = wibNow.getUTCMonth();
        let d = wibNow.getUTCDate() + (data.isTomorrow ? 1 : 0);
        dueAt = Date.UTC(y, m, d, hour - 7, min, 0, 0);
      } else {
        dueAt = now + 15 * 60 * 1000; // default 15m
      }

      return {
        success: true,
        type: 'reminder',
        dueAt,
        message: data.message,
        scheduleRaw: data.humanDescription || 'Reminder',
        targetChatId: defaultTargetChatId,
        humanDescription: data.humanDescription,
      };
    } else {
      return {
        success: true,
        type: 'cron',
        cronExpression: data.cronExpression || '0 9 * * *',
        message: data.message,
        scheduleRaw: data.humanDescription || 'Cron Job',
        targetChatId: defaultTargetChatId,
        humanDescription: data.humanDescription,
      };
    }
  } catch (err) {
    return { success: false, error: 'Gagal memproses via AI' };
  }
}

function escapeHtml(text: string): string {
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}
