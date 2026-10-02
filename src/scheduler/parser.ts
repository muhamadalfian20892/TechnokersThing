import { JobType, ParseJobResult } from './types';

// Helper to get current Date in WIB (UTC+7)
export function getWibDate(epochMs: number = Date.now()): Date {
  // Return Date shifted by 7 hours from UTC
  return new Date(epochMs + 7 * 60 * 60 * 1000);
}

// Convert WIB components back to UTC epoch (ms)
export function wibComponentsToEpoch(
  year: number,
  monthIndex: number,
  day: number,
  hour: number,
  minute: number
): number {
  return Date.UTC(year, monthIndex, day, hour - 7, minute, 0, 0);
}

/**
 * Evaluates whether a 5-part cron expression matches the given date in WIB (UTC+7)
 * Cron format: minute hour day-of-month month day-of-week
 */
export function matchesCron(cronExpr: string, wibDate: Date): boolean {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) return false;

  const [minExpr, hourExpr, domExpr, monExpr, dowExpr] = parts;

  const minute = wibDate.getUTCMinutes();
  const hour = wibDate.getUTCHours();
  const dom = wibDate.getUTCDate();
  const month = wibDate.getUTCMonth() + 1; // 1-12
  const dow = wibDate.getUTCDay();        // 0-6 (0 is Sunday)

  return (
    matchField(minExpr, minute, 0, 59) &&
    matchField(hourExpr, hour, 0, 23) &&
    matchField(domExpr, dom, 1, 31) &&
    matchField(monExpr, month, 1, 12) &&
    matchField(dowExpr, dow, 0, 6)
  );
}

function matchField(expr: string, value: number, min: number, max: number): boolean {
  if (expr === '*') return true;

  // Step values: */5 or 10-30/5
  if (expr.includes('/')) {
    const [range, stepStr] = expr.split('/');
    const step = parseInt(stepStr, 10);
    if (isNaN(step) || step <= 0) return false;

    if (range === '*') {
      return value % step === 0;
    }
    const [startStr, endStr] = range.split('-');
    const start = parseInt(startStr, 10);
    const end = endStr ? parseInt(endStr, 10) : max;
    if (value < start || value > end) return false;
    return (value - start) % step === 0;
  }

  // Comma separated values: 1,2,5
  if (expr.includes(',')) {
    const list = expr.split(',').map((x) => parseInt(x.trim(), 10));
    return list.includes(value);
  }

  // Range: 1-5
  if (expr.includes('-')) {
    const [startStr, endStr] = expr.split('-');
    const start = parseInt(startStr, 10);
    const end = parseInt(endStr, 10);
    return value >= start && value <= end;
  }

  // Exact number
  const target = parseInt(expr, 10);
  return target === value;
}

/**
 * Natural Language / Command Parser for Reminders and Cron Jobs
 */
