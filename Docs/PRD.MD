# PRD — DeadLineHero

> Product Requirements Document. Ditulis ulang berdasarkan audit kode aktual di repo ini (bukan rencana lama). Sumber kebenaran: `src/server.js`, `src/bot.js`, `src/db.js`, `public/app.js`, `public/index.html`, `public/style.css`, `database/schema.sql`, `package.json`, `Dockerfile`.

---

## 1. Ringkasan Produk

DeadLineHero adalah aplikasi web pelacak deadline tugas mahasiswa. Mahasiswa mencatat tugas (Tugas / UTS / UAS), memantau sisa waktu, menandai tugas selesai, dan mendapat pengingat otomatis H-1 jam via alarm nada dering di browser atau pesan WhatsApp ke orang terdekat (pacar / sahabat / keluarga). Admin (asisten praktikum) mengelola tugas dan menarik rekap Excel.

Tujuan:

- Mahasiswa tidak melewatkan deadline.
- Orang terdekat mahasiswa ikut membantu mengingatkan.
- Admin punya rekap keterlambatan/ketuntasan per tugas dalam bentuk Excel.

---

## 2. Platform — Murni Responsive Web Application

**Proyek ini adalah Responsive Web Application (RWA), BUKAN PWA.**

- Tidak ada `manifest.json`.
- Tidak ada service worker (`sw.js` sudah dihapus dari kode).
- Tidak ada registrasi `navigator.serviceWorker`.
- Tidak ada fitur install/offline/cache-first. Aplikasi selalu jalan online via HTTP ke server.
- Responsif mobile-first: breakpoint 640px, 841px (lihat `style.css`). Bottom navigation di mobile, sudut membulat di layar lebar.

Semua dokumen desain dan diagram (DFD/ERD) tidak boleh menyebut PWA, manifest, atau service worker lagi.

---

## 3. Tech Stack & Arsitektur

| Layer | Teknologi |
|---|---|
| Runtime | Node.js 20 (CommonJS) |
| Web framework | Express.js 5 |
| Database | PostgreSQL di Supabase (driver `pg`) |
| Hosting/deploy | Railway (Docker: `node:20-slim` + Chromium sistem) |
| Bot WhatsApp | `whatsapp-web.js` + Puppeteer (LocalAuth, headless) |
| Scheduler | `node-cron` (tiap 1 menit) |
| Ekspor Excel | `xlsx` (SheetJS) |
| QR login bot | `qrcode` + `qrcode-terminal` |
| Frontend | Vanilla JavaScript (IIFE), tanpa framework, tanpa build step |
| Font | Poppins (heading) + Inter (alternatif), via Google Fonts |

Struktur:

```
src/
  server.js   -> Express API + static hosting public/ + migrasi runtime
  bot.js      -> WA client, cron, dua track notifikasi
  db.js       -> pg Pool (Supabase), getConnection, sanitizeError
public/
  index.html, app.js, style.css, Sounds/ringtone1-3.mp3
database/
  schema.sql  -> skema acuan (dialek akademik; runtime pakai PostgreSQL)
scripts/
  generate-icons.js -> generator ikon favicon
```

Arsitektur: satu proses Node menampung (1) API Express, (2) static SPA, (3) bot WhatsApp + cron worker. Bot hidup mandiri — tidak bergantung sesi login frontend mana pun.

---

## 4. Autentikasi

- Tokenless: setiap request API membawa header `x-user-id` dan `x-user-role`.
- Middleware `authRole(...)` di server memvalidasi header; 401 jika hilang, 403 jika role tidak cocok.
- Sesi login disimpan di `localStorage` (`dlh-session`), dipulihkan saat refresh. Jika akun sudah tidak valid, `fetchTasks()` gagal -> auto-logout.
- Login: `email` + `password` (kolom `password_plain`, perbandingan langsung — catatan: hashing bcrypt adalah target perbaikan ke depan, belum diimplementasi).
- Role: `user` (mahasiswa) dan `admin` (asisten praktikum, 15 akun seed statis).

---

## 5. Skema Database (PostgreSQL)

Runtime migrasi otomatis via `ensureRecapSchema()` saat server start (`ALTER TABLE ... IF NOT EXISTS`).

### users
| Kolom | Tipe | Catatan |
|---|---|---|
| id_user | auto PK | |
| npm | VARCHAR(20) NOT NULL | 6-10 digit angka |
| nama | VARCHAR(100) NOT NULL | |
| email | VARCHAR(100) UNIQUE NOT NULL | |
| password_plain | VARCHAR(255) NOT NULL | plaintext (belum bcrypt) |
| role | VARCHAR(20) | `user` / `admin` |
| no_wa | VARCHAR(20) | nomor WhatsApp orang terdekat |
| preferensi | VARCHAR(30) | `nada_dering` / `nomor_wa` |
| relasi | VARCHAR(20) | `pacar` / `keluarga` / `sahabat` |
| selected_ringtone | VARCHAR(100) | path file mp3 di `/Sounds/` |

