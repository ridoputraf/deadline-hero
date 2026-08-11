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
  } catch (err) {
    console.error('[BOT] gagal membuat QR image:', err.message);
  }
});

client.on('auth_failure', (msg) => console.error('[BOT] auth gagal:', msg));

client.on('disconnected', (reason) => {
  ready = false;
  qrDataUrl = null;
  console.warn('[BOT] disconnect:', reason);
});

function getBotStatus() {
  return { ready, qrDataUrl };
}

function normalizePhone(raw) {
  if (!raw) return null;
  let s = String(raw).replace(/\D/g, '');
  if (!s) return null;
  if (s.startsWith('62')) return s + '@c.us';
  if (s.startsWith('0')) return '62' + s.slice(1) + '@c.us';
  return '62' + s + '@c.us';
}

const PESAN_RELASI = {
  pacar: 'Cuma mau ngingetin nih, tugas kamu kayaknya ada yang belum kelar deh, dan deadline-nya udah lewat 1 jam yang lalu. Yuk dikerjain dulu yuk, biar gak numpuk! Semangat ya.',
  keluarga: 'Halo! Ini pesan otomatis dari Bot Tugas. Mau ngingetin kalau anggota keluarga kita yang satu ini kayaknya lupa atau belum sempat ngerjain tugas, deadline-nya udah lewat 1 jam lalu nih. Tolong diingatkan ya, terima kasih!',
  sahabat: 'Halo bestie! Bot Tugas bilang tugas lu statusnya belum beres nih, dan udah lewat 1 jam dari deadline. Kerjain dulu sana, habis itu baru lanjut nge-game/rebahan lagi!',
};

function buildMessage(tugas) {
  const relasi = String(tugas.relasi || '').toLowerCase();
  return PESAN_RELASI[relasi]
    || 'Hai ini adalah Bot Tugas, Orang terdekat Kamu belum mengerjakan tugas, deadlinenya sudah lewat 1 jam yang lalu.';
}

async function getImminentTasks() {
  const client = await getConnection();
  try {
    // Hanya user preferensi nomor_wa, tugas yang belum selesai, dan sudah lewat
    // deadline minimal 1 jam. Anti-spam: skip kalau sudah pernah dikirim (notification_log).
    const result = await client.query(
      `SELECT u.id_user AS "id_user", u.no_wa AS "whatsapp", u.relasi AS "relasi",
              t.id_tugas AS "id_tugas", t.judul AS "judul"
       FROM users u
       JOIN user_task_status uts ON uts.id_user = u.id_user
       JOIN tasks t ON t.id_tugas = uts.id_tugas
       WHERE u.preferensi = 'nomor_wa'
         AND u.no_wa IS NOT NULL
         AND uts.status != 'selesai'
         AND t.deadline <= NOW() - INTERVAL '1 hour'
         AND NOT EXISTS (
           SELECT 1 FROM notification_log nl
           WHERE nl.id_user = u.id_user AND nl.id_tugas = t.id_tugas AND nl.jenis = 'wa_h1jam'
         )`
    );
    return result.rows;
  } finally {
    client.release();
  }
}

async function markNotified(client, idUser, idTugas) {
  await client.query(
    `INSERT INTO notification_log (id_user, id_tugas, jenis) VALUES ($1, $2, 'wa_h1jam')`,
    [idUser, idTugas]
  );
}

async function runCheck() {
  let tasks;
  try {
    tasks = await getImminentTasks();
  } catch (err) {
    console.error('[BOT] ambil tugas gagal:', sanitizeError(err));
    return;
  }
  if (!tasks || !tasks.length) return;

  const conn = await getConnection();
  try {
    for (const t of tasks) {
      if (!t.whatsapp) continue;
      if (!ready) {
        console.warn(`[BOT] belum ready, skip user=${t.id_user}`);
        continue;
      }
      const chatId = normalizePhone(t.whatsapp);
      try {
        const ok = await client.isRegisteredUser(chatId);
        if (!ok) {
          console.warn(`[BOT] nomor tidak terdaftar: ${chatId}`);
          continue;
        }
        await client.sendMessage(chatId, buildMessage(t));
        await markNotified(conn, t.id_user, t.id_tugas);
        console.log(`[BOT] terkirim ${chatId} (tugas #${t.id_tugas})`);
      } catch (err) {
        console.error(`[BOT] kirim gagal ${chatId}:`, sanitizeError(err));
      }
    }
  } finally {
    conn.release();
  }
}

function startBot() {
  // Langsung hapus paksa file lock spesifik jika ada di dalam folder sesi
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
        console.log(`[BOT] Sukses menghapus file kunci: ${lockFile}`);
      }
    } catch (e) {
      // Abaikan jika gagal
    }
  }

  // Jalankan bot
  client.initialize();

  client.on('ready', () => {
    ready = true;
    qrDataUrl = null;
    console.log('[BOT] WhatsApp siap');
    console.log('[BOT] Menjalankan pengecekan instan...');
    runCheck().catch((err) => console.error('[BOT] instan cek error:', sanitizeError(err)));
  });

  cron.schedule('*/15 * * * *', () => {
    console.log('[BOT] cron cek deadline...');
    runCheck().catch((err) => console.error('[BOT] cron error:', sanitizeError(err)));
  });
}

module.exports = { startBot, runCheck, client, getBotStatus };