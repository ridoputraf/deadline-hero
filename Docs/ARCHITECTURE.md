# ARCHITECTURE — DeadLineHero

Dokumen ini merangkas alur data (DFD) dan struktur data (ERD) DeadLineHero
berdasarkan implementasi aktual di `src/server.js`, `src/bot.js`, dan
`database/schema.sql`. Diagram digambar pakai Mermaid supaya langsung
ter-render di GitHub tanpa tool tambahan.

## Ringkasan Sistem

Web app manajemen tugas (Tugas/UTS/UAS) untuk mahasiswa & admin, dengan dua
jalur pengingat otomatis H-1 jam: nada dering di browser (mahasiswa sendiri)
dan pesan WhatsApp ke orang terdekat mahasiswa (pacar/keluarga/sahabat).
Backend Express + PostgreSQL (Supabase), deploy di Railway.

---

## DFD Level 0 (Context Diagram)

```mermaid
flowchart TB
  Mahasiswa([Mahasiswa])
  Admin([Admin])
  Relasi([Orang Terdekat Mahasiswa])

  Sistem[["Sistem DeadLineHero"]]

  WA[[WhatsApp Web API]]
  DB[(Supabase PostgreSQL)]

  Mahasiswa -- "Daftar / Login / Tandai Selesai / Atur Preferensi" --> Sistem
  Sistem -- "Daftar Tugas / Notifikasi / Rekap" --> Mahasiswa

  Admin -- "Buat Tugas / Hapus Tugas / Rekap & Arsip" --> Sistem
  Sistem -- "Data Rekap / Excel" --> Admin

  Sistem -- "Kirim Pesan Pengingat" --> WA
  WA -- "Pesan Pengingat H-1 Jam" --> Relasi

  Sistem <--> DB
```

---

## DFD Level 1 (Rincian Proses)

```mermaid
flowchart TB
  Mahasiswa([Mahasiswa])
  Admin([Admin])
  Relasi([Orang Terdekat])

  subgraph Sistem [Sistem DeadLineHero]
    P1["1.0 Autentikasi & Preferensi\n(register/login/change-password/preferences)"]
    P2["2.0 Manajemen Tugas\n(create/list/delete tasks)"]
    P3["3.0 Progres & Rekap\n(mark done, recap, arsip, export Excel)"]
    P4["4.0 Alarm Nada Dering\n(client-side, per browser)"]
    P5["5.0 Bot Pengingat WhatsApp\n(cron 10 menit + trigger instan)"]
  end

  D1[(D1 users)]
  D2[(D2 tasks)]
  D3[(D3 user_task_status)]
  D4[(D4 task_completions)]
  D5[(D5 notification_log)]

  Mahasiswa -- "kredensial, preferensi" --> P1
  P1 -- "sesi user" --> Mahasiswa
  P1 <--> D1

  Admin -- "data tugas baru / hapus" --> P2
  P2 -- "daftar tugas" --> Mahasiswa
  P2 -- "konfirmasi" --> Admin
  P2 <--> D2

  Mahasiswa -- "tandai selesai" --> P3
  Admin -- "tarik rekap & arsip" --> P3
  P3 -- "file Excel rekap" --> Admin
  P3 -- "riwayat/progress" --> Mahasiswa
  P3 <--> D2
  P3 <--> D3
  P3 <--> D4

  D2 -- "tugas mendekati deadline" --> P4
  D3 -- "status pengerjaan" --> P4
  P4 -- "bunyi alarm + notifikasi browser" --> Mahasiswa

  D2 -- "tugas mendekati deadline" --> P5
  D1 -- "no_wa & relasi" --> P5
  D3 -- "status pengerjaan" --> P5
  P5 <--> D5
  P5 -- "pesan WA pengingat" --> Relasi
```

**Catatan proses:**
- **P4 (Alarm Nada Dering)** murni berjalan di browser mahasiswa (`public/app.js`), memindai tugas tiap 30 detik + saat data tugas baru diambil. Status "sudah pernah bunyi" disimpan per tugas di `localStorage`, dan id tugas yang sedang berbunyi dipersist ke `sessionStorage` supaya bertahan saat halaman di-refresh. Audio berhenti otomatis hanya kalau **seluruh** tugas aktif (Tugas/UTS/UAS) sudah berstatus selesai — bukan begitu satu tugas saja ditandai selesai.
- **P5 (Bot WhatsApp)** jalan di server (`src/bot.js`) via `whatsapp-web.js` + `node-cron`, mengecek dua jalur: pengingat langsung (`wa_h1jam`, ke nomor `no_wa` milik user itu sendiri) dan pengingat relasi (`H-1_RELASI`, ke nomor `no_wa` semua user berperan relasi untuk tugas milik mahasiswa lain). Dedup terjadi lewat `notification_log`.

---

## ERD

```mermaid
erDiagram
  USERS ||--o{ TASKS : "membuat (created_by)"
  USERS ||--o{ USER_TASK_STATUS : "punya status per tugas"
  USERS ||--o{ TASK_COMPLETIONS : "menyelesaikan"
  USERS ||--o{ NOTIFICATION_LOG : "menerima notifikasi"
  TASKS ||--o{ USER_TASK_STATUS : "dikerjakan oleh"
  TASKS ||--o{ TASK_COMPLETIONS : "diselesaikan pada"
  TASKS ||--o{ NOTIFICATION_LOG : "memicu notifikasi"

  USERS {
    int id_user PK
    varchar npm
    varchar nama
    varchar email UK
    varchar password "bcrypt hash"
    varchar role "user | admin"
    varchar preferensi "nada_dering | nomor_wa"
    varchar no_wa
    varchar relasi "pacar | keluarga | sahabat"
    varchar selected_ringtone
    timestamp created_at
  }

  TASKS {
    int id_tugas PK
    varchar judul
    text deskripsi
    timestamp deadline
    varchar kategori "Tugas | UTS | UAS"
    int created_by FK
    varchar sumber_web "Vclass | Ilab | Praktikum"
    boolean is_archived
    timestamp archived_at
    timestamp created_at
  }

  USER_TASK_STATUS {
    int id_status PK
    int id_user FK
    int id_tugas FK
    varchar status "belum | selesai"
    timestamp completed_at
    timestamp updated_at
  }

  TASK_COMPLETIONS {
    bigint id_completion PK
    bigint id_tugas FK
    bigint id_user FK
    timestamp completed_at
  }

  NOTIFICATION_LOG {
    int id_notif PK
    int id_user FK
    int id_tugas FK
    varchar jenis "wa_h1jam | ring_h1jam | pwa_h1hari | H-1_RELASI"
    timestamp notified_at
  }
```

---

## Catatan Arsitektur Lain

- **Single source of truth skema:** `database/schema.sql` adalah acuan struktur tabel Supabase. `ensureRecapSchema()` di `src/server.js` menjalankan migrasi idempoten (`ADD COLUMN IF NOT EXISTS`, dst.) saat startup supaya instance Railway otomatis menyesuaikan tanpa migrasi manual — bukan skema tandingan, hanya penjaga kalau DB live belum disinkron.
- **Autentikasi:** password disimpan sebagai hash bcrypt (`BCRYPT_ROUNDS = 10`). Akun lama (kalau masih ada sisa password plaintext) otomatis di-upgrade ke hash begitu berhasil login sekali — tidak perlu migrasi manual/reset password massal.
- **Deployment:** Railway (Docker `node:20-slim`), volume persistent untuk sesi WhatsApp (`RAILWAY_VOLUME_MOUNT_PATH`).
