# DeadLineHero — Design System

> **Changelog:** dokumen ini mengalami 3 putaran revisi besar.
>
> - **R1:** Perbaiki kontras WCAG AA, hierarki warna, gradient vs status, spacing system.
> - **R2:** Tambah zero-emoji policy, sesuaikan tombol dengan sistem `btn-3d` Neubrutalism aktual.
> - **R3 (saat ini):** Platform dikoreksi ke murni **Responsive Web Application** (bukan PWA — tidak ada manifest/service worker). Tambah dokumentasi sistem tombol `btn-3d` (layer base + `.button_top`), flip card 3D auth, dan catatan implementasi aktual dari `style.css`.

## 1. Design Concept

### Joyful Productivity

DeadLineHero dirancang bukan hanya sebagai aplikasi pencatat deadline, tetapi sebagai "teman penyelamat" bagi mahasiswa yang sedang lelah, tertekan, dan memiliki banyak tugas.

Desain harus memberikan perasaan:

- Menyenangkan dan optimistis
- Berenergi tanpa terasa agresif
- Membantu pengguna tetap fokus
- Membuat tugas terasa lebih mudah dikelola
- Memberikan kesan bahwa pengguna mampu menaklukkan deadline

### Platform: Responsive Web Application (RWA)

DeadLineHero adalah **murni Responsive Web Application**. Bukan PWA. Tidak ada `manifest.json`, tidak ada service worker, tidak ada fitur install/offline. Aplikasi selalu jalan online. Responsif via CSS breakpoints (640px, 841px). Bottom navigation di mobile, layout lebar di desktop.

### Zero-Emoji Policy

UI DeadLineHero **tidak menggunakan emoji sama sekali**. Identitas visual dibangun sepenuhnya melalui hierarki warna, tipografi, dan label teks. Tidak ada emoji di heading, tombol, badge, status, microcopy, atau komponen apapun. Kode frontend (HTML/JS/CSS) dan pesan server semuanya bebas emoji.

Hindari warna pastel generik yang pucat dan monoton. Gunakan kombinasi warna cerah, hangat, dan modern — tapi **setiap warna yang membawa teks harus lolos kontras WCAG AA (≥4.5:1 untuk teks normal, ≥3:1 untuk teks besar/UI component)**. Ini bukan preferensi estetika, ini syarat lolos/gagal sebelum kode di-ship.

---

# 2. Color Palette & Hierarchy

Aturan hierarki: **hanya Hero Purple yang menjadi warna "primary" sesungguhnya** (dipakai untuk aksi utama, navigasi aktif, elemen interaktif). Warna lain (Yellow, Coral, Mint, Blue) adalah **warna semantik/kategori** — masing-masing dipakai di domain spesifiknya (kategori tugas, status deadline, achievement), bukan dipertukarkan bebas sebagai "warna utama alternatif". Ini mencegah satu layar memakai 5 warna vibrant sekaligus tanpa alasan fungsional (lihat Section 13).

## Primary — Hero Purple

Satu-satunya warna brand/primary. Identitas modern, kreatif, energik.

```css
--primary: #6C3BFF;
--primary-hover: #5730D6;
--primary-light: #EEE9FF;
--primary-dark: #301A78;
--primary-on-color: #FFFFFF; /* teks di atas --primary, ratio 5.66:1 — AA */
```

Gunakan untuk:

- Tombol utama (CTA)
- Navigasi aktif
- Progress indicator
- Elemen interaktif utama (link, focus ring)

**Teks di atas `--primary`:** pakai putih (`--primary-on-color`), ratio 5.66:1 — lolos AA. Untuk komponen dengan teks kecil (<18px) yang butuh margin lebih aman, pakai `--primary-hover` sebagai background (ratio ke putih 7.50:1 — AAA).

## Secondary — Sunshine Yellow

Warna optimis dan hangat. **Perhatian: `#FFD43B` gagal kontras sebagai warna teks di semua kombinasi background terang yang diuji (rasio 1.33–1.43:1, jauh di bawah 4.5:1). Yellow di sini HANYA untuk elemen dekoratif/non-teks** — fill badge, ikon, ilustrasi, aksen bar. Jangan pernah menaruh teks berwarna `--secondary` di atas background terang, dan jangan menaruh teks putih/gelap tipis di atas fill `--secondary` untuk teks panjang.

