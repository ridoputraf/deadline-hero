(() => {
  'use strict';

  const API = '';

  // Daftar nada dering (file ada di /public/sounds/, disajikan di /sounds/...)
 // Daftar nada dering (file ada di /public/Sounds/)
  const RINGTONE_OPTIONS = [
    { value: '/Sounds/ringtone1.mp3', label: 'Bruno Mars - Risk It All' },
    { value: '/Sounds/ringtone2.mp3', label: 'Cameron Boyce - OBH Combi Sachet' },
    { value: '/Sounds/ringtone3.mp3', label: 'Sal Priadi - Foto Kita Blur' },
  ];
  const DEFAULT_RINGTONE = RINGTONE_OPTIONS[0].value;

  const state = {
    user: null,
    tasks: { Tugas: [], UTS: [], UAS: [] },
    activeTab: 'Tugas',
    activeView: 'tasks',
  };

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  /* ===== Theme ===== */
  function applyTheme(mode) {
    document.documentElement.classList.toggle('dark', mode === 'dark');
    localStorage.setItem('dlh-theme', mode);
    const btn = $('#menu-dropdown [data-action="toggle-theme"]');
    if (btn) btn.textContent = mode === 'dark' ? '☀️ Light Mode' : '🌙 Dark Mode';
  }
  applyTheme(localStorage.getItem('dlh-theme') || 'light');

  /* ===== Autoplay policy: audio hanya boleh play setelah user interact =====
   * Selama user belum pernah berinteraksi dengan halaman (klik/keydown),
   * browser modern akan memblokir audio.play() secara otomatis.
   * Kita simpan "pemicu yang tertunda" (pendingRingtone) di state global,
   * lalu memutarnya begitu interaksi pertama user terdeteksi.
   */
  let userInteracted = false;
  let pendingRingtone = null; // { src, id, judul } — menunggu interaksi pertama user

  function markInteracted() {
    if (userInteracted) return;
    userInteracted = true;
    window.removeEventListener('pointerdown', markInteracted);
    window.removeEventListener('keydown', markInteracted);

    if (pendingRingtone) {
      const { src, id, judul } = pendingRingtone;
      pendingRingtone = null;
      playRingtone(src);
      markRung(id);
      toast(`⏰ Pengingat: ${judul}`);
    }
  }
  window.addEventListener('pointerdown', markInteracted);
  window.addEventListener('keydown', markInteracted);

  /* ===== Audio engine (via elemen <audio>) =====
   * Instance audio yang sedang aktif disimpan di variabel `activeAudio` (state global
   * modul ini) supaya bisa dihentikan kapan saja dari fungsi lain, mis. saat
   * tombol "Mark As Done" ditekan.
   */
  let activeAudio = null;

  function stopRingtone() {
    if (activeAudio) {
      activeAudio.pause();
      activeAudio.currentTime = 0;
      activeAudio = null;
    }
  }

  function playRingtone(src) {
    stopRingtone();
    if (!src) {
      toast('Pilih nada dering terlebih dahulu!');
      return null;
    }

    // Ubah ke string & bersihkan spasi
    let formattedSrc = String(src).trim();

    // Pastikan diawali dengan slash /
    if (!formattedSrc.startsWith('/')) {
      formattedSrc = '/' + formattedSrc;
    }

    // PAKSA ganti /sounds/ menjadi /Sounds/ (case sensitivity fix untuk Linux Railway)
    formattedSrc = formattedSrc.replace(/\/sounds\//g, '/Sounds/');

    const audio = new Audio(formattedSrc);
    audio.preload = 'auto';
    activeAudio = audio;

    // Tangani kebijakan autoplay browser secara graceful: jika diblokir,
    // cukup log & beri tahu lewat toast, tanpa menghentikan alur aplikasi.
    audio.play().catch((err) => {
      console.warn('Audio diblokir/gagal diputar:', err.message);
      toast('Nada dering diblokir browser, klik layar untuk mengaktifkan suara.');
    });

    audio.addEventListener('ended', () => {
      if (activeAudio === audio) activeAudio = null;
    });

    return audio;
  }

// Fungsi helper yang dipanggil saat tombol "Tes Suara" diklik
function testSelectedRingtone() {
  // Ambil nilai ringtone dari radio button atau dropdown yang sedang dipilih user
  const selectedElement = document.querySelector('input[name="selected_ringtone"]:checked') 
                       || document.getElementById('selected_ringtone');
  
  const ringtonePath = selectedElement ? selectedElement.value : '/Sounds/ringtone1.mp3';
  playRingtone(ringtonePath);
}

  /* ===== API ===== */
  async function api(path, opts = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...(state.user && { 'x-user-id': String(state.user.id_user) }),
      ...(state.user && { 'x-user-role': state.user.role }),
    };
    const res = await fetch(`${API}${path}`, {
      ...opts,
      headers: { ...headers, ...(opts.headers || {}) },
    });
    let data;
    try { data = await res.json(); } catch (_) { data = {}; }
    if (!res.ok) {
      const err = new Error(data.error || 'Request gagal');
      err.status = res.status;
      throw err;
    }
    return data;
  }

  /* ===== Sesi (persist login lewat localStorage) =====
   * Supaya user/admin tidak ter-logout saat refresh browser, data user yang
   * sedang login disimpan di localStorage dan dipulihkan lagi saat halaman dimuat.
   */
  const SESSION_KEY = 'dlh-session';

  function saveSession(user) {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(user)); } catch (_) { /* abaikan, storage penuh/diblokir */ }
  }

  function clearSession() {
    try { localStorage.removeItem(SESSION_KEY); } catch (_) { /* no-op */ }
  }

  function loadSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  /* ===== Toast ===== */
  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 2600);
  }

  /* ===== Auth Tabs ===== */
  $$('.tab-btn[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      $$('.tab-btn[data-tab]').forEach((b) => b.classList.toggle('active', b === btn));
      $('#login-form').classList.toggle('hidden', tab !== 'login');
      $('#register-form').classList.toggle('hidden', tab !== 'register');
      $('#auth-msg').textContent = '';
    });
  });

  /* ===== Preferensi radio: show/hide WA fields + ringtone dropdown ===== */
  function syncPreferensiVisibility() {
    const checked = $('input[name="preferensi"]:checked');
    if (!checked) return;
    $('#wa-extra').classList.toggle('hidden', checked.value !== 'nomor_wa');
    $('#ringtone-extra').classList.toggle('hidden', checked.value !== 'nada_dering');
  }
  $$('input[name="preferensi"]').forEach((r) => {
    r.addEventListener('change', syncPreferensiVisibility);
  });
  // Sync awal: radio default 'nada_dering' (checked) → tampilkan ringtone-extra
  syncPreferensiVisibility();

  /* ===== Login ===== */
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const msg = $('#auth-msg');
    try {
      const data = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: f.email.value.trim(), password: f.password.value }),
      });
      state.user = data.user;
      saveSession(state.user);
      msg.textContent = '';
      enterApp();
    } catch (err) {
      msg.className = 'msg error';
      msg.textContent = err.message;
    }
  });

  /* ===== Register ===== */
  $('#register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const msg = $('#auth-msg');
    const preferensi = $('input[name="preferensi"]:checked').value;
    const relasi = preferensi === 'nomor_wa' ? ($('input[name="relasi"]:checked') || {}).value : null;
    const selectedRingtone = preferensi === 'nada_dering' ? f.selected_ringtone.value : null;
    try {
      await api('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          npm: f.npm.value.trim(),
          nama: f.nama.value.trim(),
          email: f.email.value.trim(),
          password: f.password.value,
          preferensi,
          no_wa: preferensi === 'nomor_wa' ? f.no_wa.value.trim() : null,
          relasi,
          selected_ringtone: selectedRingtone,
        }),
      });
      msg.className = 'msg success';
      msg.textContent = 'Registrasi berhasil. Silakan login.';
      f.reset();
      syncPreferensiVisibility();
      $('.tab-btn[data-tab="login"]').click();
    } catch (err) {
      msg.className = 'msg error';
      msg.textContent = err.message;
    }
  });

  /* ===== Enter App ===== */
  function enterApp() {
    $('#auth-view').classList.add('hidden');
    $('#app-view').classList.remove('hidden');

    const u = state.user;
    // Fallback ringtone jika backend belum kirim kolom (DB lama)
    if (!u.selected_ringtone) u.selected_ringtone = DEFAULT_RINGTONE;

    $('#user-nama').textContent = u.nama || 'User';
    $('#user-role').textContent = u.role || 'user';
    $('#user-avatar').textContent = (u.nama || 'U').charAt(0).toUpperCase();

    const isAdmin = u.role === 'admin';
    $('#admin-panel').classList.toggle('hidden', !isAdmin);
    $('#nav-admin').classList.toggle('hidden', !isAdmin);
    $('#menu-change-email').classList.toggle('hidden', isAdmin);
    $('#menu-preferences').classList.toggle('hidden', isAdmin);

    fetchTasks();
    startDeadlineChecker();
    startTasksPolling();
  }

  /* ===== Tasks ===== */
  async function fetchTasks(silent = false) {
    try {
      const data = await api('/api/tasks');
      state.tasks = { Tugas: [], UTS: [], UAS: [] };
      for (const k of ['Tugas', 'UTS', 'UAS']) {
        if (Array.isArray(data[k])) state.tasks[k] = data[k];
      }
      renderTasks();
    } catch (err) {
      if (err.status === 401 || err.status === 403) {
        // Kredensial di localStorage sudah tidak valid (mis. akun dihapus) → paksa logout
        toast('Sesi berakhir, silakan login kembali.');
        handleMenuAction('logout');
        return;
      }
      if (!silent) toast(err.message);
    }
  }

  /* ===== Polling: auto-refresh daftar tugas & modal rekap secara berkala =====
   * Supaya perubahan dari user lain (mis. teman menekan "Mark As Done") langsung
   * terlihat oleh admin/user lain tanpa perlu refresh manual.
   */
  let tasksPollTimer = null;
  const TASKS_POLL_INTERVAL_MS = 8000;

  function startTasksPolling() {
    stopTasksPolling();
    tasksPollTimer = setInterval(() => {
      fetchTasks(true);
      refreshOpenRecap();
    }, TASKS_POLL_INTERVAL_MS);
  }

  function stopTasksPolling() {
    if (tasksPollTimer) clearInterval(tasksPollTimer);
    tasksPollTimer = null;
  }

  function normTask(raw) {
    const get = (obj, ...keys) => {
      for (const k of keys) {
        const v = obj[k];
        if (v !== undefined && v !== null) return v;
      }
      return null;
    };
    const safe = (v) => (v && typeof v === 'object') ? '' : String(v ?? '');
    const rawStatus = safe(get(raw, 'status', 'STATUS')).toLowerCase();

    return {
      id: get(raw, 'id_tugas', 'ID_TUGAS'),
      judul: safe(get(raw, 'judul', 'JUDUL')) || '(tanpa judul)',
      deskripsi: safe(get(raw, 'deskripsi', 'DESKRIPSI')),
      kategori: safe(get(raw, 'kategori', 'KATEGORI')) || 'Tugas',
      sumber: safe(get(raw, 'sumber_web', 'SUMBER_WEB')),
      deadline: safe(get(raw, 'deadline', 'DEADLINE')),
      status: (rawStatus.includes('selesai') || rawStatus === 'done' || rawStatus === '1') ? 'selesai' : 'belum',
    };
  }

  function renderTasks() {
    const list = $('#task-list');
    const empty = $('#empty-msg');
    const items = state.tasks[state.activeTab] || [];
    const isAdmin = state.user && state.user.role === 'admin';

    list.innerHTML = '';
    empty.classList.toggle('hidden', items.length > 0);

    for (const raw of items) {
      const t = normTask(raw);
      const done = t.status === 'selesai';
      const li = document.createElement('li');
      li.className = `task-item ${done ? 'done' : ''}`;

      const sumberTag = t.sumber
        ? `<span class="tag ${t.sumber.toLowerCase()}">${escapeHtml(t.sumber)}</span>` : '';
      const deskripsi = t.deskripsi
        ? `<div class="task-desc">${escapeHtml(t.deskripsi)}</div>` : '';

      let actionBtn = '';
      if (state.activeTab === 'Tugas') {
        if (isAdmin) {
          // Admin tidak menandai tugas selesai sendiri, cukup melihat rekap pengerjaan mahasiswa
          actionBtn = `<button class="btn-detail" data-id="${t.id}" data-judul="${escapeHtml(t.judul)}" type="button">Detail</button>`;
        } else {
          const deadlineMs = new Date(t.deadline).getTime();
          const isExpired = !isNaN(deadlineMs) && deadlineMs < Date.now();

          if (done) {
            actionBtn = `<button class="btn-done done" type="button" disabled>Selesai ✓</button>`;
          } else if (isExpired) {
            actionBtn = `<button class="btn-done missed" type="button" disabled>Terlewat</button>`;
          } else {
            actionBtn = `<button class="btn-done" data-id="${t.id}" type="button">Mark As Done</button>`;
          }
        }
      }

      li.innerHTML = `
        <div class="task-body">
          <div class="task-title">${escapeHtml(t.judul)}</div>
          <div class="task-meta">
            ${sumberTag}
            <span class="tag">${escapeHtml(t.kategori)}</span>
            <span class="task-deadline">⏰ ${formatDate(t.deadline)}</span>
          </div>
          ${deskripsi}
        </div>
        ${actionBtn}
      `;
      list.appendChild(li);
    }

    $$('.btn-done[data-id]', list).forEach((btn) => {
      btn.addEventListener('click', () => toggleDone(Number(btn.dataset.id)));
    });

    $$('.btn-detail', list).forEach((btn) => {
      btn.addEventListener('click', () => openRecapModal(Number(btn.dataset.id), btn.dataset.judul));
    });
  }

  /* ===== Modal Rekapitulasi (khusus Admin) ===== */
  let currentRecapTaskId = null;
  let currentRecapModalEl = null;

  function renderRecapContent(modal, judul, sudah, belum) {
    modal.innerHTML = `
      <h3>Rekap: ${escapeHtml(judul)}</h3>
      <div class="recap-section">
        <h4 class="recap-heading done-heading">✅ Sudah Mengerjakan (${sudah.length})</h4>
        <ul class="recap-list">
          ${sudah.length
            ? sudah.map((u) => `<li>${escapeHtml(u.nama)}</li>`).join('')
            : '<li class="recap-empty">Belum ada yang mengerjakan.</li>'}
        </ul>
      </div>
      <div class="recap-section">
        <h4 class="recap-heading pending-heading">⏳ Belum Mengerjakan (${belum.length})</h4>
        <ul class="recap-list">
          ${belum.length
            ? belum.map((u) => `<li>${escapeHtml(u.nama)}</li>`).join('')
            : '<li class="recap-empty">Semua mahasiswa sudah mengerjakan 🎉</li>'}
        </ul>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn-secondary recap-close">Tutup</button>
      </div>
    `;
    $('.recap-close', modal).addEventListener('click', closeRecapModal);
  }

  function closeRecapModal() {
    $('#modal-host').innerHTML = '';
    currentRecapTaskId = null;
    currentRecapModalEl = null;
  }

  async function openRecapModal(idTugas, judul) {
    const host = $('#modal-host');
    host.innerHTML = '';
    stopRingtone();

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'modal recap-modal';
    modal.innerHTML = `
      <h3>Rekap: ${escapeHtml(judul)}</h3>
      <p class="recap-loading">Memuat data rekapitulasi...</p>
    `;

    overlay.appendChild(modal);
    host.appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeRecapModal(); });

    currentRecapTaskId = idTugas;
    currentRecapModalEl = modal;

    try {
      const data = await api(`/api/tasks/${idTugas}/recap`);
      // Modal bisa saja sudah ditutup user sebelum request selesai
      if (currentRecapTaskId !== idTugas) return;
      renderRecapContent(modal, judul, data.sudah || [], data.belum || []);
    } catch (err) {
      if (currentRecapTaskId !== idTugas) return;
      modal.innerHTML = `
        <h3>Rekap: ${escapeHtml(judul)}</h3>
        <p class="msg error">${escapeHtml(err.message)}</p>
        <div class="modal-actions">
          <button type="button" class="btn-secondary recap-close">Tutup</button>
        </div>
      `;
      $('.recap-close', modal).addEventListener('click', closeRecapModal);
    }
  }

  // Dipanggil setiap siklus polling: kalau modal rekap sedang terbuka,
  // perbarui isinya diam-diam tanpa mengganggu tampilan (tanpa loading spinner).
  async function refreshOpenRecap() {
    if (!currentRecapTaskId || !currentRecapModalEl) return;
    const idTugas = currentRecapTaskId;
    const judulEl = $('h3', currentRecapModalEl);
    const judul = judulEl ? judulEl.textContent.replace(/^Rekap:\s*/, '') : '';
    try {
      const data = await api(`/api/tasks/${idTugas}/recap`);
      if (currentRecapTaskId !== idTugas) return; // modal sudah ditutup/ganti selagi fetch
      renderRecapContent(currentRecapModalEl, judul, data.sudah || [], data.belum || []);
    } catch (_) {
      // Gagal refresh diam-diam, biarkan data lama tetap tampil
    }
  }

  async function toggleDone(id) {
    // Hentikan nada dering yang mungkin sedang berbunyi untuk tugas ini
    stopRingtone();
    pendingRingtone = null;

    // Optimistic: flip state lokal + re-render langsung biar UI responsif
    const applyOptimistic = (status) => {
      for (const k of Object.keys(state.tasks)) {
        const arr = state.tasks[k];
        const idx = arr.findIndex((t) => Number(t.id_tugas ?? t.ID_TUGAS) === id);
        if (idx >= 0) {
          arr[idx] = { ...arr[idx], status };
          renderTasks();
          return true;
        }
      }
      return false;
    };
    applyOptimistic('selesai');

    try {
      const data = await api(`/api/tasks/${id}/done`, { method: 'PATCH' });
      toast(data.message || 'Tugas ditandai selesai');
      fetchTasks();
    } catch (err) {
      // Rollback optimistic
      applyOptimistic('belum');
      toast(err.message);
    }
  }

  /* ===== Task Tabs ===== */
  $$('.tab-btn[data-task-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.activeTab = btn.dataset.taskTab;
      $$('.tab-btn[data-task-tab]').forEach((b) => b.classList.toggle('active', b === btn));
      renderTasks();
    });
  });

  /* ===== Admin Task Form ===== */
  const taskForm = $('#task-form');
  if (taskForm) {
    const kategoriSel = $('select[name="kategori"]', taskForm);
    const toggleSumber = () => {
      $('#sumber-field').classList.toggle('hidden', kategoriSel.value !== 'Tugas');
    };
    kategoriSel.addEventListener('change', toggleSumber);

    taskForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = $('#task-msg');
      try {
        await api('/api/tasks', {
          method: 'POST',
          body: JSON.stringify({
            judul: taskForm.judul.value.trim(),
            deskripsi: taskForm.deskripsi.value.trim(),
            kategori: taskForm.kategori.value,
            sumber_web: taskForm.kategori.value === 'Tugas' ? taskForm.sumber_web.value : null,
            deadline: taskForm.deadline.value,
          }),
        });
        msg.className = 'msg success';
        msg.textContent = 'Tugas ditambahkan.';
        taskForm.reset();
        toggleSumber();
        fetchTasks();
      } catch (err) {
        msg.className = 'msg error';
        msg.textContent = err.message;
      }
    });
  }

  /* ===== Header Menu (profile-trigger) ===== */
  const trigger = $('#profile-trigger');
  const dropdown = $('#menu-dropdown');

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const opening = dropdown.classList.toggle('hidden');
    trigger.setAttribute('aria-expanded', String(!opening));
  });
  document.addEventListener('click', () => {
    dropdown.classList.add('hidden');
    trigger.setAttribute('aria-expanded', 'false');
  });
  dropdown.addEventListener('click', (e) => e.stopPropagation());

  $$('#menu-dropdown button').forEach((btn) => {
    btn.addEventListener('click', () => {
      dropdown.classList.add('hidden');
      trigger.setAttribute('aria-expanded', 'false');
      handleMenuAction(btn.dataset.action);
    });
  });

  function handleMenuAction(action) {
    switch (action) {
      case 'toggle-theme':
        applyTheme(document.documentElement.classList.contains('dark') ? 'light' : 'dark');
        break;
      case 'logout':
        stopDeadlineChecker();
        stopTasksPolling();
        pendingRingtone = null;
        currentRecapTaskId = null;
        currentRecapModalEl = null;
        clearSession();
        state.user = null;
        $('#app-view').classList.add('hidden');
        $('#auth-view').classList.remove('hidden');
        $('#login-form').reset();
        $('#register-form').reset();
        syncPreferensiVisibility();
        $('.tab-btn[data-tab="login"]').click();
        break;
      case 'change-password':
        openModal('Ganti Password', [
          { name: 'password', type: 'password', label: 'Password Baru', required: true },
        ], async (vals) => {
          await api('/api/auth/change-password', { method: 'PATCH', body: JSON.stringify(vals) });
          toast('Password diperbarui');
        });
        break;
      case 'change-email':
        openModal('Ganti Email', [
          { name: 'email', type: 'email', label: 'Email Baru', required: true },
        ], async (vals) => {
          await api('/api/auth/change-email', { method: 'PATCH', body: JSON.stringify(vals) });
          if (state.user) {
            state.user.email = vals.email;
            saveSession(state.user);
          }
          toast('Email diperbarui');
        });
        break;
      case 'preferences':
        openModal('Preferensi Pengingat', [
          {
            name: 'preferensi', type: 'select', label: 'Preferensi',
            value: state.user ? state.user.preferensi : 'nada_dering',
            options: [
              { value: 'nada_dering', label: 'Nada Dering' },
              { value: 'nomor_wa', label: 'Nomor WhatsApp Orang Terdekat' },
            ],
          },
          { name: 'no_wa', type: 'tel', label: 'Nomor WhatsApp (jika Nomor WA)', value: state.user ? (state.user.no_wa || '') : '' },
          {
            name: 'relasi', type: 'select', label: 'Hubungan Kontak',
            value: state.user ? state.user.relasi : '',
            options: [
              { value: 'pacar', label: 'Pacar' },
              { value: 'keluarga', label: 'Keluarga' },
              { value: 'sahabat', label: 'Sahabat' },
            ],
          },
          {
            name: 'selected_ringtone', type: 'select_preview', label: 'Nada Dering Aktif',
            value: state.user ? state.user.selected_ringtone : DEFAULT_RINGTONE,
            options: RINGTONE_OPTIONS,
          },
        ], async (vals) => {
          const payload = {
            preferensi: vals.preferensi,
            no_wa: vals.no_wa || null,
            relasi: vals.relasi || null,
            selected_ringtone: vals.selected_ringtone || DEFAULT_RINGTONE,
          };
          const data = await api('/api/auth/preferences', { method: 'PATCH', body: JSON.stringify(payload) });
          if (state.user) {
            state.user.preferensi = payload.preferensi;
            state.user.no_wa = payload.no_wa;
            state.user.relasi = payload.relasi;
            state.user.selected_ringtone = data.selected_ringtone || payload.selected_ringtone;
            saveSession(state.user);
          }
          toast('Preferensi diperbarui');
        });
        break;
    }
  }

  /* ===== Modal ===== */
  function openModal(title, fields, onSubmit) {
    const host = $('#modal-host');
    host.innerHTML = '';
    stopRingtone(); // hentikan audio tes dari modal sebelumnya
    currentRecapTaskId = null;
    currentRecapModalEl = null;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'modal';

    const fieldHtml = fields.map((f) => {
      const curVal = f.value !== undefined ? f.value : '';
      if (f.type === 'select' || f.type === 'select_preview') {
        const opts = f.options.map((o) =>
          `<option value="${o.value}" ${curVal === o.value ? 'selected' : ''}>${o.label}</option>`
        ).join('');
        const selectHtml = `<select name="${f.name}">${opts}</select>`;
        if (f.type === 'select_preview') {
          return `<label>${f.label}
            <div class="select-preview-row">
              ${selectHtml}
              <button type="button" class="btn-preview" data-preview="${f.name}">🔊 Tes</button>
            </div>
          </label>`;
        }
        return `<label>${f.label}${selectHtml}</label>`;
      }
      return `<label>${f.label}<input type="${f.type}" name="${f.name}" value="${curVal}" ${f.required ? 'required' : ''} /></label>`;
    }).join('');

    modal.innerHTML = `
      <h3>${title}</h3>
      <form>
        ${fieldHtml}
        <div class="modal-actions">
          <button type="button" class="btn-secondary">Batal</button>
          <button type="submit" class="btn-primary modal-btn">Simpan</button>
        </div>
      </form>
    `;
    overlay.appendChild(modal);
    host.appendChild(overlay);

    const form = $('form', modal);
    const close = () => { stopRingtone(); host.innerHTML = ''; };
    $('.btn-secondary', modal).addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    // Tombol Tes Audio: toggle play/stop
    $$('.btn-preview', modal).forEach((btn) => {
      btn.addEventListener('click', () => {
        const sel = $(`select[name="${btn.dataset.preview}"]`, modal);
        if (!sel) return;
        if (activeAudio && btn.dataset.playing === '1') {
          stopRingtone();
          btn.dataset.playing = '0';
          btn.textContent = '🔊 Tes';
          btn.classList.remove('playing');
          return;
        }
        const audio = playRingtone(sel.value);
        if (!audio) return;
        btn.dataset.playing = '1';
        btn.textContent = '⏹ Stop';
        btn.classList.add('playing');
        audio.addEventListener('ended', () => {
          btn.dataset.playing = '0';
          btn.textContent = '🔊 Tes';
          btn.classList.remove('playing');
        });
      });
    });

    // Dynamic visibility: jika ada field `selected_ringtone` + `preferensi`,
    // tampilkan/sembunyikan row ringtone berdasarkan nilai preferensi.
   // Dynamic visibility: tampilkan/sembunyikan field berdasarkan preferensi
    const prefSel = $('select[name="preferensi"]', modal);
    if (prefSel) {
      const getLabel = (name) => {
        const el = $(`[name="${name}"]`, modal);
        return el ? el.closest('label') : null;
      };

      const ringLabel = getLabel('selected_ringtone');
      const waLabel = getLabel('no_wa');
      const relasiLabel = getLabel('relasi');

      const syncModalVisibility = () => {
        const isNadaDering = prefSel.value === 'nada_dering';

        // Tampilkan ringtone jika 'nada_dering', sembunyikan jika 'nomor_wa'
        if (ringLabel) ringLabel.classList.toggle('hidden', !isNadaDering);

        // Sembunyikan WA & Relasi jika 'nada_dering', tampilkan jika 'nomor_wa'
        if (waLabel) waLabel.classList.toggle('hidden', isNadaDering);
        if (relasiLabel) relasiLabel.classList.toggle('hidden', isNadaDering);
      };

      // Jalankan saat modal pertama kali muncul
      syncModalVisibility();

      // Jalankan saat user mengubah dropdown pilihan
      prefSel.addEventListener('change', syncModalVisibility);
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const vals = {};
      $$('[name]', form).forEach((el) => { vals[el.name] = el.value.trim(); });
      try {
        await onSubmit(vals);
        close();
      } catch (err) {
        toast(err.message);
      }
    });
  }

  /* ===== Bottom Nav ===== */
  $$('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      state.activeView = view;
      $$('.nav-item').forEach((b) => b.classList.toggle('active', b === btn));

      const card = $('.card');
      const admin = $('#admin-panel');
      card.classList.remove('hidden');
      admin.classList.add('hidden');

      if (view === 'admin') {
        admin.classList.remove('hidden');
        card.classList.add('hidden');
      } else if (view === 'profile') {
        openProfileModal();
      }
    });
  });

  function openProfileModal() {
    const u = state.user || {};
    openModal('Profil', [
      { name: '_nama', type: 'text', label: 'Nama' },
    ], async () => { toast('Profil bersifat read-only'); });
    const inp = $('#modal-host [name="_nama"]');
    if (inp) inp.value = u.nama || '';
    inp && (inp.readOnly = true);
  }

  /* ===== Deadline Sound Checker (client-side trigger) =====
   * Tiap 30 detik scan semua task user (preferensi nada_dering).
   * Trigger jika deadline dalam window [-1jam, +5menit] ATAU overdue & belum selesai hari ini.
   * Anti-spam: simpan id_tugas yang sudah dibunyikan di sessionStorage.
   * Audio hanya play setelah user interact (browser autoplay policy).
   */
  let checkerTimer = null;
  function getRungSet() {
    try { return new Set(JSON.parse(sessionStorage.getItem('dlh-rung') || '[]')); }
    catch (_) { return new Set(); }
  }
  function markRung(id) {
    const set = getRungSet();
    set.add(id);
    sessionStorage.setItem('dlh-rung', JSON.stringify([...set]));
  }
  function scanDeadlineAlerts() {
    const u = state.user;
    if (!u || u.preferensi !== 'nada_dering') return;
    const now = Date.now();
    const windowStart = now - 60 * 60 * 1000;       // -1 jam
    const windowEnd = now + 5 * 60 * 1000;           // +5 menit
    const rung = getRungSet();
    let triggered = false;

    for (const k of Object.keys(state.tasks)) {
      for (const raw of state.tasks[k]) {
        const t = normTask(raw);
        if (t.status === 'selesai') continue;
        const dl = new Date(t.deadline).getTime();
        if (isNaN(dl)) continue;
        const inWindow = dl >= windowStart && dl <= windowEnd;
        if (!inWindow) continue;
        if (rung.has(t.id)) continue;

        const src = u.selected_ringtone || DEFAULT_RINGTONE;
        if (!userInteracted) {
          // Simpan pemicu yang tertunda di state global, siap diputar
          // begitu ada interaksi pertama dari user (klik/keydown).
          if (!pendingRingtone || pendingRingtone.id !== t.id) {
            pendingRingtone = { src, id: t.id, judul: t.judul };
            toast('⏰ Alarm aktif — klik halaman untuk dengar nada dering');
          }
          return;
        }

        playRingtone(src);
        markRung(t.id);
        toast(`⏰ Pengingat: ${t.judul}`);
        triggered = true;
        break;
      }
      if (triggered) break;
    }
  }
  function startDeadlineChecker() {
    if (checkerTimer) clearInterval(checkerTimer);
    // Cek sekali saat start (setelah fetchTasks selesai ~1.5s), lalu tiap 30 detik
    setTimeout(scanDeadlineAlerts, 1500);
    checkerTimer = setInterval(scanDeadlineAlerts, 30000);
  }
  function stopDeadlineChecker() {
    if (checkerTimer) { clearInterval(checkerTimer); checkerTimer = null; }
    stopRingtone();
  }

  /* ===== Utils ===== */
  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function formatDate(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleString('id-ID', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  /* ===== Service Worker ===== */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch((err) => console.warn('SW reg failed:', err));
    });
  }

  /* ===== Restore sesi saat halaman dimuat/direfresh =====
   * Kalau ada data login tersimpan di localStorage, langsung masuk ke dashboard
   * tanpa perlu login ulang. Kalau ternyata sesi sudah tidak valid (mis. akun
   * dihapus admin), fetchTasks() di dalam enterApp() akan otomatis logout.
   */
  (function restoreSession() {
    const saved = loadSession();
    if (saved && saved.id_user && saved.role) {
      state.user = saved;
      enterApp();
    }
  })();
})();
