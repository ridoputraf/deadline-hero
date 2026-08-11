const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const { initPool, getConnection, closePool, sanitizeError, getPool } = require('./db');
const { startBot, getBotStatus } = require('./bot');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const PORT = process.env.PORT || 3000;

// Daftar nada dering yang diizinkan (Disesuaikan dengan nama folder /Sounds/)
const ALLOWED_RINGTONES = [
  '/Sounds/ringtone1.mp3',
  '/Sounds/ringtone2.mp3',
  '/Sounds/ringtone3.mp3',
];
const DEFAULT_RINGTONE = ALLOWED_RINGTONES[0];

// Endpoint untuk scan QR WhatsApp
app.get('/api/bot/qr', (req, res) => {
  const { ready, qrDataUrl } = getBotStatus();
  if (ready) return res.send('Bot WhatsApp sudah terhubung ✅ Tidak perlu scan lagi.');
  if (!qrDataUrl) return res.send('QR belum siap, refresh beberapa detik lagi...');
  res.send(`<img src="${qrDataUrl}" alt="QR WhatsApp" />`);
});

app.use(async (req, res, next) => {
  const pool = getPool();
  if (!pool) {
    console.error('DB pool unavailable');
    return res.status(503).json({ error: 'Database unavailable' });
  }
  next();
});

function authRole(...allowedRoles) {
  return (req, res, next) => {
    const role = req.header('x-user-role');
    const idUser = req.header('x-user-id');
    if (!role || !idUser) {
      return res.status(401).json({ error: 'Unauthorized: missing credentials' });
    }
    if (!allowedRoles.includes(role)) {
      return res.status(403).json({ error: 'Forbidden: insufficient role' });
    }
    res.locals.idUser = Number(idUser);
    res.locals.role = role;
    next();
  };
}

app.post('/api/auth/register', async (req, res) => {
  const { npm, nama, email, password, no_wa, preferensi, relasi, selected_ringtone } = req.body;
  if (!npm || !nama || !email || !password || !preferensi) {
    return res.status(400).json({ error: 'npm, nama, email, password, preferensi wajib diisi' });
  }
  if (!['nomor_wa', 'nada_dering'].includes(preferensi)) {
    return res.status(400).json({ error: 'preferensi harus nomor_wa atau nada_dering' });
  }
  if (preferensi === 'nomor_wa' && !no_wa) {
    return res.status(400).json({ error: 'no_wa wajib diisi jika preferensi nomor_wa' });
  }
  if (relasi && !['pacar', 'keluarga', 'sahabat'].includes(relasi)) {
    return res.status(400).json({ error: 'relasi harus pacar, keluarga, atau sahabat' });
  }
  if (selected_ringtone && !ALLOWED_RINGTONES.includes(selected_ringtone)) {
    return res.status(400).json({ error: 'selected_ringtone tidak valid' });
  }

  let client;
  try {
    client = await getConnection();
    const exists = await client.query(
      'SELECT id_user FROM users WHERE email = $1',
      [email]
    );
    if (exists.rows.length > 0) {
      return res.status(409).json({ error: 'Email sudah terdaftar' });
    }

    const resolvedNoWa = no_wa || null;
    const resolvedRelasi = preferensi === 'nomor_wa' ? (relasi || null) : null;
    const resolvedRingtone = preferensi === 'nada_dering'
      ? (ALLOWED_RINGTONES.includes(selected_ringtone) ? selected_ringtone : DEFAULT_RINGTONE)
      : null;

    const result = await client.query(
      `INSERT INTO users (npm, nama, email, password, role, no_wa, preferensi, relasi, selected_ringtone)
       VALUES ($1, $2, $3, $4, 'user', $5, $6, $7, $8)
       RETURNING id_user`,
      [npm, nama, email, password, resolvedNoWa, preferensi, resolvedRelasi, resolvedRingtone]
    );
    const idUser = result.rows[0].id_user;
    return res.status(201).json({ message: 'Registrasi berhasil', id_user: idUser });
  } catch (err) {
    console.error('REGISTER ERR:', sanitizeError(err));
    return res.status(500).json({ error: 'Terjadi kesalahan server' });
  } finally {
    if (client) client.release();
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email dan password wajib diisi' });
  }

  let client;
  try {
    client = await getConnection();
    const result = await client.query(
      `SELECT id_user AS "id_user", npm AS "npm", nama AS "nama", email AS "email",
              role AS "role", no_wa AS "no_wa", preferensi AS "preferensi", relasi AS "relasi",
              COALESCE(selected_ringtone, '${DEFAULT_RINGTONE}') AS "selected_ringtone"
       FROM users WHERE email = $1 AND password = $2`,
      [email, password]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Email atau password salah' });
    }
    return res.json({ message: 'Login berhasil', user: result.rows[0] });
  } catch (err) {
    console.error('LOGIN ERR:', sanitizeError(err));
    return res.status(500).json({ error: 'Terjadi kesalahan server' });
  } finally {
    if (client) client.release();
  }
});

