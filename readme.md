# TechnokersThing - Telegram AI News Bot & Interactive Chat Pro

Bot Telegram otomatis dan asisten AI bertenaga **Cloudflare Workers** & **Workers AI (Llama 3.3 70B, DeepSeek R1, Qwen 2.5)** yang terhubung langsung ke channel Telegram **[@aicomindo](https://t.me/aicomindo)**.

---

## 🌟 20 Fitur & Stabilitas Utama

1. **Jadwal Posting Harian (18:00 WIB)**: Tepat 1x sehari pukul 18:00 WIB (11:00 UTC) via Cloudflare Cron Trigger `0 11 * * *`.
2. **Kunci Anti-Spam Harian (`daily_posted:YYYY-MM-DD`)**: Mencegah spam atau eksekusi ganda di hari yang sama.
3. **Edisi Khusus Hari Jumat (Weekly Tech Recap)**: Rangkuman 10 gebrakan paling gila selama seminggu penuh dengan narasi panjang, berbobot, dan analitis.
4. **Edisi Harian (Daily AI Update)**: Rangkuman 5 terobosan terpanas hari ini (Senin-Kamis, Sabtu, Minggu).
5. **Few-Shot Style Memory System**: Template memori penulisan disimpan di KV dan diinjeksikan langsung ke prompt AI untuk memastikan tulisan selalu panjang, berisi fakta angka, dan bernada tech insider.
6. **Live Cloudflare Models Catalog (`/models`)**: Mengambil katalog model resmi secara live dari dokumentasi Cloudflare Workers AI.
7. **Dynamic Model Switcher (`/setmodel <id>`)**: Mengganti model AI aktif secara instan tanpa perlu deploy ulang.
8. **Usage & Quota Limit Monitor (`/usage`)**: Melacak pemakaian requests, token, dan estimasi kuota Neurons Cloudflare Free Tier (10.000 Neurons/hari).
9. **Dynamic Model Cascade Fallback**: Jika model utama timeout/gagal, otomatis beralih ke cadangan (Llama 3.3 70B -> DeepSeek R1 32B -> Llama 3.1 8B -> Qwen 2.5 7B).
10. **Conversational Multi-Turn Memory**: Percakapan di chat pribadi bot mengingat konteks tanya jawab sebelumnya (disimpan di KV).
11. **Admin Emergency Kill-Switch (`/stop_posting` & `/resume_posting`)**: Menghentikan atau mengaktifkan kembali jadwal posting seketika.
12. **Force Post On-Demand (`/post_now`)**: Memaksa posting sekarang ke channel tanpa menunggu jam 18:00 WIB.
13. **Draft Preview (`/preview`)**: Melihat pratinjau berita AI hari ini di chat pribadi sebelum tayang.
14. **Arsip Berita & Pencarian (`/search <query>`)**: Mencari riwayat berita yang pernah diposting di memori KV.
15. **Suntik Berita Manual (`/addnews`)**: Admin dapat memasukkan breaking news manual ke dalam antrean digest berikutnya.
16. **Anti-Flood Rate Limiting**: Proteksi chat pribadi bot maksimal 20 request per menit per user untuk mencegah abuse.
17. **Smart Message Chunking**: Memecah pesan panjang secara rapi per paragraf agar tidak melebihi limit 4096 karakter Telegram.
18. **Sistem Otorisasi Admin (`/setadmin` & `/admins`)**: Melindungi perintah sensitif agar hanya bisa diakses admin.
19. **Log Audit Aktivitas (`/logs`)**: Mencatat riwayat aksi sistem dan admin di KV.
20. **Health Check & Latency Monitor (`/health` & `/ping`)**: Mengukur latensi respon Cloudflare KV dan Workers AI.

---

## 📱 Daftar Perintah Telegram Bot (@tckn_bot)

| Perintah | Akses | Deskripsi |
|----------|-------|-----------|
| `/start` | Semua | Membuka pesan perkenalan & panduan |
| `/help` | Semua | Daftar lengkap bantuan & perintah |
| `/news` | Semua | Mengambil ringkasan berita AI terkini secara on-demand |
| `/preview` | Semua | Melihat draf berita AI yang siap diposting hari ini |
| `/status` | Semua | Melihat status sistem, model aktif, dan memori KV |
| `/models` | Semua | Menampilkan daftar model AI resmi Cloudflare |
| `/usage` | Semua | Memeriksa estimasi pemakaian kuota Neurons hari ini |
| `/health` | Semua | Uji latensi roundtrip Cloudflare KV dan Workers AI |
| `/search <kata>` | Semua | Mencari arsip berita yang pernah diposting |
| `/stop_posting` | Admin | 🛑 Menghentikan posting otomatis harian (Pause) |
| `/resume_posting` | Admin | 🟢 Mengaktifkan kembali posting otomatis harian |
| `/post_now` | Admin | 🚀 Memaksa pengiriman postingan langsung ke channel |
| `/setmodel <id>` | Admin | Mengganti model AI aktif |
| `/unlock_today` | Admin | Membuka kunci harian untuk testing |
| `/addnews <j> \| <l> \| <i>` | Admin | Menambahkan berita breaking news manual |
| `/getstyle` | Admin | Melihat template gaya few-shot yang tersimpan |
| `/resetstyle` | Admin | Mengembalikan template gaya ke default |
| `/logs` | Admin | Melihat 10 log aktivitas sistem terakhir |
| `/backup` | Admin | Mengekspor metadata riwayat KV |
| `/admins` | Admin | Menampilkan daftar ID admin terdaftar |

---

## 🌐 Endpoint REST API Worker

- `GET /` - Dashboard status antarmuka web
- `GET /telegram/status` - Status bot, webhook, dan memori KV
- `GET /api/models` - Katalog model resmi Cloudflare
- `GET /api/usage` - Monitor pemakaian kuota Neurons
- `GET /api/health` - Health check & latensi
- `GET /api/preview-news` - Dry-run digest hari ini
- `GET /api/pause` - Pause posting via HTTP
- `GET /api/resume` - Resume posting via HTTP
- `POST /api/trigger-news` - Trigger manual posting ke channel