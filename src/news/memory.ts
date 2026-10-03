import {
  RawNewsItem,
  PostedNewsRecord,
  UsageMetric,
  AuditLogEntry,
  ChatMessage,
  UserProfile,
  DashboardOtpRecord,
  DashboardSessionRecord,
} from './types';

// Hardcoded Super Admin as requested: @alfian04121 (ID: 1023972475)
export const SUPER_ADMIN_ID = '1023972475';

// Fast SHA-256 for Cloudflare Workers Web Crypto API
async function hashText(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`.toLowerCase();
  } catch {
    return url.toLowerCase().split('?')[0];
  }
}

// ==========================================
// 1. Posting Lock & Pause Switch
// ==========================================

export async function isPostingPaused(kv: KVNamespace): Promise<boolean> {
  const val = await kv.get('config:posting_paused');
  return val === 'true';
}

export async function setPostingPaused(kv: KVNamespace, paused: boolean): Promise<void> {
  await kv.put('config:posting_paused', paused ? 'true' : 'false');
  await addAuditLog(kv, paused ? 'PAUSE_POSTING' : 'RESUME_POSTING', 'Admin');
}

export async function hasPostedToday(kv: KVNamespace, wibDateStr: string): Promise<boolean> {
  const key = `daily_posted:${wibDateStr}`;
  const val = await kv.get(key);
  return val !== null;
}

export async function markPostedToday(kv: KVNamespace, wibDateStr: string): Promise<void> {
  const key = `daily_posted:${wibDateStr}`;
  await kv.put(key, new Date().toISOString(), { expirationTtl: 3 * 24 * 60 * 60 });
}

export async function clearPostedTodayLock(kv: KVNamespace, wibDateStr: string): Promise<void> {
  const key = `daily_posted:${wibDateStr}`;
  await kv.delete(key);
  await addAuditLog(kv, 'CLEAR_TODAY_LOCK', 'Admin', `Date: ${wibDateStr}`);
}

// ==========================================
// 2. Active Model Selection
// ==========================================

export const DEFAULT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

export async function getActiveModel(kv: KVNamespace): Promise<string> {
  const model = await kv.get('config:active_model');
  return model || DEFAULT_MODEL;
}

export async function setActiveModel(kv: KVNamespace, modelId: string): Promise<void> {
  await kv.put('config:active_model', modelId.trim());
  await addAuditLog(kv, 'SET_ACTIVE_MODEL', 'Admin', `New model: ${modelId}`);
}

// ==========================================
// 3. Usage & Limit Tracking
// ==========================================

export async function recordUsage(
  kv: KVNamespace,
  tokensEstimated: number = 0,
  isAiGen: boolean = true,
  isBackup: boolean = false
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const key = `usage:${today}`;
  const raw = await kv.get(key);

  let metric: UsageMetric = {
    date: today,
    totalRequests: 0,
    aiGenerations: 0,
    totalTokensEstimated: 0,
    neuronsEstimated: 0,
    backupAiRequests: 0,
  };

  if (raw) {
    try {
      metric = JSON.parse(raw);
    } catch {
      // default
    }
  }

  metric.totalRequests += 1;
  if (isAiGen) {
    metric.aiGenerations += 1;
    metric.totalTokensEstimated += tokensEstimated;
    if (isBackup) {
      metric.backupAiRequests = (metric.backupAiRequests || 0) + 1;
    } else {
      metric.neuronsEstimated += Math.round(tokensEstimated * 1.2);
    }
  }

  await kv.put(key, JSON.stringify(metric), { expirationTtl: 14 * 24 * 60 * 60 });
}

export async function getUsageStats(kv: KVNamespace, dateStr?: string): Promise<UsageMetric> {
  const targetDate = dateStr || new Date().toISOString().slice(0, 10);
  const raw = await kv.get(`usage:${targetDate}`);
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch {
      // fallback
    }
  }
  return {
    date: targetDate,
    totalRequests: 0,
    aiGenerations: 0,
    totalTokensEstimated: 0,
    neuronsEstimated: 0,
    backupAiRequests: 0,
  };
}

// ==========================================
// 4. Few-Shot Style Memory System
// ==========================================

export const DEFAULT_STYLE_FEW_SHOT = `Google Cetak Sejarah! Caplok Wiz $32 Miliar Demi Rajai Keamanan Cloud AI!

Dua minggu terakhir ini dunia tech bener-bener gak kasih kita napas. Buat kalian yang gak mau pusing ketinggalan info, ini rangkuman 10 gebrakan paling gila yang bakal ngerubah masa depan ekosistem digital kita. Langsung sikat:

1. Google Pecah Rekor: Akuisisi Wiz $32 Miliar!
Google resmi tutup deal terbesar sepanjang sejarahnya dengan beli perusahaan cybersecurity Wiz. Tujuannya jelas: bikin Google Cloud & Gemini jadi benteng paling aman buat data AI kalian. Google rela keluar Rp 500 Triliun+ cuma buat menangin kepercayaan korporat global.

2. Meta x Broadcom: Perang Chip Lawan Nvidia!
Mark Zuckerberg makin serius "cerai" dari Nvidia. Meta gandeng Broadcom buat bikin chip kustom MTIA generasi terbaru. Mereka mau AI-nya makin kenceng di WhatsApp & Instagram tanpa harus ngemis stok GPU ke pihak lain.

3. Spotify vs Lagu AI "Sampah"
Industri musik makin gerah! Spotify ngerilis Artist Profile Protection. Sekarang, lagu hasil generate suara AI ilegal bakal langsung ditendang sebelum tayang. Ini kemenangan telak buat hak cipta musisi asli.

4. Mozilla Thunderbolt: Bangun Server AI Sendiri di Rumah!
Bosen data kalian "diintip" raksasa cloud? Mozilla rilis Thunderbolt, client open-source buat jalanin model AI pinter (kayak Llama) di server sendiri. Privasi total, kedaulatan digital beneran. Lu bisa cek kodenya di git clone https://github.com/mozilla/thunderbolt.

5. Adobe Firefly AI Assistant: Desain Tinggal Ngomong
Adobe rilis asisten yang nggak cuma bikin gambar, tapi bisa "ngejalanin" Photoshop & Premiere buat kalian secara otomatis. Kerja desain ribet sekarang jadi urusan asisten AI-nya.

6. Gemini for Mac: Fitur "Screen Sharing" Jadi Game Changer!
Google Gemini resmi punya aplikasi native buat Mac. Fitur juaranya: Screen Sharing. Gemini bisa liat apa yang kalian buka di layar buat kasih saran koding atau analisis data secara real-time.

7. Anthropic Mythos: AI Hacking Paling Ngeri!
Anthropic lagi ngetes model Mythos yang pinter banget nge-hack celah keamanan zero-day di Windows/macOS. Saking bahayanya, Gedung Putih sampe turun tangan ngatur pemakaiannya biar nggak disalahgunakan.

8. Apple Siri Reboot: Bakal Jadi Robot Otonom?
Bocoran roadmap Apple: Siri bakal punya aplikasi sendiri dan ditenagai AI otonom di iOS 27. Plus, iPhone Lipat & kacamata Vision Air murah siap meluncur 2027!

9. SpaceX IPO $1,75 Triliun: Ambisi Produksi GPU Sendiri!
SpaceX resmi ajuin berkas IPO. Elon Musk nggak cuma mau ke Mars, tapi juga mau bikin GPU sendiri buat lepas dari dominasi Nvidia. Valuasinya setara Rp 27.000 Triliun lebih!

10. Nonton Gratis di ChatGPT lewat Integrasi Tubi
Layanan streaming Tubi rilis aplikasi native di dalem ChatGPT. Sekarang kalian bisa nyari film sambil ngobrol dan tonton langsung trailernya tanpa perlu pindah aplikasi.

Pandangan Saya:
Kita bener-bener lagi transisi dari AI yang cuma "pinter jawab" jadi AI yang "pinter kerja" (Agentic). Dari chip sampe hiburan, semuanya lagi berevolusi gila-gilaan.

Nah, dari 10 berita ini, mana yang menurut kalian paling ngerubah hidup kedepannya? Coba kasih analisis kalian di bawah!

Link Channel: t.me/aicomindo
#TechRecap #AIUpdate #Google #Meta #Apple #SpaceX #OpenAI #Innovation #FutureOfWork #DigitalSovereignty`;

export async function getStyleMemory(kv: KVNamespace): Promise<string> {
  const customStyle = await kv.get('config:style_few_shot');
  return customStyle || DEFAULT_STYLE_FEW_SHOT;
}

export async function setStyleMemory(kv: KVNamespace, styleText: string): Promise<void> {
  await kv.put('config:style_few_shot', styleText);
  await addAuditLog(kv, 'UPDATE_STYLE_MEMORY', 'Admin', 'Updated custom few-shot writing prompt');
}

export async function resetStyleMemory(kv: KVNamespace): Promise<void> {
  await kv.delete('config:style_few_shot');
  await addAuditLog(kv, 'RESET_STYLE_MEMORY', 'Admin', 'Reset to default author example');
}

// ==========================================
// 5. Admin Authorization (Super Admin: 1023972475)
// ==========================================

export async function getAdminList(kv: KVNamespace): Promise<string[]> {
  const raw = await kv.get('config:admins');
  let list: string[] = [SUPER_ADMIN_ID];
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        list = Array.from(new Set([SUPER_ADMIN_ID, ...parsed]));
      }
    } catch {
      // fallback
    }
  }
  return list;
}

