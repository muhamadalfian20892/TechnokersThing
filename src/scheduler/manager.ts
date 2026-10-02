import {
  ScheduledJob,
  JobType,
  JobPlatform,
  ParseJobResult,
  WebNotification,
  PendingReminderState,
} from './types';
import {
  parseScheduleInput,
  extractNaturalLanguageIntent,
  matchesCron,
  getWibDate,
} from './parser';
import { sendTelegramMessage } from '../telegram/api';
import { runUnifiedAiCompletion } from '../news/ai_client';
import {
  getActiveModel,
  getAdminList,
  getUserProfile,
  getIsolatedChatHistory,
  saveIsolatedChatHistory,
} from '../news/memory';

const KV_JOBS_KEY = 'scheduler:jobs';
const KV_WEB_NOTIFICATIONS_KEY = 'scheduler:web_notifications';
const KV_PENDING_REMINDER_PREFIX = 'pending_reminder:';

// ==========================================
// 1. Storage Operations for Scheduled Jobs
// ==========================================
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

// ==========================================
// 2. Web Notifications & Pending Reminders Storage
// ==========================================
export async function getWebNotifications(kv: KVNamespace): Promise<WebNotification[]> {
  const raw = await kv.get(KV_WEB_NOTIFICATIONS_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as WebNotification[];
  } catch {
    return [];
  }
}

export async function addWebNotification(kv: KVNamespace, notif: WebNotification): Promise<void> {
  const list = await getWebNotifications(kv);
  list.unshift(notif);
  // Keep recent 50 notifications
  const trimmed = list.slice(0, 50);
  await kv.put(KV_WEB_NOTIFICATIONS_KEY, JSON.stringify(trimmed));
}

export async function dismissWebNotifications(kv: KVNamespace, id?: string): Promise<void> {
  const list = await getWebNotifications(kv);
  let updated: WebNotification[];
  if (id) {
    updated = list.map((n) => (n.id === id ? { ...n, read: true } : n));
  } else {
    updated = list.map((n) => ({ ...n, read: true }));
  }
  await kv.put(KV_WEB_NOTIFICATIONS_KEY, JSON.stringify(updated));
}

export async function getPendingReminder(
  kv: KVNamespace,
  sessionKey: string
): Promise<PendingReminderState | null> {
  const key = `${KV_PENDING_REMINDER_PREFIX}${sessionKey}`;
  const raw = await kv.get(key);
  if (!raw) return null;
  try {
    const state = JSON.parse(raw) as PendingReminderState;
    if (state.expiresAt && state.expiresAt < Date.now()) {
      await kv.delete(key);
      return null;
    }
    return state;
  } catch {
    return null;
  }
}

export async function setPendingReminder(
  kv: KVNamespace,
  sessionKey: string,
  state: PendingReminderState
): Promise<void> {
  const key = `${KV_PENDING_REMINDER_PREFIX}${sessionKey}`;
  await kv.put(key, JSON.stringify(state), { expirationTtl: 15 * 60 }); // 15 mins
}

export async function clearPendingReminder(kv: KVNamespace, sessionKey: string): Promise<void> {
  const key = `${KV_PENDING_REMINDER_PREFIX}${sessionKey}`;
  await kv.delete(key);
}

// Helper to resolve Telegram username or ID to numerical Chat ID
export async function resolveTelegramChatId(
  kv: KVNamespace,
  input: string | number
): Promise<{ chatId: string | number; label: string } | null> {
  const clean = String(input).trim();
  // Numeric chat ID
  if (/^-?\d{5,}$/.test(clean)) {
    if (clean === '1023972475') {
      return { chatId: 1023972475, label: '@alfian04121' };
    }
    return { chatId: clean, label: `ID: ${clean}` };
  }

  // Handle username
  const username = clean.replace(/^@/, '').toLowerCase();
  if (username === 'alfian04121' || username === 'muhamadalfian' || username === 'alfian') {
    return { chatId: 1023972475, label: '@alfian04121' };
  }

  // Check admin profiles
  const admins = await getAdminList(kv);
  for (const adminId of admins) {
    const profile = await getUserProfile(kv, adminId);
    if (profile?.username && profile.username.toLowerCase() === username) {
      return { chatId: adminId, label: `@${profile.username}` };
    }
  }

  // Scan recent profiles in KV
  try {
    const listRes = await kv.list({ prefix: 'profile:', limit: 50 });
    for (const key of listRes.keys) {
      const uId = key.name.replace('profile:', '');
      const profile = await getUserProfile(kv, uId);
      if (profile?.username && profile.username.toLowerCase() === username) {
        return { chatId: uId, label: `@${profile.username}` };
      }
    }
  } catch {}

  return null;
}