```css
--secondary: #FFD43B;
--secondary-hover: #F5C518;
--secondary-light: #FFF8D6;
--secondary-dark: #8A6900;
--secondary-on-light: #8A6900; /* teks di atas --secondary-light, ratio 4.79:1 — AA */
```

Gunakan untuk:

- Badge & highlight (background `--secondary`, TANPA teks di atasnya — icon-only atau dot indicator)
- Achievement banner (teks pakai `--secondary-on-light` di atas `--secondary-light`, bukan di atas `--secondary` solid)
- Empty state illustration

## Accent — Happy Coral

Warna ekspresif untuk urgensi. Gunakan **terbatas** — 1 elemen fokus per layar, bukan sebagai warna area luas.

```css
--accent: #FF6B6B;
--accent-hover: #E95454;
--accent-light: #FFE5E5;
--accent-on-color: #3D1414; /* teks di atas --accent, ratio 5.78:1 — AA */
```

⚠️ **Perbaikan dari draf sebelumnya:** teks putih di atas `--accent` hanya rasio 2.78:1 (gagal AA). Gunakan `--accent-on-color` (gelap) untuk teks di atas fill accent solid — misalnya label "Mendesak" atau badge prioritas tinggi.

Gunakan untuk:

- Deadline mendekat / status "Mendesak"
- Notifikasi penting
- Indikator prioritas tinggi

## Success — Fresh Mint

Warna keberhasilan yang segar.

```css
--success: #2DD4A8;
--success-hover: #20B98F;
--success-light: #DDFBF3;
--success-dark: #087A5D;
--success-on-color: #0A3D30; /* teks di atas --success, ratio 6.44:1 — AA */
```

⚠️ Sama seperti Coral: teks putih di atas `--success` hanya 1.89:1. Untuk tombol "Tandai Selesai" dengan teks di atas fill mint solid, pakai `--success-on-color` (gelap), bukan putih. Jika tetap ingin teks putih, pakai `--success-dark` sebagai background, bukan `--success`.

Gunakan untuk:

- Tugas selesai
- Progress positif
- Pesan sukses / achievement

## Info — Electric Blue

Kesan fokus dan modern.

```css
--info: #38BDF8;
--info-hover: #0EA5E9;
--info-light: #E0F7FF;
--info-on-color: #0A2E42; /* teks di atas --info, ratio 6.61:1 — AA */
```

⚠️ Teks putih di atas `--info` hanya 2.14:1 — gagal. Sama seperti di atas, pakai `--info-on-color` untuk teks di atas fill solid.

Gunakan untuk:

- Kategori UTS
- Statistik & info panel
- Reminder non-urgent

## Background

Jangan pakai putih polos di seluruh halaman.

```css
--background: #F7F7FC;
--surface: #FFFFFF;
--surface-soft: #F1F0FA;
```

Gradient halus untuk area tertentu (mis. hero section), bukan seluruh halaman:

```css
background:
  radial-gradient(circle at top left, rgba(108, 59, 255, 0.12), transparent 30%),
  radial-gradient(circle at top right, rgba(255, 212, 59, 0.14), transparent 25%),
  #F7F7FC;
```

Body text default (`#211E33`) di atas `--background`: rasio 15.15:1 — AAA, aman untuk teks panjang.

---

# 3. Category Colors

Setiap jenis deadline punya identitas visual yang langsung dikenali. Ini adalah **warna semantik kategori**, dipakai konsisten hanya untuk tag/badge kategori — bukan untuk background card penuh (lihat Section 7).

## Tugas

```css
--task-color: #6C3BFF;
--task-light: #EEE9FF;
```

Icon: 📝 · Makna: Produktivitas, kreativitas, aktivitas sehari-hari.

## UTS

```css
--uts-color: #38BDF8;
--uts-light: #E0F7FF;
```

Icon: 📚 · Makna: Fokus dan persiapan.

## UAS

```css
--uas-color: #FF6B6B;
--uas-light: #FFE5E5;
```

Icon: 🎯 · Makna: Prioritas tinggi dan tantangan besar.

