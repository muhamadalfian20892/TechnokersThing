# TechnokersThing - Telegram AI News Bot & Interactive Chat Pro

Bot Telegram otomatis dan asisten AI bertenaga **Cloudflare Workers** & **Workers AI** dengan **Backup OpenAI-Compatible Provider** yang terhubung langsung ke channel Telegram **[@aicomindo](https://t.me/aicomindo)**.

---

## ♿ Standar Aksesibilitas WCAG 2.1 AAA

Sistem dirancang memenuhi standar aksesibilitas tertinggi **WCAG 2.1 Level AAA**:
1. **Web Dashboard**:
   - **Rasio Kontras Ekstra Tinggi (Enhanced Contrast >= 7:1)**: Teks utama (`#ffffff`) pada latar belakang (`#080d1a`) memiliki rasio kontras **17.9:1** (jauh melampaui standar AAA 7:1).
   - **Tampilan Fokus Terlihat (Focus Visible & Appearance)**: Outline fokus tebal `3px solid #60a5fa` dengan `outline-offset: 3px` untuk navigasi keyboard penuh.
   - **Ukuran Target Sentuh (Target Size >= 44x44px)**: Semua tombol, input, dan link memenuhi standar kenyamanan interaksi pengguna.
   - **Landmark Semantik & Skip Link**: Memiliki `<a href="#main-content" class="skip-link">`, `<main role="main">`, `<header>`, dan label form eksplisit dengan atribut ARIA.
2. **Pesan Telegram**:
   - Struktur teks semantik berjenjang dengan pemisah paragraf ganda yang mudah dicerna oleh pembaca layar (*screen reader*).
   - Tautan deskriptif yang menjelaskan isi tujuan (bukan tautan kosong atau generik).
   - Tipografi rapi tanpa simbol atau emoji ambigu.

---

## 🧵 Isolasi Memori Percakapan per User & per Thread

- **Sesi Percakapan Terisolasi**:
  - AI memisahkan memori percakapan secara ketat berdasarkan **User ID** dan **Thread/Topic ID** (`dm:user:{userId}` atau `group:{chatId}:topic:{threadId}:user:{userId}`).
  - Saat User A dan User B mengobrol secara bersamaan dengan bot, AI tahu persis sedang berbicara dengan siapa dan **tidak akan pernah mencampur adukkan topik atau konteks**.
  - AI dipersonalisasi untuk menyapa nama pengguna dan mengingat alur percakapan hingga 10 pesan terakhir.
  - Pengguna dapat mengetik **`/reset`** atau **`/clearchat`** kapan saja untuk membersihkan memori obrolan khusus sesi mereka.

---

## 👑 Hak Akses Administrator & Batas Chat User

- **Super Admin**: `@alfian04121` (ID: `1023972475`, Muhamad Alfian).
- **Pengguna Non-Admin**:
  - Hanya dapat menggunakan **chat tanya-jawab AI biasa** dan perintah **`/news`** (serta `/reset`).
  - Dibatasi kuota chat maksimal **40 kali chat per hari** (configurable lewat `/setlimit <n>`, `0` untuk menonaktifkan).
  - Admin bebas kuota (*unlimited*).

---

## 🔐 Web Dashboard OTP (5 Menit Sekali Pakai)

- URL: [https://technokersthing.hafiyanajah.workers.dev](https://technokersthing.hafiyanajah.workers.dev)
- Ketik **`/dashboard_code`** di [@tckn_bot](https://t.me/tckn_bot) untuk membuat kode OTP login 6-digit (valid 5 menit, langsung hangus setelah dipakai).
- Maksimal 3 kali percobaan gagal sebelum dikunci 15 menit.

---

## 🎙️ Dukungan Pesan Suara (Voice Message & Speech-to-Text)

Bot mendukung pesan suara interaktif baik dari **Administrator** maupun **Pengguna**:
- **Telegram Voice Notes & Audio**:
  - Menerima rekaman suara instan (`voice`) dan berkas audio (`audio` seperti `.ogg`, `.opus`, `.mp3`, `.wav`).
  - Ditenagai **Cloudflare Workers AI Whisper** (`@cf/openai/whisper` & `@cf/openai/whisper-large-v3-turbo`) dengan sistem *failover* multi-tier otomatis.
  - **Transparansi Aksesibel**: Bot selalu menampilkan kutipan transkripsi teks sebelum memberikan jawaban AI, sehingga pengguna dan pembaca layar (*screen reader*) dapat memverifikasi isi ucapan yang dikenali.
  - **Perintah Suara Alami**: Pengguna dapat berbicara santai untuk mengatur jadwal/pengingat (*"ingetin aku 15 menit lagi meeting"*), membaca berita (*"berita hari ini"*), atau mereset sesi (*"bersihkan riwayat chat"*).
- **Web Dashboard Voice Input**:
  - Tombol rekaman suara langsung di konsol web dashboard dengan kontrol aksesibilitas penuh (*aria-label*, status rekam visual berkontras tinggi, dan *keyboard navigation*).

---

## 🔄 Dual AI Provider & Automatic Failover

- **Cloudflare Workers AI**: Model `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, `@cf/deepseek-ai/deepseek-r1-distill-qwen-32b`, Whisper speech recognition, dll.
- **Backup OpenAI Provider** (`https://api.mrido1.my.id/v1`): Model `ag/gemini-3.8-flash-high`, `ag/claude-sonnet-4-6`, `xai/grok-4.6`, dll.
- **Failover Otomatis**: Jika kuota harian Cloudflare habis, sistem otomatis beralih ke provider backup tanpa gagal.