const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const XLSX = require('xlsx');

const { initPool, getConnection, closePool, sanitizeError, getPool } = require('./db');
const { startBot, getBotStatus, triggerInstantCheck, runCheck } = require('./bot');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const PORT = process.env.PORT || 3000;

const ALLOWED_RINGTONES = [
  '/Sounds/ringtone1.mp3',
  '/Sounds/ringtone2.mp3',
  '/Sounds/ringtone3.mp3',
  '/sounds/ringtone1.mp3',
  '/sounds/ringtone2.mp3',
  '/sounds/ringtone3.mp3',
];
const DEFAULT_RINGTONE = '/Sounds/ringtone1.mp3';

app.get('/api/bot/qr', (req, res) => {
  const { ready, qrDataUrl } = getBotStatus();
  if (ready) return res.send('Bot WhatsApp sudah terhubung. Tidak perlu scan lagi.');
  if (!qrDataUrl) return res.send('QR belum siap, refresh beberapa detik lagi...');
  res.send(`<img src="${qrDataUrl}" alt="QR WhatsApp" />`);
});

/* Trigger manual pengiriman pengingat WA lewat URL browser (keperluan testing). */
app.get('/api/bot/force-trigger', async (req, res) => {
  if (process.env.ENABLE_BOT !== 'true') {
    return res.status(503).json({ ok: false, message: 'Bot WhatsApp tidak aktif. Set ENABLE_BOT=true dulu.' });
  }
  try {
    console.log('[WA BOT] Force-trigger dikirim lewat URL.');
    await runCheck();
    const { ready } = getBotStatus();
    return res.json({
      ok: ready,
      message: ready
        ? 'Trigger pengingat WA sudah dijalankan. Cek log server untuk hasilnya.'
        : 'Bot belum ready (scan QR di /api/bot/qr dulu). Trigger dijalankan, tapi antrian ditunda.'
    });
  } catch (err) {
    console.error('FORCE TRIGGER ERR:', sanitizeError(err));
    return res.status(500).json({ ok: false, message: 'Trigger gagal dijalankan.' });
  }
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

/* ===== Migrasi runtime: skema rekap & arsip =====
 * Dijalankan sekali saat startup supaya DB live (Supabase/PostgreSQL) otomatis
 * punya kolom is_archived/archived_at/created_at + tabel task_completions. */
async function ensureRecapSchema() {
  const client = await getConnection();
  try {
    await client.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE`);
    await client.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP`);
    await client.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW()`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS task_completions (
        id_completion BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        id_tugas      BIGINT NOT NULL REFERENCES tasks(id_tugas) ON DELETE CASCADE,
        id_user       BIGINT NOT NULL REFERENCES users(id_user) ON DELETE CASCADE,
        completed_at  TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT uk_task_completions UNIQUE (id_tugas, id_user)
      )`);
    // Tambah jenis 'H-1_RELASI' ke CHECK constraint notification_log
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'chk_nl_jenis'
        ) THEN
          ALTER TABLE notification_log DROP CONSTRAINT chk_nl_jenis;
        END IF;
      END $$`);
    await client.query(`
      ALTER TABLE notification_log ADD CONSTRAINT chk_nl_jenis
        CHECK (jenis IN ('wa_h1jam', 'ring_h1jam', 'pwa_h1hari', 'H-1_RELASI'))`);
    console.log('Skema rekap & arsip terverifikasi (H-1_RELASI added).');
  } finally {
    client.release();
  }
}

/* Susun workbook Excel dari array of objects (header = key). */
function buildXlsxBuffer(data, sheetName) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(data.length ? data : [{}]);
  ws['!cols'] = data.length
    ? Object.keys(data[0]).map(() => ({ wch: 20 }))
    : undefined;
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function sendXlsx(res, buffer, filename) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.send(buffer);
}

// =========================================================================
// ENDPOINT REGISTER (DILENGKAPI VALIDASI NPM & EMAIL)
// =========================================================================
app.post('/api/auth/register', async (req, res) => {
  const { npm, nama, email, password, no_wa, preferensi, relasi, selected_ringtone } = req.body;
  
  if (!npm || !nama || !email || !password || !preferensi) {
    return res.status(400).json({ error: 'npm, nama, email, password, preferensi wajib diisi' });
  }

  // --- VALIDASI TAMBAHAN SERVER-SIDE ---
  // 1. Validasi Format NPM: Wajib 6 - 10 digit angka saja (mencegah teks aneh / SQL Injection payload)
  const npmRegex = /^[0-9]{6,10}$/;
  if (!npmRegex.test(npm)) {
    return res.status(400).json({ error: 'Waduh, NPM kamu harus 6 sampai 10 digit angka ya!' });
  }

  // 2. Validasi Format Email
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Format email tidak valid!' });
  }

  // 3. Validasi Preferensi Notifikasi & Relasi
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
    let resolvedRingtone = null;
    if (preferensi === 'nada_dering') {
      resolvedRingtone = ALLOWED_RINGTONES.includes(selected_ringtone) 
        ? selected_ringtone.replace('/sounds/', '/Sounds/') 
        : DEFAULT_RINGTONE;
    }

    const result = await client.query(
      `INSERT INTO users (npm, nama, email, password, role, no_wa, preferensi, relasi, selected_ringtone)
       VALUES ($1, $2, $3, $4, 'user', $5, $6, $7, $8)
       RETURNING id_user`,
      [npm, nama, email, password, resolvedNoWa, preferensi, resolvedRelasi, resolvedRingtone]
    );
    const idUser = result.rows[0].id_user;
    // Mahasiswa baru: cek instan apakah ada tugas lama yang deadlinenya sudah H-1 jam
    if (process.env.ENABLE_BOT === 'true') triggerInstantCheck('register');
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
    
    let userData = result.rows[0];
    if (userData.selected_ringtone) {
      userData.selected_ringtone = userData.selected_ringtone.replace('/sounds/', '/Sounds/');
    }
    
    return res.json({ message: 'Login berhasil', user: userData });
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
       WHERE COALESCE(t.is_archived, FALSE) = FALSE
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

    // Deadline: dukung 'DD/MM/YYYY HH:mm' dan 'YYYY-MM-DDTHH:mm' (datetime-local)
    const dlSlash = deadline.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}:\d{2})$/);
    const dlIso = deadline.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})$/);
    let isoDeadline;
    if (dlSlash) {
      isoDeadline = `${dlSlash[3]}-${dlSlash[1]}-${dlSlash[2]}T${dlSlash[4]}`;
    } else if (dlIso) {
      isoDeadline = deadline;
    } else {
      return res.status(400).json({ error: 'Format deadline tidak dikenali. Gunakan DD/MM/YYYY HH:mm atau YYYY-MM-DDTHH:mm' });
    }

    const result = await client.query(
      `INSERT INTO tasks (judul, deskripsi, kategori, sumber_web, deadline, created_by, is_archived)
       VALUES ($1, $2, $3, $4, TO_TIMESTAMP($5, 'YYYY-MM-DD"T"HH24:MI'), $6, FALSE)
       RETURNING id_tugas`,
      [judul, resolvedDeskripsi, kategori, resolvedSumberWeb, isoDeadline, res.locals.idUser]
    );
    const idTugas = result.rows[0].id_tugas;
    // Tugas baru: cek instan kalau deadlinenya langsung masuk rentang H-1 jam
    if (process.env.ENABLE_BOT === 'true') triggerInstantCheck('tugas-baru');
    return res.status(201).json({ message: 'Tugas berhasil dibuat', id_tugas: idTugas });
  } catch (err) {
    console.error('Error insert task:', err);
    return res.status(500).json({
      error: 'Gagal menyimpan tugas',
      detail: err.message
    });
  } finally {
    if (client) client.release();
  }
});

/* ===== Rekap & Arsip ===== */

/* Admin: tarik semua tugas aktif ke arsip + unduh Excel rekap lengkap
 * (semua mahasiswa x semua tugas, termasuk yang terarsip). */
app.post('/api/admin/archive-all', authRole('admin'), async (req, res) => {
  let client;
  try {
    client = await getConnection();
    // Tolak dulu kalau tidak ada tugas sama sekali — lebih jelas daripada
    // mengunduh file Excel kosong.
    const cek = await client.query(`SELECT COUNT(*)::int AS "jumlah" FROM tasks`);
    if (cek.rows[0].jumlah === 0) {
      return res.status(400).json({ error: 'Belum ada tugas yang bisa direkap.' });
    }

    const arc = await client.query(
      `UPDATE tasks SET is_archived = TRUE, archived_at = NOW()
       WHERE COALESCE(is_archived, FALSE) = FALSE`
    );
    console.log(`REKAP: ${arc.rowCount} tugas ditarik ke arsip oleh admin id=${res.locals.idUser}.`);

    const rows = await client.query(
      `SELECT u.nama AS "mahasiswa",
              t.judul AS "judul",
              t.kategori AS "kategori",
              CASE WHEN COALESCE(uts.status, 'belum') = 'selesai' THEN 'Selesai' ELSE 'Terlewat' END AS "status",
              a.nama AS "admin_upload",
              TO_CHAR(t.created_at, 'YYYY-MM-DD HH24:MI') AS "waktu_upload",
              TO_CHAR(t.deadline, 'YYYY-MM-DD HH24:MI') AS "deadline",
              COALESCE(TO_CHAR(tc.completed_at, 'YYYY-MM-DD HH24:MI'), '-') AS "waktu_selesai"
       FROM tasks t
       JOIN users a ON a.id_user = t.created_by
       CROSS JOIN users u
       LEFT JOIN user_task_status uts ON uts.id_tugas = t.id_tugas AND uts.id_user = u.id_user
       LEFT JOIN task_completions tc ON tc.id_tugas = t.id_tugas AND tc.id_user = u.id_user
       WHERE u.role = 'user'
       ORDER BY u.nama ASC, t.deadline ASC`
    );
    const data = rows.rows.map((r) => ({
      'Nama Mahasiswa': r.mahasiswa,
      'Judul Tugas': r.judul,
      'Kategori': r.kategori,
      'Status': r.status,
      'Admin Upload': r.admin_upload,
      'Waktu Upload': r.waktu_upload,
      'Deadline': r.deadline,
      'Waktu Klik Selesai': r.waktu_selesai,
    }));
    const stamp = new Date().toISOString().slice(0, 10);
    return sendXlsx(res, buildXlsxBuffer(data, 'Rekap Tugas'), `rekap-semua-tugas-${stamp}.xlsx`);
  } catch (err) {
    console.error('ARCHIVE-ALL ERR:', sanitizeError(err));
    return res.status(500).json({ error: 'Terjadi kesalahan server' });
  } finally {
    if (client) client.release();
  }
});

/* Ambil baris riwayat tugas milik satu admin dari sudut pandang satu mahasiswa. */
async function getRiwayatRows(client, idAdmin, idUser) {
  const adminResult = await client.query(
    `SELECT id_user AS "id_admin", nama AS "nama_admin" FROM users
     WHERE id_user = $1 AND role = 'admin'`,
    [idAdmin]
  );
  if (adminResult.rows.length === 0) return null;

  const rows = await client.query(
    `SELECT t.id_tugas AS "id_tugas",
            t.judul AS "judul",
            t.kategori AS "kategori",
            CASE WHEN COALESCE(uts.status, 'belum') = 'selesai' THEN 'Selesai' ELSE 'Terlewat' END AS "status",
            TO_CHAR(t.deadline, 'YYYY-MM-DD HH24:MI') AS "deadline",
            COALESCE(TO_CHAR(tc.completed_at, 'YYYY-MM-DD HH24:MI'), '-') AS "waktu_selesai",
            COALESCE(t.is_archived, FALSE) AS "is_archived"
     FROM tasks t
     LEFT JOIN user_task_status uts ON uts.id_tugas = t.id_tugas AND uts.id_user = $2
     LEFT JOIN task_completions tc ON tc.id_tugas = t.id_tugas AND tc.id_user = $2
     WHERE t.created_by = $1
     ORDER BY t.deadline ASC`,
    [idAdmin, idUser]
  );
  return { admin: adminResult.rows[0], tugas: rows.rows };
}

/* User: ringkasan admin yang pernah upload tugas + progress pengerjaan sendiri. */
app.get('/api/recap/summary', authRole('user'), async (req, res) => {
  let client;
  try {
    client = await getConnection();
    const rows = await client.query(
      `SELECT a.id_user AS "id_admin", a.nama AS "nama_admin",
              COUNT(t.id_tugas)::int AS "total",
              COALESCE(SUM(CASE WHEN uts.status = 'selesai' THEN 1 ELSE 0 END), 0)::int AS "selesai"
       FROM tasks t
       JOIN users a ON a.id_user = t.created_by AND a.role = 'admin'
       LEFT JOIN user_task_status uts ON uts.id_tugas = t.id_tugas AND uts.id_user = $1
       GROUP BY a.id_user, a.nama
       ORDER BY a.nama ASC`,
      [res.locals.idUser]
    );
    return res.json({ admins: rows.rows });
  } catch (err) {
    console.error('RECAP SUMMARY ERR:', sanitizeError(err));
    return res.status(500).json({ error: 'Terjadi kesalahan server' });
  } finally {
    if (client) client.release();
  }
});

/* User: rincian riwayat tugas dari satu admin. */
app.get('/api/recap/admin/:id', authRole('user'), async (req, res) => {
  const idAdmin = Number(req.params.id);
  if (isNaN(idAdmin)) {
    return res.status(400).json({ error: 'ID admin tidak valid' });
  }
  let client;
  try {
    client = await getConnection();
    const data = await getRiwayatRows(client, idAdmin, res.locals.idUser);
    if (!data) return res.status(404).json({ error: 'Admin tidak ditemukan' });
    return res.json(data);
  } catch (err) {
    console.error('RECAP DETAIL ERR:', sanitizeError(err));
    return res.status(500).json({ error: 'Terjadi kesalahan server' });
  } finally {
    if (client) client.release();
  }
});

/* User: unduh Excel detail riwayat tugas dari satu admin. */
app.get('/api/recap/admin/:id/export', authRole('user'), async (req, res) => {
  const idAdmin = Number(req.params.id);
  if (isNaN(idAdmin)) {
    return res.status(400).json({ error: 'ID admin tidak valid' });
  }
  let client;
  try {
    client = await getConnection();
    const data = await getRiwayatRows(client, idAdmin, res.locals.idUser);
    if (!data) return res.status(404).json({ error: 'Admin tidak ditemukan' });
    if (!data.tugas.length) {
      return res.status(400).json({ error: 'Belum ada tugas dari admin ini yang bisa diekspor.' });
    }

    const me = await client.query(
      `SELECT nama AS "nama" FROM users WHERE id_user = $1`,
      [res.locals.idUser]
    );
    const namaMahasiswa = me.rows.length ? me.rows[0].nama : '-';

    const rowsOut = data.tugas.map((t) => ({
      'Nama Mahasiswa': namaMahasiswa,
      'Judul Tugas': t.judul,
      'Kategori': t.kategori,
      'Status': t.status,
      'Admin Upload': data.admin.nama_admin,
      'Deadline': t.deadline,
      'Waktu Klik Selesai': t.waktu_selesai,
    }));
    const slug = String(data.admin.nama_admin || 'admin')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'admin';
    const stamp = new Date().toISOString().slice(0, 10);
    return sendXlsx(res, buildXlsxBuffer(rowsOut, 'Riwayat Tugas'), `riwayat-tugas-${slug}-${stamp}.xlsx`);
  } catch (err) {
    console.error('RECAP EXPORT ERR:', sanitizeError(err));
    return res.status(500).json({ error: 'Terjadi kesalahan server' });
  } finally {
    if (client) client.release();
  }
});

/* Hapus tugas — hanya admin PEMBUAT tugas tersebut (ownership control). */
app.delete('/api/tasks/:id', authRole('admin'), async (req, res) => {
  const idTugas = Number(req.params.id);
  if (isNaN(idTugas)) {
    return res.status(400).json({ error: 'ID tugas tidak valid' });
  }

  let client;
  try {
    client = await getConnection();
    const cek = await client.query(
      `SELECT created_by FROM tasks WHERE id_tugas = $1`,
      [idTugas]
    );
    if (cek.rows.length === 0) {
      return res.status(404).json({ error: 'Tugas tidak ditemukan' });
    }
    if (Number(cek.rows[0].created_by) !== Number(res.locals.idUser)) {
      return res.status(403).json({ error: 'Kamu cuma bisa hapus tugas yang kamu buat sendiri' });
    }

    // Hapus baris anak dulu (FK tanpa ON DELETE CASCADE), lalu tugasnya.
    await client.query('BEGIN');
    await client.query('DELETE FROM notification_log WHERE id_tugas = $1', [idTugas]);
    await client.query('DELETE FROM user_task_status WHERE id_tugas = $1', [idTugas]);
    await client.query('DELETE FROM tasks WHERE id_tugas = $1', [idTugas]);
    await client.query('COMMIT');

    return res.json({ message: 'Tugas berhasil dihapus' });
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('DELETE TASK ERR:', sanitizeError(err));
    return res.status(500).json({ error: 'Terjadi kesalahan server' });
  } finally {
    if (client) client.release();
  }
});

app.get('/api/tasks/:id/recap', authRole('admin'), async (req, res) => {
  const idTugas = Number(req.params.id);
  if (isNaN(idTugas)) {
    return res.status(400).json({ error: 'ID tugas tidak valid' });
  }

  let client;
  try {
    client = await getConnection();

    const taskResult = await client.query(
      `SELECT id_tugas AS "id_tugas", judul AS "judul" FROM tasks WHERE id_tugas = $1`,
      [idTugas]
    );
    if (taskResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tugas tidak ditemukan' });
    }

    const sudahResult = await client.query(
      `SELECT u.id_user AS "id_user", u.nama AS "nama"
       FROM users u
       JOIN user_task_status uts ON uts.id_user = u.id_user
       WHERE uts.id_tugas = $1 AND uts.status = 'selesai' AND u.role = 'user'
       ORDER BY u.nama ASC`,
      [idTugas]
    );

    const belumResult = await client.query(
      `SELECT u.id_user AS "id_user", u.nama AS "nama"
       FROM users u
       WHERE u.role = 'user'
         AND u.id_user NOT IN (
           SELECT id_user FROM user_task_status
           WHERE id_tugas = $1 AND status = 'selesai'
         )
       ORDER BY u.nama ASC`,
      [idTugas]
    );

    return res.json({
      task: taskResult.rows[0],
      sudah: sudahResult.rows,
      belum: belumResult.rows,
    });
  } catch (err) {
    console.error('GET RECAP ERR:', sanitizeError(err), 'id_tugas=', idTugas);
    return res.status(500).json({ error: 'Terjadi kesalahan server' });
  } finally {
    if (client) client.release();
  }
});

app.patch('/api/tasks/:id/done', authRole('user', 'admin'), async (req, res) => {
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
    // Riwayat waktu klik "Mark As Done" untuk keperluan rekap/arsip
    await client.query(
      `INSERT INTO task_completions (id_tugas, id_user)
       VALUES ($1, $2)
       ON CONFLICT (id_tugas, id_user) DO NOTHING`,
      [idTugas, res.locals.idUser]
    );
    return res.json({ message: 'Tugas ditandai selesai', id_tugas: idTugas, status: 'selesai' });
  } catch (err) {
    console.error('TOGGLE DONE ERR:', sanitizeError(err), 'id_tugas=', idTugas, 'id_user=', res.locals.idUser);
    return res.status(500).json({ error: 'Terjadi kesalahan server' });
  } finally {
    if (client) client.release();
  }
});

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
    let resolvedRingtone = null;
    if (preferensi === 'nada_dering') {
      resolvedRingtone = ALLOWED_RINGTONES.includes(selected_ringtone) 
        ? selected_ringtone.replace('/sounds/', '/Sounds/') 
        : DEFAULT_RINGTONE;
    }

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
    await ensureRecapSchema();

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