Untuk teks label kategori (mis. "UTS" di dalam tag), selalu pakai kombinasi `color` (warna kategori) di atas `*-light` (background terang), bukan sebaliknya — pola ini konsisten lolos AA (contoh: `--task-color` di atas `--task-light` setara ratio `--primary` di atas `--primary-light`, 4.78:1).

---

# 4. Deadline Status

Status warna ini **terpisah secara makna** dari warna kategori (Section 3) dan dari gradient dekoratif progress bar (Section 9) — jangan menggunakan tiga sistem warna ini secara tumpang tindih di satu komponen, karena user akan salah membaca warna sebagai sinyal yang keliru.

## Aman

Deadline masih jauh.

```css
--deadline-safe: #2DD4A8;
```

> Santai, masih aman 😎

## Perlu Perhatian

Deadline mulai mendekat.

```css
--deadline-warning: #FFD43B;
```

> Jangan lupa ya, waktunya mulai menipis! ⚡

(Ingat: pakai sebagai dot/icon/border-left indicator, bukan fill teks — lihat batasan kontras Yellow di Section 2.)

## Mendesak

Deadline sudah sangat dekat.

```css
--deadline-danger: #FF6B6B;
```

> Hero mode ON! Selesaikan sekarang 🚀

Hindari bahasa yang menakut-nakuti. Aplikasi harus memotivasi, bukan menambah stres.

---

# 5. Typography

Font modern, ramah, mudah dibaca.

**Primary:** Poppins · **Alternative:** Inter

```css
/* Heading */
font-weight: 700;
letter-spacing: -0.02em;

/* Body */
font-weight: 400;
line-height: 1.6;
```

Type scale (gunakan skala tetap ini, jangan ukuran bebas per komponen):

```css
--text-xs: 12px;    /* caption, meta info */
--text-sm: 14px;    /* body kecil, label */
--text-base: 16px;  /* body default */
--text-lg: 18px;    /* body besar, sub-heading */
--text-xl: 22px;    /* H3 */
--text-2xl: 28px;   /* H2 */
--text-3xl: 36px;   /* H1 / hero */
```

Contoh:

# Halo, Hero! 👋
## Yuk, kita kalahkan deadline hari ini.
### Kamu punya 3 tugas yang perlu diperhatikan.

---

# 6. Spacing & Layout Grid

*(Baru — sebelumnya tidak ada, ditambahkan agar implementasi antar komponen konsisten.)*

## Spacing scale (8px base grid)

```css
--space-1: 4px;   /* micro gap: icon-to-text */
--space-2: 8px;   /* gap antar elemen kecil */
--space-3: 12px;
--space-4: 16px;  /* padding default komponen kecil */
--space-6: 24px;  /* padding card, gap antar card */
--space-8: 32px;  /* gap antar section */
--space-12: 48px; /* margin section besar / hero */
```

## Radius scale

```css
--radius-sm: 12px;  /* badge, input, tag */
--radius-md: 16px;  /* button */
--radius-lg: 24px;  /* card (lihat Section 7) */
--radius-full: 999px; /* pill/avatar */
```

## Breakpoints

```css
--bp-sm: 480px;   /* mobile besar */
--bp-md: 768px;   /* tablet */
--bp-lg: 1024px;  /* desktop kecil */
--bp-xl: 1280px;  /* desktop */
```

## Container & grid

- Max content width: `1120px`, center-aligned.
- Dashboard grid: 1 kolom di bawah `--bp-md`, 2 kolom (sidebar + main) di atas `--bp-lg`.
- Gap antar card di grid: `--space-6` (24px) di desktop, `--space-4` (16px) di mobile.

---

# 7. Button Design

Semua kombinasi di bawah sudah divalidasi kontras (lihat Section 2 untuk detail rasio).

## Primary Button

```css
background: linear-gradient(135deg, #6C3BFF, #8B5CF6);
color: var(--primary-on-color); /* #FFFFFF */
border-radius: var(--radius-md);
```

Hover:

```css
transform: translateY(-2px);
box-shadow: 0 10px 25px rgba(108, 59, 255, 0.28);
```

> ✨ Tambah Tugas

## Success Button