export function parseScheduleInput(text: string, defaultTargetChatId: string | number): ParseJobResult {
  const clean = text.trim();
  const now = Date.now();
  const wibNow = getWibDate(now);

  // 1. Check for Standard 5-field Cron command: /cron <min hour dom mon dow> <pesan>
  // Example: "0 9 * * * Minum air & cek server"
  const cronMatch = /^(\S+\s+\S+\s+\S+\s+\S+\s+\S+)\s+(.+)$/i.exec(clean);
  if (cronMatch) {
    const cronExpr = cronMatch[1];
    const message = cronMatch[2].trim();
    if (cronExpr.split(/\s+/).length === 5) {
      return {
        success: true,
        type: 'cron',
        cronExpression: cronExpr,
        scheduleRaw: cronExpr,
        message,
        targetChatId: defaultTargetChatId,
        humanDescription: `Berulang sesuai ekspresi cron "${cronExpr}" (WIB)`,
      };
    }
  }

  // 2. Relative offset reminders: e.g. "10m", "15 menit", "1 jam", "2 jam 30 menit", "30s"
  // Format: "10m pesan" or "10 menit lagi pesan" or "in 10 minutes pesan"
  const relativeRegex = /^(?:in\s+)?(\d+)\s*(m|menit|mins?|h|jam|hours?|d|hari|days?|s|detik|secs?)\s*(?:lagi)?(?::|\s+)?(.+)$/i;
  const relMatch = relativeRegex.exec(clean);
  if (relMatch) {
    const amount = parseInt(relMatch[1], 10);
    const unit = relMatch[2].toLowerCase();
    const message = relMatch[3].trim();

    let multiplierMs = 60 * 1000;
    let unitLabel = 'menit';
    if (unit.startsWith('h') || unit.startsWith('jam')) {
      multiplierMs = 60 * 60 * 1000;
      unitLabel = 'jam';
    } else if (unit.startsWith('d') || unit.startsWith('hari')) {
      multiplierMs = 24 * 60 * 60 * 1000;
      unitLabel = 'hari';
    } else if (unit.startsWith('s') || unit.startsWith('detik')) {
      multiplierMs = 1000;
      unitLabel = 'detik';
    }

    const dueAt = now + amount * multiplierMs;
    const dueWib = getWibDate(dueAt);
    const timeStr = `${String(dueWib.getUTCHours()).padStart(2, '0')}:${String(dueWib.getUTCMinutes()).padStart(2, '0')} WIB`;

    return {
      success: true,
      type: 'reminder',
      dueAt,
      scheduleRaw: `${amount} ${unitLabel} lagi`,
      message,
      targetChatId: defaultTargetChatId,
      humanDescription: `${amount} ${unitLabel} lagi (${timeStr})`,
    };
  }

  // 3. Specific Time Today or Tomorrow: e.g. "jam 15:30 pesan", "15:30 pesan", "besok jam 08:00 pesan"
  const specificTimeRegex = /^(?:(besok)\s+)?(?:jam\s+)?(\d{1,2})[:.](\d{2})\s*(?:wib)?(?::|\s+)?(.+)$/i;
  const specMatch = specificTimeRegex.exec(clean);
  if (specMatch) {
    const isTomorrow = Boolean(specMatch[1]);
    const targetHour = parseInt(specMatch[2], 10);
    const targetMinute = parseInt(specMatch[3], 10);
    const message = specMatch[4].trim();

    if (targetHour >= 0 && targetHour <= 23 && targetMinute >= 0 && targetMinute <= 59) {
      let targetYear = wibNow.getUTCFullYear();
      let targetMonth = wibNow.getUTCMonth();
      let targetDay = wibNow.getUTCDate();

      if (isTomorrow) {
        targetDay += 1;
      } else {
        // If the hour has already passed today in WIB, schedule for tomorrow
        const currentHour = wibNow.getUTCHours();
        const currentMinute = wibNow.getUTCMinutes();
        if (targetHour < currentHour || (targetHour === currentHour && targetMinute <= currentMinute)) {
          targetDay += 1;
        }
      }

      const dueAt = wibComponentsToEpoch(targetYear, targetMonth, targetDay, targetHour, targetMinute);
      const dayLabel = isTomorrow || targetDay !== wibNow.getUTCDate() ? 'Besok' : 'Hari ini';
      const timeStr = `${String(targetHour).padStart(2, '0')}:${String(targetMinute).padStart(2, '0')} WIB`;

      return {
        success: true,
        type: 'reminder',
        dueAt,
        scheduleRaw: `${dayLabel} jam ${timeStr}`,
        message,
        targetChatId: defaultTargetChatId,
        humanDescription: `${dayLabel} pukul ${timeStr}`,
      };
    }
  }

  // 4. Daily Recurring: e.g. "tiap hari jam 09:00 pesan" or "setiap hari jam 9 pagi pesan"
  const dailyRecurringRegex = /^(?:tiap|setiap|every)\s+hari\s+(?:jam\s+)?(\d{1,2})(?:[:.](\d{2}))?\s*(pagi|siang|sore|malam|wib)?(?::|\s+)?(.+)$/i;
  const dailyMatch = dailyRecurringRegex.exec(clean);
  if (dailyMatch) {
    let hour = parseInt(dailyMatch[1], 10);
    const minute = dailyMatch[2] ? parseInt(dailyMatch[2], 10) : 0;
    const period = (dailyMatch[3] || '').toLowerCase();
    const message = dailyMatch[4].trim();

    if (period === 'malam' && hour < 12) hour += 12;
    if (period === 'sore' && hour < 12 && hour <= 6) hour += 12;
    if (period === 'siang' && hour < 11) hour += 12;

    const cronExpr = `${minute} ${hour} * * *`;
    const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} WIB`;

    return {
      success: true,
      type: 'cron',
      cronExpression: cronExpr,
      scheduleRaw: `Tiap hari jam ${timeStr}`,
      message,
      targetChatId: defaultTargetChatId,
      humanDescription: `Setiap hari pukul ${timeStr}`,
    };
  }

  // 5. Weekly Recurring: e.g. "tiap senin jam 10:00 pesan"
  const daysMap: Record<string, number> = {
    minggu: 0,
    ahad: 0,
    sunday: 0,
    senin: 1,
    monday: 1,
    selasa: 2,
    tuesday: 2,
    rabu: 3,
    wednesday: 3,
    kamis: 4,
    thursday: 4,
    jumat: 5,
    friday: 5,
    sabtu: 6,
    saturday: 6,
  };

  const weeklyRegex = /^(?:tiap|setiap|every)\s+(minggu|senin|selasa|rabu|kamis|jumat|sabtu)\s+(?:jam\s+)?(\d{1,2})(?:[:.](\d{2}))?\s*(?:wib)?(?::|\s+)?(.+)$/i;
  const weeklyMatch = weeklyRegex.exec(clean);
  if (weeklyMatch) {
    const dayName = weeklyMatch[1].toLowerCase();
    const dow = daysMap[dayName] ?? 1;
    const hour = parseInt(weeklyMatch[2], 10);
    const minute = weeklyMatch[3] ? parseInt(weeklyMatch[3], 10) : 0;
    const message = weeklyMatch[4].trim();

    const cronExpr = `${minute} ${hour} * * ${dow}`;
    const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} WIB`;

    return {
      success: true,
      type: 'cron',
      cronExpression: cronExpr,
      scheduleRaw: `Tiap ${dayName} jam ${timeStr}`,
      message,
      targetChatId: defaultTargetChatId,
      humanDescription: `Setiap hari ${dayName.toUpperCase()} pukul ${timeStr}`,
    };
  }

  return {
    success: false,
    error: 'Format waktu tidak dikenali. Contoh: "15m cek kopi", "jam 18:30 kirim laporan", "tiap hari jam 09:00 meeting tim".',
  };
}