export async function addAdmin(kv: KVNamespace, userId: string | number): Promise<void> {
  const strId = String(userId);
  const admins = await getAdminList(kv);
  if (!admins.includes(strId)) {
    admins.push(strId);
    await kv.put('config:admins', JSON.stringify(admins));
    await addAuditLog(kv, 'ADD_ADMIN', strId);
  }
}

export async function isUserAdmin(kv: KVNamespace, userId: string | number): Promise<boolean> {
  const strId = String(userId);
  if (strId === SUPER_ADMIN_ID) return true;
  const admins = await getAdminList(kv);
  return admins.includes(strId);
}

// ==========================================
// 6. User Daily Chat Limit System (Default: 40/day)
// ==========================================

export async function getDailyChatLimit(kv: KVNamespace): Promise<number> {
  const val = await kv.get('config:daily_chat_limit');
  if (val === null) return 40;
  const num = parseInt(val, 10);
  return isNaN(num) ? 40 : num;
}

export async function setDailyChatLimit(kv: KVNamespace, limit: number): Promise<void> {
  await kv.put('config:daily_chat_limit', String(limit));
  await addAuditLog(kv, 'SET_DAILY_CHAT_LIMIT', 'Admin', `Limit set to ${limit} (0=disabled)`);
}

export async function getUserDailyChatCount(
  kv: KVNamespace,
  userId: string | number,
  dateStr: string
): Promise<number> {
  const key = `user_chat_count:${userId}:${dateStr}`;
  const val = await kv.get(key);
  return val ? parseInt(val, 10) || 0 : 0;
}

