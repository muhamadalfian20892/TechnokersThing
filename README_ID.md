# Technokers AI Bot Pro (TechnokersThing)

[English Version (README.md)](README.md)

Halo, aku Alfian ([@alfian04121](https://t.me/alfian04121) di Telegram, [GitHub](https://github.com/muhamadalfian20892)).

Projek ini awalnya kubuat karena aku ngelola channel komunitas Telegram AI Community News Indonesia (@aicomindo). Tiap jam 6 sore WIB, aku pengen komunitas dapat rangkuman kurasi berita AI yang berbobot dan enak dibaca tanpa harus bayar sewa VPS 24 jam yang sering nganggur. Cloudflare Workers jadi pilihan paling pas: jalan langsung di edge, cold-start hitungan milidetik, dan terintegrasi langsung ke Workers AI dengan model seperti Llama 3.3 dan Whisper.

Lama-lama bot ini berkembang cukup jauh. Teman-teman di grup pengen bisa ngobrol langsung sama botnya, tanya koding, dan kirim pesan suara (voice note) dari HP pas lagi di jalan. Aku juga bosen sama bot AI yang bicaranya kaku banget kayak customer service bank yang ngulang salam pembuka terus, jadi kubikin bot ini punya dua mode: mode chat yang santai dan mengalir kayak ngobrol sama teman biasa, serta mode berita yang ringkas dan ngejelasin kenapa berita itu penting.

Karena projek ini open source, semua identitas dan ID Telegram admin sekarang udah kupisahin ke `bot.config.json`. Jadi kamu bisa fork repositori ini, sesuaikan pengaturannya buat komunitas atau asisten pribadimu sendiri, dan deploy ke Cloudflare Workers dalam hitungan menit.

---

## Log Pembaruan (Update Log)

New on 10/04/2026:
	Walaupun butuh penelusuran mendalam, bug menyebalkan di mana bot selalu nyapa "Halo Muhamad" di awal setiap pesan balasan sekarang udah diberesin total. Bot sekarang paham alur percakapan yang lagi jalan dan bicara wajar layaknya manusia biasa tanpa ngulang salam formal terus-menerus.
	Menambahkan context-aware persona engine. Bot sekarang ngecek siapa yang kirim pesan: kalau mendeteksi developer atau admin utama, dia langsung bersikap santai sebagai partner dev yang siap bantu koding atau cek sistem. Kalau bicara sama member biasa, bot tetap ramah dan membantu sambil menjaga rahasia internal bot.
	Memisahkan seluruh data identitas admin, username, nama bot, dan channel dari dalam kode ke bot.config.json. Kamu juga bisa menimpanya lewat environment variables di Cloudflare, jadi gak ada lagi variabel yang di-hardcode.
	Memperbaiki crash di callBackupOpenAi di mana script melempar TypeError saat manggil .replace() pada URL backup yang belum diisi. Sekarang ada pengecekan awal yang aman.
	Menambahkan verifikasi header X-Telegram-Bot-Api-Secret-Token pada endpoint webhook Telegram. Permintaan asing yang coba memalsukan webhook tanpa token rahasia langsung ditolak dengan 403 Forbidden.
	Mengamankan /addnews dari serangan SSRF. Upaya masukin IP lokal seperti 127.0.0.1, localhost, atau 169.254.169.254 sekarang otomatis ditolak.
	Memindahkan endpoint /api/trigger-news, /api/preview-news, dan /telegram/set-webhook ke balik proteksi login dashboard agar kuota AI gak bisa dikuras pihak luar tanpa izin.
	Menambahkan pembersih kebocoran token (sanitizeSecretLeaks) biar kalau AI dipancing membocorkan token TELEGRAM_TOKEN atau BACKUP_AI_KEY, teksnya otomatis disensor jadi [REDACTED_SECRET].

New on 10/03/2026:
	Grup chat sekarang jauh lebih tenang. Kalau bot dimasukin ke grup dengan privacy mode mati, dulunya dia bakal nyamber semua obrolan orang. Sekarang bot bakal diam kecuali namanya di-mention, pesannya di-reply, atau dikasih perintah garis miring.
	Mention username bot sekarang otomatis dibersihin dari teks perintah dan pesan obrolan, jadi model AI nerima prompt yang bersih tanpa embel-embel username bot.
	Menambahkan dukungan pesan suara (voice note). Berkas audio yang dikirim di Telegram otomatis diunduh dan ditranskripsi pakai Cloudflare Workers AI Whisper dengan sistem fallback ganda.
	Berkas audio di atas 20 MB langsung ditolak dengan pesan yang jelas agar proses download gak macet di tengah jalan.
	Pesan suara yang dibalas bot bakal nampilin kutipan transkripsi teksnya terlebih dahulu biar pengguna dan screen reader bisa ngecek apa yang didengar bot.

New on 10/02/2026:
	Menambahkan konektor universal untuk mempublikasikan berita harian langsung ke Google Blogger dan webhook kustom.
	Menambahkan deteksi bahasa alami untuk konektor, jadi admin tinggal ketik "sambungin ke blogger" di chat buat mulai konfigurasi.
	Menerapkan login OTP 6-digit untuk dashboard web. Admin tinggal ketik /dashboard_code di Telegram buat dapetin kode sekali pakai yang aktif selama 5 menit.
	Menambahkan proteksi brute-force: tiga kali salah masukin OTP bakal mengunci IP pengakses selama 15 menit dan langsung menghanguskan kodenya.

New on 10/01/2026:
	Mendesain ulang dashboard web agar memenuhi standar aksesibilitas WCAG 2.1 Level AAA.
	Menyesuaikan kontras warna teks jadi 17.9:1, jauh di atas standar AAA yang minimal 7:1.
	Menambahkan outline fokus keyboard tebal 3px, semantic landmark roles, skip links, dan memastikan semua tombol memenuhi ukuran minimal 44x44px.

New on 09/28/2026:
	Menambahkan sistem pengingat dan cron otomatis. Kamu bisa bilang "ingetin aku 15 menit lagi angkat jemuran" atau "ingetin meeting besok jam 9 pagi", dan bot bakal ngitung waktunya lalu disimpan ke KV.
	Mendukung cron berulang lewat /cron 0 9 * * * Minum air atau kalimat santai seperti "tiap hari jam 8 pagi cek server".
	Mendukung pengiriman pengingat ke chat pribadi, channel resmi, atau notifikasi dashboard web.

New on 09/25/2026:
	Rilis awal bot pembuat ringkasan berita harian di edge Cloudflare Workers.
	Memasang cron trigger jam 18:00 WIB (11:00 UTC) dengan penguncian KV biar gak dobel kirim berita.
	Menggunakan Workers AI dengan Llama 3.3 sebagai model utama dan endpoint kompatibel OpenAI sebagai cadangan otomatis kalau limit harian habis.

---

## Fitur Utama

- Pesan Suara dan Transkripsi Whisper: Menerima voice note (.ogg, .opus, .mp3) di Telegram maupun rekaman langsung di dashboard web. Suara ditranskripsi otomatis oleh Whisper, dan kutipan teksnya disertakan di balasan.
- Deteksi Persona Kontekstual: Otomatis membedakan apakah sedang ngobrol sama admin atau member biasa. Ngobrol santai dan teknis dengan admin, serta ramah ke pengguna biasa sambil menjaga token sistem.
- Mode Chat dan Mode Berita Alami: Mode chat pakai bahasa Indonesia santai sehari-hari tanpa sapaan formal berulang. Mode berita menyusun ringkasan dengan penjelasan dampak dan hashtag yang relevan.
- Penyaring Obrolan Grup: Mengabaikan obrolan pasif antar anggota grup. Hanya merespons jika di-mention, di-reply, atau diberi perintah.
- Pengamanan Sistem: Memvalidasi secret token webhook Telegram, memblokir URL internal dari celah SSRF, menyensor token dari balasan AI, dan membatasi percobaan OTP.
- Pengingat dan Jadwal Cron: Memahami bahasa sehari-hari untuk bikin pengingat, mendukung format cron standar, dan mengirim notifikasi tepat waktu.
- Dashboard Aksesibel WCAG 2.1 AAA: Dashboard pengelolaan dengan kontras tinggi (17.9:1), outline navigasi keyboard yang jelas, skip link, dan ukuran sentuh nyaman.
- Konektor Universal: Mengirim berita harian otomatis ke Google Blogger dan webhook eksternal.
- Konfigurasi Terbuka: Semua identitas admin dan batasan disimpan rapi di `bot.config.json` atau environment variables Cloudflare.

---

## Konfigurasi (bot.config.json)

Semua identitas dan batasan kuota bot disimpan di file `bot.config.json` pada root projek:

```json
{
  "admin": {
    "userId": "1023972475",
    "username": "alfian04121",
    "name": "Muhamad Alfian",
    "roleTitle": "Lead Developer & System Architect"
  },
  "bot": {
    "name": "Technokers AI Bot Pro",
    "username": "tckn_bot",
    "channelId": "@aicomindo",
    "channelName": "AI Community News Indonesia"
  },
  "limits": {
    "defaultDailyUserChatLimit": 40,
    "rateLimitPerMinute": 25,
    "maxAudioSizeBytes": 20971520,
    "otpExpirationSeconds": 300,
    "otpMaxFailedAttempts": 3
  },
  "features": {
    "enableVoiceTranscriptions": true,
    "enableSchedulerTools": true,
    "enableConnectors": true
  }
}
```

### Override via Environment Variables

Kalau kamu lebih suka mengatur variabel lewat konfigurasi Cloudflare Worker di `wrangler.jsonc` atau `.dev.vars`, kamu bisa pasang:

- ADMIN_USER_ID: User ID Telegram numerik admin.
- ADMIN_USERNAME: Username Telegram admin (tanpa @).
- ADMIN_NAME: Nama panggilan/tampilan admin.
- BOT_NAME: Nama bot kamu.
- BOT_USERNAME: Username bot kamu.
- CHANNEL_ID: Target channel Telegram (contoh: @channelku).
- DEFAULT_DAILY_LIMIT: Batas chat harian member biasa (isi 0 kalau mau unlimited).
- TELEGRAM_WEBHOOK_SECRET: Token rahasia verifikasi webhook.

---

## Daftar Perintah

### Perintah Umum

- /start: Pesan pembuka dengan info channel dan sisa kuota chat harian.
- /help: Panduan singkat cara ngobrol, baca berita, dan bikin pengingat.
- /news: Menghasilkan rangkuman berita AI terhangat secara instan.
- /reset atau /clearchat: Membersihkan riwayat percakapan sesi ini.
- /remind <waktu> <pesan>: Bikin pengingat sekali jalan (contoh: /remind 15m Minum air).
- /myreminders: Menampilkan daftar pengingat aktif milikmu.
- /delremind <id>: Membatalkan jadwal pengingat.

### Perintah Admin

- /dashboard_code: Menghasilkan kode OTP 6-digit untuk login ke dashboard web (aktif 5 menit).
- /connectors: Melihat status konektor Blogger dan webhook.
- /models: Menampilkan daftar model AI Cloudflare dan provider cadangan.
- /setmodel <id>: Mengganti model AI aktif langsung dari chat.
- /usage: Menampilkan statistik token, panggilan HTTP, dan estimasi kuota Neurons Cloudflare.
- /setlimit <n>: Mengatur batas chat harian pengguna umum (0 untuk mematikan batas).
- /getlimit: Memeriksa setelan batas chat harian saat ini.
- /preview: Membuat draf berita hari ini tanpa diposting ke channel.
- /post_now: Langsung memposting berita hari ini ke channel saat itu juga.
- /stop_posting dan /resume_posting: Menghentikan sementara atau mengaktifkan kembali jadwal posting otomatis jam 18:00 WIB.
- /unlock_today: Membuka kunci proteksi satu kali kirim per hari.
- /search <kata_kunci>: Mencari arsip berita yang tersimpan di KV.
- /addnews <judul> | <url> | <ringkasan>: Memasukkan berita manual ke digest berikutnya.
- /logs: Melihat riwayat log audit sistem.

---

## Panduan Instalasi dan Deployment

### 1. Prasyarat

- Node.js (versi 18 ke atas).
- Akun Cloudflare dengan fitur Workers dan KV aktif.
- Token bot Telegram dari @BotFather.

### 2. Kloning dan Install

```bash
git clone https://github.com/muhamadalfian20892/TechnokersThing.git
cd TechnokersThing
npm install
```

### 3. File Environment Lokal

Buat file `.dev.vars` di folder utama projek:

```env
TELEGRAM_TOKEN=token_bot_telegram_kamu
CHANNEL_ID=@username_channel_kamu
BACKUP_AI_URL=https://api.openai.com/v1
BACKUP_AI_KEY=api_key_backup_kamu
TELEGRAM_WEBHOOK_SECRET=token_rahasia_webhook_kamu
```

### 4. Menjalankan di Lokal

```bash
npm run dev
# atau
npx wrangler dev
```

### 5. Typecheck dan Simulasi

```bash
# Cek tipe data TypeScript
npx tsc --noEmit

# Jalankan simulasi pengujian 6 zona
npx tsx scratch/simulate_all_personas.mjs
```

### 6. Deploy ke Cloudflare

```bash
npm run deploy
# atau
npx wrangler deploy
```

Setelah berhasil di-deploy, pasang webhook Telegram dengan membuka URL:

```
https://<subdomain-worker-kamu>.workers.dev/telegram/set-webhook
```

---

## Aksesibilitas (WCAG 2.1 AAA)

Aksesibilitas dirancang sejak awal:

- Kontras Tinggi: Teks putih (#ffffff) di atas latar biru gelap (#080d1a) menghasilkan rasio kontras 17.9:1, jauh di atas batas minimum AAA yaitu 7:1.
- Fokus Keyboard: Garis tepi fokus menggunakan outline tebal 3px solid #60a5fa dengan offset 3px.
- Skip Link: Tersedia tautan lompat agar pengguna keyboard bisa langsung menuju konten utama.
- Transkrip Teks: Pesan suara otomatis menampilkan transkripsi teks di Telegram dan log dashboard agar isi rekaman selalu bisa dibaca.

---

## Lisensi

Projek ini dirilis di bawah lisensi MIT License. Kamu bebas menggunakan, mengubah, dan membagikannya sesuai kebutuhan.
