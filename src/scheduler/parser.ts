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

function cleanActionMessage(msg: string): string {
  let cleaned = msg.trim();
  // Strip leading "buat", "untuk", "agar", "supaya", "tentang", "soal"
  cleaned = cleaned.replace(/^(?:buat|untuk|agar|supaya|tentang|soal)\s+/i, '');
  // Strip trailing polite particles and punctuation
  cleaned = cleaned.replace(/[\s,]+(?:ya|dong|tolong|plis|please|yah)\s*$/i, '');
  cleaned = cleaned.replace(/[.,:;!]+$/, '').trim();
  return cleaned;
}

/**
 * Natural Language / Command Parser for Reminders and Cron Jobs
 */
export function parseScheduleInput(
  text: string,
  defaultTargetChatId: string | number
): ParseJobResult {
  const clean = text.trim();
  const now = Date.now();
  const wibNow = getWibDate(now);

  // 1. Check for Standard 5-field Cron command: /cron <min hour dom mon dow> <pesan>
  // Example: "0 9 * * * Minum air & cek server"
  const cronMatch = /^([\d*,\/\-]+\s+[\d*,\/\-]+\s+[\d*,\/\-]+\s+[\d*,\/\-]+\s+[\d*,\/\-]+)\s+(.+)$/i.exec(clean);
  if (cronMatch) {
    const cronExpr = cronMatch[1];
    const message = cleanActionMessage(cronMatch[2]);
    if (cronExpr.split(/\s+/).length === 5) {
      return {
        success: true,
        type: 'cron',
        cronExpression: cronExpr,
        scheduleRaw: cronExpr,
        message,
        targetChatId: defaultTargetChatId,
        humanDescription: `Berulang sesuai pola cron "${cronExpr}" (WIB)`,
      };
    }
  }

  // 2. Worded intervals: "setengah jam lagi", "sejam lagi", "sehari lagi"
  // Order A: Action first: "makan setengah jam lagi"
  const wordedActionFirst = /^(.+?)\s+(setengah\s+jam|1\/2\s+jam|sejam|sehari)\s*(?:lagi)?$/i.exec(clean);
  // Order B: Time first: "setengah jam lagi makan"
  const wordedTimeFirst = /^(setengah\s+jam|1\/2\s+jam|sejam|sehari)\s*(?:lagi)?(?::|\s+)?(.+)$/i.exec(clean);
  if (wordedActionFirst || wordedTimeFirst) {
    const timeWord = (wordedActionFirst ? wordedActionFirst[2] : wordedTimeFirst![1]).toLowerCase();
    const rawMsg = wordedActionFirst ? wordedActionFirst[1] : wordedTimeFirst![2];
    const message = cleanActionMessage(rawMsg);

    let minutes = 30;
    let label = '30 menit';
    if (timeWord.includes('sejam')) {
      minutes = 60;
      label = '1 jam';
    } else if (timeWord.includes('sehari')) {
      minutes = 1440;
      label = '1 hari';
    }

    const dueAt = now + minutes * 60 * 1000;
    const dueWib = getWibDate(dueAt);
    const timeStr = `${String(dueWib.getUTCHours()).padStart(2, '0')}:${String(dueWib.getUTCMinutes()).padStart(2, '0')} WIB`;

    return {
      success: true,
      type: 'reminder',
      dueAt,
      scheduleRaw: `${label} lagi`,
      message,
      targetChatId: defaultTargetChatId,
      humanDescription: `${label} lagi (${timeStr})`,
    };
  }

  // 3. Relative offset reminders
  // Order A: Time first: "10m cek server", "15 menit lagi makan", "in 10 minutes buat makan"
  const relTimeFirstRegex = /^(?:in\s+)?(\d+)\s*(m|menit|mins?|h|jam|hours?|d|hari|days?|s|detik|secs?)\s*(?:lagi)?(?::|\s+)?(.+)$/i;
  // Order B: Action first: "makan 3 menit lagi", "buat makan 3 menit lagi", "cek oven 10m lagi", "dalam waktu 5 menit"
  const relActionFirstRegex = /^(.+?)\s+(?:dalam\s+waktu\s+|dalam\s+)?(\d+)\s*(m|menit|mins?|h|jam|hours?|d|hari|days?|s|detik|secs?)\s*(?:lagi)?$/i;

  let relMatch = relTimeFirstRegex.exec(clean);
  let isActionFirst = false;
  if (!relMatch) {
    relMatch = relActionFirstRegex.exec(clean);
    isActionFirst = true;
  }

  if (relMatch) {
    const amount = parseInt(isActionFirst ? relMatch[2] : relMatch[1], 10);
    const unit = (isActionFirst ? relMatch[3] : relMatch[2]).toLowerCase();
    const rawMsg = isActionFirst ? relMatch[1] : relMatch[3];
    const message = cleanActionMessage(rawMsg);

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

  // 4. Specific Time Today or Tomorrow:
  // Order A: Time first: "jam 15:30 kirim laporan", "besok jam 08:00 meeting", "jam 8 pagi ada meeting"
  const specTimeFirstRegex = /^(?:(besok)\s+)?(?:jam|pukul)\s*(\d{1,2})(?:[:.](\d{2}))?\s*(pagi|siang|sore|malam|wib)?(?::|\s+)?(.+)$/i;
  // Order B: Action first: "kirim laporan jam 15:30", "meeting besok jam 8 pagi"
  const specActionFirstRegex = /^(.+?)\s+(?:(besok)\s+)?(?:jam|pukul)\s*(\d{1,2})(?:[:.](\d{2}))?\s*(pagi|siang|sore|malam|wib)?$/i;

  let specMatch = specTimeFirstRegex.exec(clean);
  let isSpecActionFirst = false;
  if (!specMatch) {
    specMatch = specActionFirstRegex.exec(clean);
    isSpecActionFirst = true;
  }

  if (specMatch) {
    const isTomorrow = Boolean(isSpecActionFirst ? specMatch[2] : specMatch[1]);
    let targetHour = parseInt(isSpecActionFirst ? specMatch[3] : specMatch[2], 10);
    const minuteStr = isSpecActionFirst ? specMatch[4] : specMatch[3];
    const targetMinute = minuteStr ? parseInt(minuteStr, 10) : 0;
    const period = (isSpecActionFirst ? specMatch[5] || '' : specMatch[4] || '').toLowerCase();
    const rawMsg = isSpecActionFirst ? specMatch[1] : specMatch[5] || specMatch[4] ? specMatch[6] || specMatch[5] || specMatch[4] : specMatch[4];
    const message = cleanActionMessage(rawMsg);

    if (period === 'malam' && targetHour < 12) targetHour += 12;
    if (period === 'sore' && targetHour < 12 && targetHour <= 6) targetHour += 12;
    if (period === 'siang' && targetHour < 11) targetHour += 12;

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

  // 5. Daily Recurring: e.g. "tiap hari jam 09:00 pesan" or "olahraga tiap hari jam 09:00"
  const dailyTimeFirst = /^(?:tiap|setiap|every)\s+hari\s+(?:(?:jam|pukul)\s+)?(\d{1,2})(?:[:.](\d{2}))?\s*(pagi|siang|sore|malam|wib)?(?::|\s+)?(.+)$/i;
  const dailyActionFirst = /^(.+?)\s+(?:tiap|setiap|every)\s+hari\s+(?:(?:jam|pukul)\s+)?(\d{1,2})(?:[:.](\d{2}))?\s*(pagi|siang|sore|malam|wib)?$/i;

  let dailyMatch = dailyTimeFirst.exec(clean);
  let isDailyActionFirst = false;
  if (!dailyMatch) {
    dailyMatch = dailyActionFirst.exec(clean);
    isDailyActionFirst = true;
  }

  if (dailyMatch) {
    let hour = parseInt(isDailyActionFirst ? dailyMatch[2] : dailyMatch[1], 10);
    const minute = (isDailyActionFirst ? dailyMatch[3] : dailyMatch[2]) ? parseInt(isDailyActionFirst ? dailyMatch[3] : dailyMatch[2], 10) : 0;
    const period = (isDailyActionFirst ? dailyMatch[4] || '' : dailyMatch[3] || '').toLowerCase();
    const rawMsg = isDailyActionFirst ? dailyMatch[1] : dailyMatch[4];
    const message = cleanActionMessage(rawMsg);

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

  // 6. Weekly Recurring: e.g. "tiap senin jam 10:00 meeting"
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

  const weeklyTimeFirst = /^(?:tiap|setiap|every)\s+(minggu|senin|selasa|rabu|kamis|jumat|sabtu)\s+(?:(?:jam|pukul)\s+)?(\d{1,2})(?:[:.](\d{2}))?\s*(?:wib)?(?::|\s+)?(.+)$/i;
  const weeklyActionFirst = /^(.+?)\s+(?:tiap|setiap|every)\s+(minggu|senin|selasa|rabu|kamis|jumat|sabtu)\s+(?:(?:jam|pukul)\s+)?(\d{1,2})(?:[:.](\d{2}))?\s*(?:wib)?$/i;

  let weeklyMatch = weeklyTimeFirst.exec(clean);
  let isWeeklyActionFirst = false;
  if (!weeklyMatch) {
    weeklyMatch = weeklyActionFirst.exec(clean);
    isWeeklyActionFirst = true;
  }

  if (weeklyMatch) {
    const dayName = (isWeeklyActionFirst ? weeklyMatch[2] : weeklyMatch[1]).toLowerCase();
    const dow = daysMap[dayName] ?? 1;
    const hour = parseInt(isWeeklyActionFirst ? weeklyMatch[3] : weeklyMatch[2], 10);
    const minute = (isWeeklyActionFirst ? weeklyMatch[4] : weeklyMatch[3]) ? parseInt(isWeeklyActionFirst ? weeklyMatch[4] : weeklyMatch[3], 10) : 0;
    const rawMsg = isWeeklyActionFirst ? weeklyMatch[1] : weeklyMatch[4];
    const message = cleanActionMessage(rawMsg);

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
    error: 'Format waktu tidak dikenali. Contoh: "15m cek kopi", "makan 3 menit lagi", "jam 18:30 kirim laporan", "tiap hari jam 09:00 olahraga".',
  };
}

/**
 * Checks if a natural language prompt is requesting a reminder or cron job.
 * e.g. "ingetin buat makan 3 menit lagi ya, ingetinnya disini aja"
 * e.g. "ingetin buat makan 3 menit lagi ya, di telegram aja"
 */
export function extractNaturalLanguageIntent(text: string): {
  isIntent: boolean;
  cleanInput?: string;
  destinationRequested?: 'here' | 'telegram' | 'channel' | 'unspecified';
  explicitTelegramUser?: string;
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
    lower.includes('schedule') ||
    lower.includes('tiap hari') ||
    lower.includes('setiap hari') ||
    lower.includes('tiap minggu') ||
    lower.includes('setiap minggu');

  if (!hasReminderWord) {
    return { isIntent: false };
  }

  // 1. Detect Destination Requested
  let destinationRequested: 'here' | 'telegram' | 'channel' | 'unspecified' = 'unspecified';
  let explicitTelegramUser: string | undefined = undefined;

  // Check for Channel
  if (lower.includes('channel') || lower.includes('@aicomindo')) {
    destinationRequested = 'channel';
  }
  // Check for Telegram
  else if (
    lower.includes('di telegram') ||
    lower.includes('ke telegram') ||
    lower.includes('lewat telegram') ||
    lower.includes('telegram aja') ||
    lower.includes('telegram ya') ||
    lower.includes('di tlg')
  ) {
    destinationRequested = 'telegram';

    // Check if explicit username or ID is provided: e.g. "di telegram @alfian04121" or "di telegram 1023972475"
    const tgUserMatch = /(?:di|ke|lewat)?\s*telegram\s*(?:aja|ya|dong)?\s*(@[a-zA-Z0-9_]{3,}|\d{7,})/i.exec(text);
    if (tgUserMatch) {
      explicitTelegramUser = tgUserMatch[1];
    } else {
      // General handle pattern: e.g. @alfian04121 anywhere in text
      const handleMatch = /@([a-zA-Z0-9_]{4,})/i.exec(text);
      if (handleMatch && handleMatch[1].toLowerCase() !== 'aicomindo') {
        explicitTelegramUser = `@${handleMatch[1]}`;
      }
    }
  }
  // Check for "here" / "disini"
  else if (
    lower.includes('disini') ||
    lower.includes('di sini') ||
    lower.includes('di dashboard') ||
    lower.includes('di web')
  ) {
    destinationRequested = 'here';
  }

  // 2. Clean out destination phrases from input text
  let cleanInput = text
    // Remove "ingetinnya disini aja", "ingetin disini", "di sini aja", "disini aja", etc.
    .replace(/(?:,\s*)?(?:ingetinnya|ingatkan|kirim(?:kan)?|ingetin)?\s*(?:di\s+sini|disini|di\s+dashboard|di\s+web)\s*(?:aja|ya|dong)?/gi, '')
    // Remove "ingetinnya di telegram aja", "di telegram aja", "ke telegram @username", etc.
    .replace(/(?:,\s*)?(?:ingetinnya|ingatkan|kirim(?:kan)?|ingetin)?\s*(?:di\s+telegram|ke\s+telegram|lewat\s+telegram|telegram)\s*(?:aja|ya|dong)?(?:\s*@[a-zA-Z0-9_]+|\s*\d{7,})?/gi, '')
    // Remove "di channel", "ke channel"
    .replace(/(?:,\s*)?(?:di\s+channel|ke\s+channel|di\s+@aicomindo)\s*(?:aja|ya|dong)?/gi, '')
    // Strip prefixes like "tolong ingetin aku", "bisa ingetin aku", "bikin reminder", etc.
    .replace(/^(?:halo\s+bot,?\s*)?(?:tolong\s+)?(?:bisa\s+)?(?:tolong\s+)?(?:bikin|buat|jadwalkan|set)\s+(?:reminder|cron\s*job|pengingat|jadwal)\s*(?:dong|ya)?\s*:?/gi, '')
    .replace(/^(?:halo\s+bot,?\s*)?(?:tolong\s+)?(?:ingetin|ingatkan|remind)\s+(?:aku|saya|kita|kami|channel)?\s*(?:dong|ya)?\s*:?/gi, '')
    .trim();

  // Remove trailing "tolong ingetin", "bisa ingetin ya", etc.
  cleanInput = cleanInput.replace(/[\s,]+(?:tolong\s+)?(?:bisa\s+)?(?:di)?(?:ingetin|ingatkan|remind)(?:\s*dong|\s*ya|\s*plis)?\s*$/i, '').trim();
  // Remove leading "buat" or "untuk"
  cleanInput = cleanInput.replace(/^(?:untuk|buat)\s+/i, '').trim();
  // Remove trailing politeness particles
  cleanInput = cleanInput.replace(/[\s,]+(?:ya|dong|tolong|plis|please|yah)\s*$/i, '').trim();

  return {
    isIntent: true,
    cleanInput,
    destinationRequested,
    explicitTelegramUser,
  };
}