export async function incrementUserDailyChat(
  kv: KVNamespace,
  userId: string | number,
  dateStr: string
): Promise<number> {
  const key = `user_chat_count:${userId}:${dateStr}`;
  const current = await getUserDailyChatCount(kv, userId, dateStr);
  const next = current + 1;
  await kv.put(key, String(next), { expirationTtl: 48 * 60 * 60 });
  return next;
}

export async function checkUserChatPermission(
  kv: KVNamespace,
  userId: string | number,
  dateStr: string
): Promise<{ allowed: boolean; count: number; limit: number; isAdmin: boolean }> {
  const isAdmin = await isUserAdmin(kv, userId);
  if (isAdmin) {
    return { allowed: true, count: 0, limit: 0, isAdmin: true };
  }

  const limit = await getDailyChatLimit(kv);
  if (limit === 0) {
    return { allowed: true, count: 0, limit: 0, isAdmin: false };
  }

  const currentCount = await getUserDailyChatCount(kv, userId, dateStr);
  if (currentCount >= limit) {
    return { allowed: false, count: currentCount, limit, isAdmin: false };
  }

  return { allowed: true, count: currentCount, limit, isAdmin: false };
}

// ==========================================
// 7. Per-User and Per-Thread Memory Isolation
// ==========================================

export function buildChatSessionKey(
  chatId: number | string,
  userId: number | string,
  threadId?: number | string
): string {
  const strChat = String(chatId);
  const strUser = String(userId);
  if (strChat === strUser) {
    // Private chat: strictly isolated per Telegram user
    return `dm:user:${strUser}`;
  }
  // Group chat / topic thread: isolated per user inside that topic
  const strThread = threadId ? String(threadId) : 'main';
  return `group:${strChat}:topic:${strThread}:user:${strUser}`;
}