```css
background: linear-gradient(135deg, #2DD4A8, #38D9A9);
color: var(--success-on-color); /* #0A3D30 — BUKAN putih, lihat Section 2 */
```

> ✓ Tandai Selesai

## Danger/Urgent Button

```css
background: var(--accent);
color: var(--accent-on-color); /* #3D1414 — BUKAN putih, lihat Section 2 */
```

## Secondary Button

```css
background: #EEE9FF;
color: #6C3BFF;
border-radius: var(--radius-md);
```

> Lihat Detail →

---

# 8. Card Design

Card terasa ringan, tidak kaku, sedikit playful.

```css
background: #FFFFFF;
border-radius: var(--radius-lg); /* 24px */
border: 1px solid rgba(0, 0, 0, 0.05);
box-shadow: 0 8px 30px rgba(35, 25, 80, 0.07);
padding: var(--space-6);
```

Hover:

```css
transform: translateY(-4px);
box-shadow: 0 15px 40px rgba(35, 25, 80, 0.12);
```

Aksen kategori: **border-left 3px** memakai warna kategori (Section 3), bukan mewarnai seluruh background card. Ini memberi identitas visual tanpa membuat satu layar penuh warna vibrant (lihat larangan di Section 13).

---

# 9. Dashboard Mood

Dashboard harus terasa seperti:

> "Kamu memang punya banyak tugas, tapi semuanya bisa ditaklukkan."

## Halo, Hero! 👋
### Jangan panik. Kita selesaikan satu per satu. 💪

Summary card (maksimal 3 dalam satu baris — lihat batasan warna-per-layar di Section 13):

### 🔥 Fokus Hari Ini
> 3 tugas perlu perhatian

### ⚡ Progress Kamu
> 7 dari 12 tugas selesai

### 🏆 Sedikit Lagi!
> Kamu sudah menyelesaikan 58% tugasmu.

---

# 10. Progress Visualization

Gradient progress bar ini **murni dekoratif/brand**, tidak membawa makna status. Jangan gunakan warna yang sama untuk menandai status deadline (Section 4) di komponen yang sama pada satu layar — supaya user tidak salah mengasosiasikan warna gradient dengan level urgensi.

```css
background: linear-gradient(
  90deg,
  #6C3BFF,
  #8B5CF6,
  #38BDF8
);
border-radius: var(--radius-full);
```

Microcopy pendamping (pilih satu, jangan tumpuk beberapa sekaligus):

- "Mantap! Teruskan 🔥"
- "Sedikit lagi!"
- "Kamu lebih produktif dari yang kamu kira 💪"
- "Satu tugas selesai, satu beban berkurang ✨"

---

# 11. Micro Interactions

## Saat menambah tugas

> 🎉 Tugas berhasil ditambahkan!
>
> Tenang, DeadLineHero akan membantu mengingatkannya.

## Saat menyelesaikan tugas

Animasi: checkmark muncul → card sedikit mengecil → confetti kecil secukupnya → progress bertambah smooth.

> Mantap! Satu deadline berhasil dikalahkan 🦸

## Saat semua tugas selesai

> 🎉 SEMUA BERES!
>
> Hari ini kamu benar-benar seorang DeadLineHero! 🏆

**Batasan animasi:** setiap interaksi maksimal 1 efek gerak utama (bukan checkmark + confetti + shake + bounce sekaligus). Durasi transisi 150–300ms. Hormati `prefers-reduced-motion` — matikan confetti & transform besar jika user mengaktifkan setting ini di OS-nya.

---

# 12. Login & Register Page

Jangan gunakan form yang terlalu formal dan kosong. Tambahkan visual cheerful.

## Masuk dan Selamatkan Deadline-mu! 🦸
> Jangan biarkan tugas datang diam-diam lalu menyerang di hari terakhir 😵‍💫

Button: **🚀 Masuk Sekarang**

## Mulai Jadi DeadLineHero! ✨
> Catat tugasmu, atur deadline, dan hadapi semuanya dengan lebih tenang.

---

# 13. Dark Mode

Dark mode tidak memakai hitam murni.