### tasks
| Kolom | Tipe | Catatan |
|---|---|---|
| id_tugas | auto PK | |
| judul | VARCHAR(200) NOT NULL | |
| deskripsi | TEXT | opsional |
| kategori | VARCHAR(20) | `Tugas` / `UTS` / `UAS` |
| sumber_web | VARCHAR(30) | `Vclass` / `Ilab` / `Praktikum` (wajib utk kategori Tugas) |
| deadline | TIMESTAMP NOT NULL | input menit-presisi (tanpa detik) |
| created_by | FK users NOT NULL | pembuat tugas |
| created_at | TIMESTAMP DEFAULT NOW() | |
| is_archived | BOOLEAN DEFAULT FALSE | dipakai fitur rekap/arsip |
| archived_at | TIMESTAMP | |

### user_task_status
`id_status` PK, `id_user` FK, `id_tugas` FK, `status` (`belum`/`selesai`), `updated_at`. UNIQUE(id_user, id_tugas).

### task_completions
Log penyelesaian tugas: `id_completion` PK, `id_tugas` FK, `id_user` FK, `completed_at` DEFAULT NOW(). UNIQUE(id_tugas, id_user). ON DELETE CASCADE.

### notification_log
Anti-spam notifikasi: `id_notif` PK, `id_user` FK, `id_tugas` FK, `jenis`, `created_at` DEFAULT CURRENT_TIMESTAMP. UNIQUE(id_user, id_tugas, jenis).

Nilai `jenis` yang diizinkan (CHECK constraint `chk_nl_jenis`, diperbarui via migrasi runtime):
- `wa_h1jam` — notifikasi WA ke mahasiswa
- `H-1_RELASI` — notifikasi WA ke orang terdekat
- `ring_h1jam`, `pwa_h1hari` — nilai legacy (tidak dipakai lagi; `pwa_h1hari` tidak relevan karena bukan PWA)

---

## 6. API Endpoints

| Method | Path | Auth | Fungsi |
|---|---|---|---|
| POST | /api/auth/register | publik | Daftar mahasiswa. Validasi NPM 6-10 digit, email, preferensi, relasi, ringtone. Trigger cek bot instan. |
| POST | /api/auth/login | publik | Login, kembalikan objek user. |
| PATCH | /api/auth/change-password | user/admin | Ganti password. |
| PATCH | /api/auth/change-email | user/admin | Ganti email (cek unik). |
| PATCH | /api/auth/preferences | user/admin | Ganti preferensi notifikasi / no_wa / relasi / ringtone. |
| GET | /api/tasks | user/admin | Semua tugas aktif (belum terarsip) + status selesai user. |
| POST | /api/tasks | admin | Buat tugas. Deadline menerima `YYYY-MM-DDTHH:mm` atau `DD/MM/YYYY HH:mm`. Trigger cek bot instan. |
| DELETE | /api/tasks/:id | admin (pembuat) | Hapus tugas miliknya (cek created_by), cascade log + status. |
| PATCH | /api/tasks/:id/done | user/admin | Tandai selesai (idempotent, upsert dua tabel). |
| GET | /api/tasks/:id/recap | admin | Rekap satu tugas: siapa selesai / belum. |
| POST | /api/admin/archive-all | admin | Arsipkan semua tugas aktif + unduh Excel rekap total. |
| GET | /api/recap/summary | user | Ringkasan tugas per admin (progress selesai). |
| GET | /api/recap/admin/:id | user | Riwayat detail tugas dari satu admin. |
| GET | /api/recap/admin/:id/export | user | Unduh Excel riwayat admin tsb. |
| GET | /api/bot/qr | publik | QR code login WhatsApp bot (data URL). |
| GET | /api/bot/force-trigger | publik | Paksa jalankan cek deadline sekarang (debug; hanya jika ENABLE_BOT=true). |

Static: Express menyajikan `public/` di root.

---

## 7. Sistem Notifikasi Bot WhatsApp

### 7.1 Prinsip

- Cron `node-cron` jalan tiap **1 menit** (`* * * * *`) di background server.
- Mandiri total: tidak bergantung session login, token, atau status online user. Selama server hidup dan WA client `ready`, pengecekan jalan.
- Trigger instan tambahan: saat register user dan saat tugas baru dibuat (tanpa nunggu menit berikutnya).
- Fokus: **hanya tugas buatan akun role `user`** (`creator.role = 'user' AND creator.no_wa <> ''`). Tugas buatan admin diabaikan sepenuhnya.

### 7.2 Dual-Track Notifikasi

| Track | jenis di notification_log | Penerima | Template |
|---|---|---|---|
| Track 1 | `wa_h1jam` | Mahasiswa (no_wa pada baris user itu sendiri) | Variatif per relasi (pacar manis, sahabat santai, keluarga sopan) |
| Track 2 | `H-1_RELASI` | Orang terdekat (no_wa target relasi) | Sopan formal: "Halo! Ini pesan otomatis dari DeadlineHero. Sekadar mengingatkan bahwa [Nama] memiliki tugas '[Judul]' ([Kategori]) yang akan mendeadline dalam [sisa waktu]. Mohon bantu ingatkan beliau ya! Terima kasih." |

