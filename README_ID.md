# Technokers AI Bot Pro (`TechnokersThing`)

> 🌐 **Bahasa / Language:**  
> **Bahasa Indonesia** | 🇬🇧 [Read the English Documentation here (README.md)](README.md)

Bot Asisten AI Telegram multimodal kelas enterprise dan penerbit berita teknologi otomatis yang berjalan sepenuhnya di atas infrastruktur serverless **Cloudflare Workers**, **Workers AI**, **Cloudflare KV**, dan **Telegram Bot API**, dilengkapi web dashboard administratif berstandar aksesibilitas tertinggi **WCAG 2.1 AAA**.

Dibuat dan dikembangkan dengan penuh dedikasi oleh **[Muhamad Alfian](https://github.com/muhamadalfian20892)** ([@alfian04121](https://t.me/alfian04121)).

---

## 👨‍💻 Cerita Pengembang & Latar Belakang Projek

Halo semuanya! Saya **Muhamad Alfian** ([@alfian04121](https://t.me/alfian04121) di Telegram, [`muhamadalfian20892`](https://github.com/muhamadalfian20892) di GitHub).

Projek ini berawal dari kebutuhan nyata saya sendiri sebagai pengelola channel komunitas teknologi **[@aicomindo](https://t.me/aicomindo)** (*AI Community News Indonesia*). Setiap sore pukul 18:00 WIB, saya ingin teman-teman di komunitas mendapatkan rangkuman kurasi berita AI, riset model bahasa besar (LLM), dan terobosan komputasi terhangat yang berbobot, mudah dipahami, dan mendalam—tanpa saya harus menyewa server VPS atau VM cloud yang boros biaya dan harus terus dipantau 24 jam.

**Cloudflare Workers** adalah solusi yang sangat ideal: tanpa biaya server saat tidak digunakan (*zero idle costs*), waktu pemuatan super cepat (sub-milidetik di 330+ titik edge global), dan memiliki integrasi bawaan ke **Cloudflare Workers AI** (Llama 3.3 70B, DeepSeek R1, Whisper) langsung dari kode worker tanpa perantara.

Seiring berjalannya waktu, projek ini berkembang jauh melampaui sekadar bot kurasi otomatis:
1. **Asisten AI Multimodal yang Cerdas**: Rekan-rekan komunitas ingin bisa mengobrol santai dengan bot, bertanya koding, berdiskusi konsep AI, bahkan mengirim **pesan suara (voice note)** dari ponsel di perjalanan pulang kerja.
2. **Karakter Bahasa yang Natural**: Saya perhatikan banyak bot AI terasa sangat kaku, membosankan, dan terdengar seperti customer service korporat. Karena itu, bot ini saya bekali dua mode gaya bicara yang tegas: **CHAT MODE** (santai, mengalir, ramah, to-the-point) dan **NEWS MODE** (menarik, tanpa istilah teknis yang memusingkan, dan dilengkapi konteks *"Mengapa ini menarik?"*).
3. **Arsitektur Terbuka untuk Komunitas Open Source**: Saya tidak ingin nama atau user ID saya terkunci (*hardcoded*) di dalam kode sistem. Sekarang semua orang bisa melakukan *fork* atau *clone*, mengatur identitas bot dan ID Telegram mereka sendiri di [`bot.config.json`](bot.config.json), dan menjalankan bot mereka sendiri dalam hitungan menit.

---

## 📜 Catatan Pengembang & Log Pembaruan (Developer Changelog)

Berikut adalah catatan harian pengembang dan pembaruan teknis terbaru dari projek ini:

### New on 10/04/2026:
* Walaupun butuh sedikit penelusuran mendalam di alur percakapan, bug yang sangat mengganggu di mana bot selalu menyapa *"Halo Muhamad"* di awal setiap pesan—bahkan di tengah-tengah obrolan yang sedang asyik berlangsung—akhirnya berhasil dibasmi total. Bot sekarang mengenali kesinambungan obrolan dan berbicara layaknya teman nyata tanpa reset sapaan berulang-ulang di setiap pesan balasan.
* Menerapkan **Context-Aware Persona Engine** (`buildContextAwareSystemPersona`). Bot sekarang memeriksa identitas pengirim pesan: jika ia mendeteksi creator/admin (sesuai `ADMIN_USER_ID` atau `ADMIN_USERNAME`), bot otomatis bersikap sebagai rekan developer andal yang sigap membantu urusan teknis dan operasional. Jika berbicara dengan member komunitas umum, bot tetap ramah dan edukatif namun menjaga rahasia internal sistem secara ketat.
* Memisahkan seluruh variabel identitas admin, bot, dan channel ke dalam [`bot.config.json`](bot.config.json) melalui modul [`getAppConfig`](src/config.ts). Tidak ada lagi user ID atau username yang di-*hardcode* di dalam kode fungsional—siapa pun kini bisa menyesuaikan konfigurasi untuk kebutuhan mereka sendiri.
* Menemukan dan memperbaiki bug tersembunyi pada `callBackupOpenAi` di mana pemanggilan `.replace()` pada URL backup yang belum dikonfigurasi menghasilkan `TypeError: Cannot read properties of undefined`. Kami menambahkan validasi defensif sehingga ketiadaan kredensial backup ditangani dengan aman tanpa mematikan proses worker.
* Menambahkan verifikasi keamanan header `X-Telegram-Bot-Api-Secret-Token` pada endpoint `/telegram/webhook`. Jika ada pihak yang mencoba memalsukan webhook atau melakukan *probing* tanpa token rahasia yang sah, permintaan langsung ditolak dengan status `403 Forbidden`.
* Mengamankan perintah `/addnews` dari celah SSRF (Server-Side Request Forgery). Upaya memasukkan IP privat, loopback lokal, atau endpoint metadata (`127.0.0.1`, `localhost`, `169.254.169.254`) kini langsung diblokir secara otomatis oleh sistem validasi URL publik.
* Memindahkan rute administratif `/api/trigger-news`, `/api/preview-news`, dan `/telegram/set-webhook` ke balik autentikasi session dashboard. Pengunjung tanpa hak akses kini menerima respons `401 Unauthorized` sehingga kuota AI Anda aman dari penyalahgunaan.
* Mengimplementasikan `sanitizeSecretLeaks` pada balasan LLM untuk memastikan token sensitif seperti `TELEGRAM_TOKEN`, `BACKUP_AI_KEY`, atau webhook secret yang tidak sengaja terpancing keluar otomatis disensor menjadi `[REDACTED_SECRET]`.

### New on 10/03/2026:
* Obrolan di grup Telegram sekarang jauh lebih tertib dan tenang! Sebelumnya, jika bot dimasukkan ke dalam grup dengan mode privasi nonaktif, bot akan mencoba menjawab setiap obrolan santai antar member. Sekarang bot dengan sopan mengabaikan obrolan pasif dan hanya merespons jika di-mention secara eksplisit (`@bot_username`), di-*reply*, atau diberi perintah *command*.
* Token mention seperti `@bot_username` kini otomatis dibersihkan dari perintah (misalnya `/news@nama_bot` menjadi `/news`) maupun dari pertanyaan teks bebas, sehingga AI menerima kalimat yang bersih dan fokus.
* Pesan suara (voice note) dan berkas audio (`.ogg`, `.opus`, `.mp3`) yang dikirimkan ke Telegram kini otomatis ditranskripsikan ke teks menggunakan Cloudflare Workers AI Whisper (`@cf/openai/whisper` & `@cf/openai/whisper-large-v3-turbo`) dengan sistem *failover* multi-tier.
* Berkas audio yang melebihi batas 20 MB (batas unduhan Telegram Bot API) kini ditolak dengan pesan yang ramah dan informatif, mencegah *hanging* saat proses pengunduhan.
* Hasil transkripsi ditampilkan di pesan Telegram sebagai kutipan teks (`"..."`) agar pengguna dan pembaca layar (*screen reader*) dapat memverifikasi isi rekaman sebelum membaca jawaban AI.

### New on 10/02/2026:
* Meluncurkan modul **Universal Connectors**. Bot kini dapat menyindikasikan kurasi berita harian secara otomatis ke Google Blogger atau mengirim *webhook* ke sistem eksternal milik pengguna.
* Menambahkan deteksi niat percakapan alami untuk konektor—admin cukup mengatakan *"sambungin ke blogger"* di obrolan chat untuk dipandu dalam konfigurasi.
* Menerapkan sistem autentikasi **OTP 6-Digit Sekali Pakai** untuk Web Dashboard. Admin dapat membuat kode login langsung dari Telegram menggunakan perintah `/dashboard_code` (berlaku 5 menit).
* Menambahkan perlindungan *anti brute-force*: setelah 3 kali gagal memasukkan kode OTP, IP klien otomatis dikunci selama 15 menit dan kode langsung dibatalkan.

### New on 10/01/2026:
* Merombak total Web Dashboard agar memenuhi standar aksesibilitas tertinggi dunia: **WCAG 2.1 Level AAA**.
* Meningkatkan rasio kontras warna teks hingga **17.9:1** (`#ffffff` di atas `#080d1a`), jauh melampaui ambang batas minimum AAA yaitu 7:1.
* Menambahkan outline fokus keyboard tebal berukuran `3px` yang jelas terlihat, atribut ARIA semantik (`role="main"`, `aria-live="polite"`), serta tautan lewati (*skip link*).
* Memastikan seluruh tombol dan elemen masukan memenuhi ukuran minimal area sentuh 44x44 piksel untuk kenyamanan layar sentuh.

### New on 09/28/2026:
* Membangun modul **Penjadwal Otonom & Pengingat Pintar**. Pengguna dapat mengetik secara santai seperti *"ingetin aku 15 menit lagi angkat jemuran"* atau *"ingetin meeting besok jam 09:00"*, dan AI akan mengekstrak waktu, menghitung zona waktu WIB (UTC+7), lalu menyimpannya di Cloudflare KV.
* Mendukung jadwal rutin (cron job) melalui perintah `/cron 0 9 * * * Minum air pagi` maupun lewat percakapan santai (*"tiap hari jam 8 pagi cek server"*).
* Menyediakan fleksibilitas tujuan notifikasi: pengingat dapat dikirimkan ke chat Telegram pribadi, ke channel resmi (khusus admin), atau ke konsol notifikasi Web Dashboard.

### New on 09/25/2026:
* Rilis perdana sistem kurasi berita AI harian otomatis di edge Cloudflare Workers.
* Mengintegrasikan pemicu Cron Triggers (`0 11 * * *` UTC / 18:00 WIB) dengan mekanisme kunci harian di Cloudflare KV untuk mencegah *double posting*.
* Menyiapkan arsitektur Dual AI Provider: model utama di Cloudflare Workers AI (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`) dengan *failover* otomatis ke provider backup kompatibel OpenAI jika limit Neurons harian habis.

---

## 🌟 Fitur Utama

| Fitur | Deskripsi |
|---|---|
| 🎙️ **Pesan Suara & Whisper STT** | Kirim pesan suara (VN) di Telegram atau rekam langsung di dashboard web. Ditranskripsikan secara otomatis dengan kutipan teks yang transparan. |
| 🧠 **Persona Deteksi Konteks** | Mengenali pembuat/admin vs anggota komunitas. Berbicara akrab dan teknis dengan admin, serta ramah dan aman dengan member umum. |
| 💬 **Mode CHAT vs NEWS Natural** | Mode CHAT berbicara luwes tanpa salam kaku berulang. Mode NEWS menyajikan rangkuman berita menarik dengan sudut pandang *"Mengapa ini menarik?"*. |
| 🛡️ **Keamanan Tingkat Lanjut** | Validasi rahasia webhook token, proteksi SSRF, sensor kebocoran token (*prompt injection*), dan penguncian otomatis brute-force OTP. |
| 👥 **Penyaring Cerdas Grup Chat** | Mengabaikan obrolan umum antar member di grup. Hanya merespons jika di-mention (`@bot`), di-*reply*, atau diberi *command*. |
| ⏰ **Pengingat Otonom & Cron Job** | Buat pengingat dengan bahasa sehari-hari (*"ingetin 20 menit lagi"*), kelola jadwal rutin, dan pilih target pengiriman notifikasi. |
| ♿ **Dashboard Aksesibel WCAG 2.1 AAA** | Konsol kendali lengkap dengan rasio kontras 17.9:1, navigasi keyboard penuh, skip link, dan ukuran sentuh 44x44px. |
| 🔌 **Konektor Universal** | Terintegrasi langsung untuk memposting rangkuman berita ke Google Blogger dan webhook eksternal. |
| ⚙️ **Konfigurasi Terbuka (Open Source)** | Seluruh identitas admin, nama bot, dan batasan kuota dapat diatur dengan mudah di [`bot.config.json`](bot.config.json). |

---

## ⚙️ Panduan Konfigurasi (`bot.config.json`)

Projek ini sepenuhnya siap untuk *open source* dan *self-hosting*. Anda dapat menyesuaikan seluruh variabel identitas di file [`bot.config.json`](bot.config.json):

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
Anda juga dapat menimpa (*override*) konfigurasi di atas melalui variabel lingkungan Cloudflare Workers di `wrangler.jsonc` atau `.dev.vars`:
- `ADMIN_USER_ID`: User ID numerik Telegram milik Anda.
- `ADMIN_USERNAME`: Username Telegram admin (boleh menggunakan `@` atau tanpa `@`).
- `ADMIN_NAME`: Nama lengkap/panggilan pengelola bot.
- `BOT_NAME`: Nama tampilan bot Anda.
- `BOT_USERNAME`: Username bot Telegram Anda.
- `CHANNEL_ID`: Username channel Telegram tujuan publikasi berita (contoh: `@channelku`).
- `DEFAULT_DAILY_LIMIT`: Batas pesan chat harian untuk pengguna umum (`0` untuk tanpa batas).
- `TELEGRAM_WEBHOOK_SECRET`: Token rahasia verifikasi webhook Telegram.

---

## 📱 Panduan Perintah Bot Telegram

### Perintah Publik (Untuk Semua Pengguna)
- `/start`: Menampilkan sapaan pembuka, panduan fitur, dan status kuota obrolan harian.
- `/help`: Panduan lengkap cara berinteraksi, membaca berita, dan mengatur pengingat.
- `/news`: Menghasilkan rangkuman berita AI terhangat secara instan.
- `/reset` atau `/clearchat`: Membersihkan memori percakapan sesi Anda agar bisa memulai topik baru.
- `/remind <waktu> <pesan>`: Mengatur pengingat sekali jalan (contoh: `/remind 15m Minum air`).
- `/myreminders`: Melihat daftar pengingat aktif yang Anda miliki.
- `/delremind <id>`: Membatalkan jadwal pengingat tertentu.

### Perintah Khusus Administrator
- `/dashboard_code`: Membuat kode OTP 6-digit untuk login ke Web Dashboard (berlaku 5 menit).
- `/connectors`: Memeriksa status integrasi Google Blogger, Gmail, dan Webhook.
- `/models`: Melihat daftar model Cloudflare Workers AI dan backup OpenAI API.
- `/setmodel <id>`: Mengganti model AI aktif secara langsung tanpa redeploy.
- `/usage`: Melihat statistik token, panggilan HTTP, dan estimasi kuota Neurons harian.
- `/setlimit <n>`: Mengatur batas chat harian pengguna umum (`0` = unlimited).
- `/getlimit`: Memeriksa pengaturan batas chat harian yang sedang aktif.
- `/preview`: Melihat draf rangkuman berita hari ini tanpa mengirim ke channel.
- `/post_now`: Memposting digest berita ke channel secara langsung saat itu juga.
- `/stop_posting` & `/resume_posting`: Menghentikan sementara atau mengaktifkan kembali jadwal posting otomatis jam 18:00 WIB.
- `/unlock_today`: Membuka kunci proteksi satu kali posting per hari.
- `/search <kata_kunci>`: Mencari arsip berita yang tersimpan di Cloudflare KV.
- `/addnews <judul> | <url> | <ringkasan>`: Menyuntikkan berita penting manual ke digest berikutnya.
- `/logs`: Menampilkan log audit aktivitas sistem.

---

## 🚀 Panduan Menjalankan & Deploy

### 1. Prasyarat
- [Node.js](https://nodejs.org/) (versi 18 ke atas).
- Akun [Cloudflare](https://dash.cloudflare.com/) dengan fitur Workers & KV aktif.
- Token bot Telegram dari [@BotFather](https://t.me/BotFather).

### 2. Kloning & Instalasi Dependensi
```bash
git clone https://github.com/muhamadalfian20892/TechnokersThing.git
cd TechnokersThing
npm install
```

### 3. Konfigurasi Variabel Rahasia (.dev.vars)
Buat berkas `.dev.vars` untuk pengembangan lokal:
```env
TELEGRAM_TOKEN=token_bot_telegram_anda
CHANNEL_ID=@username_channel_anda
BACKUP_AI_URL=https://api.openai.com/v1
BACKUP_AI_KEY=api_key_backup_anda
TELEGRAM_WEBHOOK_SECRET=token_rahasia_webhook_opsional
```

### 4. Menjalankan Server Lokal (Local Development)
```bash
npm run dev
# atau
npx wrangler dev
```

### 5. Verifikasi Tipe & Simulasi Komprehensif
```bash
# Uji kompilasi TypeScript
npx tsc --noEmit

# Jalankan pengujian simulasi multi-persona (6 zona pengujian)
npx tsx scratch/simulate_all_personas.mjs
```

### 6. Melakukan Deploy ke Cloudflare Workers
```bash
npm run deploy
# atau
npx wrangler deploy
```

Setelah berhasil di-deploy, pasang webhook Telegram dengan membuka URL:
```
https://<nama-worker-anda>.workers.dev/telegram/set-webhook
```
*(Memerlukan sesi login di Web Dashboard atau kredensial admin).*

---

## ♿ Standar Aksesibilitas (WCAG 2.1 AAA)

Aksesibilitas adalah prioritas utama dalam perancangan Technokers AI Bot Pro:
- **Kontras Warna Tinggi**: Teks `#ffffff` di atas latar belakang `#080d1a` menghasilkan rasio kontras **17.9:1** (jauh di atas batas minimum AAA yaitu 7:1).
- **Indikator Fokus Jelas**: Outline navigasi keyboard menggunakan warna biru terang (`3px solid #60a5fa`) dengan jarak `3px`.
- **Skip Links**: Pengguna pembaca layar dapat langsung melompat ke konten utama menggunakan navigasi tautan loncat.
- **Dukungan Pembaca Layar**: Setiap pesan suara yang masuk otomatis ditranskripsikan ke dalam teks kutipan di Telegram dan dashboard web agar konten audio selalu dapat diakses secara visual maupun auditori.

---

## 📄 Lisensi

Projek ini dilisensikan di bawah **MIT License**. Anda bebas menggunakan, memodifikasi, dan mendistribusikannya untuk keperluan pribadi maupun komunitas.

Jika projek ini bermanfaat bagi Anda, jangan lupa berikan bintang ⭐️ di [GitHub](https://github.com/muhamadalfian20892/TechnokersThing) dan mari bergabung di channel komunitas kami di **[@aicomindo](https://t.me/aicomindo)**!
