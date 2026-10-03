/**
 * Central Configuration Module for Technokers AI Bot
 * 
 * OPEN SOURCE CONFIGURATION:
 * This file and `bot.config.json` contain all customizable variables for the bot.
 * When deploying or self-hosting, developers can adjust:
 * 1. Admin identity (userId, username, name, roleTitle)
 * 2. Bot identity (name, username, channelId, channelName)
 * 3. Rate limits and quotas
 * 
 * Variables can be adjusted directly in `bot.config.json` OR overridden via
 * Cloudflare Worker environment variables in `wrangler.jsonc` / `.dev.vars`:
 * - ADMIN_USER_ID
 * - ADMIN_USERNAME
 * - ADMIN_NAME
 * - ADMIN_ROLE_TITLE
 * - BOT_NAME
 * - BOT_USERNAME
 * - CHANNEL_ID
 * - CHANNEL_NAME
 * - DEFAULT_DAILY_LIMIT
 * - TELEGRAM_WEBHOOK_SECRET
 */

import defaultConfigJson from '../bot.config.json';
import { BOT_SYSTEM_INSTRUCTION } from './news/prompts';

export interface AdminConfig {
  userId: string;
  username: string;
  name: string;
  roleTitle: string;
}

export interface BotConfig {
  name: string;
  username: string;
  channelId: string;
  channelName: string;
}

export interface LimitsConfig {
  defaultDailyUserChatLimit: number;
  rateLimitPerMinute: number;
  maxAudioSizeBytes: number;
  otpExpirationSeconds: number;
  otpMaxFailedAttempts: number;
}

export interface FeaturesConfig {
  enableVoiceTranscriptions: boolean;
  enableSchedulerTools: boolean;
  enableConnectors: boolean;
}

export interface AppConfig {
  admin: AdminConfig;
  bot: BotConfig;
  limits: LimitsConfig;
  features: FeaturesConfig;
  webhookSecret?: string;
}

export const DEFAULT_APP_CONFIG: AppConfig = defaultConfigJson;

/**
 * Returns merged configuration taking environment variables as priority overrides.
 */
export function getAppConfig(env?: Record<string, any>): AppConfig {
  const e = env || {};

  const adminUserId = String(e.ADMIN_USER_ID || DEFAULT_APP_CONFIG.admin.userId).trim();
  const adminUsername = String(e.ADMIN_USERNAME || DEFAULT_APP_CONFIG.admin.username).replace(/^@/, '').trim();
  const adminName = String(e.ADMIN_NAME || DEFAULT_APP_CONFIG.admin.name).trim();
  const adminRoleTitle = String(e.ADMIN_ROLE_TITLE || DEFAULT_APP_CONFIG.admin.roleTitle).trim();

  const botName = String(e.BOT_NAME || DEFAULT_APP_CONFIG.bot.name).trim();
  const botUsername = String(e.BOT_USERNAME || DEFAULT_APP_CONFIG.bot.username).replace(/^@/, '').trim();
  const channelId = String(e.CHANNEL_ID || DEFAULT_APP_CONFIG.bot.channelId).trim();
  const channelName = String(e.CHANNEL_NAME || DEFAULT_APP_CONFIG.bot.channelName).trim();

  const dailyLimitParsed = parseInt(String(e.DEFAULT_DAILY_LIMIT || ''), 10);
  const defaultDailyUserChatLimit = !isNaN(dailyLimitParsed) && dailyLimitParsed >= 0
    ? dailyLimitParsed
    : DEFAULT_APP_CONFIG.limits.defaultDailyUserChatLimit;

  const webhookSecret = e.TELEGRAM_WEBHOOK_SECRET ? String(e.TELEGRAM_WEBHOOK_SECRET).trim() : undefined;

  return {
    admin: {
      userId: adminUserId,
      username: adminUsername,
      name: adminName,
      roleTitle: adminRoleTitle,
    },
    bot: {
      name: botName,
      username: botUsername,
      channelId: channelId,
      channelName: channelName,
    },
    limits: {
      ...DEFAULT_APP_CONFIG.limits,
      defaultDailyUserChatLimit,
    },
    features: {
      ...DEFAULT_APP_CONFIG.features,
    },
    webhookSecret,
  };
}