export async function getUserProfile(
  kv: KVNamespace,
  userId: string | number
): Promise<UserProfile | null> {
  const key = `profile:${userId}`;
  const raw = await kv.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function upsertUserProfile(
  kv: KVNamespace,
  userId: string | number,
  info: { firstName?: string; lastName?: string; username?: string }
): Promise<UserProfile> {
  const key = `profile:${userId}`;
  const existing = await getUserProfile(kv, userId);
  const now = new Date().toISOString();

  const profile: UserProfile = {
    userId: String(userId),
    firstName: info.firstName || existing?.firstName,
    lastName: info.lastName || existing?.lastName,
    username: info.username || existing?.username,
    firstSeen: existing?.firstSeen || now,
    lastSeen: now,
    totalMessages: (existing?.totalMessages || 0) + 1,
  };

  // Profile stored for 90 days
  await kv.put(key, JSON.stringify(profile), { expirationTtl: 90 * 24 * 60 * 60 });
  return profile;
}

export async function getIsolatedChatHistory(
  kv: KVNamespace,
  sessionKey: string
): Promise<ChatMessage[]> {
  const key = `chat_ctx:${sessionKey}`;
  const raw = await kv.get(key);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function saveIsolatedChatHistory(
  kv: KVNamespace,
  sessionKey: string,
  messages: ChatMessage[]
): Promise<void> {
  const key = `chat_ctx:${sessionKey}`;
  // Keep last 10 messages (5 turns) with 24 hours TTL per thread
  const trimmed = messages.slice(-10);
  await kv.put(key, JSON.stringify(trimmed), { expirationTtl: 24 * 60 * 60 });
}

export async function clearIsolatedChatHistory(
  kv: KVNamespace,
  sessionKey: string
): Promise<void> {
  const key = `chat_ctx:${sessionKey}`;
  await kv.delete(key);
}

// ==========================================
// 8. Web Dashboard OTP & Session Security
// ==========================================

export async function generateDashboardOtp(
  kv: KVNamespace,
  userId: string | number
): Promise<string> {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  const code = (100000 + (array[0] % 900000)).toString();

  const record: DashboardOtpRecord = {
    code,
    createdBy: String(userId),
    expiresAt: Date.now() + 5 * 60 * 1000,
  };

  await kv.put(`dashboard_otp:${code}`, JSON.stringify(record), { expirationTtl: 300 });
  await addAuditLog(kv, 'GENERATE_DASHBOARD_OTP', String(userId), `Code generated`);
  return code;
}

export async function verifyAndConsumeDashboardOtp(
  kv: KVNamespace,
  inputCode: string,
  clientIp: string = 'unknown'
): Promise<{ ok: boolean; sessionToken?: string; error?: string }> {
  const cleanCode = inputCode.trim();
  const lockKey = `login_lock:${clientIp}`;
  const attemptsKey = `login_attempts:${clientIp}`;

  const isLocked = await kv.get(lockKey);
  if (isLocked) {
    return {
      ok: false,
      error: '⛔ Terlalu banyak percobaan gagal (3x). Akses login dikunci selama 15 menit demi keamanan.',
    };
  }

  const otpKey = `dashboard_otp:${cleanCode}`;
  const otpRaw = await kv.get(otpKey);

  if (!otpRaw) {
    const rawAttempts = await kv.get(attemptsKey);
    const attempts = rawAttempts ? parseInt(rawAttempts, 10) + 1 : 1;

    if (attempts >= 3) {
      await kv.put(lockKey, 'LOCKED', { expirationTtl: 900 });
      await kv.delete(attemptsKey);
      await addAuditLog(kv, 'LOGIN_LOCKOUT_TRIGGERED', clientIp, '3 failed login attempts');
      return {
        ok: false,
        error: '⛔ Anda telah gagal 3 kali. Akses login dikunci selama 15 menit.',
      };
    } else {
      await kv.put(attemptsKey, String(attempts), { expirationTtl: 900 });
      return {
        ok: false,
        error: `⚠️ Kode otentikasi salah atau sudah kedaluwarsa. Sisa percobaan: ${3 - attempts} kali.`,
      };
    }
  }

  // Code is VALID - consume immediately
  await kv.delete(otpKey);
  await kv.delete(attemptsKey);

  const sessionBuffer = new Uint8Array(16);
  crypto.getRandomValues(sessionBuffer);
  const sessionToken = Array.from(sessionBuffer)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  let otpData: DashboardOtpRecord = { code: cleanCode, createdBy: SUPER_ADMIN_ID, expiresAt: 0 };
  try {
    otpData = JSON.parse(otpRaw);
  } catch {
    // pass
  }

  const sessionRecord: DashboardSessionRecord = {
    token: sessionToken,
    userId: otpData.createdBy,
    createdAt: new Date().toISOString(),
    expiresAt: Date.now() + 24 * 60 * 60 * 1000,
  };

  await kv.put(`dashboard_session:${sessionToken}`, JSON.stringify(sessionRecord), {
    expirationTtl: 24 * 60 * 60,
  });

  await addAuditLog(kv, 'DASHBOARD_LOGIN_SUCCESS', otpData.createdBy, `IP: ${clientIp}`);

  return { ok: true, sessionToken };
}

export async function verifyDashboardSession(
  kv: KVNamespace,
  sessionToken: string
): Promise<boolean> {
  if (!sessionToken) return false;
  const raw = await kv.get(`dashboard_session:${sessionToken}`);
  return raw !== null;
}

export async function revokeDashboardSession(
  kv: KVNamespace,
  sessionToken: string
): Promise<void> {
  if (sessionToken) {
    await kv.delete(`dashboard_session:${sessionToken}`);
  }
}

// ==========================================
// 9. Anti-Spam Rate Limiting (Sliding Window)
// ==========================================

export async function checkRateLimit(
  kv: KVNamespace,
  userId: string | number,
  maxPerMinute: number = 25
): Promise<{ allowed: boolean; remaining: number }> {
  const minuteKey = `ratelimit:${userId}:${Math.floor(Date.now() / 60000)}`;
  const current = await kv.get(minuteKey);
  const count = current ? parseInt(current, 10) : 0;

  if (count >= maxPerMinute) {
    return { allowed: false, remaining: 0 };
  }

  await kv.put(minuteKey, String(count + 1), { expirationTtl: 120 });
  return { allowed: true, remaining: maxPerMinute - count - 1 };
}

// ==========================================
// 10. Audit Logging & System Trail
// ==========================================

export async function addAuditLog(
  kv: KVNamespace,
  action: string,
  actor: string,
  details?: string
): Promise<void> {
  const key = 'logs:audit';
  const raw = await kv.get(key);
  let logs: AuditLogEntry[] = [];

  if (raw) {
    try {
      logs = JSON.parse(raw);
    } catch {
      logs = [];
    }
  }

  const newEntry: AuditLogEntry = {
    timestamp: new Date().toISOString(),
    action,
    actor,
    details,
  };

  const updated = [newEntry, ...logs].slice(0, 30);
  await kv.put(key, JSON.stringify(updated));
}

export async function getAuditLogs(kv: KVNamespace): Promise<AuditLogEntry[]> {
  const raw = await kv.get('logs:audit');
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

// ==========================================
// 11. Manual News Injector
// ==========================================

export async function addInjectedNews(kv: KVNamespace, item: RawNewsItem): Promise<void> {
  const key = 'injected:news';
  const raw = await kv.get(key);
  let list: RawNewsItem[] = [];
  if (raw) {
    try {
      list = JSON.parse(raw);
    } catch {
      list = [];
    }
  }
  list.unshift(item);
  await kv.put(key, JSON.stringify(list.slice(0, 10)), { expirationTtl: 24 * 60 * 60 });
}

export async function getInjectedNews(kv: KVNamespace): Promise<RawNewsItem[]> {
  const raw = await kv.get('injected:news');
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function clearInjectedNews(kv: KVNamespace): Promise<void> {
  await kv.delete('injected:news');
}

// ==========================================
// 12. News Deduplication & Search Archive
// ==========================================

export async function isNewsAlreadyPosted(kv: KVNamespace, item: RawNewsItem): Promise<boolean> {
  const normUrl = normalizeUrl(item.url);
  const urlHash = await hashText(normUrl);
  const urlKey = `seen:url:${urlHash}`;

  const existingUrl = await kv.get(urlKey);
  if (existingUrl) return true;

  const normTitle = normalizeTitle(item.title);
  const titleHash = await hashText(normTitle);
  const titleKey = `seen:title:${titleHash}`;

  const existingTitle = await kv.get(titleKey);
  return existingTitle !== null;
}

export async function filterUnpostedNews(kv: KVNamespace, items: RawNewsItem[]): Promise<RawNewsItem[]> {
  const unposted: RawNewsItem[] = [];

  for (const item of items) {
    const alreadyPosted = await isNewsAlreadyPosted(kv, item);
    if (!alreadyPosted) {
      unposted.push(item);
    }
  }

  return unposted;
}

export async function recordPostedNews(
  kv: KVNamespace,
  items: RawNewsItem[],
  headline: string = ''
): Promise<void> {
  const now = new Date().toISOString();
  const expirationTtl = 60 * 24 * 60 * 60;

  for (const item of items) {
    const normUrl = normalizeUrl(item.url);
    const urlHash = await hashText(normUrl);
    await kv.put(`seen:url:${urlHash}`, now, { expirationTtl });

    const normTitle = normalizeTitle(item.title);
    const titleHash = await hashText(normTitle);
    await kv.put(`seen:title:${titleHash}`, now, { expirationTtl });
  }

  const historyKey = 'history:posted';
  const existingHistoryJson = await kv.get(historyKey);
  let history: PostedNewsRecord[] = [];

  if (existingHistoryJson) {
    try {
      history = JSON.parse(existingHistoryJson);
    } catch {
      history = [];
    }
  }

  const newRecords: PostedNewsRecord[] = items.map((item) => ({
    id: item.id,
    title: item.title,
    url: item.url,
    postedAt: now,
  }));

  const updatedHistory = [...newRecords, ...history].slice(0, 100);
  await kv.put(historyKey, JSON.stringify(updatedHistory));

  await kv.put(
    'stats:last_digest',
    JSON.stringify({
      timestamp: now,
      headline,
      count: items.length,
    })
  );

  await addAuditLog(kv, 'POST_DIGEST_SUCCESS', 'System', `Posted ${items.length} news items`);
}

export async function getRecentPostedHistory(kv: KVNamespace): Promise<PostedNewsRecord[]> {
  const historyKey = 'history:posted';
  const historyJson = await kv.get(historyKey);
  if (!historyJson) return [];

  try {
    return JSON.parse(historyJson);
  } catch {
    return [];
  }
}

export async function getLastDigestStats(kv: KVNamespace): Promise<{
  timestamp: string;
  headline: string;
  count: number;
} | null> {
  const raw = await kv.get('stats:last_digest');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function searchPostedNews(
  kv: KVNamespace,
  query: string
): Promise<PostedNewsRecord[]> {
  const history = await getRecentPostedHistory(kv);
  const q = query.toLowerCase().trim();
  return history.filter(
    (item) => item.title.toLowerCase().includes(q) || item.url.toLowerCase().includes(q)
  );
}
