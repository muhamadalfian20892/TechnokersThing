export type JobType = 'reminder' | 'cron';
export type JobStatus = 'active' | 'completed' | 'cancelled';
export type JobPlatform = 'telegram' | 'dashboard';

export interface ScheduledJob {
  id: string;                      // Unique ID, e.g. "job_1727891234567_xyz"
  type: JobType;                   // 'reminder' (sekali jalan) atau 'cron' (berulang)
  message: string;                 // Konten pesan pengingat / tugas
  targetPlatform: JobPlatform;     // 'telegram' atau 'dashboard'
  targetChatId: string | number;   // Chat ID Telegram tujuan (User ID, Channel, atau 'dashboard')
  threadId?: number;               // Thread ID jika di forum/topik Telegram
  creatorId: string | number;      // User ID pembuat
  creatorName?: string;            // Nama pembuat (cth: "Muhamad Alfian")
  
  // Waktu & Jadwal
  scheduleRaw: string;             // Deskripsi jadwal asli dari input (cth: "15 menit lagi", "0 9 * * *")
  dueAt?: number;                  // Timestamp epoch (ms) untuk reminder sekali jalan
  cronExpression?: string;         // 5-field cron (min hour dom mon dow) dalam waktu WIB / UTC
  timezoneOffsetHours: number;     // Offset zona waktu (default 7 untuk WIB / Asia/Jakarta)
  
  // Status & Riwayat
  status: JobStatus;
  createdAt: string;               // ISO String saat dibuat
  lastRunAt?: string;              // ISO String saat terakhir dijalankan
  runCount: number;                // Jumlah eksekusi
}

export interface ParseJobResult {
  success: boolean;
  type?: JobType;
  scheduleRaw?: string;
  dueAt?: number;
  cronExpression?: string;
  message?: string;
  targetPlatform?: JobPlatform;
  targetChatId?: string | number;
  destinationRequested?: 'here' | 'telegram' | 'channel' | 'unspecified';
  explicitTelegramUser?: string;
  humanDescription?: string;
  error?: string;
}

export interface WebNotification {
  id: string;
  jobId: string;
  message: string;
  scheduleRaw: string;
  firedAt: number;
  read: boolean;
}

export interface PendingReminderState {
  message: string;
  scheduleRaw: string;
  dueAt?: number;
  cronExpression?: string;
  humanDescription?: string;
  type: JobType;
  createdAt: number;
  expiresAt: number;
}
