# TechnokersThing - Telegram AI News Bot & Interactive Chat Pro

Bot Telegram otomatis dan asisten AI bertenaga **Cloudflare Workers** & **Workers AI** dengan **Backup OpenAI-Compatible Provider** yang terhubung langsung ke channel Telegram **[@aicomindo](https://t.me/aicomindo)**.

---

## 👑 Sistem Hak Akses Administrator

- **Super Admin**: `@alfian04121` (ID: `1023972475`, Muhamad Alfian)
- **User Non-Admin**:
  - Hanya dapat menggunakan **chat tanya-jawab AI** dan perintah **`/news`**.
  - Kuota chat dibatasi maksimal **40 chat per hari** (dapat diubah oleh Admin via `/setlimit <n>`, `0` untuk menonaktifkan limit).
  - Admin bebas kuota (*unlimited*).

---

## 🔐 Keamanan Web Dashboard (5-Menit One-Time Code)

Web dashboard di `https://technokersthing.hafiyanajah.workers.dev` diproteksi sistem otentikasi kode sekali pakai:
1. Admin membuka chat bot Telegram [@tckn_bot](https://t.me/tckn_bot) dan mengetik **`/dashboard_code`**.
2. Bot menghasilkan kode OTP 6-digit yang **valid selama 5 menit**.
3. Kode bersifat **sekali pakai** (*single-use*); langsung hangus setelah berhasil login.
4. **Anti-Brute Force**: Maksimal 3 kali percobaan gagal per IP sebelum akun login dikunci selama 15 menit.
5. Setelah login, sesi aman berlaku selama 24 jam dengan cookie HTTP-Only.

---

## 🔄 Dual AI Provider & Automatic Failover

Bot mendukung dua provider AI sekaligus:
1. **Cloudflare Workers AI**: Model native seperti `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, `@cf/deepseek-ai/deepseek-r1-distill-qwen-32b`, dll.
2. **Backup OpenAI-Compatible Provider**:
   - Endpoint: `https://api.mrido1.my.id/v1`
   - Model: `ag/gemini-3.8-flash-high`, `ag/claude-sonnet-4-6`, `xai/grok-4.6`, `nvidia/deepseek-ai/deepseek-v4-pro`, dll.
3. **Automatic Failover**: Jika kuota harian Cloudflare AI habis (Error 429 / limit tercapai), sistem otomatis beralih ke provider backup tanpa mengganggu postingan harian atau percakapan user!

---

## 📱 Daftar Perintah Telegram Bot (@tckn_bot)

### Pengguna Umum
- `/start` : Sambutan & penjelasan bot.
- `/help` : Panduan penggunaan.
- `/news` : Rangkuman berita AI terkini on-demand.
- Chat bebas seputar AI (kuota default: 40 pesan/hari).

### Khusus Admin (@alfian04121)
- `/dashboard_code` : Buat kode OTP masuk Web Dashboard (valid 5 menit).
- `/models` : Lihat daftar model Cloudflare & Backup Provider.
- `/setmodel <id>` : Ganti model AI aktif secara dinamis.
- `/setlimit <n>` : Ubah kuota chat harian user non-admin (`0` = disable limit).
- `/getlimit` : Cek pengaturan limit chat yang sedang aktif.
- `/preview` : Melihat draf berita AI yang siap diposting hari ini.
- `/post_now` : Paksa kirim digest berita langsung ke channel `@aicomindo`.
- `/stop_posting` : 🛑 Hentikan posting harian otomatis (Pause).
- `/resume_posting` : 🟢 Aktifkan kembali posting harian otomatis.
- `/usage` : Monitor pemakaian token, Neurons, dan request harian.
- `/unlock_today` : Buka kunci harian jika ingin re-test posting.
- `/addnews <j> | <l> | <i>` : Suntikkan berita breaking news manual.
- `/search <kata>` : Cari arsip berita yang pernah diposting di KV.
- `/health` / `/ping` : Cek latensi roundtrip Cloudflare KV & Workers AI.
- `/logs` : Lihat log aktivitas audit sistem.