app.get('/api/tasks', authRole('user', 'admin'), async (req, res) => {
  let client;
  try {
    client = await getConnection();
    const result = await client.query(
      `SELECT t.id_tugas AS "id_tugas", t.judul AS "judul", t.deskripsi AS "deskripsi",
              t.kategori AS "kategori", t.sumber_web AS "sumber_web",
              TO_CHAR(t.deadline, 'YYYY-MM-DD"T"HH24:MI:SS') AS "deadline",
              t.created_by AS "created_by",
              COALESCE(uts.status, 'belum') AS "status"
       FROM tasks t
       LEFT JOIN user_task_status uts
         ON uts.id_tugas = t.id_tugas AND uts.id_user = $1
       ORDER BY t.deadline ASC`,
      [res.locals.idUser]
    );

    const grouped = { Tugas: [], UTS: [], UAS: [] };
    for (const row of result.rows) {
      if (grouped[row.kategori]) {
        grouped[row.kategori].push(row);
      }
    }
    return res.json(grouped);
  } catch (err) {
    console.error('GET TASKS ERR:', sanitizeError(err));
    return res.status(500).json({ error: 'Terjadi kesalahan server' });
  } finally {
    if (client) client.release();
  }
});

app.post('/api/tasks', authRole('admin'), async (req, res) => {
  const { judul, deskripsi, kategori, sumber_web, deadline } = req.body;
  if (!judul || !kategori || !deadline) {
    return res.status(400).json({ error: 'judul, kategori, deadline wajib diisi' });
  }
  if (!['Tugas', 'UTS', 'UAS'].includes(kategori)) {
    return res.status(400).json({ error: 'kategori harus Tugas, UTS, atau UAS' });
  }
  if (kategori === 'Tugas' && !sumber_web) {
    return res.status(400).json({ error: 'sumber_web wajib diisi untuk kategori Tugas' });
  }

  let client;
  try {
    client = await getConnection();
    const resolvedDeskripsi = deskripsi || null;
    const resolvedSumberWeb = kategori === 'Tugas' ? sumber_web : null;

    const result = await client.query(
      `INSERT INTO tasks (judul, deskripsi, kategori, sumber_web, deadline, created_by)
       VALUES ($1, $2, $3, $4, TO_TIMESTAMP($5, 'YYYY-MM-DD"T"HH24:MI:SS'), $6)
       RETURNING id_tugas`,
      [judul, resolvedDeskripsi, kategori, resolvedSumberWeb, deadline, res.locals.idUser]
    );
    const idTugas = result.rows[0].id_tugas;
    return res.status(201).json({ message: 'Tugas berhasil dibuat', id_tugas: idTugas });
  } catch (err) {
    console.error('CREATE TASK ERR:', sanitizeError(err));
    return res.status(500).json({ error: 'Terjadi kesalahan server' });
  } finally {
    if (client) client.release();
  }
});

app.patch('/api/tasks/:id/done', authRole('user'), async (req, res) => {
  const idTugas = Number(req.params.id);
  if (isNaN(idTugas)) {
    return res.status(400).json({ error: 'ID tugas tidak valid' });
  }

  let client;
  try {
    client = await getConnection();
    const cur = await client.query(
      `SELECT status AS "status" FROM user_task_status WHERE id_user = $1 AND id_tugas = $2`,
      [res.locals.idUser, idTugas]
    );

    const already = cur.rows.length > 0 && cur.rows[0].status === 'selesai';
    if (already) {
      return res.json({ message: 'Sudah selesai', id_tugas: idTugas, status: 'selesai' });
    }

    await client.query(
      `INSERT INTO user_task_status (id_user, id_tugas, status, updated_at)
       VALUES ($1, $2, 'selesai', CURRENT_TIMESTAMP)
       ON CONFLICT (id_user, id_tugas)
       DO UPDATE SET status = 'selesai', updated_at = CURRENT_TIMESTAMP`,
      [res.locals.idUser, idTugas]
    );
    return res.json({ message: 'Tugas ditandai selesai', id_tugas: idTugas, status: 'selesai' });
  } catch (err) {
    console.error('TOGGLE DONE ERR:', sanitizeError(err), 'id_tugas=', idTugas, 'id_user=', res.locals.idUser);
    return res.status(500).json({ error: 'Terjadi kesalahan server' });
  } finally {
    if (client) client.release();
  }
});

