import { ScheduledJob, JobPlatform } from './types';
import { saveJob, getAllJobs, deleteJob, resolveTelegramChatId } from './manager';
import { getWibDate, wibComponentsToEpoch } from './parser';
import { stripEmojis, escapeHtml } from '../utils/text';
import { getAppConfig } from '../config';

export interface ToolExecutionContext {
  env: Env;
  userId: string | number;
  userName: string;
  chatId: string | number;
  sourcePlatform: 'telegram' | 'web_dashboard';
  isAdmin: boolean;
}

export interface ToolExecutionResult {
  toolName: string;
  success: boolean;
  message?: string;
  data?: any;
  needsClarification?: boolean;
  clarificationQuestion?: string;
}

// 1. OpenAI-compatible Tool Specifications
export const SCHEDULER_TOOLS_SCHEMA = [
  {
    type: 'function',
    function: {
      name: 'set_reminder',
      description: 'Atur pengingat (reminder) satu kali untuk pengguna. Panggil fungsi ini jika pengguna secara eksplisit meminta pengingat atau mengonfirmasi ingin diingatkan.',
      parameters: {
        type: 'object',
        properties: {
          message: {
            type: 'string',
            description: 'Isi tugas atau kegiatan yang ingin diingatkan (misal: "makan", "minum air", "cek oven", "meeting tim"). Jangan sertakan keterangan waktu/tempat di sini.',
          },
          delay_minutes: {
            type: 'number',
            description: 'Jumlah menit dari sekarang untuk waktu relatif (misal: 3 untuk 3 menit lagi, 15, 60 untuk 1 jam lagi). Berikan null jika menggunakan specific_time_wib.',
          },
          specific_time_wib: {
            type: 'string',
            description: 'Waktu spesifik WIB dalam format HH:mm (misal: "14:30", "08:00", "20:00"). Berikan null jika menggunakan delay_minutes.',
          },
          is_tomorrow: {
            type: 'boolean',
            description: 'Set true jika waktu spesifik dijadwalkan untuk besok hari.',
          },
          target_platform: {
            type: 'string',
            enum: ['current', 'telegram', 'dashboard'],
            description: 'Platform tujuan pengiriman notifikasi. Pilih "current" jika di tempat chat saat ini ("disini"), "telegram" jika diminta ke Telegram, atau "dashboard" jika ke Web Dashboard.',
          },
          target_account: {
            type: 'string',
            description: 'Username Telegram (misal: username akun pengguna) atau Chat ID jika pengguna di Web Dashboard meminta kirim ke Telegram. Berikan null jika tidak disebutkan.',
          },
        },
        required: ['message'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_cron_job',
      description: 'Atur tugas berulang (cron job) otomatis yang dieksekusi secara berkala (misal: tiap hari jam 9 pagi, tiap senin, dsb).',
      parameters: {
        type: 'object',
        properties: {
          message: {
            type: 'string',
            description: 'Pesan pengingat atau konten tugas yang dijalankan berulang kali.',
          },
          cron_expression: {
            type: 'string',
            description: '5-field cron expression WIB (misal: "0 9 * * *" untuk tiap hari jam 9 pagi, "30 8 * * 1" untuk tiap senin 08:30).',
          },
          schedule_description: {
            type: 'string',
            description: 'Keterangan manusia yang mudah dibaca mengenai jadwalnya (misal: "Setiap hari pukul 09:00 WIB").',
          },
          target_platform: {
            type: 'string',
            enum: ['current', 'telegram', 'dashboard', 'channel'],
            description: 'Tujuan notifikasi. "channel" hanya boleh jika pengguna adalah admin atau pengelola bot.',
          },
          target_account: {
            type: 'string',
            description: 'Username atau ID Telegram tujuan jika diminta khusus.',
          },
        },
        required: ['message', 'cron_expression'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_reminders',
      description: 'Lihat daftar semua pengingat dan jadwal aktif milik pengguna saat ini.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_reminder',
      description: 'Batalkan atau hapus jadwal atau pengingat berdasarkan ID jadwal.',
      parameters: {
        type: 'object',
        properties: {
          job_id: {
            type: 'string',
            description: 'ID jadwal (misal: "job_1727891234_abc").',
          },
        },
        required: ['job_id'],
      },
    },
  },
];

// 2. System Prompt Instructions for Natural Tool Calling
export const SCHEDULER_SYSTEM_PROMPT_INSTRUCTIONS = `
KEMAMPUAN ALAT PENGINGAT & PENJADWALAN (FUNCTION CALLING):
Kamu memiliki akses ke alat penjadwalan cerdas untuk mengelola pengingat (reminders) dan jadwal otomatis (cron jobs).
Daftar alat yang tersedia:
1. set_reminder(message, delay_minutes, specific_time_wib, is_tomorrow, target_platform, target_account)
2. set_cron_job(message, cron_expression, schedule_description, target_platform, target_account)
3. list_reminders()
4. delete_reminder(job_id)

PANDUAN KEPUTUSAN CERDAS (LET THE AI DECIDE):
1. JIKA PENGGUNA MEMERINTAHKAN PENGINGAT:
   Contoh: "ingetin 3 menit lagi makan", "makan 3 menit ingetin ya", "ingetin besok jam 8 pagi meeting", "ingetin minum air 15 menit lagi disini aja".
   -> LANGSUNG PANGGIL fungsi 'set_reminder'! Jangan tanya lagi, langsung eksekusi tugasnya.

2. JIKA PENGGUNA HANYA BERCERITA / BICARA SANTAI (INTENT BELUM JELAS):
   Contoh: "mau makan 3 menit nih", "aku lagi mau ngerjain tugas 1 jam lagi", "nanti sore mau jogging".
   -> JANGAN langsung panggil tool tanpa izin. Jawab secara ramah dan tanyakan apakah mereka mau dipasangkan pengingat!
   Contoh: "Selamat makan! Mau sekalian aku pasangin pengingat 3 menit lagi biar nggak kelupaan?"

3. JIKA PENGGUNA DI WEB DASHBOARD INGIN KE TELEGRAM TAPI BELUM KASIH AKUN:
   Contoh: di Web Dashboard user bilang "ingetin makan 3 menit lagi di telegram aja".
   -> Jawab ramah dan tanyakan akunnya: "Boleh! Mau dikirim ke Telegram kamu yang mana? Kasih tahu username (@username) atau Chat ID kamu ya!"

4. JIKA PENGGUNA DI TELEGRAM:
   Segala permintaan "disini aja" atau "di telegram aja" otomatis berlaku di chat Telegram yang sedang berlangsung tanpa perlu menanyakan akun lagi.

CARA PEMANGGILAN ALAT:
Kamu dapat memanggil tool melalui protokol Function Calling, atau sertakan tag:
<tool_call>{"name": "nama_tool", "arguments": {...}}</tool_call>
`;

// 3. Executor Engine for Tool Calls
export async function executeSchedulerTool(
  name: string,
  args: Record<string, any>,
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  const { env, userId, userName, chatId, sourcePlatform, isAdmin } = context;
  const now = Date.now();
  const wibNow = getWibDate(now);

  console.log(`[Tool Engine] Executing tool '${name}' with args:`, JSON.stringify(args));

  // TOOL 1: SET_REMINDER
  if (name === 'set_reminder') {
    const rawMsg = (args.message || 'Pengingat').trim();
    const delayMinutes = typeof args.delay_minutes === 'number' ? args.delay_minutes : null;
    const specificTime = args.specific_time_wib ? String(args.specific_time_wib).trim() : null;
    const isTomorrow = Boolean(args.is_tomorrow);
    const targetPlatformArg = args.target_platform || 'current';
    const targetAccount = args.target_account ? String(args.target_account).trim() : null;

    let dueAt = now;
    let scheduleRaw = '';
    let humanSchedule = '';

    // Calculate dueAt
    if (delayMinutes && delayMinutes > 0) {
      dueAt = now + delayMinutes * 60 * 1000;
      scheduleRaw = `${delayMinutes} menit lagi`;
      const dueWib = getWibDate(dueAt);
      const timeStr = `${String(dueWib.getUTCHours()).padStart(2, '0')}:${String(dueWib.getUTCMinutes()).padStart(2, '0')} WIB`;
      humanSchedule = `${delayMinutes} menit lagi (pukul ${timeStr})`;
    } else if (specificTime) {
      const match = /^(\d{1,2})[:.](\d{2})$/.exec(specificTime);
      let targetHour = match ? parseInt(match[1], 10) : 12;
      let targetMinute = match ? parseInt(match[2], 10) : 0;

      let y = wibNow.getUTCFullYear();
      let m = wibNow.getUTCMonth();
      let d = wibNow.getUTCDate();

      if (isTomorrow) {
        d += 1;
      } else {
        const curH = wibNow.getUTCHours();
        const curM = wibNow.getUTCMinutes();
        if (targetHour < curH || (targetHour === curH && targetMinute <= curM)) {
          d += 1;
        }
      }

      dueAt = wibComponentsToEpoch(y, m, d, targetHour, targetMinute);
      const dayLabel = isTomorrow || d !== wibNow.getUTCDate() ? 'Besok' : 'Hari ini';
      const timeStr = `${String(targetHour).padStart(2, '0')}:${String(targetMinute).padStart(2, '0')} WIB`;
      scheduleRaw = `${dayLabel} jam ${timeStr}`;
      humanSchedule = `${dayLabel} pukul ${timeStr}`;
    } else {
      // Default to 15 minutes
      dueAt = now + 15 * 60 * 1000;
      scheduleRaw = '15 menit lagi';
      const dueWib = getWibDate(dueAt);
      const timeStr = `${String(dueWib.getUTCHours()).padStart(2, '0')}:${String(dueWib.getUTCMinutes()).padStart(2, '0')} WIB`;
      humanSchedule = `15 menit lagi (pukul ${timeStr})`;
    }

    // Resolve Target Destination
    let targetPlatform: JobPlatform = 'telegram';
    let targetChatId: string | number = chatId;
    let targetLabel = '';

    if (sourcePlatform === 'telegram') {
      targetPlatform = 'telegram';
      targetChatId = chatId;
      targetLabel = 'Chat Telegram ini';
    } else {
      // Chatting on Web Dashboard
      if (targetPlatformArg === 'telegram') {
        const config = getAppConfig(env);
        if (targetAccount) {
          const resolved = await resolveTelegramChatId(env.AI_NEWS_KV, targetAccount, env);
          if (resolved) {
            targetPlatform = 'telegram';
            targetChatId = resolved.chatId;
            targetLabel = `Akun Telegram ${resolved.label} (ID: ${resolved.chatId})`;
          } else {
            const botHandle = config.bot.username ? `@${config.bot.username}` : 'bot kami';
            return {
              toolName: name,
              success: false,
              message: `Akun Telegram <code>${targetAccount}</code> belum terdaftar di bot kami. Silakan pastikan akun tersebut sudah pernah mengirim pesan ke ${botHandle} atau gunakan ID numerik.`,
            };
          }
        } else {
          // User in dashboard wants Telegram but did not specify which account!
          return {
            toolName: name,
            success: false,
            needsClarification: true,
            clarificationQuestion:
              `Boleh! Mau dikirim ke akun Telegram kamu yang mana? ` +
              `Silakan sebutkan username Telegram kamu (contoh: <code>@${config.admin.username}</code>) atau Chat ID kamu ya!`,
          };
        }
      } else {
        // Destination is Dashboard
        targetPlatform = 'dashboard';
        targetChatId = 'dashboard';
        targetLabel = 'Web Dashboard ini (Di sini)';
      }
    }

    // Create & Save Scheduled Job
    const newJob: ScheduledJob = {
      id: `job_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      type: 'reminder',
      message: rawMsg,
      targetPlatform,
      targetChatId,
      creatorId: userId,
      creatorName: userName,
      scheduleRaw,
      dueAt,
      timezoneOffsetHours: 7,
      status: 'active',
      createdAt: new Date().toISOString(),
      runCount: 0,
    };

    await saveJob(env.AI_NEWS_KV, newJob);

    return {
      toolName: name,
      success: true,
      message: `Pengingat berhasil dijadwalkan untuk "${newJob.message}" pada ${humanSchedule} (${targetLabel}).`,
      data: newJob,
    };
  }

  // TOOL 2: SET_CRON_JOB
  if (name === 'set_cron_job') {
    const rawMsg = (args.message || 'Tugas Otomatis').trim();
    const cronExpr = String(args.cron_expression || '0 9 * * *').trim();
    const scheduleDesc = args.schedule_description || `Pola cron: ${cronExpr}`;
    const targetPlatformArg = args.target_platform || 'current';

    let targetPlatform: JobPlatform = 'telegram';
    let targetChatId: string | number = chatId;
    let targetLabel = '';

    if (targetPlatformArg === 'channel' && isAdmin) {
      targetPlatform = 'telegram';
      targetChatId = env.CHANNEL_ID;
      targetLabel = `Channel resmi ${env.CHANNEL_ID}`;
    } else if (sourcePlatform === 'web_dashboard' && targetPlatformArg !== 'telegram') {
      targetPlatform = 'dashboard';
      targetChatId = 'dashboard';
      targetLabel = 'Web Dashboard ini (Di sini)';
    } else {
      targetPlatform = 'telegram';
      targetChatId = chatId;
      targetLabel = 'Chat Telegram ini';
    }

    const newJob: ScheduledJob = {
      id: `job_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      type: 'cron',
      message: rawMsg,
      targetPlatform,
      targetChatId,
      creatorId: userId,
      creatorName: userName,
      scheduleRaw: scheduleDesc,
      cronExpression: cronExpr,
      timezoneOffsetHours: 7,
      status: 'active',
      createdAt: new Date().toISOString(),
      runCount: 0,
    };

    await saveJob(env.AI_NEWS_KV, newJob);

    return {
      toolName: name,
      success: true,
      message: `Jadwal otomatis berhasil dibuat untuk "${newJob.message}" dengan jadwal ${scheduleDesc} (${targetLabel}).`,
      data: newJob,
    };
  }

  // TOOL 3: LIST_REMINDERS
  if (name === 'list_reminders') {
    const jobs = await getAllJobs(env.AI_NEWS_KV);
    const activeJobs = jobs.filter((j) => j.status === 'active');

    if (activeJobs.length === 0) {
      return {
        toolName: name,
        success: true,
        message: 'Saat ini belum ada pengingat atau jadwal aktif yang tersimpan.',
      };
    }

    const jobLines = activeJobs.map(
      (j, idx) =>
        `${idx + 1}. [${j.type === 'cron' ? 'Jadwal Rutin' : 'Pengingat'}] <b>${escapeHtml(j.message)}</b>\n` +
        `   Waktu: <i>${escapeHtml(j.scheduleRaw)}</i> &bull; Target: <i>${j.targetPlatform === 'dashboard' ? 'Web Dashboard' : 'Telegram'}</i>`
    );

    return {
      toolName: name,
      success: true,
      message: `<b>Daftar Jadwal & Pengingat Aktif (${activeJobs.length}):</b>\n\n${jobLines.join('\n\n')}`,
      data: activeJobs,
    };
  }

  // TOOL 4: DELETE_REMINDER
  if (name === 'delete_reminder') {
    const jobId = String(args.job_id || '').trim();
    if (!jobId) {
      return {
        toolName: name,
        success: false,
        message: 'Mohon sebutkan ID pengingat yang ingin dibatalkan.',
      };
    }

    const delRes = await deleteJob(env.AI_NEWS_KV, jobId, userId, isAdmin);
    return {
      toolName: name,
      success: delRes.success,
      message: stripEmojis(delRes.message),
    };
  }

  return {
    toolName: name,
    success: false,
    message: `Alat '${name}' tidak dikenali.`,
  };
}
