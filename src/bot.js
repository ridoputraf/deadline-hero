const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const qrcodeTerminal = require('qrcode-terminal');
const qrcode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');
const { getConnection, sanitizeError } = require('./db');

let ready = false;
let qrDataUrl = null;

// Menentukan path volume persistent Railway atau lokal
// 1. Menentukan path volume persistent Railway atau lokal
const SESSION_PATH = process.env.RAILWAY_VOLUME_MOUNT_PATH 
  || path.join(__dirname, '..', '.wwebjs_auth');

// 2. FUNGSI PEMBERSIH LOCK PADA VOLUME (Wajib sebelum new Client)
function cleanChromiumLocks(dir) {
  if (!fs.existsSync(dir)) return;
  try {
    const files = fs.readdirSync(dir, { withFileTypes: true });
    for (const file of files) {
      const fullPath = path.join(dir, file.name);
      if (file.isDirectory()) {
        cleanChromiumLocks(fullPath);
      } else if (
        file.name === 'SingletonLock' || 
        file.name === 'SingletonCookie' || 
        file.name === 'SingletonSocket'
      ) {
        try {
          fs.unlinkSync(fullPath);
          console.log(`[WA BOT] Berhasil menghapus file pengunci Chromium: ${fullPath}`);
        } catch (err) {
          console.error(`[WA BOT] Gagal menghapus file pengunci ${fullPath}:`, err.message);
        }
      }
    }
  } catch (e) {
    console.error('[WA BOT] Gagal pembersihan direktori:', e.message);
  }
}

// Jalankan pembersihan langsung di awal sebelum Puppeteer start
cleanChromiumLocks(SESSION_PATH);

// 3. Inisialisasi WhatsApp Client
const client = new Client({
  authStrategy: new LocalAuth({
    clientId: 'deadlinehero',
    dataPath: SESSION_PATH
  }),
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-gpu'
    ],
  },
});

client.on('qr', async (qr) => {
  qrcodeTerminal.generate(qr, { small: true });
  try {
    qrDataUrl = await qrcode.toDataURL(qr);
    console.log('[WA BOT] QR baru dibuat. Scan untuk login WhatsApp.');
  } catch (err) {
    console.error('[WA BOT] gagal membuat QR image:', err.message);
  }
});

client.on('auth_failure', (msg) => {
  ready = false;
  console.error('[WA BOT] auth gagal:', msg);
});

client.on('disconnected', (reason) => {
  ready = false;
  qrDataUrl = null;
  console.warn('[WA BOT] koneksi terputus:', reason, '- menunggu reconnect...');
});

client.on('ready', () => {
  ready = true;
  qrDataUrl = null;
  console.log('[WA BOT] WhatsApp siap.');
  console.log('[WA BOT] Menjalankan pengecekan instan...');
  runCheck().catch((err) => console.error('[WA BOT] instan cek error:', err));
  runRelasiCheck().catch((err) => console.error('[WA BOT] instan relasi cek error:', err));
});

function getBotStatus() {
  return { ready, qrDataUrl };
}

/* Format nomor: '08xxx' -> '628xxx@c.us', '628xxx' -> '628xxx@c.us' */
function normalizePhone(raw) {
  if (!raw) return null;
  let s = String(raw).replace(/\D/g, '');
  if (!s) return null;
  if (s.startsWith('62')) return s + '@c.us';
  if (s.startsWith('0')) return '62' + s.slice(1) + '@c.us';
  return '62' + s + '@c.us';
}

/* Sisa waktu deadline dalam menit (dibulatkan ke bawah), dihitung murni di Node.js */
function diffMinutes(deadlineStr) {
  return Math.floor((new Date(deadlineStr) - new Date()) / (1000 * 60));
}

function sisaMenitLabel(menit) {
  if (menit <= 1) return 'tinggal hitungan menit lagi';
  return `${menit} menit lagi`;
}

/* Template pesan pengingat berdasarkan relasi penerima.
 * Detail tugas: nama mahasiswa, nama tugas, kategori (mata kuliah), sisa waktu. */