// ==========================================
// 3. Notification Message Formatters (WCAG 2.1 AAA Compliant)
// ==========================================
export function formatReminderNotification(job: ScheduledJob): string {
  const targetDesc =
    job.targetPlatform === 'dashboard'
      ? 'Web Dashboard (Di sini)'
      : String(job.targetChatId);

  return (
    `⏰ <b>PENGINGAT (REMINDER)</b>\n\n` +
    `Halo! Ini adalah pengingat yang Anda jadwalkan:\n` +
    `📌 <b>Pesan:</b> ${escapeHtml(job.message)}\n\n` +
    `🕒 <i>Jadwal: ${job.scheduleRaw}</i>\n` +
    `🎯 <i>Target: ${targetDesc}</i> &bull; 🆔 <code>${job.id}</code>`
  );
}

export function formatCronNotification(job: ScheduledJob): string {
  const wib = getWibDate();
  const timeStr = `${String(wib.getUTCHours()).padStart(2, '0')}:${String(wib.getUTCMinutes()).padStart(2, '0')} WIB`;
  const targetDesc =
    job.targetPlatform === 'dashboard'
      ? 'Web Dashboard (Di sini)'
      : String(job.targetChatId);

  return (
    `🔔 <b>JADWAL OTOMATIS (CRON JOB)</b>\n\n` +
    `📢 <b>Pesan:</b> ${escapeHtml(job.message)}\n\n` +
    `⏱️ <b>Waktu Eksekusi:</b> ${timeStr}\n` +
    `🔄 <b>Pola:</b> <code>${job.cronExpression || job.scheduleRaw}</code>\n` +
    `🎯 <i>Target: ${targetDesc}</i> &bull; 📊 <i>Eksekusi ke-${job.runCount + 1}</i> &bull; 🆔 <code>${job.id}</code>`
  );
}

// ==========================================
// 4. Minute-by-Minute Scheduled Processor
// ==========================================
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
        // Platform A: Web Dashboard
        if (job.targetPlatform === 'dashboard' || String(job.targetChatId) === 'dashboard') {
          console.log(`[Scheduler] Firing web dashboard reminder ${job.id}`);
          const notif: WebNotification = {
            id: `wn_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            jobId: job.id,
            message: job.message,
            scheduleRaw: job.scheduleRaw,
            firedAt: Date.now(),
            read: false,
          };
          await addWebNotification(env.AI_NEWS_KV, notif);

          // Append to web admin chat history
          const webSessionKey = 'web:admin:1023972475';
          const history = await getIsolatedChatHistory(env.AI_NEWS_KV, webSessionKey);
          history.push({
            role: 'assistant',
            content: formatReminderNotification(job),
            timestamp: Date.now(),
          });
          await saveIsolatedChatHistory(env.AI_NEWS_KV, webSessionKey, history);

          logs.push(`[Reminder ${job.id}] Dispatched to Web Dashboard`);
        }
        // Platform B: Telegram
        else {
          console.log(`[Scheduler] Firing telegram reminder ${job.id} for target ${job.targetChatId}`);
          const text = formatReminderNotification(job);
          const sendRes = await sendTelegramMessage(env.TELEGRAM_TOKEN, job.targetChatId, text);
          logs.push(`[Reminder ${job.id}] Dispatched to ${job.targetChatId}: ${sendRes.ok ? 'OK' : sendRes.description}`);
        }

        job.status = 'completed';
        job.lastRunAt = new Date().toISOString();
        job.runCount = (job.runCount || 0) + 1;
        stateChanged = true;
        executedCount++;
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
        // Platform A: Web Dashboard
        if (job.targetPlatform === 'dashboard' || String(job.targetChatId) === 'dashboard') {
          console.log(`[Scheduler] Firing web dashboard cron ${job.id}`);
          const notif: WebNotification = {
            id: `wn_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            jobId: job.id,
            message: job.message,
            scheduleRaw: job.scheduleRaw,
            firedAt: Date.now(),
            read: false,
          };
          await addWebNotification(env.AI_NEWS_KV, notif);

          const webSessionKey = 'web:admin:1023972475';
          const history = await getIsolatedChatHistory(env.AI_NEWS_KV, webSessionKey);
          history.push({
            role: 'assistant',
            content: formatCronNotification(job),
            timestamp: Date.now(),
          });
          await saveIsolatedChatHistory(env.AI_NEWS_KV, webSessionKey, history);

          logs.push(`[Cron ${job.id}] Dispatched to Web Dashboard`);
        }
        // Platform B: Telegram
        else {
          console.log(`[Scheduler] Firing telegram cron job ${job.id} for target ${job.targetChatId}`);
          const text = formatCronNotification(job);
          const sendRes = await sendTelegramMessage(env.TELEGRAM_TOKEN, job.targetChatId, text);
          logs.push(`[Cron ${job.id}] Dispatched to ${job.targetChatId}: ${sendRes.ok ? 'OK' : sendRes.description}`);
        }

        job.lastRunAt = new Date().toISOString();
        job.runCount = (job.runCount || 0) + 1;
        stateChanged = true;
        executedCount++;
      }
    }
  }

  // Prune completed/cancelled jobs older than 3 days
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