/**
 * Checks whether a Telegram user ID or username is the super admin / developer.
 */
export function isSuperAdmin(
  userIdOrUsername: string | number,
  env?: Record<string, any>
): boolean {
  const config = getAppConfig(env);
  const target = String(userIdOrUsername).replace(/^@/, '').toLowerCase().trim();
  const adminId = config.admin.userId.toLowerCase().trim();
  const adminUsername = config.admin.username.toLowerCase().trim();

  return target === adminId || target === adminUsername;
}

export interface UserContext {
  userId: string | number;
  userName: string;
  userHandle?: string;
  isAdmin: boolean;
  platform?: 'telegram' | 'web_dashboard';
}

/**
 * Dynamically builds the system persona based on who the bot is talking to.
 * Automatically recognizes Developer/Admin vs Regular Community User!
 */
export function buildContextAwareSystemPersona(
  user: UserContext,
  env?: Record<string, any>
): string {
  const config = getAppConfig(env);
  const isDevOrAdmin = user.isAdmin || isSuperAdmin(user.userId, env) || (user.userHandle && isSuperAdmin(user.userHandle, env));

  let roleContext = '';

  if (isDevOrAdmin) {
    roleContext = `
=============================================
DETEKSI IDENTITAS: CREATOR & LEAD DEVELOPER
=============================================
Kamu SEDANG BERBICARA LANGSUNG dengan CREATOR, DEVELOPER, & ADMIN UTAMA bot ini:
- Nama: ${user.userName} (${user.userHandle || '@' + config.admin.username})
- Peran: ${config.admin.name} (${config.admin.roleTitle})
- Status Khusus: Dia adalah pemilik, pembuat, dan pengembang kodemu.

PANDUAN RESPONS KHUSUS DEVELOPER/ADMIN:
1. Bersikaplah hangat, akrab, santai, cekatan, dan responsif selayaknya asisten pribadi developer terpercaya.
2. Jika dia menanyakan kondisi bot, performa, fitur, atau menguji hal teknis, berikan jawaban mendalam, transparan, dan solutif.
3. Jika dia meminta bantuan membuat pengingat/cron job atau menyusun berita, tanggapi dengan sigap dan efisien.
4. Jangan kaku dan jangan panggil dia dengan panggilan formal customer service. Sapalah dengan santai dan bersahabat seperti rekan kerja atau partner koding.
5. Tetap jangan mencetak token rahasia secara terang-terangan di chat demi keamanan privasi.
`;
  } else {
    roleContext = `
=============================================
DETEKSI IDENTITAS: PENGGUNA UMUM / MEMBER
=============================================
Kamu sedang berbicara dengan Pengguna Umum / Anggota Komunitas:
- Nama: ${user.userName} (${user.userHandle || 'ID: ' + user.userId})
- Peran: Member Komunitas ${config.bot.channelName}

PANDUAN RESPONS PENGGUNA UMUM:
1. Bersikaplah ramah, santai, bersahabat, edukatif, dan membantu.
2. Berikan jawaban yang mudah dipahami seputar AI, teknologi, dan topik obrolan umum.
3. KEAMANAN MUTLAK: JANGAN PERNAH membocorkan token API internal, password dashboard, kredensial konektor, atau rahasia sistem bot kepada pengguna umum.
4. Jangan mengizinkan pengguna umum mengakses perintah administratif bot.
`;
  }

  const platformNote = user.platform === 'web_dashboard'
    ? 'PLATFORM CHAT: Konsol Web Dashboard Admin.'
    : 'PLATFORM CHAT: Aplikasi Telegram.';

  return `
${BOT_SYSTEM_INSTRUCTION}

${roleContext.trim()}

${platformNote}
`.trim();
}