function buildMessage(t) {
  const relasi = String(t.relasi || '').toLowerCase();
  const sisa = sisaMenitLabel(diffMinutes(t.deadline));
  const detail =
    `Nama Mahasiswa : ${t.nama}\n` +
    `Nama Tugas     : ${t.judul}\n` +
    `Mata Kuliah    : ${t.kategori}${t.sumber_web ? ` (${t.sumber_web})` : ''}\n` +
    `Sisa Deadline  : ${sisa}`;

  if (relasi === 'pacar') {
    return (
      `Hai! Ini pengingat otomatis dari DeadLineHero.\n` +
      `Kamu orang terdekat buat ${t.nama}, dan ada kabar yang perlu kamu ingetin nih:\n\n` +
      `${detail}\n\n` +
      `Tolong ingetin dia ya, biar tugasnya gak kelewat. Dukungan kamu berarti banget buat dia.`
    );
  }
  if (relasi === 'sahabat') {
    return (
      `Woy! Bot DeadLineHero nih.\n` +
      `Sahabat kamu, ${t.nama}, masih ada tugas yang belum beres dan deadlinenya mepet banget:\n\n` +
      `${detail}\n\n` +
      `Cepet diingetin sebelum kelewat, nanti nyesel loh!`
    );
  }
  if (relasi === 'keluarga') {
    return (
      `Selamat datang dari aplikasi DeadLineHero.\n` +
      `Kami ingin menginformasikan bahwa ${t.nama} memiliki tugas yang akan segera menemui batas waktu pengumpulan:\n\n` +
      `${detail}\n\n` +
      `Mohon bantuan Bapak/Ibu untuk mengingatkan agar tugas tersebut dapat diselesaikan tepat waktu. Terima kasih.`
    );
  }
  return (
    `Hai! Ini pengingat otomatis dari DeadLineHero.\n` +
    `${t.nama} punya tugas yang deadlinenya tinggal ${sisa}:\n\n` +
    `${detail}\n\n` +
    `Tolong bantu ingetin dia ya. Terima kasih!`
  );
}

/* Ambil kandidat tugas: belum selesai, deadline masih di masa depan dan
 * maksimal 60 menit dari sekarang (termasuk tugas mendadak 30m/15m).
 * Tanpa filter preferensi: selama nomor WA valid, wajib dikirim.
 * LEFT JOIN user_task_status supaya user yang belum pernah menandai status
 * (belum punya baris status) tetap dianggap "belum" dan ikut diingatkan.
 * Verifikasi final selisih menit dilakukan di Node.js (lihat runCheck). */
async function getImminentTasks() {
  const conn = await getConnection();
  try {
    const result = await conn.query(
      `SELECT u.id_user AS "id_user", u.nama AS "nama", u.no_wa AS "no_wa", u.relasi AS "relasi",
              t.id_tugas AS "id_tugas", t.judul AS "judul", t.kategori AS "kategori",
              t.sumber_web AS "sumber_web",
              TO_CHAR(t.deadline, 'YYYY-MM-DD"T"HH24:MI:SS') AS "deadline"
       FROM tasks t
       JOIN users u ON u.role = 'user'
          AND TRIM(COALESCE(u.no_wa, '')) <> ''
       LEFT JOIN user_task_status uts
          ON uts.id_user = u.id_user AND uts.id_tugas = t.id_tugas
       LEFT JOIN notification_log nl
          ON nl.id_user = u.id_user AND nl.id_tugas = t.id_tugas AND nl.jenis = 'wa_h1jam'
       WHERE COALESCE(uts.status, 'belum') != 'selesai'
          AND COALESCE(t.is_archived, FALSE) = FALSE
          AND t.deadline > (NOW() AT TIME ZONE 'Asia/Jakarta') - INTERVAL '5 minutes'
          AND t.deadline <= (NOW() AT TIME ZONE 'Asia/Jakarta') + INTERVAL '60 minutes'
          AND nl.id_notif IS NULL`
    );
    return result.rows;
  } finally {
    conn.release();
  }
}

/* Catat ke notification_log agar tidak terkirim ulang.
 * ON CONFLICT DO NOTHING: guard ekstra kalau cron berjalan paralel. */
async function markNotified(conn, idUser, idTugas) {
  await conn.query(
    `INSERT INTO notification_log (id_user, id_tugas, jenis) VALUES ($1, $2, 'wa_h1jam')
     ON CONFLICT (id_user, id_tugas, jenis) DO NOTHING`,
    [idUser, idTugas]
  );
}

/* ===== H-1 RELASI: notifikasi ke orang terdekat mahasiswa ===== */

