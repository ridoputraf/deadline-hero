const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const qrcodeTerminal = require('qrcode-terminal');
const qrcode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');
const { getConnection, sanitizeError } = require('./db');

let ready = false;
let qrDataUrl = null;

const client = new Client({
  authStrategy: new LocalAuth({ clientId: 'deadlinehero' }),
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
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
  runCheck().catch((err) => console.error('[WA BOT] instan cek error:', sanitizeError(err)));
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

/* Sisa waktu deadline dalam menit (dibulatkan ke atas) */
function sisaMenitLabel(sisaDetik) {
  const menit = Math.max(1, Math.ceil(Number(sisaDetik) / 60));
  return `sekitar ${menit} menit lagi`;
}

/* Template pesan H-1 jam berdasarkan relasi penerima.
 * Detail tugas: nama mahasiswa, nama tugas, kategori (mata kuliah), sisa waktu. */
function buildMessage(t) {
  const relasi = String(t.relasi || '').toLowerCase();
  const sisa = sisaMenitLabel(t.sisa_detik);
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

/* Ambil tugas H-1 jam: belum selesai, sisa waktu 50-60 menit, belum pernah dikirim.
 * LEFT JOIN user_task_status supaya user yang belum pernah menandai status
 * (belum punya baris status) tetap dianggap "belum" dan ikut diingatkan. */
async function getImminentTasks() {
  const conn = await getConnection();
  try {
    const result = await conn.query(
      `SELECT u.id_user AS "id_user", u.nama AS "nama", u.no_wa AS "no_wa", u.relasi AS "relasi",
              t.id_tugas AS "id_tugas", t.judul AS "judul", t.kategori AS "kategori",
              t.sumber_web AS "sumber_web",
              EXTRACT(EPOCH FROM (t.deadline - NOW())) AS "sisa_detik"
       FROM users u
       CROSS JOIN tasks t
       LEFT JOIN user_task_status uts
         ON uts.id_user = u.id_user AND uts.id_tugas = t.id_tugas
       LEFT JOIN notification_log nl
         ON nl.id_user = u.id_user AND nl.id_tugas = t.id_tugas AND nl.jenis = 'wa_h1jam'
       WHERE u.role = 'user'
         AND u.preferensi = 'nomor_wa'
         AND u.no_wa IS NOT NULL
         AND COALESCE(uts.status, 'belum') != 'selesai'
         AND t.deadline >  NOW() + INTERVAL '50 minutes'
         AND t.deadline <= NOW() + INTERVAL '60 minutes'
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

async function runCheck() {
  let tasks;
  try {
    tasks = await getImminentTasks();
  } catch (err) {
    console.error('[WA BOT] ambil daftar tugas H-1 jam gagal:', sanitizeError(err));
    return;
  }
  if (!tasks || !tasks.length) return;

  console.log(`[WA BOT] Menemukan ${tasks.length} antrian notifikasi H-1 jam.`);
  const conn = await getConnection();
  try {
    for (const t of tasks) {
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
        console.log(`[WA BOT] Mengirim pesan H-1 jam ke nomor ${chatId} (user=${t.id_user}, tugas #${t.id_tugas} "${t.judul}")...`);
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
    console.log('[WA BOT] Antrian notifikasi H-1 jam selesai diproses.');
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
  console.log(`[WA BOT] Trigger instan (${label}): cek tugas H-1 jam sekarang...`);
  runCheck().catch((err) => console.error(`[WA BOT] trigger instan (${label}) error:`, sanitizeError(err)));
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

  // Cron tiap 1 menit: cek mandiri dari DB, tidak bergantung sesi login frontend.
  cron.schedule('* * * * *', () => {
    console.log('[WA BOT] cron cek deadline H-1 jam...');
    runCheck().catch((err) => console.error('[WA BOT] cron error:', sanitizeError(err)));
  });
}

module.exports = { startBot, runCheck, triggerInstantCheck, client, getBotStatus };