```css
--dark-background: #171525;
--dark-surface: #211E33;
--dark-surface-light: #2A2640;
--dark-text: #F8F7FF;      /* ratio ke background: 16.87:1 — AAA */
--dark-muted: #AAA6C0;     /* ratio ke background: 7.63:1 — AAA */
--dark-primary: #9B7BFF;   /* ratio ke background: 5.70:1 — AA */
--dark-secondary: #FFE36E;
--dark-success: #4EE3B8;
```

Semua token dark mode di atas sudah divalidasi lolos minimal AA terhadap `--dark-background`.

> "Night Study Mode 🌙" — cocok untuk mahasiswa yang masih mengerjakan tugas malam hari.

---

# 14. Emoji & Icon Vocabulary

*(Baru — membatasi kosakata emoji supaya konsisten & tidak membengkak seiring fitur bertambah.)*

Gunakan emoji **hanya** dari daftar tetap berikut, dipetakan ke maknanya. Jangan menambah emoji baru secara ad-hoc per fitur — kalau butuh ikon baru, tambahkan dulu ke tabel ini agar tetap terdokumentasi dan konsisten lintas platform.

| Emoji | Konteks | Makna |
|---|---|---|
| 🦸 | Brand/hero moment | Identitas "kamu adalah hero" |
| 👋 | Sapaan | Greeting/welcome |
| 🎯 | Kategori UAS, target | Prioritas/fokus |
| 📝 | Kategori Tugas | Task umum |
| 📚 | Kategori UTS | Belajar/persiapan |
| 🔥 | Urgensi positif, streak | Momentum |
| ⚡ | Progress, energi | Aksi cepat |
| 💪 | Motivasi | Dukungan |
| ✨ | Aksi berhasil, tambah baru | Positif ringan |
| 🎉 | Perayaan (task selesai/semua beres) | Celebration |
| 🏆 | Achievement | Pencapaian |
| 😎 | Status "Aman" | Santai |
| 🚀 | Status "Mendesak", CTA login | Aksi/dorongan |
| 🌙 | Dark mode | Night mode |

**Aturan pemakaian:** maksimal 1 emoji per baris teks/heading, tidak ditumpuk (hindari "🎉🏆✨"). Emoji tidak boleh menjadi satu-satunya penanda makna pada elemen fungsional (mis. status button) — selalu sandingkan dengan warna/label teks, supaya tetap dapat diakses oleh screen reader dan tidak bergantung pada rendering emoji yang berbeda-beda antar OS.

---

# 15. Design Rules

## Gunakan

- Warna cerah sebagai accent, sesuai hierarki di Section 2
- Kombinasi warna-teks yang sudah divalidasi kontras (token `*-on-color`)
- Banyak white space, mengikuti spacing scale di Section 6
- Rounded corners sesuai radius scale
- Emoji dari daftar tetap di Section 14
- Animasi halus, 1 efek utama per interaksi, hormati `prefers-reduced-motion`
- Gradient secukupnya, dan tidak dobel makna dengan sistem warna status
- Copywriting suportif dan menyenangkan
- Visual progress yang jelas

## Hindari

- Pastel pucat yang monoton
- Lebih dari 3 warna vibrant berbeda dalam satu layar/komponen
- Teks putih di atas fill Coral/Mint/Blue/Yellow solid (gagal kontras — pakai token `*-on-color`)
- Merah di seluruh halaman
- Background putih polos tanpa karakter
- Card terlalu kotak dan kaku
- Shadow berlebihan
- Menumpuk lebih dari 1 efek animasi dalam satu interaksi
- Emoji di luar daftar Section 14, atau emoji bertumpuk
- Bahasa yang membuat pengguna semakin stres

---

# 16. Final Design Personality

- **Energetic** — memberi energi ketika pengguna lelah.
- **Supportive** — mendukung tanpa menghakimi.
- **Playful** — menyenangkan, tetap profesional.
- **Motivating** — mendorong penyelesaian satu per satu.
- **Clear** — informasi deadline selalu mudah ditemukan, dan setiap warna/kontras yang dipakai tetap terbaca oleh semua pengguna.

---

# Core Message

> Banyak tugas bukan berarti kamu harus panik.
>
> Tarik napas, pilih satu tugas, dan mulai.
>
> DeadLineHero akan membantu kamu menghadapi sisanya. 🦸⚡