### 7.3 Alur per track

1. Query kandidat: `tasks` JOIN `users creator ON created_by` (role=user) JOIN `users u` (penerima), filter `deadline > NOW() AND deadline <= NOW() + 60 menit`, belum terarsip, belum selesai (track 1), dan `notification_log` untuk jenis tsb masih kosong.
2. Verifikasi ulang di Node.js: `0 < sisaMenit <= 60` (hitung dari `diffMinutes`).
3. Sanitasi nomor: buang non-digit, awalan `0` jadi `62`, format `${clean}@c.us`.
4. Cek `isRegisteredUser()` sebelum kirim.
5. `client.sendMessage(chatId, message)`.
6. Catat `notification_log (id_user, id_tugas, jenis)` — `ON CONFLICT DO NOTHING` sebagai guard paralel. Kolom `created_at`/`notified_at` terisi `CURRENT_TIMESTAMP` oleh default.

### 7.4 Alarm Browser (alternatif nada dering)

- Untuk user `preferensi = 'nada_dering`: `scanDeadlineAlerts()` jalan tiap 30 detik + setelah fetch tugas.
- Bersyarat: ada tugas status `belum` dengan deadline <= 1 jam.
- Anti-ulang: flag `ringtone_played_task_<id>` di localStorage.
- Auto-stop: audio berhenti saat task ditandai selesai ATAU deadline lewat.
- Kebijakan autoplay browser: dering ditunda sampai interaksi user pertama.
- Mute tersedia untuk admin.

---

## 8. Fitur Frontend

- **Auth flip card 3D**: login/daftar satu kartu berputar (perspective 1400px, 0.75s). Tinggi kartu dinamis via `sizeFlipCard()`.
- **Dashboard tugas**: tab kategori (Semua/Tugas/UTS/UAS), polling tiap 10 detik, render ditunda saat scroll (debounce 150ms).
- **Status tugas**: tombol Selesai/Terlewat/Mark As Done untuk semua kategori, UI optimistik dengan rollback.
- **Detail tugas**: modal detail + (untuk admin pemilik) tombol Hapus Tugas.
- **Rekap user**: modal ringkasan per admin, progress, drill-down riwayat, ekspor Excel.
- **Rekap admin**: modal per-tugas (siapa selesai/belum), auto-refresh 10 detik, tombol Rekap & Arsip Semua di dropdown menu admin.
- **Ganti pengingat**: modal ubah preferensi dengan tombol tes audio.
- **Dark mode**: toggle di dropdown, tersimpan `dlh-theme`, token warna khusus.
- **Bottom nav**: Daftar + Input (admin), eksklusif via `switchView()`.
- **Zero emoji policy**: UI bebas emoji, identitas visual lewat warna/label.
- **Avatar fallback**: "Jangan Lupa Isi Nama Kamu".

---

## 9. Design System

Acuan penuh: `Docs/design1.md`. Inti:

- Konsep "Joyful Productivity", mobile-first.
- Warna utama: Hero Purple `#6C3BFF`; semantik: Yellow `#FFD43B` (dekoratif saja), Coral `#FF6B6B`, Mint `#2DD4A8`, Blue `#38BDF8`.
- Semua pasangan teks-background wajib lolos **WCAG AA** (>= 4.5:1 normal, >= 3:1 besar) — rasio aktual tercatat di design1.md.
- Tombol: sistem `btn-3d` Neubrutalism (span `.button_top`, bayangan offset solid, border tebal). Varian: primary/sm/done/danger.
- Spacing 8px grid; radius scale 12/16/24px.
- `prefers-reduced-motion` dihormati.

---

## 10. Environment Variables

| Variabel | Keterangan |
|---|---|
| PORT | Port server (default 3000) |
| DATABASE_URL / DB_CONNECT_STRING | Connection string Supabase PostgreSQL (SSL `rejectUnauthorized: false`) |
| DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME | Alternatif koneksi terpisah |
| ENABLE_BOT | `true` = aktifkan bot WA + trigger instan |
| PUPPETEER_SKIP_CHROMIUM_DOWNLOAD, PUPPETEER_EXECUTABLE_PATH | Untuk container Railway/Docker |

---

## 11. Catatan Kualitas & Utang Teknis

- Password masih plaintext — migrasi ke bcrypt adalah item roadmap berikutnya.
- Header auth tokenless hanya cocok untuk lingkungan tugas akademik/demo terkontrol; produksi butuh token sungguhan (JWT/session).
- `database/schema.sql` ditulis dalam dialek akademik Oracle untuk lampiran tugas; runtime nyata 100% PostgreSQL (Supabase) dengan migrasi otomatis.
- Nilai legacy `pwa_h1hari` di CHECK constraint tidak terpakai (bukan PWA).
