# TechnokersThing - Telegram AI News Bot & Interactive Chat

Bot Telegram otomatis dan asisten AI interaktif bertenaga **Cloudflare Workers** & **Workers AI (Llama 3.3 70B)** yang terhubung langsung ke channel Telegram **[@aicomindo](https://t.me/aicomindo)**.

---

## 🌟 Fitur Utama

1. **Daily AI News Digest Otomatis (Setiap Jam 18:00 WIB / 11:00 UTC)**:
   - Mengambil berita AI global terbaru dari berbagai sumber (Hacker News Tech, Google News AI, TechCrunch AI).
   - Diringkas menggunakan **Cloudflare Workers AI** ke dalam Bahasa Indonesia yang segar, mudah dimengerti, dan berformat rapi untuk Telegram.
   - Diposting otomatis ke channel **[@aicomindo](https://t.me/aicomindo)**.
2. **Sistem Anti-Duplikasi Cerdas (Cloudflare KV)**:
   - Terintegrasi dengan Cloudflare KV (`AI_NEWS_KV`).
   - Menyimpan hash URL dan judul berita yang telah diposting sehingga **tidak akan pernah ada berita berulang**.
3. **Chat AI Interaktif (Direct Message dengan [@tckn_bot](https://t.me/tckn_bot))**:
   - Pengguna dapat berinteraksi dan bertanya langsung seputar AI, LLM, coding, maupun meminta rangkuman berita kapan saja.
   - Perintah bot:
     - `/start` - Pesan sambutan dan penjelasan fitur.
     - `/news` - Rangkuman berita AI terkini on-demand.
     - `/status` - Cek kesehatan bot, status webhook, dan isi memori KV.
     - `/help` - Panduan penggunaan.
4. **Deploy Otomatis via GitHub**:
   - Setiap `git push` ke branch `main` dapat memicu deployment otomatis ke Cloudflare.

---

## 🛠️ Arsitektur & Teknologi

- **Runtime**: [Cloudflare Workers](https://developers.cloudflare.com/workers/) (TypeScript, ES2022)
- **AI Model**: `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (fallback `@cf/meta/llama-3.1-8b-instruct`)
- **Penyimpanan KV**: Cloudflare KV (`AI_NEWS_KV`)
- **Cron Triggers**: `0 11 * * *` (Setiap hari pukul 11:00 UTC = 18:00 WIB)
- **Telegram Bot API**: Webhook integration (`/telegram/webhook`)

---

## 🌐 Endpoint Worker

| Endpoint | Method | Deskripsi |
|----------|--------|-----------|
| `/` | GET | Dashboard status worker & informasi bot |
| `/telegram/webhook` | POST | Webhook receiver untuk update pesan Telegram |
| `/telegram/set-webhook` | GET/POST | Pendaftaran URL webhook ke Telegram Bot API |
| `/telegram/status` | GET | Cek profil bot, webhook status, dan memori KV |
| `/api/preview-news` | GET | Dry-run rangkuman berita AI tanpa mengirim ke channel |
| `/api/trigger-news` | POST | Trigger manual pengiriman digest berita ke channel |

---

## 🚀 Pengembangan Lokal

1. Install dependensi:
   ```bash
   npm install
   ```

2. Generate types Cloudflare:
   ```bash
   npm run types
   ```

3. Jalankan server lokal:
   ```bash
   npm run dev
   ```

4. Tes Scheduled Cron secara lokal:
   ```bash
   curl "http://localhost:8787/cdn-cgi/handler/scheduled?cron=0+11+*+*+*"
   ```

5. Deploy ke Cloudflare:
   ```bash
   npm run deploy
   ```