PRODUCT REQUIREMENTS DOCUMENT (PRD)

Nama Project: Project1 (Aplikasi DeadLineHero)

Platform: Progressive Web App (PWA) & WhatsApp Bot



1. Problem Statement

Mahasiswa sering ketinggalan tenggat waktu (deadline) tugas karena pemberitahuan tugas tersebar di tiga website kampus yang berbeda (Vclass, Ilab, dan Praktikum/Luring). Saat waktu sibuk, mahasiswa tidak memiliki waktu untuk memantau website-website tersebut secara manual. Saat nongkrong bersama teman, masalah ini sering muncul karena notifikasi tidak terpusat. Dibutuhkan solusi yang ringan, bisa diinstal tanpa biaya Playstore, dan mampu memberikan peringatan keras baik kepada mahasiswa maupun orang terdekat mereka saat mendekati deadline.



2. Goals

Memusatkan informasi tugas, UTS, dan UAS ke dalam satu aplikasi PWA yang ringan dan mudah diinstal via link.

Menyediakan sistem pengingat (reminder) yang fleksibel: mahasiswa dapat memilih diingatkan via WhatsApp Bot ke orang terdekat atau via nada dering khusus di aplikasi saat H-1 jam.

Memberikan antarmuka yang clean dan nyaman dilihat dengan menggunakan tema warna pastel.

Menghindari AI Slop dalam pengembangan (Vibe Coding) dengan menulis kode yang padat, langsung pada fungsi inti, tanpa komentar berlebihan, dan tanpa over-engineering.

3. Target User

Mahasiswa (User): Mahasiswa Universitas Gunadarma (khususnya 1 kelas) yang memiliki akun di Vclass, Ilab, dan Praktikum/Luring.

Admin (Penanggung Jawab Kelas): 15 orang yang bertugas menginput tugas ke dalam sistem. Admin ini juga memiliki akun sebagai mahasiswa biasa.

4. User Stories

Sebagai Mahasiswa (User):



Saya ingin membuat akun dengan memasukkan Email, Nama, NPM, Password, dan Kelas.

Saya ingin memilih preferensi pengingat saat mendaftar: memasukkan Nomor WhatsApp orang terdekat ATAU memilih Nada Dering jika tidak ingin membagikan nomor.

Saya ingin login menggunakan Email dan Password.

Saya ingin melihat daftar tugas yang dibagi menjadi 3 kategori (Tugas, UTS, UAS).

Untuk kategori "Tugas", saya ingin melihat Judul, Sumber Web, Tag Kategori, dan tombol "Mark As Done".

Untuk kategori "UTS" dan "UAS", saya ingin melihat Judul, Sumber Web, dan Tag Kategori (tanpa tombol Mark As Done).

Saya ingin mendapatkan notifikasi aplikasi saat H-1 hari deadline.

Jika saya memilih nada dering, saya ingin aplikasi membunyikan nada dering keras saat H-1 jam deadline.

Saya ingin bisa mengakses menu di pojok kanan atas untuk Logout, Ganti Password, Ganti Email, dan mengubah preferensi pengingat (Nomor WA / Nada Dering).

Sebagai Admin (PJ Kelas):



Saya ingin login menggunakan akun statis (AdminPAslab1 - AdminPAslab15).

Saya ingin menginput tugas dengan mengisi: Judul, Deskripsi, Kategori, Deadline (Tanggal, Jam, Menit, Detik).

Saat input kategori "Tugas", saya ingin wajib memilih sumber web (Vclass/Ilab/Praktikum). Saat input "UTS/UAS", sumber web tidak perlu diisi.

Saya ingin menu pojok kanan atas yang hanya berisi Logout dan Ganti Password (tanpa ganti email).

Sebagai Sistem (Bot WA):



Saat deadline H-1 jam, sistem akan mengechat nomor WhatsApp orang terdekat mahasiswa dengan format: "Hai ini adalah Bot Tugas, Orang terdekat Kamu belum [kategori tugas], deadlinenya -1 jam".

5. Functional Requirements

Autentikasi & Onboarding:



Fitur Registrasi: Input data dasar mahasiswa. Password disimpan plain-text di SQL Oracle (tanpa Encode/Decode) untuk memudahkan testing.

Pilihan Pengingat: Form dinamis. Jika user tidak mengisi Nomor Orang Terdekat, wajib memilih Nada Dering dari dropdown.

Fitur Login: Verifikasi Email dan Password (plain-text comparison).

Dashboard Mahasiswa:



Tampilan UI Pastel: Background Soft Lilac, Tombol Soft Purple gradient, Teks Dark Slate Gray.

Layout List Tugas: 3 kategori yang dapat di-scroll.

Mark As Done: Hanya muncul pada kategori "Tugas". Mengubah status tugas di database.

Menu Header: Dropdown/Tombol pojok kanan atas untuk pengaturan akun dan preferensi pengingat.

Dashboard Admin:



Form Input Tugas: Kondisional field "Sumber Web" berdasarkan pilihan "Kategori".

Input Deadline: Presisi hingga detik.

Menu Header: Hanya Ganti Password dan Logout.

Sistem Notifikasi (Node.js & whatsapp.js):



Cron job/interval mengecek deadline di SQL Oracle.

Pemicu H-1 Hari: Kirim notifikasi standar ke PWA.

Pemicu H-1 Jam:

Cek apakah user punya Nomor WA -> Jalankan whatsapp.js untuk kirim pesan.

Jika tidak ada Nomor WA -> Picu event di PWA untuk memutar Nada Dering.

6. Non-Functional Requirements

Tech Stack: HTML, CSS, JavaScript murni (Vanilla JS) untuk Frontend PWA. Node.js untuk Backend & WA Bot. SQL Oracle untuk Database.

PWA Capability: Harus memiliki manifest.json agar bisa "Add to Home Screen" via link browser. Service Worker wajib ada untuk caching agar aplikasi ringan.

Vibe Coding Rules (No AI Slop): Kode yang dihasilkan harus bersih. Dilarang menambahkan komentar yang menjelaskan hal yang obvious (contoh: // fungsi login). Tidak boleh menggunakan framework yang tidak disebutkan di tech stack.

Keamanan (Sementara): Sengaja tidak menggunakan enkripsi password (plain-text) sesuai permintaan untuk fase testing.

UI/UX: Desain wajib menggunakan warna Pastel. Mengikuti sketsa wireframe (Area profil di pojok kiri atas, list tugas membulat besar di tengah, filter di dalam list, navigasi memanjang di bawah).

7. Scope (Optional - Project Sekali Jalan)

In-Scope:

Pengembangan aplikasi PWA dan Backend Node.js untuk 1 kelas spesifik di Gunadarma.

Pembuatan 15 akun Admin secara manual di database.

Integrasi whatsapp.js menggunakan 1 nomor WhatsApp sender.

Out-of-Scope (Tidak dikerjakan pada fase ini):

Publikasi ke Google Playstore atau Apple App Store.

Enkripsi password atau fitur keamanan tingkat lanjut (seperti JWT yang complex, 2FA, dll).

Skalabilitas untuk multi-kelas atau seluruh mahasiswa Gunadarma (fokus hanya untuk 1 kelas penguji).

Pembuatan fitur lupa password (cukup ganti password saat sudah login). 