// ==========================================
// 5. Context-Aware Natural Language Intent Processor
// ==========================================
export async function processReminderIntent(
  env: Env,
  text: string,
  userId: string | number,
  userName: string,
  defaultChatId: string | number,
  isAdmin: boolean = false,
  sourcePlatform: 'telegram' | 'web_dashboard' = 'telegram'
): Promise<{ handled: boolean; replyText?: string }> {
  const trimmed = text.trim();

  // 1. Check if there's a PENDING reminder awaiting Telegram account confirmation (for Web Dashboard)
  if (sourcePlatform === 'web_dashboard') {
    const pendingKey = 'web:admin:1023972475';
    const pending = await getPendingReminder(env.AI_NEWS_KV, pendingKey);

    if (pending) {
      const lower = trimmed.toLowerCase();
      // If user chooses to cancel
      if (lower === 'batal' || lower === 'cancel' || lower === 'tidak jadi') {
        await clearPendingReminder(env.AI_NEWS_KV, pendingKey);
        return {
          handled: true,
          replyText: '❌ <b>Pengingat Dibatalkan</b>\n\nPermintaan pengaturan pengingat ke Telegram telah dibatalkan.',
        };
      }

      // Check if user is answering where to remind (username or ID)
      const resolved = await resolveTelegramChatId(env.AI_NEWS_KV, trimmed);
      if (resolved) {
        const newJob: ScheduledJob = {
          id: `job_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          type: pending.type,
          message: pending.message,
          targetPlatform: 'telegram',
          targetChatId: resolved.chatId,
          creatorId: userId,
          creatorName: userName,
          scheduleRaw: pending.scheduleRaw,
          dueAt: pending.dueAt,
          cronExpression: pending.cronExpression,
          timezoneOffsetHours: 7,
          status: 'active',
          createdAt: new Date().toISOString(),
          runCount: 0,
        };

        await saveJob(env.AI_NEWS_KV, newJob);
        await clearPendingReminder(env.AI_NEWS_KV, pendingKey);

        return {
          handled: true,
          replyText:
            `✅ <b>Siap! Pengingat Berhasil Diatur ke Telegram!</b>\n\n` +
            `📌 <b>Pesan:</b> ${escapeHtml(pending.message)}\n` +
            `⏰ <b>Waktu:</b> ${pending.humanDescription || pending.scheduleRaw}\n` +
            `🎯 <b>Tujuan:</b> Akun Telegram <b>${resolved.label}</b> (ID: <code>${resolved.chatId}</code>)\n` +
            `🆔 <b>Job ID:</b> <code>${newJob.id}</code>\n\n` +
            `🔔 Notifikasi akan dikirimkan langsung ke Telegram kamu tepat pada waktunya!`,
        };
      } else {
        return {
          handled: true,
          replyText:
            `⚠️ <b>Akun Telegram Tidak Ditemukan</b>\n\n` +
            `Sistem belum menemukan akun <code>${escapeHtml(trimmed)}</code>. ` +
            `Pastikan Anda sudah pernah mengirim pesan ke bot kami di Telegram (<a href="https://t.me/tckn_bot">@tckn_bot</a>) atau masukkan Chat ID numerik Anda.\n\n` +
            `<i>(Ketik "batal" jika ingin membatalkan pengingat)</i>`,
        };
      }
    }
  }

  // 2. Extract Natural Language Intent
  const intentCheck = extractNaturalLanguageIntent(trimmed);
  if (!intentCheck.isIntent) {
    return { handled: false };
  }

  const cleanInput = intentCheck.cleanInput || trimmed;

  // 3. Fast deterministic regex parse
  let parseResult = parseScheduleInput(cleanInput, defaultChatId);

  // 4. Fallback to AI if regex failed
  if (!parseResult.success) {
    parseResult = await parseWithAiFallback(
      env,
      trimmed,
      defaultChatId,
      sourcePlatform === 'web_dashboard' ? 'dashboard' : 'telegram'
    );
  }

  if (!parseResult.success || !parseResult.message) {
    return {
      handled: true,
      replyText:
        `⚠️ <b>Format Pengingat Kurang Jelas</b>\n\n` +
        `Silakan sebutkan waktu dan pesannya secara spesifik, misalnya:\n` +
        `• <i>"ingetin buat makan 3 menit lagi ya"</i>\n` +
        `• <i>"ingetin makan 3 menit lagi, ingetinnya disini aja"</i>\n` +
        `• <i>"ingetin cek server 15 menit lagi di telegram aja"</i>\n` +
        `• <i>"ingetin besok jam 8 pagi ada meeting"</i>\n` +
        `• <i>"tiap hari jam 09:00 olahraga"</i>`,
    };
  }

  // 5. Context & Target Determination
  let targetPlatform: JobPlatform = 'telegram';
  let finalTargetChatId: string | number = defaultChatId;
  let targetLabel = '';

  const destinationRequested =
    intentCheck.destinationRequested || parseResult.destinationRequested || 'unspecified';
  const explicitUser =
    intentCheck.explicitTelegramUser || parseResult.explicitTelegramUser;

  // ========================================================
  // SCENARIO A: User is chatting in TELEGRAM
  // "cuma kalo di telegram langsung aja disana ingetin"
  // ========================================================
  if (sourcePlatform === 'telegram') {
    targetPlatform = 'telegram';

    if (destinationRequested === 'channel' && isAdmin) {
      finalTargetChatId = env.CHANNEL_ID;
      targetLabel = `Channel <b>${env.CHANNEL_ID}</b>`;
    } else {
      finalTargetChatId = defaultChatId;
      targetLabel = `Chat pribadi ini`;
    }
  }
  // ========================================================
  // SCENARIO B: User is chatting in WEB DASHBOARD
  // ========================================================
  else {
    // Subcase B1: User explicitly asked for TELEGRAM ("di telegram aja", "ke telegram")
    if (destinationRequested === 'telegram') {
      // If user specified the handle/ID in the prompt (e.g. "di telegram @alfian04121")
      if (explicitUser) {
        const resolved = await resolveTelegramChatId(env.AI_NEWS_KV, explicitUser);
        if (resolved) {
          targetPlatform = 'telegram';
          finalTargetChatId = resolved.chatId;
          targetLabel = `Akun Telegram <b>${resolved.label}</b> (ID: <code>${resolved.chatId}</code>)`;
        } else {
          return {
            handled: true,
            replyText:
              `⚠️ <b>Akun Telegram ${escapeHtml(explicitUser)} Belum Terdaftar</b>\n\n` +
              `Pastikan akun tersebut sudah pernah berinteraksi dengan bot di <a href="https://t.me/tckn_bot">@tckn_bot</a> atau masukkan ID numerik Telegram Anda.`,
          };
        }
      } else {
        // User said "di telegram aja" WITHOUT specifying who -> ASK THE USER!
        const pendingState: PendingReminderState = {
          message: parseResult.message,
          scheduleRaw: parseResult.scheduleRaw || 'Reminder',
          dueAt: parseResult.dueAt,
          cronExpression: parseResult.cronExpression,
          humanDescription: parseResult.humanDescription || parseResult.scheduleRaw,
          type: parseResult.type || 'reminder',
          createdAt: Date.now(),
          expiresAt: Date.now() + 15 * 60 * 1000,
        };
        await setPendingReminder(env.AI_NEWS_KV, 'web:admin:1023972475', pendingState);

        return {
          handled: true,
          replyText:
            `🤖 <b>Telegram kamu yang mana?</b>\n\n` +
            `Silakan masukkan username Telegram kamu (contoh: <code>@alfian04121</code>) atau Chat ID kamu agar pengingat <i>"${escapeHtml(parseResult.message)}"</i> bisa dikirimkan langsung ke sana.\n\n` +
            `<i>(Ketik "batal" jika ingin membatalkan)</i>`,
        };
      }
    }
    // Subcase B2: User said "disini aja" / "di web" OR did not specify (default to current platform: Web Dashboard)
    else {
      targetPlatform = 'dashboard';
      finalTargetChatId = 'dashboard';
      targetLabel = `Web Dashboard ini (Di sini)`;
    }
  }

  // 6. Create and Save the Scheduled Job
  const newJob: ScheduledJob = {
    id: `job_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    type: parseResult.type || 'reminder',
    message: parseResult.message,
    targetPlatform,
    targetChatId: finalTargetChatId,
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
        `🔔 Notifikasi akan dikirimkan tepat pada waktunya!\n` +
        `💡 <i>Ketik <code>/delremind ${newJob.id}</code> jika ingin membatalkan pengingat ini.</i>`,
    };
  }
}

// ==========================================
// 6. AI-Assisted Parsing Fallback
// ==========================================
async function parseWithAiFallback(
  env: Env,
  userPrompt: string,
  defaultTargetChatId: string | number,
  defaultPlatform: JobPlatform = 'telegram'
): Promise<ParseJobResult> {
  try {
    const activeModel = await getActiveModel(env.AI_NEWS_KV);
    const wibNow = getWibDate();
    const currentTimeStr = `${wibNow.getUTCFullYear()}-${String(wibNow.getUTCMonth() + 1).padStart(2, '0')}-${String(wibNow.getUTCDate()).padStart(2, '0')} ${String(wibNow.getUTCHours()).padStart(2, '0')}:${String(wibNow.getUTCMinutes()).padStart(2, '0')} WIB`;

    const systemPrompt = `Kamu adalah parser jadwal dan reminder cerdas untuk Cloudflare Worker. Waktu sekarang: ${currentTimeStr}.
Tugasmu adalah menganalisis pesan pengguna dalam Bahasa Indonesia atau Inggris dan mengembalikan JSON HANYA dalam format berikut:
{
  "isSchedule": true,
  "type": "reminder" atau "cron",
  "delayMinutes": integer atau null (jika relatif seperti "3 menit lagi", "1 jam lagi", dsb),
  "specificHourWib": integer 0-23 atau null,
  "specificMinuteWib": integer 0-59 atau null,
  "isTomorrow": boolean,
  "cronExpression": string 5-field cron (atau null jika reminder sekali jalan),
  "message": "isi tugas/pengingat (tanpa embel-embel waktu atau tempat)",
  "destination": "here" atau "telegram" atau "channel" atau "unspecified",
  "explicitTelegramUser": "@username" atau null,
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
        targetPlatform: defaultPlatform,
        destinationRequested: data.destination || 'unspecified',
        explicitTelegramUser: data.explicitTelegramUser || undefined,
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
        targetPlatform: defaultPlatform,
        destinationRequested: data.destination || 'unspecified',
        explicitTelegramUser: data.explicitTelegramUser || undefined,
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