/**
 * Checks if a natural language prompt is requesting a reminder or cron job.
 * e.g. "ingetin aku 10 menit lagi buat minum obat"
 */
export function extractNaturalLanguageIntent(text: string): {
  isIntent: boolean;
  cleanInput?: string;
  targetIsChannel?: boolean;
} {
  const lower = text.toLowerCase().trim();

  // Keyword indicators
  const hasReminderWord =
    lower.includes('ingetin') ||
    lower.includes('ingatkan') ||
    lower.includes('reminder') ||
    lower.includes('remind me') ||
    lower.includes('bikin reminder') ||
    lower.includes('buat reminder') ||
    lower.includes('bikin cron') ||
    lower.includes('buat cron') ||
    lower.includes('jadwalkan') ||
    lower.includes('schedule');

  if (!hasReminderWord) {
    return { isIntent: false };
  }

  const targetIsChannel = lower.includes('channel') || lower.includes('@aicomindo');

  // Strip prefixes like "tolong ingetin aku", "bisa ingetin aku", "bikin reminder", etc.
  let cleanInput = text
    .replace(/^(?:halo\s+bot,?\s*)?(?:tolong\s+)?(?:bisa\s+)?(?:tolong\s+)?(?:bikin|buat|jadwalkan|set)\s+(?:reminder|cron\s*job|pengingat|jadwal)\s*(?:dong|ya)?\s*:?/i, '')
    .replace(/^(?:halo\s+bot,?\s*)?(?:tolong\s+)?(?:ingetin|ingatkan|remind)\s+(?:aku|saya|kita|kami|channel)?\s*(?:dong|ya)?\s*:?/i, '')
    .trim();

  // If text started with "ingetin aku buat..." -> might be "buat minum obat 10 menit lagi" or "10 menit lagi buat..."
  // Remove leading "buat" or "untuk" if followed by relative time
  cleanInput = cleanInput.replace(/^(?:untuk|buat)\s+/i, '').trim();

  return {
    isIntent: true,
    cleanInput,
    targetIsChannel,
  };
}