// FIX GANTI PASSWORD: Mengubah password_plain menjadi password
app.patch('/api/auth/change-password', authRole('user', 'admin'), async (req, res) => {
  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ error: 'password wajib diisi' });
  }

  let client;
  try {
    client = await getConnection();
    await client.query(
      `UPDATE users SET password = $1 WHERE id_user = $2`,
      [password, res.locals.idUser]
    );
    return res.json({ message: 'Password diperbarui' });
  } catch (err) {
    console.error('CHANGE PASSWORD ERR:', sanitizeError(err));
    return res.status(500).json({ error: 'Terjadi kesalahan server' });
  } finally {
    if (client) client.release();
  }
});

// FIX GANTI EMAIL
app.patch('/api/auth/change-email', authRole('user', 'admin'), async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'email wajib diisi' });
  }

  let client;
  try {
    client = await getConnection();
    const exists = await client.query(
      `SELECT id_user AS "id_user" FROM users WHERE email = $1`,
      [email]
    );
    if (exists.rows.length > 0) {
      return res.status(409).json({ error: 'Email sudah digunakan' });
    }
    await client.query(
      `UPDATE users SET email = $1 WHERE id_user = $2`,
      [email, res.locals.idUser]
    );
    return res.json({ message: 'Email diperbarui' });
  } catch (err) {
    console.error('CHANGE EMAIL ERR:', sanitizeError(err));
    return res.status(500).json({ error: 'Terjadi kesalahan server' });
  } finally {
    if (client) client.release();
  }
});

app.patch('/api/auth/preferences', authRole('user', 'admin'), async (req, res) => {
  const { preferensi, no_wa, relasi, selected_ringtone } = req.body;
  if (!['nomor_wa', 'nada_dering'].includes(preferensi)) {
    return res.status(400).json({ error: 'preferensi harus nomor_wa atau nada_dering' });
  }
  if (preferensi === 'nomor_wa' && !no_wa) {
    return res.status(400).json({ error: 'no_wa wajib diisi jika preferensi nomor_wa' });
  }
  if (relasi && !['pacar', 'keluarga', 'sahabat'].includes(relasi)) {
    return res.status(400).json({ error: 'relasi harus pacar, keluarga, atau sahabat' });
  }
  if (selected_ringtone && !ALLOWED_RINGTONES.includes(selected_ringtone)) {
    return res.status(400).json({ error: 'selected_ringtone tidak valid' });
  }

  let client;
  try {
    client = await getConnection();
    const resolvedNoWa = preferensi === 'nomor_wa' ? no_wa : null;
    const resolvedRelasi = preferensi === 'nomor_wa' ? (relasi || null) : null;
    const resolvedRingtone = preferensi === 'nada_dering'
      ? (ALLOWED_RINGTONES.includes(selected_ringtone) ? selected_ringtone : DEFAULT_RINGTONE)
      : null;

    await client.query(
      `UPDATE users
       SET preferensi = $1,
           no_wa = $2,
           relasi = $3,
           selected_ringtone = $4
       WHERE id_user = $5`,
      [preferensi, resolvedNoWa, resolvedRelasi, resolvedRingtone, res.locals.idUser]
    );
    return res.json({ message: 'Preferensi diperbarui', selected_ringtone: resolvedRingtone });
  } catch (err) {
    console.error('PREFERENCES ERR:', sanitizeError(err));
    return res.status(500).json({ error: 'Terjadi kesalahan server' });
  } finally {
    if (client) client.release();
  }
});

app.use((err, req, res, next) => {
  console.error('UNHANDLED ERR:', sanitizeError(err));
  res.status(500).json({ error: 'Terjadi kesalahan server' });
});

async function start() {
  try {
    await initPool();
    console.log('Database connected successfully.');
    
    if (process.env.ENABLE_BOT === 'true') {
      startBot();
      console.log('WhatsApp Bot service started.');
    }
  } catch (err) {
    console.error('PERINGATAN: Gagal terhubung ke database saat startup:', err.message);
    console.error('Server tetap berjalan, namun fitur database akan gagal sampai kredensial diperbaiki.');
  }

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

start();

module.exports = app;