/* Ambil kandidat: tugas H-1 jam, JOIN creator (user) + user relasi.
 * Hanya tugas yang dibuat user (role=user) + no_wa valid.
 * Dedup via notification_log jenis 'H-1_RELASI'. */
async function getRelasiTasks() {
  const conn = await getConnection();
  try {
    const result = await conn.query(
      `SELECT creator.nama AS "nama_creator",
              u.id_user, u.nama, u.no_wa, u.relasi,
              t.id_tugas, t.judul, t.kategori, t.sumber_web,
              TO_CHAR(t.deadline, 'YYYY-MM-DD"T"HH24:MI:SS') AS "deadline"
       FROM tasks t
       JOIN users creator ON creator.id_user = t.created_by
       JOIN users u ON u.role = 'user'
          AND TRIM(COALESCE(u.no_wa, '')) <> ''
       LEFT JOIN notification_log nl
          ON nl.id_user = u.id_user AND nl.id_tugas = t.id_tugas AND nl.jenis = 'H-1_RELASI'
       WHERE COALESCE(t.is_archived, FALSE) = FALSE
          AND t.deadline > (NOW() AT TIME ZONE 'Asia/Jakarta') - INTERVAL '5 minutes'
          AND t.deadline <= (NOW() AT TIME ZONE 'Asia/Jakarta') + INTERVAL '60 minutes'
          AND nl.id_notif IS NULL`
    );
    return result.rows;
  } finally {
    conn.release();
  }
}

/* Template pesan sopan untuk orang terdekat. */
function buildRelasiMessage(t) {
  const sisa = sisaMenitLabel(diffMinutes(t.deadline));
  return (
    `Halo! Ini pesan otomatis dari DeadlineHero.\n` +
    `Sekadar mengingatkan bahwa ${t.nama} memiliki tugas "${t.judul}" (${t.kategori}) ` +
    `yang akan mendeadline dalam ${sisa}.\n` +
    `Mohon bantu ingatkan beliau ya! Terima kasih.`
  );
}

/* Catat notifikasi relasi ke notification_log. */
async function markRelasiNotified(conn, idUser, idTugas) {
  await conn.query(
    `INSERT INTO notification_log (id_user, id_tugas, jenis) VALUES ($1, $2, 'H-1_RELASI')
     ON CONFLICT (id_user, id_tugas, jenis) DO NOTHING`,
    [idUser, idTugas]
  );
}

/* Orkestrasi: ambil tugas, verifikasi waktu, kirim ke relasi. */
async function runRelasiCheck() {
  let tasks;
  try {
    tasks = await getRelasiTasks();
  } catch (err) {
    console.error('[WA BOT] RELASI: ambil daftar tugas gagal:', err);
    return;
  }
  if (!tasks || !tasks.length) return;

  console.log(`[WA BOT] RELASI: ${tasks.length} antrian pengingat ke orang terdekat.`);
  const conn = await getConnection();
  try {
    for (const t of tasks) {
      const sisaMenit = diffMinutes(t.deadline);
      if (!(sisaMenit > 0 && sisaMenit <= 60)) continue;

      const chatId = normalizePhone(t.no_wa);
      if (!chatId) {
        console.warn(`[WA BOT] RELASI: no_wa kosong/invalid user=${t.id_user}, dilewati.`);
        continue;
      }
      if (!ready) {
        console.warn(`[WA BOT] RELASI: client belum ready, tunda.`);
        continue;
      }
      try {
        console.log(`[WA BOT] RELASI: kirim ke ${chatId} (relasi=${t.relasi}, dari ${t.nama}, tugas #${t.id_tugas})...`);
        const terdaftar = await client.isRegisteredUser(chatId);
        if (!terdaftar) {
          console.warn(`[WA BOT] RELASI: nomor tidak terdaftar di WA: ${chatId}. Dilewati.`);
          continue;
        }
        await client.sendMessage(chatId, buildRelasiMessage(t));
        await markRelasiNotified(conn, t.id_user, t.id_tugas);
        console.log(`[WA BOT] RELASI: terkirim ke ${chatId} (tugas #${t.id_tugas}).`);
      } catch (err) {
        console.error(`[WA BOT] RELASI: kirim gagal ke ${chatId}:`, err);
      }
    }
    console.log('[WA BOT] RELASI: antrian selesai diproses.');
  } finally {
    conn.release();
  }
}

