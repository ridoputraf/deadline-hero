(() => {
  'use strict';

  const API = '';

  // Daftar nada dering (file ada di /public/sounds/, disajikan di /sounds/...)
 // Daftar nada dering (file ada di /public/Sounds/)
  const RINGTONE_OPTIONS = [
    { value: '/Sounds/ringtone1.mp3', label: 'Bruno Mars - Risk It All' },
    { value: '/Sounds/ringtone2.mp3', label: 'Naykilla - OBH Combi Sachet' },
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

  /* ===== Nomor WhatsApp: auto-prefix +62 & pembersihan format lokal =====
   * Input di UI cuma nampung angka lokal tanpa "0"/"62" di depan (badge "+62"
   * yang nempel di sebelah input udah mewakili kode negaranya). Tapi orang
   * suka paste nomor lengkap (mis. "08123..." atau "+62812...") apa adanya,
   * jadi tetap dibersihin di titik pemakaian biar hasil akhirnya konsisten
   * "628xxxxxxxxxx" — format yang sama persis dipakai bot.js buat kirim WA.
   */
  function waLocalDigits(raw) {
    // Ambil angka doang, lalu buang kode negara/awalan "0" kalau kepencet ikut ke-paste.
    let d = String(raw || '').replace(/\D/g, '');
    if (d.startsWith('62')) d = d.slice(2);
    else if (d.startsWith('0')) d = d.slice(1);
    return d;
  }
  function waFullNumber(raw) {
    const d = waLocalDigits(raw);
    return d ? '62' + d : null;
  }
  // Nempel ke input nomor WA: sambil ngetik, otomatis buang "0"/"62" nyasar
  // biar yang keliatan di kolom cuma angka lokal setelah badge "+62".
  function attachWaAutoClean(input) {
    if (!input) return;
    input.addEventListener('input', () => {
      const cleaned = waLocalDigits(input.value);
      if (cleaned !== input.value) input.value = cleaned;
    });
  }

  /* ===== Theme ===== */
  function applyTheme(mode) {
    document.documentElement.classList.toggle('dark', mode === 'dark');
    localStorage.setItem('dlh-theme', mode);
    const btn = $('#menu-dropdown [data-action="toggle-theme"]');
    if (btn) btn.textContent = mode === 'dark' ? 'Light Mode' : 'Dark Mode';
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
      setActiveAlarmTaskId(id); // lacak tugas yang sedang membunyikan alarm (utk auto-stop, lihat scanDeadlineAlerts)
      markRung(id);
      toast(`Psst, "${judul}" mepet deadline-nya. Gas kerjain!`);
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

  // id_tugas yang sedang membunyikan alarm deadline saat ini (bukan "Tes Suara" biasa).
  // Dipakai scanDeadlineAlerts() untuk tahu kapan harus auto-stop (deadline lewat / tugas selesai).
  let activeAlarmTaskId = null;

  /* ===== Persist state alarm ke sessionStorage =====
   * Supaya alarm yang sedang bunyi tidak "hilang tanpa jejak" kalau
   * halaman di-refresh — begitu app reload, kita cek balik id tugas yang
   * masih nyalain alarm dan langsung lanjutkan (bukan dianggap sudah beres).
   */
  const ALARM_SESSION_KEY = 'dlh-active-alarm-id';
  function persistActiveAlarm(id) {
    try {
      if (id === null || id === undefined) sessionStorage.removeItem(ALARM_SESSION_KEY);
      else sessionStorage.setItem(ALARM_SESSION_KEY, String(id));
    } catch (_) { /* storage diblokir, alarm cukup jalan in-memory */ }
  }
  function readPersistedAlarm() {
    try {
      const v = sessionStorage.getItem(ALARM_SESSION_KEY);
      return v ? Number(v) : null;
    } catch (_) { return null; }
  }
  function setActiveAlarmTaskId(id) {
    activeAlarmTaskId = id;
    persistActiveAlarm(id);
  }

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
      toast('Pilih dulu nada deringnya ya.');
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
      toast('Browsernya nunggu kamu klik halaman dulu biar suaranya bisa keluar.');
    });

    audio.addEventListener('ended', () => {
      if (activeAudio === audio) activeAudio = null;
    });

    return audio;
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

  /* Unduh file (blob) dari endpoint API — untuk export Excel rekap.
   * opts.method penting untuk endpoint POST (mis. /api/admin/archive-all);
   * fetch tanpa method default GET dan endpoint POST akan 404. */
  async function apiDownload(path, filename, opts = {}) {
    const headers = {};
    if (state.user) {
      headers['x-user-id'] = String(state.user.id_user);
      headers['x-user-role'] = state.user.role;
    }
    const res = await fetch(`${API}${path}`, { ...opts, headers });
    if (!res.ok) {
      let data = {};
      try { data = await res.json(); } catch (_) { /* respons bukan JSON */ }
      throw new Error(data.error || 'Download gagal. Coba lagi sebentar ya.');
    }
    const blob = await res.blob();
    if (!blob.size) {
      throw new Error('File-nya kosong. Coba lagi sebentar ya.');
    }
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
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

  /* ===== Auth Tabs → flip kartu 3D =====
   * Kedua face kartu memakai position:absolute, jadi tinggi .flip-card__inner
   * harus diset manual dari tinggi face yang sedang aktif. Dengan begitu form
   * register (yang lebih panjang) tetap muat tanpa merusak animasi flip-nya.
   */
  function sizeFlipCard() {
    const inner = $('.flip-card__inner');
    if (!inner) return;
    const face = inner.classList.contains('flipped')
      ? $('.flip-card__back', inner)
      : $('.flip-card__front', inner);
    if (face) inner.style.height = `${face.offsetHeight}px`;
  }

  $$('.tab-btn[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      $$('.tab-btn[data-tab]').forEach((b) => b.classList.toggle('active', b === btn));
      const inner = $('.flip-card__inner');
      if (inner) inner.classList.toggle('flipped', tab === 'register');
      sizeFlipCard();
      $('#auth-msg').textContent = '';
    });
  });
  window.addEventListener('resize', sizeFlipCard);
  window.addEventListener('load', sizeFlipCard); // tinggi bisa berubah setelah font web termuat
  sizeFlipCard();

  /* ===== Preferensi: show/hide WA fields + ringtone dropdown ===== */
  function syncPreferensiVisibility() {
    const sel = $('#pref-select');
    if (!sel) return;
    $('#wa-extra').classList.toggle('hidden', sel.value !== 'nomor_wa');
    $('#ringtone-extra').classList.toggle('hidden', sel.value !== 'nada_dering');
    sizeFlipCard();
  }
  const prefSelect = $('#pref-select');
  if (prefSelect) prefSelect.addEventListener('change', syncPreferensiVisibility);
  // Sync awal: default 'nada_dering' → tampilkan ringtone-extra
  syncPreferensiVisibility();
  attachWaAutoClean($('#register-form input[name="no_wa"]'));

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
      msg.textContent = humanizeError(err);
    }
  });

  /* ===== Register ===== */
  $('#register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const msg = $('#auth-msg');
    const preferensi = f.preferensi.value;
    const npm = f.npm.value.trim();

    // Validasi frontend: NPM wajib 6-10 digit angka (sama seperti aturan backend)
    if (!/^[0-9]{6,10}$/.test(npm)) {
      msg.className = 'msg error';
      msg.textContent = 'Waduh, NPM kamu harus 6 sampai 10 digit angka ya!';
      f.npm.focus();
      return;
    }

    // Nomor WA wajib valid kalau preferensinya nomor_wa (angka lokal setelah badge +62)
    const waFull = preferensi === 'nomor_wa' ? waFullNumber(f.no_wa.value) : null;
    if (preferensi === 'nomor_wa') {
      const localDigits = waLocalDigits(f.no_wa.value);
      if (localDigits.length < 8 || localDigits.length > 14) {
        msg.className = 'msg error';
        msg.textContent = 'Nomor WhatsApp-nya kelihatannya belum lengkap. Tulis 8-14 digit angka ya!';
        f.no_wa.focus();
        return;
      }
    }

    const relasi = preferensi === 'nomor_wa' ? f.relasi.value : null;
    const selectedRingtone = preferensi === 'nada_dering' ? f.selected_ringtone.value : null;
    try {
      await api('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          npm,
          nama: f.nama.value.trim(),
          email: f.email.value.trim(),
          password: f.password.value,
          preferensi,
          no_wa: waFull,
          relasi,
          selected_ringtone: selectedRingtone,
        }),
      });
      const firstName = (f.nama.value.trim() || 'Hero').split(' ')[0];
      msg.className = 'msg success';
      msg.textContent = `Yes! Akun kamu udah jadi, ${firstName}. Tinggal masuk, ya!`;
      f.reset();
      syncPreferensiVisibility();
      $('.tab-btn[data-tab="login"]').click();
    } catch (err) {
      msg.className = 'msg error';
      msg.textContent = humanizeError(err);
    }
  });

  /* ===== Enter App ===== */
  function enterApp() {
    $('#auth-view').classList.add('hidden');
    $('#app-view').classList.remove('hidden');

    const u = state.user;
    // Fallback ringtone jika backend belum kirim kolom (DB lama)
    if (!u.selected_ringtone) u.selected_ringtone = DEFAULT_RINGTONE;

    $('#user-nama').textContent = u.nama || 'Jangan Lupa Isi Nama Kamu';
    $('#user-role').textContent = u.role || 'user';
    $('#user-avatar').textContent = (u.nama || 'Jangan Lupa Isi Nama Kamu').charAt(0).toUpperCase();

    // Sapaan: nama depan saja
    const firstName = (u.nama || 'Hero').split(' ')[0];
    const heroGreeting = $('#hero-greeting');
    if (heroGreeting) heroGreeting.textContent = `Halo, ${firstName}!`;

    const isAdmin = u.role === 'admin';
    $('#admin-panel').classList.toggle('hidden', !isAdmin);
    $('#nav-admin').classList.toggle('hidden', !isAdmin);
    $('#menu-change-email').classList.toggle('hidden', isAdmin);
    $('#menu-preferences').classList.toggle('hidden', isAdmin);
    $('#menu-recap').classList.toggle('hidden', isAdmin);
    $('#menu-archive').classList.toggle('hidden', !isAdmin);

    // Sembunyikan hero section untuk admin
    const heroSection = $('.hero');
    if (heroSection) heroSection.classList.toggle('hidden', isAdmin);

    // Reset state tab secara tegas: selalu mulai dari view tersimpan,
    // fallback "Daftar" — mencegah panel Input & Daftar tampil bersamaan
    // saat refresh atau login pertama.
    switchView(isAdmin ? (state.activeView === 'admin' ? 'admin' : 'tasks') : 'tasks');

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
      // (1) Cek alarm deadline setiap kali data tugas baru datang dari polling,
      // supaya tugas baru (deadline < 1 jam) langsung terdeteksi & berbunyi
      // tanpa menunggu interval checkerTimer terpisah (maks 30 detik).
      scanDeadlineAlerts();
    } catch (err) {
      if (err.status === 401 || err.status === 403) {
        // Kredensial di localStorage sudah tidak valid (mis. akun dihapus) → paksa logout
        toast('Sesi kamu udah habis. Yok masuk lagi biar aman.');
        handleMenuAction('logout');
        return;
      }
      if (!silent) toast(humanizeError(err));
    }
  }

  /* ===== Polling: auto-refresh daftar tugas & modal rekap secara berkala =====
   * Supaya perubahan dari user lain (mis. teman menekan "Mark As Done") langsung
   * terlihat oleh admin/user lain tanpa perlu refresh manual.
   */
  let tasksPollTimer = null;
  const TASKS_POLL_INTERVAL_MS = 10000; // (4) 10 detik, dinaikkan dari 8 detik untuk kurangi beban render

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
      created_by: get(raw, 'created_by', 'CREATED_BY'),
      status: (rawStatus.includes('selesai') || rawStatus === 'done' || rawStatus === '1') ? 'selesai' : 'belum',
    };
  }

  /* ===== (4) Optimasi scrolling: tunda re-render DOM (innerHTML) selagi user
   * sedang scroll, supaya polling (fetchTasks tiap 10 detik) tidak bikin
   * scroll patah-patah. Render yang tertunda akan otomatis dijalankan begitu
   * user berhenti scroll (debounce ~150ms tanpa event scroll baru).
   */
  let isScrolling = false;
  let scrollEndTimer = null;
  let renderTasksPending = false;

  function handleScrollForRender() {
    isScrolling = true;
    clearTimeout(scrollEndTimer);
    scrollEndTimer = setTimeout(() => {
      isScrolling = false;
      if (renderTasksPending) {
        renderTasksPending = false;
        renderTasksNow();
      }
    }, 150);
  }
  window.addEventListener('scroll', handleScrollForRender, { passive: true });

  function renderTasks() {
    // Selagi scrolling, skip render DOM sekarang; tandai "pending" agar
    // dijalankan begitu scroll selesai. Tidak berlaku untuk render yang
    // dipicu langsung oleh aksi user (ganti tab, mark as done), tapi
    // menunda sesaat tidak masalah karena isi tetap konsisten setelahnya.
    if (isScrolling) {
      renderTasksPending = true;
      return;
    }
    renderTasksNow();
  }

  function renderTasksNow() {
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

      // Tombol aksi (Detail utk admin, Mark As Done utk user) berlaku sama
      // di semua kategori — Tugas, UTS, maupun UAS.
      let actionBtn = '';
      if (isAdmin) {
        // Admin tidak menandai tugas selesai sendiri, cukup melihat rekap pengerjaan mahasiswa
        actionBtn = `<button class="btn-3d btn-3d--sm" data-id="${t.id}" data-judul="${escapeHtml(t.judul)}" data-createdby="${t.created_by ?? ''}" type="button"><span class="button_top">Detail</span></button>`;
      } else {
        const deadlineMs = new Date(t.deadline).getTime();
        const isExpired = !isNaN(deadlineMs) && deadlineMs < Date.now();

        if (done) {
          actionBtn = `<button class="btn-3d btn-3d--sm btn-3d--done done" type="button" disabled><span class="button_top">Selesai</span></button>`;
        } else if (isExpired) {
          actionBtn = `<button class="btn-3d btn-3d--sm btn-3d--done missed" type="button" disabled><span class="button_top">Terlewat</span></button>`;
        } else {
          actionBtn = `<button class="btn-3d btn-3d--sm btn-3d--done" data-id="${t.id}" type="button"><span class="button_top">Mark As Done</span></button>`;
        }
      }

      li.innerHTML = `
        <div class="task-body">
          <div class="task-title">${escapeHtml(t.judul)}</div>
          <div class="task-meta">
            ${sumberTag}
            <span class="tag">${escapeHtml(t.kategori)}</span>
            <span class="task-deadline">${formatDate(t.deadline)}</span>
          </div>
          ${deskripsi}
        </div>
        ${actionBtn}
      `;
      list.appendChild(li);
    }

    $$('.btn-3d--done[data-id]', list).forEach((btn) => {
      btn.addEventListener('click', () => toggleDone(Number(btn.dataset.id)));
    });

    $$('.btn-3d--sm[data-judul]', list).forEach((btn) => {
      btn.addEventListener('click', () => {
        const createdBy = btn.dataset.createdby ? Number(btn.dataset.createdby) : null;
        openRecapModal(Number(btn.dataset.id), btn.dataset.judul, createdBy);
      });
    });
  }

  /* ===== Modal Rekapitulasi (khusus Admin) ===== */
  let currentRecapTaskId = null;
  let currentRecapCreatedBy = null;
  let currentRecapModalEl = null;

  function renderRecapContent(modal, judul, sudah, belum) {
    // Tombol hapus hanya untuk admin yang membuat tugas ini (ownership control)
    const isOwner = !!(state.user
      && state.user.role === 'admin'
      && currentRecapCreatedBy !== null
      && Number(currentRecapCreatedBy) === Number(state.user.id_user));

    modal.innerHTML = `
      <h3>Rekap: ${escapeHtml(judul)}</h3>
      <div class="recap-section">
        <h4 class="recap-heading done-heading">Sudah Mengerjakan (${sudah.length})</h4>
        <ul class="recap-list">
          ${sudah.length
            ? sudah.map((u) => `<li>${escapeHtml(u.nama)}</li>`).join('')
            : '<li class="recap-empty">Belum ada yang mengerjakan.</li>'}
        </ul>
      </div>
      <div class="recap-section">
        <h4 class="recap-heading pending-heading">Belum Mengerjakan (${belum.length})</h4>
        <ul class="recap-list">
          ${belum.length
            ? belum.map((u) => `<li>${escapeHtml(u.nama)}</li>`).join('')
            : '<li class="recap-empty">Semua mahasiswa sudah mengerjakan.</li>'}
        </ul>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn-secondary recap-close">Tutup</button>
        ${isOwner ? `
        <button type="button" class="btn-3d btn-3d--sm btn-3d--danger recap-delete"><span class="button_top">Hapus Tugas</span></button>` : ''}
      </div>
    `;
    $('.recap-close', modal).addEventListener('click', closeRecapModal);
    const delBtn = $('.recap-delete', modal);
    if (delBtn) delBtn.addEventListener('click', () => deleteTask(currentRecapTaskId, judul));
  }

  /* Hapus tugas (hanya admin pembuat tugas). Konfirmasi dulu, lalu panggil
   * DELETE /api/tasks/:id, tutup modal, dan segarkan daftar tugas. */
  async function deleteTask(idTugas, judul) {
    if (!idTugas) return;
    if (!window.confirm(`Yakin mau hapus tugas "${judul}"? Tindakan ini nggak bisa dibatalkan.`)) return;
    try {
      await api(`/api/tasks/${idTugas}`, { method: 'DELETE' });
      toast('Tugas udah dihapus.');
      closeRecapModal();
      fetchTasks();
    } catch (err) {
      toast(humanizeError(err));
    }
  }

  /* ===== Riwayat / Recap (User): daftar admin pengupload tugas + progress ===== */
  function buildModalShell(title, bodyHtml) {
    const host = $('#modal-host');
    host.innerHTML = '';
    stopRingtone();
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    const modal = document.createElement('div');
    modal.className = 'modal recap-modal';
    modal.innerHTML = `<h3>${title}</h3>${bodyHtml}`;
    overlay.appendChild(modal);
    host.appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) host.innerHTML = ''; });
    const closeBtn = $('.modal-dismiss', modal);
    if (closeBtn) closeBtn.addEventListener('click', () => { host.innerHTML = ''; });
    return modal;
  }

  async function openUserRecapModal() {
    const modal = buildModalShell('Riwayat Tugas Saya', '<p class="recap-loading">Memuat riwayat...</p>');
    try {
      const data = await api('/api/recap/summary');
      const admins = data.admins || [];
      if (!admins.length) {
        modal.innerHTML = `
          <h3>Riwayat Tugas Saya</h3>
          <p class="recap-empty-state">Belum ada admin yang mengupload tugas. Sabar ya!</p>
          <div class="modal-actions">
            <button type="button" class="btn-secondary modal-dismiss">Tutup</button>
          </div>`;
        const closeBtn = $('.modal-dismiss', modal);
        if (closeBtn) closeBtn.addEventListener('click', () => { $('#modal-host').innerHTML = ''; });
        return;
      }
      const cards = admins.map((a) => `
        <li class="recap-admin-card">
          <div class="recap-admin-info">
            <div class="recap-admin-name">${escapeHtml(a.nama_admin)}</div>
            <div class="recap-progress">${a.selesai}/${a.total} Tugas Selesai</div>
          </div>
          <button type="button" class="btn-3d btn-3d--sm recap-detail-btn" data-id="${a.id_admin}" data-nama="${escapeHtml(a.nama_admin)}">
            <span class="button_top">Detail</span>
          </button>
        </li>`).join('');
      modal.innerHTML = `
        <h3>Riwayat Tugas Saya</h3>
        <ul class="recap-admin-list">${cards}</ul>
        <div class="modal-actions">
          <button type="button" class="btn-secondary modal-dismiss">Tutup</button>
        </div>`;
      const closeBtn = $('.modal-dismiss', modal);
      if (closeBtn) closeBtn.addEventListener('click', () => { $('#modal-host').innerHTML = ''; });
      $$('.recap-detail-btn', modal).forEach((btn) => {
        btn.addEventListener('click', () => openRiwayatDetailModal(Number(btn.dataset.id), btn.dataset.nama));
      });
    } catch (err) {
      modal.innerHTML = `
        <h3>Riwayat Tugas Saya</h3>
        <p class="msg error">${escapeHtml(err.message)}</p>
        <div class="modal-actions">
          <button type="button" class="btn-secondary modal-dismiss">Tutup</button>
        </div>`;
      const closeBtn = $('.modal-dismiss', modal);
      if (closeBtn) closeBtn.addEventListener('click', () => { $('#modal-host').innerHTML = ''; });
    }
  }

  async function openRiwayatDetailModal(idAdmin, namaAdmin) {
    const modal = buildModalShell(`Riwayat: ${escapeHtml(namaAdmin)}`, '<p class="recap-loading">Memuat detail...</p>');
    try {
      const data = await api(`/api/recap/admin/${idAdmin}`);
      const tugas = data.tugas || [];
      if (!tugas.length) {
        modal.innerHTML = `
          <h3>Riwayat: ${escapeHtml(namaAdmin)}</h3>
          <p class="recap-empty-state">Belum ada tugas dari admin ini.</p>
          <div class="modal-actions">
            <button type="button" class="btn-secondary modal-dismiss">Tutup</button>
          </div>`;
      } else {
        const selesai = tugas.filter((t) => t.status === 'Selesai').length;
        const rows = tugas.map((t) => `
          <li class="riwayat-item">
            <div class="riwayat-info">
              <div class="riwayat-judul">${escapeHtml(t.judul)}</div>
              <div class="riwayat-meta">${escapeHtml(t.kategori)} &middot; Deadline ${escapeHtml(t.deadline)} &middot; Klik Selesai: ${escapeHtml(t.waktu_selesai)}</div>
            </div>
            <span class="riwayat-status ${t.status === 'Selesai' ? 'selesai' : 'terlewat'}">${t.status}</span>
          </li>`).join('');
        modal.innerHTML = `
          <h3>Riwayat: ${escapeHtml(namaAdmin)}</h3>
          <p class="recap-progress">${selesai}/${tugas.length} Tugas Selesai</p>
          <ul class="riwayat-list">${rows}</ul>
          <div class="modal-actions">
            <button type="button" class="btn-secondary modal-dismiss">Tutup</button>
            <button type="button" class="btn-3d btn-3d--sm riwayat-export-btn"><span class="button_top">Export Excel Detail</span></button>
          </div>`;
        $('.riwayat-export-btn', modal).addEventListener('click', async () => {
          try {
            const stamp = new Date().toISOString().slice(0, 10);
            await apiDownload(`/api/recap/admin/${idAdmin}/export`, `riwayat-tugas-${stamp}.xlsx`);
            toast('File riwayat udah terunduh.');
          } catch (err) {
            toast(humanizeError(err));
          }
        });
      }
      const closeBtn = $('.modal-dismiss', modal);
      if (closeBtn) closeBtn.addEventListener('click', () => { $('#modal-host').innerHTML = ''; });
    } catch (err) {
      modal.innerHTML = `
        <h3>Riwayat: ${escapeHtml(namaAdmin)}</h3>
        <p class="msg error">${escapeHtml(err.message)}</p>
        <div class="modal-actions">
          <button type="button" class="btn-secondary modal-dismiss">Tutup</button>
        </div>`;
      const closeBtn = $('.modal-dismiss', modal);
      if (closeBtn) closeBtn.addEventListener('click', () => { $('#modal-host').innerHTML = ''; });
    }
  }

  function closeRecapModal() {
    $('#modal-host').innerHTML = '';
    currentRecapTaskId = null;
    currentRecapCreatedBy = null;
    currentRecapModalEl = null;
  }

  async function openRecapModal(idTugas, judul, createdBy = null) {
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
    currentRecapCreatedBy = createdBy;
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
    // Cuma hentikan nada dering kalau tugas yang baru ditandai selesai ini
    // yang lagi bunyi — tugas lain (kategori lain) yang masih mepet deadline
    // harus tetap ngingetin. Alarm baru benar-benar diam kalau semua tugas
    // aktif sudah "selesai" (dicek lagi lewat scanDeadlineAlerts di bawah).
    if (pendingRingtone && pendingRingtone.id === id) pendingRingtone = null;
    if (activeAlarmTaskId === id) {
      stopRingtone();
      setActiveAlarmTaskId(null);
    }

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
    // Langsung re-scan: kalau masih ada tugas lain (kategori lain juga)
    // yang mepet deadline & belum ditandai, alarm lanjut jalan buat itu.
    scanDeadlineAlerts();

    try {
      const data = await api(`/api/tasks/${id}/done`, { method: 'PATCH' });
      toast(data.message || 'Mantap, tugas ini udah kamu bereskan!');
      fetchTasks();
    } catch (err) {
      // Rollback optimistic
      applyOptimistic('belum');
      toast(humanizeError(err));
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
            // Potong komponen detik (:ss) — backend hanya butuh YYYY-MM-DDTHH:mm
            deadline: taskForm.deadline.value.slice(0, 16),
          }),
        });
        msg.className = 'msg success';
        msg.textContent = 'Tugas baru udah masuk. Semangat buat yang ngerjain!';
        taskForm.reset();
        toggleSumber();
        fetchTasks();
      } catch (err) {
        msg.className = 'msg error';
        msg.textContent = humanizeError(err);
      }
    });
  }

  /* ===== Admin: Rekap & Arsip Semua Tugas (unduh Excel, dari menu profile) ===== */
  async function runArchiveAll() {
    const yakin = window.confirm('Apakah Anda yakin ingin menarik semua tugas karena sudah waktunya merekap nilai?');
    if (!yakin) return;
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      await apiDownload('/api/admin/archive-all', `rekap-semua-tugas-${stamp}.xlsx`, { method: 'POST' });
      toast('Rekap terunduh. Semua tugas udah ditarik ke arsip.');
      fetchTasks();
    } catch (err) {
      toast(humanizeError(err));
    }
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
      case 'recap':
        openUserRecapModal();
        break;
      case 'archive-recap':
        runArchiveAll();
        break;
      case 'logout':
        stopDeadlineChecker();
        stopTasksPolling();
        pendingRingtone = null;
        currentRecapTaskId = null;
        currentRecapModalEl = null;
        state.activeView = 'tasks';
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
          toast('Password baru udah aman terpasang.');
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
          toast('Email kamu udah berhasil diganti.');
        });
        break;
      case 'preferences':
        openModal('Ganti Pengingat', [
          {
            name: 'preferensi', type: 'select', label: 'Preferensi',
            value: state.user ? state.user.preferensi : 'nada_dering',
            options: [
              { value: 'nada_dering', label: 'Nada Dering' },
              { value: 'nomor_wa', label: 'Nomor WhatsApp Orang Terdekat' },
            ],
          },
          {
            name: 'no_wa', type: 'tel', label: 'Nomor WhatsApp (jika Nomor WA)', prefix: '+62',
            placeholder: '81234567890',
            value: state.user ? waLocalDigits(state.user.no_wa || '') : '',
          },
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
          toast('Siap! Pengingat kamu udah diperbarui.');
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
              <button type="button" class="btn-3d btn-3d--sm btn-preview" data-preview="${f.name}"><span class="button_top">Tes</span></button>
            </div>
          </label>`;
        }
        return `<label>${f.label}${selectHtml}</label>`;
      }
      const inputHtml = `<input type="${f.type}" name="${f.name}" value="${curVal}" ${f.required ? 'required' : ''} ${f.placeholder ? `placeholder="${f.placeholder}"` : ''} />`;
      if (f.prefix) {
        return `<label>${f.label}
          <div class="wa-input-group">
            <span class="wa-prefix">${f.prefix}</span>
            ${inputHtml}
          </div>
        </label>`;
      }
      return `<label>${f.label}${inputHtml}</label>`;
    }).join('');

    modal.innerHTML = `
      <h3>${title}</h3>
      <form>
        ${fieldHtml}
        <div class="modal-actions">
          <button type="button" class="btn-secondary">Batal</button>
          <button type="submit" class="btn-3d btn-3d--primary modal-btn"><span class="button_top">Simpan</span></button>
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
          ($('.button_top', btn) || btn).textContent = 'Tes';
          btn.classList.remove('playing');
          return;
        }
        const audio = playRingtone(sel.value);
        if (!audio) return;
        btn.dataset.playing = '1';
        ($('.button_top', btn) || btn).textContent = 'Stop';
        btn.classList.add('playing');
        audio.addEventListener('ended', () => {
          btn.dataset.playing = '0';
          ($('.button_top', btn) || btn).textContent = 'Tes';
          btn.classList.remove('playing');
        });
      });
    });

    attachWaAutoClean($('input[name="no_wa"]', modal));

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
      $$('[name]', form).forEach((el) => {
        // Nomor WA disimpan penuh dengan kode negara (628xxxxxxxxxx), meskipun
        // yang keliatan di kolom cuma angka lokal setelah badge "+62".
        vals[el.name] = el.name === 'no_wa' ? (waFullNumber(el.value) || '') : el.value.trim();
      });
      try {
        await onSubmit(vals);
        close();
      } catch (err) {
        toast(err.message);
      }
    });
  }

  /* ===== Bottom Nav =====
   * Satu-satunya pengatur tampilan panel: pastikan "Daftar" dan "Input"
   * selalu eksklusif (yang satu hidden, yang lain tampil). */
  function switchView(view) {
    const isAdmin = state.user && state.user.role === 'admin';
    const target = view === 'admin' && isAdmin ? 'admin' : 'tasks';
    state.activeView = target;

    const tasksPanel = $('#tasks-panel');
    const adminPanel = $('#admin-panel');
    tasksPanel.classList.toggle('hidden', target !== 'tasks');
    adminPanel.classList.toggle('hidden', target !== 'admin');

    $$('.nav-item').forEach((b) =>
      b.classList.toggle('active', b.dataset.view === target));
  }

  $$('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  /* ===== Deadline Sound Checker (client-side trigger) =====
   * Dipanggil setiap GET /api/tasks selesai + tiap 30 detik.
   * Trigger untuk tugas berstatus "belum" yang deadlinenya < 1 jam dari sekarang
   * (dan belum lewat). Anti-bunyi-ulang: simpan penanda per tugas di
   * localStorage (ringtone_played_task_<id_tugas>) sehingga satu tugas hanya
   * berbunyi SATU KALI. Audio hanya play setelah user interact (autoplay policy).
   */
  let checkerTimer = null;
  const RUNG_PREFIX = 'ringtone_played_task_';

  function hasRung(id) {
    try { return localStorage.getItem(RUNG_PREFIX + id) === 'true'; }
    catch (_) { return false; }
  }
  function markRung(id) {
    try { localStorage.setItem(RUNG_PREFIX + id, 'true'); }
    catch (_) { /* storage penuh/diblokir — biarkan alarm tetap bunyi sekali per sesi */ }
  }
  // Cek apakah tugas `id` yang sedang berbunyi masih valid untuk terus berbunyi:
  // harus masih ada, belum "selesai", dan deadline-nya belum lewat (dl > now).
  function isAlarmStillValid(id, now) {
    for (const k of Object.keys(state.tasks)) {
      for (const raw of state.tasks[k]) {
        const t = normTask(raw);
        if (t.id !== id) continue;
        if (t.status === 'selesai') return false;
        const dl = new Date(t.deadline).getTime();
        if (isNaN(dl) || dl <= now) return false; // deadline sudah menyentuh 0 / "Terlewat"
        return true;
      }
    }
    return false; // tugas tidak ditemukan lagi (mis. dihapus admin)
  }
  function findTaskById(id) {
    for (const k of Object.keys(state.tasks)) {
      for (const raw of state.tasks[k]) {
        const t = normTask(raw);
        if (t.id === id) return t;
      }
    }
    return null;
  }

  /* ===== checkUrgentTasksAndPlayRingtone =====
   * Inti alarm: cari tugas berstatus "belum" dengan deadline < 1 jam dari
   * sekarang (tapi belum lewat), lalu putar ringtone milik user.
   * Dipanggil dari scanDeadlineAlerts() setiap kali data GET /api/tasks turun
   * dan dari interval 30 detik. Aman dari Autoplay Policy: kalau user belum
   * pernah interaksi, simpan pendingRingtone lalu mainkan saat interaksi
   * pertama terdeteksi (mis. klik tombol Login). Satu tugas = satu kali bunyi
   * (penanda di localStorage, lihat hasRung/markRung).
   */
  function checkUrgentTasksAndPlayRingtone(tasks, userRingtone) {
    const now = Date.now();
    const windowStart = now - 60 * 60 * 1000; // batas bawah: deadline < 1 jam dari sekarang

    for (const k of Object.keys(tasks)) {
      for (const raw of tasks[k]) {
        const t = normTask(raw);
        if (t.status === 'selesai') continue; // hanya yang masih "belum"
        const dl = new Date(t.deadline).getTime();
        if (isNaN(dl)) continue;
        if (!(dl >= windowStart && dl > now)) continue; // belum mepet / sudah lewat
        if (hasRung(t.id)) continue; // sudah pernah dibunyikan

        const src = userRingtone || DEFAULT_RINGTONE;
        if (!userInteracted) {
          // Belum ada interaksi user → tahan dulu, mainkan begitu user klik/keydown
          if (!pendingRingtone || pendingRingtone.id !== t.id) {
            pendingRingtone = { src, id: t.id, judul: t.judul };
            toast('Ada pengingat nunggu — klik di mana aja biar bunyi');
          }
          return null;
        }

        playRingtone(src);
        setActiveAlarmTaskId(t.id);
        markRung(t.id);
        toast(`Psst, "${t.judul}" kurang dari 1 jam lagi. Gas kerjain!`);
        return t;
      }
    }
    return null;
  }

  // Sudah dicoba resume alarm dari sessionStorage sekali sejak halaman dimuat?
  // (cukup sekali — kalau user sudah stop manual, jangan dipaksa nyala lagi)
  let alarmResumeChecked = false;

  function scanDeadlineAlerts() {
    const u = state.user;

    // (2) Pemisahan audio per-role: nada dering HANYA untuk role 'user'.
    // Jika yang login Admin (atau belum login sama sekali), pastikan tidak ada audio alarm yang berbunyi.
    if (!u || u.role !== 'user' || u.preferensi !== 'nada_dering') {
      if (activeAlarmTaskId !== null) {
        stopRingtone();
        setActiveAlarmTaskId(null);
      }
      pendingRingtone = null;
      return;
    }

    const now = Date.now();

    // Resume setelah refresh: kalau sessionStorage nyimpen id alarm yang lagi
    // bunyi sebelum halaman di-reload, dan tugasnya masih valid (belum
    // selesai/lewat), lanjutkan alarm itu — jangan anggap sudah beres cuma
    // gara-gara variabel in-memory-nya kereset.
    if (!alarmResumeChecked) {
      alarmResumeChecked = true;
      const persistedId = readPersistedAlarm();
      if (persistedId !== null && activeAlarmTaskId === null && isAlarmStillValid(persistedId, now)) {
        const t = findTaskById(persistedId);
        if (t) {
          const src = u.selected_ringtone || DEFAULT_RINGTONE;
          activeAlarmTaskId = persistedId; // set langsung, persist lagi di bawah lewat playRingtone/pending
          if (userInteracted) {
            playRingtone(src);
            persistActiveAlarm(persistedId);
          } else {
            pendingRingtone = { src, id: persistedId, judul: t.judul };
          }
        }
      }
    }

    // (3) Kalau tugas yang SEDANG berbunyi kini sudah "Terlewat" atau ditandai
    // selesai, hentikan alarm-nya SAJA (bukan mematikan alarm untuk kategori
    // lain) — checkUrgentTasksAndPlayRingtone di bawah otomatis lanjut cari
    // tugas mepet lain yang belum ditandai. Audio hanya benar-benar diam
    // begitu tidak ada lagi kandidat tersisa (di semua kategori: Tugas/UTS/UAS).
    if (activeAlarmTaskId !== null && !isAlarmStillValid(activeAlarmTaskId, now)) {
      stopRingtone();
      setActiveAlarmTaskId(null);
    }

    checkUrgentTasksAndPlayRingtone(state.tasks, u.selected_ringtone);
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
    setActiveAlarmTaskId(null);
    alarmResumeChecked = false; // logout/reset — sesi berikutnya boleh resume lagi kalau perlu
  }

  /* ===== Utils ===== */
  /* Terjemahkan pesan error server (yang kaku) jadi bahasa mahasiswa
   * yang suportif dan ramah. Pesan tak dikenal diteruskan apa adanya
   * supaya tetap informatif. */
  function humanizeError(err) {
    const raw = String((err && err.message) || '');
    if (/failed to fetch|networkerror|load failed/i.test(raw)) {
      return 'Koneksi lagi ngambek. Cek internet kamu, lalu coba lagi ya.';
    }
    const map = {
      'Email atau password salah': 'Waduh, email atau password kamu keliru. Coba cek lagi ya.',
      'Email sudah terdaftar': 'Email ini sudah pernah dipakai. Langsung masuk saja, atau pakai email lain ya.',
      'NPM harus berupa angka 6 hingga 10 digit!': 'Waduh, NPM kamu harus 6 sampai 10 digit angka ya!',
      'Format email tidak valid!': 'Hmm, format email kamu kelihatannya belum benar. Coba dicek ya.',
      'no_wa wajib diisi jika preferensi nomor_wa': 'Nomor WhatsApp-nya masih kosong nih. Isi dulu ya.',
      'npm, nama, email, password, preferensi wajib diisi': 'Masih ada kolom yang kosong. Lengkapi dulu ya.',
      'preferensi harus nomor_wa atau nada_dering': 'Pilih dulu mau diingatkan lewat apa ya.',
      'relasi harus pacar, keluarga, atau sahabat': 'Pilih dulu hubungannya: pacar, keluarga, atau sahabat.',
      'Terjadi kesalahan server': 'Server kita lagi tepar sebentar. Coba lagi nanti ya.',
      'Request gagal': 'Ada yang gagal di jalan. Coba sekali lagi ya.',
    };
    return map[raw] || raw;
  }

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