async function runCheck() {
  let tasks;
  try {
    tasks = await getImminentTasks();
  } catch (err) {
    console.error('[WA BOT] ambil daftar tugas H-1 jam gagal:', sanitizeError(err));
    return;
  }
  if (!tasks || !tasks.length) return;

  console.log(`[WA BOT] Menemukan ${tasks.length} antrian pengingat (sisa waktu <= 60 menit).`);
  const conn = await getConnection();
  try {
    for (const t of tasks) {
      // Verifikasi final selisih waktu murni di Node.js: 0 < menit <= 60
      const sisaMenit = diffMinutes(t.deadline);
      if (!(sisaMenit > 0 && sisaMenit <= 60)) continue;

      const chatId = normalizePhone(t.no_wa);
      if (!chatId) {
        console.warn(`[WA BOT] nomor WA kosong/invalid untuk user=${t.id_user}, dilewati.`);
        continue;
      }
      if (!ready) {
        console.warn(`[WA BOT] client belum ready (reconnecting?), tunda user=${t.id_user} tugas #${t.id_tugas}.`);
        continue;
      }
      try {
        console.log(`[WA BOT] Mengirim pesan H-1 jam (sisa ${sisaMenit} menit) ke nomor ${chatId} (user=${t.id_user}, tugas #${t.id_tugas} "${t.judul}")...`);
        const terdaftar = await client.isRegisteredUser(chatId);
        if (!terdaftar) {
          console.warn(`[WA BOT] nomor tidak terdaftar di WhatsApp: ${chatId}. Dilewati.`);
          continue;
        }
        await client.sendMessage(chatId, buildMessage(t));
        await markNotified(conn, t.id_user, t.id_tugas);
        console.log(`[WA BOT] Terkirim ke ${chatId} (tugas #${t.id_tugas}).`);
      } catch (err) {
        console.error(`[WA BOT] kirim gagal ke ${chatId}:`, sanitizeError(err));
      }
    }
    console.log('[WA BOT] Antrian pengingat selesai diproses.');
  } finally {
    conn.release();
  }
}

/* Trigger instan: dipanggil saat mahasiswa baru daftar atau admin buat tugas baru,
 * supaya tugas yang deadlinenya sudah masuk rentang H-1 jam langsung dieksekusi
 * tanpa menunggu cron menit berikutnya. */
function triggerInstantCheck(label) {
  if (!ready) {
    console.log(`[WA BOT] Trigger instan (${label}): client belum ready, tunggu cron berikutnya.`);
    return;
  }
  console.log(`[WA BOT] Trigger instan (${label}): cek tugas H-1 jam + relasi sekarang...`);
  runCheck().catch((err) => console.error(`[WA BOT] trigger instan (${label}) error:`, err));
  runRelasiCheck().catch((err) => console.error(`[WA BOT] trigger instan relasi (${label}) error:`, err));
}

function startBot() {
  // Hapus paksa file lock Chromium jika ada (sisa sesi crash sebelumnya)
  const possibleLockPaths = [
    path.join(__dirname, '..', '.wwebjs_auth', 'session-deadlinehero', 'SingletonLock'),
    path.join(__dirname, '.wwebjs_auth', 'session-deadlinehero', 'SingletonLock'),
    '/app/.wwebjs_auth/session-deadlinehero/SingletonLock',
    path.join(__dirname, '..', '.wwebjs_auth', 'session-deadlinehero', 'SingletonCookie'),
    path.join(__dirname, '.wwebjs_auth', 'session-deadlinehero', 'SingletonCookie'),
    '/app/.wwebjs_auth/session-deadlinehero/SingletonCookie'
  ];

  for (const lockFile of possibleLockPaths) {
    try {
      if (fs.existsSync(lockFile)) {
        fs.unlinkSync(lockFile);
        console.log(`[WA BOT] Sukses menghapus file kunci: ${lockFile}`);
      }
    } catch (e) {
      // Abaikan jika gagal
    }
  }

  client.initialize();

  // Cron tiap 10 menit: mengecek tugas H-1 jam
  cron.schedule('*/10 * * * *', () => {
    console.log('[WA BOT] cron (tiap 10 menit) cek deadline H-1 jam...');
    runCheck().catch((err) => console.error('[WA BOT] cron error:', err));
    runRelasiCheck().catch((err) => console.error('[WA BOT] cron relasi error:', err));
  });
}

module.exports = { startBot, runCheck, runRelasiCheck, triggerInstantCheck, client, getBotStatus };