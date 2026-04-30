// ================= API HELPER =================
const API_BASE = "http://localhost:5000/api";

async function api(url, method = "GET", body) {
  const token = localStorage.getItem("token");

  const opts = {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token && { Authorization: "Bearer " + token })
    }
  };

  if (body) opts.body = JSON.stringify(body);

  try {
    const res = await fetch(API_BASE + url, opts);
    const data = await res.json();
    if (!res.ok) {
      // Attach HTTP status for callers that need it
      data._httpStatus = res.status;
    }
    return data;
  } catch (err) {
    console.error("API Error:", err);
    return { msg: "Network error — is the server running?" };
  }
}

// ================= STATE =================
let currentUser = null;
let selectedDoctor = null;
let myQueueEntry = null;
let rxTargetEntry = null;
let authMode = 'login';
let authRole = 'patient';
let _prevWaiting = 0; // for doctor alert diff
let _refreshTimer = null;

/* ══════════════════════════════════════════════════════════════
   AUTH
══════════════════════════════════════════════════════════════ */
function authTab(m) {
  authMode = m;
  document.querySelectorAll('.auth-tab').forEach((t, i) =>
    t.classList.toggle('active', (i === 0 && m === 'login') || (i === 1 && m === 'register')));
  document.getElementById('form-login').style.display = m === 'login' ? '' : 'none';
  document.getElementById('form-register').style.display = m === 'register' ? '' : 'none';
}

function roleTab(r) {
  authRole = r;
  document.querySelectorAll('.role-tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`.role-tab.${r}`).classList.add('active');
  document.getElementById('doctor-extra').style.display = r === 'doctor' ? '' : 'none';
  document.getElementById('patient-extra').style.display = r === 'patient' ? '' : 'none';
  document.getElementById('reg-btn').className = `btn btn-${r === 'doctor' ? 'purple' : 'blue'} btn-full`;
}

function fillDemo(role) {
  authTab('login');
  roleTab(role);
  document.getElementById('l-id').value = role === 'patient' ? 'patient@demo' : 'doctor@demo';
  document.getElementById('l-pw').value = '1234';
}

// ── LOGIN (API) ──
async function doLogin() {
  const email = document.getElementById('l-id').value.trim();
  const password = document.getElementById('l-pw').value.trim();

  if (!email || !password) { notif('Please enter email and password', 'warn'); return; }

  const res = await api("/auth/login", "POST", { email, password });

  if (res.token) {
    localStorage.setItem("token", res.token);
    currentUser = res.user;
    enterApp(currentUser);
  } else {
    notif(res.msg || 'Login failed', 'err');
  }
}

// ── REGISTER (API) ──
async function doRegister() {
  const fname = document.getElementById('r-fname').value.trim();
  const lname = document.getElementById('r-lname').value.trim();
  const email = document.getElementById('r-email').value.trim();
  const phone = document.getElementById('r-phone').value.trim();
  const password = document.getElementById('r-pw').value.trim();

  if (!fname || !email || !password) { notif('Please fill all required fields', 'warn'); return; }

  const cols = ['#4a8cf5', '#8b5cf6', '#10b981', '#f59e0b', '#06b6d4', '#ef4444'];
  const data = { role: authRole, email, phone, password, fname, lname };

  if (authRole === 'doctor') {
    data.spec = document.getElementById('r-spec').value;
    data.qual = document.getElementById('r-qual').value;
    data.exp = document.getElementById('r-exp').value;
    data.fee = document.getElementById('r-fee').value;
    data.avatarColor = cols[Math.floor(Math.random() * cols.length)];
  } else {
    data.age = document.getElementById('r-age').value;
    data.blood = document.getElementById('r-blood').value;
  }

  const res = await api("/auth/register", "POST", data);

  if (res._id) {
    notif('Account created! Please sign in.', 'ok');
    authTab('login');
  } else {
    notif(res.msg || 'Registration failed', 'err');
  }
}

// ── ENTER APP after login ──
async function enterApp(user) {
  currentUser = user;
  document.getElementById('screen-auth').classList.remove('active');
  document.getElementById('screen-main').classList.add('active');
  document.getElementById('session-info').style.display = 'flex';
  document.getElementById('session-name').textContent = user.fname + ' ' + user.lname;
  const badge = document.getElementById('session-badge');
  badge.textContent = user.role === 'doctor' ? 'Doctor' : 'Patient';
  badge.className = 'session-role' + (user.role === 'doctor' ? ' doctor' : '');
  document.getElementById('logout-btn').style.display = 'inline-flex';

  if (user.role === 'patient') {
    document.getElementById('view-patient').style.display = '';
    document.getElementById('view-doctor').style.display = 'none';
    // Load active queue entry from server
    await loadMyQueueEntry();
    renderApptBanner();
    await renderDoctorDirectory();
    await renderPatientRx();
    await renderPatientHistory();
  } else {
    document.getElementById('view-doctor').style.display = '';
    document.getElementById('view-patient').style.display = 'none';
    renderDoctorProfile();
    await renderDoctorQueue();
    await renderDashQueue();
    await renderDoctorPatients();
    await updateDStats();
    await updateQueueBadge();
  }

  // Start live refresh polling (every 5 seconds)
  clearInterval(_refreshTimer);
  _refreshTimer = setInterval(liveRefresh, 5000);

  notif('Welcome, ' + user.fname + '!', 'ok');
}

function logout() {
  currentUser = null;
  myQueueEntry = null;
  selectedDoctor = null;
  localStorage.removeItem("token");
  clearInterval(_refreshTimer);
  document.getElementById('screen-main').classList.remove('active');
  document.getElementById('screen-auth').classList.add('active');
  document.getElementById('session-info').style.display = 'none';
  document.getElementById('logout-btn').style.display = 'none';
  document.getElementById('view-patient').style.display = 'none';
  document.getElementById('view-doctor').style.display = 'none';
  document.getElementById('appt-banner').style.display = 'none';
  notif('Signed out', 'ok');
}

// ── Load patient's active queue entry from API ──
async function loadMyQueueEntry() {
  const entry = await api("/queue/my");
  myQueueEntry = entry && entry._id ? entry : null;
}

/* ══════════════════════════════════════════════════════════════
   TABS
══════════════════════════════════════════════════════════════ */
async function pTab(t) {
  document.querySelectorAll('#view-patient .nav-tab').forEach((b, i) =>
    b.classList.toggle('active', ['find', 'queue', 'prescriptions', 'history'][i] === t));
  document.querySelectorAll('#view-patient .page').forEach(p => p.classList.remove('active'));
  document.getElementById('p-' + t).classList.add('active');
  if (t === 'queue') { await renderPatientQueue(); updateMyToken(); }
  if (t === 'prescriptions') { await renderPatientRx(); }
  if (t === 'history') { await renderPatientHistory(); }
}

async function dTab(t) {
  document.querySelectorAll('#view-doctor .nav-tab').forEach((b, i) =>
    b.classList.toggle('active', ['dashboard', 'queue', 'patients'][i] === t));
  document.querySelectorAll('#view-doctor .page').forEach(p => p.classList.remove('active'));
  document.getElementById('d-' + t).classList.add('active');
  if (t === 'dashboard') { await renderDashQueue(); }
  if (t === 'queue') { await renderDoctorQueue(); }
  if (t === 'patients') { await renderDoctorPatients(); }
  await updateDStats();
  // Clear arrival alerts when doctor visits queue
  if (t === 'queue') { hideAlert('d-queue-alert'); hideAlert('d-dash-alert'); }
}

/* ══════════════════════════════════════════════════════════════
   DOCTOR DIRECTORY (API: GET /api/doctors)
══════════════════════════════════════════════════════════════ */
const SPECIALTIES = ['All', 'General Medicine (OPD)', 'Cardiology', 'Orthopedics', 'Dermatology', 'Pediatrics', 'Gynecology', 'ENT', 'Ophthalmology', 'Neurology', 'Psychiatry'];
let activeSpec = 'All';
let _doctorCache = []; // cached list from last fetch

async function renderDoctorDirectory() {
  // Fetch doctors from API
  const allDocs = await api("/doctors");
  if (!Array.isArray(allDocs)) {
    console.error("Failed to load doctors:", allDocs);
    return;
  }
  _doctorCache = allDocs;

  const sf = document.getElementById('spec-filter');
  sf.innerHTML = SPECIALTIES.map(s =>
    `<button class="sf-btn${activeSpec === s ? ' active' : ''}" onclick="filterSpec('${s}')">${s}</button>`).join('');

  const docs = activeSpec === 'All' ? allDocs : allDocs.filter(d => d.spec === activeSpec);

  const dir = document.getElementById('doctor-directory');
  dir.innerHTML = docs.map(d => {
    const initials = (d.fname || '').replace('Dr. ', '').split(' ').map(x => x[0]).join('');
    const color = d.avatarColor || '#4a8cf5';
    const qCount = d.waiting || 0;
    return `<div class="doc-card${selectedDoctor && selectedDoctor._id === d._id ? ' selected' : ''}" onclick="selectDoctor('${d._id}')">
      <div class="doc-queue-badge">${qCount} in queue</div>
      <div class="doc-avatar" style="background:${color}22;color:${color}">${initials}</div>
      <div class="doc-name">${d.fname} ${d.lname || ''}</div>
      <div class="doc-spec">${d.spec || ''}</div>
      <div class="doc-info">
        <span>🎓 ${d.qual || 'MBBS'}</span>
        <span>⏳ ${d.exp || '—'} yrs</span>
        <span>💰 ₹${d.fee || '—'}</span>
      </div>
    </div>`;
  }).join('');

  if (!docs.length) dir.innerHTML = '<div class="empty">No doctors found for this specialty.</div>';
}

function filterSpec(s) { activeSpec = s; renderDoctorDirectory(); }

function selectDoctor(id) {
  selectedDoctor = _doctorCache.find(d => d._id === id) || null;
  renderDoctorDirectory();
  if (!selectedDoctor) return;
  const sec = document.getElementById('book-section');
  sec.style.display = '';
  const color = selectedDoctor.avatarColor || '#4a8cf5';
  document.getElementById('selected-doc-info').innerHTML = `
    <div style="display:flex;align-items:center;gap:12px">
      <div class="doc-avatar" style="background:${color}22;color:${color};width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:700">
        ${(selectedDoctor.fname || '').replace('Dr. ', '').split(' ').map(x => x[0]).join('')}
      </div>
      <div>
        <div style="font-size:14px;font-weight:600">${selectedDoctor.fname} ${selectedDoctor.lname || ''}</div>
        <div style="font-size:12px;color:var(--muted2)">${selectedDoctor.spec} · ₹${selectedDoctor.fee || '—'}</div>
      </div>
    </div>`;
}

/* ══════════════════════════════════════════════════════════════
   BOOK APPOINTMENT (API: POST /api/queue/book)
══════════════════════════════════════════════════════════════ */
async function bookWithDoctor() {
  if (!selectedDoctor) { notif('Select a doctor first', 'warn'); return; }

  // Check if already booked
  await loadMyQueueEntry();
  if (myQueueEntry) {
    notif('You already have an active booking', 'warn');
    renderApptBanner();
    return;
  }

  const res = await api("/queue/book", "POST", {
    doctorId: selectedDoctor._id,
    doctorName: (selectedDoctor.fname || '') + ' ' + (selectedDoctor.lname || ''),
    dept: selectedDoctor.spec,
    phone: currentUser.phone || '—',
    patientName: currentUser.fname + ' ' + (currentUser.lname || '')
  });

  if (res._id) {
    myQueueEntry = res;
    notif('Token ' + res.token + ' booked with ' + selectedDoctor.fname, 'ok');
    renderApptBanner();
    await renderDoctorDirectory();
    pTab('queue');
  } else {
    notif(res.msg || 'Booking failed', 'err');
  }
}

/* ══════════════════════════════════════════════════════════════
   PERSISTENT APPOINTMENT BANNER (patient) — API-driven
══════════════════════════════════════════════════════════════ */
async function renderApptBanner() {
  const banner = document.getElementById('appt-banner');

  // Re-fetch latest entry from server
  await loadMyQueueEntry();

  if (!myQueueEntry) {
    banner.style.display = 'none';
    return;
  }

  const me = myQueueEntry;

  if (me.status === 'done') {
    banner.style.display = 'none';
    myQueueEntry = null;
    return;
  }

  banner.style.display = '';
  const serving = me.status === 'serving';
  const cls = serving ? 'serving' : 'waiting';

  document.getElementById('appt-inner').className = 'appt-inner ' + cls;
  document.getElementById('appt-circle').className = 'appt-circle ' + cls;
  document.getElementById('appt-pos').className = 'appt-pos ' + cls;
  document.getElementById('appt-prog').className = 'appt-prog-fill ' + cls;
  document.getElementById('appt-tk').textContent = me.token;
  document.getElementById('appt-title').textContent =
    serving ? '🟢 You are now being served!' : '⏳ Appointment Booked — Waiting';
  document.getElementById('appt-sub').textContent =
    (me.doctorName || '—') + ' · ' + (me.dept || '—');

  if (serving) {
    document.getElementById('appt-pos').textContent = 'Please proceed to the doctor\'s counter now! 🚶';
    document.getElementById('appt-prog').style.width = '100%';
  } else {
    // Fetch waiting list for this doctor to get position
    const waiting = await api("/queue/doctor/waiting?doctorId=" + me.doctorId);
    if (Array.isArray(waiting)) {
      const pos = waiting.findIndex(q => q._id === me._id);
      const total = waiting.length;
      const pct = total > 0 ? Math.round(((total - (pos >= 0 ? pos : 0)) / total) * 100) : 0;
      document.getElementById('appt-pos').textContent =
        `Queue position: ${(pos >= 0 ? pos : 0) + 1} of ${total} · ~${((pos >= 0 ? pos : 0) + 1) * 5} min estimated wait`;
      document.getElementById('appt-prog').style.width = pct + '%';
    }
  }
}

/* ══════════════════════════════════════════════════════════════
   PATIENT QUEUE PAGE (API-driven)
══════════════════════════════════════════════════════════════ */
async function renderPatientQueue() {
  if (!myQueueEntry) {
    document.getElementById('p-now-serving').style.display = 'none';
    document.getElementById('p-q-count').textContent = '0 waiting';
    document.getElementById('p-q-list').innerHTML = '<div class="empty">No one waiting right now</div>';
    return;
  }

  const docId = myQueueEntry.doctorId;

  // Fetch the full queue for that doctor (waiting only)
  const waiting = await api("/queue/doctor/waiting?doctorId=" + docId);
  const allForDoc = await api("/queue/doctor?doctorId=" + docId);

  // Now Serving indicator
  let serving = null;
  if (Array.isArray(allForDoc)) {
    serving = allForDoc.find(q => q.status === 'serving');
  }
  const pns = document.getElementById('p-now-serving');
  if (serving) {
    pns.style.display = '';
    document.getElementById('p-ns-num').textContent = serving.token;
    document.getElementById('p-ns-name').textContent = serving.patientName;
    document.getElementById('p-ns-meta').textContent = serving.dept;
  } else {
    pns.style.display = 'none';
  }

  if (Array.isArray(waiting)) {
    document.getElementById('p-q-count').textContent = waiting.length + ' waiting';
    const list = document.getElementById('p-q-list');
    if (!waiting.length) {
      list.innerHTML = '<div class="empty">No one waiting right now</div>';
    } else {
      list.innerHTML = waiting.map((e, i) => `
        <div class="q-item">
          <div class="q-num${i === 0 ? ' active' : ''}">${i + 1}</div>
          <div class="q-info"><div class="q-name">${e.patientName}</div><div class="q-sub">${e.dept} · Token #${e.token}</div></div>
          <span class="badge badge-wait">Waiting</span>
        </div>`).join('');
    }
  }
}

async function updateMyToken() {
  const empty = document.getElementById('p-token-empty');
  const filled = document.getElementById('p-token-filled');
  if (!myQueueEntry) { empty.style.display = ''; filled.style.display = 'none'; return; }
  empty.style.display = 'none'; filled.style.display = '';

  // Re-fetch my entry
  await loadMyQueueEntry();
  const me = myQueueEntry;
  if (!me) { empty.style.display = ''; filled.style.display = 'none'; return; }

  document.getElementById('p-token-num').textContent = me.token;
  document.getElementById('p-token-meta').textContent = me.dept || '—';

  const banner = document.getElementById('p-turn-banner');
  if (me.status === 'serving') {
    document.getElementById('p-pos-text').textContent = 'You are being served!';
    document.getElementById('p-prog').style.width = '100%';
    document.getElementById('p-eta').textContent = 'Please proceed to the counter';
    banner.style.display = 'flex';
  } else {
    // Fetch waiting list to get position
    const waiting = await api("/queue/doctor/waiting?doctorId=" + me.doctorId);
    if (Array.isArray(waiting)) {
      const pos = waiting.findIndex(q => q._id === me._id);
      const pct = waiting.length > 0 ? Math.round(((waiting.length - (pos >= 0 ? pos : 0)) / waiting.length) * 100) : 0;
      document.getElementById('p-pos-text').textContent = `Position ${(pos >= 0 ? pos : 0) + 1} of ${waiting.length} — ${me.dept || ''}`;
      document.getElementById('p-prog').style.width = pct + '%';
      document.getElementById('p-eta').textContent = `~${((pos >= 0 ? pos : 0) + 1) * 5} min estimated wait`;
    }
    banner.style.display = 'none';
  }
}

/* ══════════════════════════════════════════════════════════════
   PRESCRIPTIONS & HISTORY (patient) — API-driven
══════════════════════════════════════════════════════════════ */
async function renderPatientRx() {
  const rxs = await api("/prescriptions/my");
  const el = document.getElementById('p-rx-list');

  if (!Array.isArray(rxs) || !rxs.length) {
    el.innerHTML = '<div class="empty">No prescriptions yet.</div>';
    return;
  }

  el.innerHTML = rxs.map(rx => {
    let docName = 'General Practitioner';
    let docDept = rx.dept || 'Consultant';
    
    if (rx.doctorId && typeof rx.doctorId === 'object') {
      docName = `Dr. ${rx.doctorId.fname} ${rx.doctorId.lname || ''}`;
      docDept = rx.doctorId.spec || docDept;
    } else if (rx.doctorName) {
      docName = rx.doctorName;
    }

    return `<div class="rx-card">
      <div class="rx-header">
        <div>
          <div class="rx-doctor" style="font-weight:700; color:var(--blue)">👨‍⚕️ ${docName}</div>
          <div style="font-size:11px;color:var(--muted2);margin-top:2px;font-family:var(--mono)">${docDept}</div>
        </div>
        <div class="rx-date" style="font-family:var(--mono)">${rx.date}</div>
      </div>
      <div class="rx-diag">📋 ${rx.diagnosis}</div>
      ${rx.bimari ? `<div class="rx-bimari">🔹 ${rx.bimari}</div>` : ''}
      ${rx.complaint ? `<div style="font-size:12px;color:var(--muted2);margin-bottom:.5rem">Complaint: ${rx.complaint}</div>` : ''}
      <div class="rx-meds"><div style="font-size:10px;color:var(--muted2);font-family:var(--mono);margin-bottom:4px">MEDICATIONS</div>
        ${rx.meds.split('\n').filter(Boolean).map(m => `<div class="rx-med">💊 ${m}</div>`).join('')}
      </div>
      ${rx.notes ? `<div class="rx-notes">📝 ${rx.notes}</div>` : ''}
    </div>`;
  }).join('');
}

async function renderPatientHistory() {
  const visits = await api("/visits/my");
  const el = document.getElementById('p-visit-list');

  if (!Array.isArray(visits) || !visits.length) {
    el.innerHTML = '<div class="empty">No visit history yet.</div>';
    return;
  }

  el.innerHTML = visits.map(v => {
    let docName = 'Doctor';
    let docDept = v.dept || 'General Medicine';
    
    if (v.doctorId && typeof v.doctorId === 'object') {
      docName = `Dr. ${v.doctorId.fname} ${v.doctorId.lname || ''}`;
      docDept = v.doctorId.spec || docDept;
    } else if (v.doctorName) {
      docName = v.doctorName;
    }

    return `<div class="visit-item">
      <div class="visit-top">
        <div class="visit-title">${v.diagnosis || 'Checkup Visit'}</div>
        <div class="visit-meta" style="font-family:var(--mono);font-size:11px">${v.date ? new Date(v.date).toLocaleDateString() : '—'}</div>
      </div>
      <div class="visit-diag">
        <span style="font-weight:700; color:var(--text)">👨‍⚕️ ${docName}</span> 
        <span style="color:var(--muted2)"> · ${docDept}</span>
      </div>
    </div>`;
  }).join('');
}

/* ══════════════════════════════════════════════════════════════
   DOCTOR QUEUE (API: GET /api/queue/doctor, PUT /api/queue/call-next)
══════════════════════════════════════════════════════════════ */
async function callNext() {
  const res = await api("/queue/call-next", "PUT");

  if (res.serving) {
    notif('Now serving Token ' + res.serving.token + ' — ' + res.serving.patientName, 'ok');
    rxTargetEntry = res.serving;
    openRxModal(res.serving);
  } else {
    notif(res.msg || 'Queue is empty!', 'warn');
  }

  await renderDoctorQueue();
  await updateDStats();
  await updateQueueBadge();
}

async function renderDoctorQueue() {
  const myQ = await api("/queue/doctor");
  const el = document.getElementById('d-q-list');

  if (!Array.isArray(myQ) || !myQ.length) {
    el.innerHTML = '<div class="empty">No active patients in queue</div>';
    return;
  }

  // Filter to only show waiting + serving (not done)
  const active = myQ.filter(e => e.status === 'waiting' || e.status === 'serving');

  if (!active.length) {
    el.innerHTML = '<div class="empty">No active patients in queue</div>';
    return;
  }

  el.innerHTML = active.map(e => `
    <div class="q-item">
      <div class="q-num${e.status === 'serving' ? ' serving' : ''}">${e.token}</div>
      <div class="q-info">
        <div class="q-name">${e.patientName}</div>
        <div class="q-sub">${e.dept} · ${e.phone || '—'} · booked ${fmtTime(e.bookedAt)}</div>
      </div>
      <span class="badge ${e.status === 'serving' ? 'badge-serve' : 'badge-wait'}">${e.status === 'serving' ? 'Serving' : 'Waiting'}</span>
      ${e.status === 'serving' ? `<button class="btn btn-sm btn-purple" onclick="openRxForEntry('${e._id}')">📝 Prescription</button>` : ''}
      ${e.status === 'waiting' ? `<button class="btn btn-red" onclick="removeQ('${e._id}')">Remove</button>` : ''}
    </div>`).join('');
}

function fmtTime(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }); }
  catch (e) { return '—'; }
}

// ── Remove queue entry (API: DELETE /api/queue/:id) ──
async function removeQ(id) {
  const res = await api("/queue/" + id, "DELETE");
  notif(res.msg || 'Entry removed', 'warn');
  await renderDoctorQueue();
  await updateDStats();
  await renderDoctorDirectory();
  await updateQueueBadge();
}

// ── Open prescription modal (using server data) ──
async function openRxForEntry(id) {
  // Fetch the queue to find this entry
  const myQ = await api("/queue/doctor");
  if (Array.isArray(myQ)) {
    rxTargetEntry = myQ.find(q => q._id === id) || null;
    if (rxTargetEntry) openRxModal(rxTargetEntry);
  }
}

function openRxModal(entry) {
  document.getElementById('rx-modal-title').textContent = '📝 Prescription — ' + entry.patientName + ' (Token ' + entry.token + ')';
  document.getElementById('rx-diag').value = '';
  document.getElementById('rx-complaint').value = '';
  document.getElementById('rx-meds').value = '';
  document.getElementById('rx-notes').value = '';
  openModal('rx-modal');
}

// ── Save prescription (API: POST /api/prescriptions) ──
async function savePrescription() {
  const diag = document.getElementById('rx-diag').value.trim();
  const meds = document.getElementById('rx-meds').value.trim();
  if (!diag || !meds) { notif('Diagnosis and medications are required', 'warn'); return; }

  const rx = {
    patientId: rxTargetEntry.patientId,
    doctorId: currentUser._id,
    doctorName: currentUser.fname + ' ' + (currentUser.lname || ''),
    dept: currentUser.spec || '',
    date: todayStr(),
    diagnosis: diag,
    bimari: document.getElementById('rx-complaint').value.trim(),
    complaint: document.getElementById('rx-complaint').value.trim(),
    meds,
    notes: document.getElementById('rx-notes').value.trim()
  };

  const res = await api("/prescriptions", "POST", rx);

  if (res._id) {
    closeModal('rx-modal');
    notif('Prescription saved for ' + rxTargetEntry.patientName, 'ok');
  } else {
    notif(res.msg || 'Failed to save prescription', 'err');
  }
}

/* ══════════════════════════════════════════════════════════════
   DOCTOR PATIENTS (API-driven)
══════════════════════════════════════════════════════════════ */
async function renderDoctorPatients() {
  const el = document.getElementById('d-patient-list');

  // Fetch detailed patient list from the new API route
  const patients = await api("/queue/doctor/patients");

  if (!Array.isArray(patients) || !patients.length) {
    el.innerHTML = '<div class="empty">No patients seen yet.</div>';
    return;
  }

  el.innerHTML = patients.map(p => `
    <div class="patient-rec-card" id="pt-${p._id}">
      <div class="patient-rec-header" onclick="togglePatientRecord('${p._id}', this)">
        <div class="patient-rec-info">
          <div class="patient-rec-name">${p.fname} ${p.lname || ''}</div>
          <div class="patient-rec-meta">
            <span style="color:var(--blue)">📞 ${p.phone || '—'}</span>
            <span style="color:var(--text)">🎂 ${p.age || '—'} yrs</span>
            <span style="color:var(--red)">🩸 ${p.blood || '—'}</span>
            <span>🏥 ${p.dept || 'General'}</span>
          </div>
        </div>
        <div class="patient-rec-chevron">▼</div>
      </div>
      <div class="patient-rec-body">
        <div class="patient-rec-details">
          <div class="details-section-title">Full Medical Records & History</div>
          <div class="patient-history-content" id="hist-content-${p._id}">
            <div style="padding:1rem;color:var(--muted2);font-family:var(--mono);font-size:11px;text-align:center">
              <div class="pip" style="display:inline-block;margin-right:8px"></div> Loading clinical history...
            </div>
          </div>
        </div>
      </div>
    </div>`).join('');
}

async function togglePatientRecord(pid, el) {
  const card = el.closest('.patient-rec-card');
  const isOpening = !card.classList.contains('expanded');

  card.classList.toggle('expanded');

  if (isOpening) {
    const contentEl = document.getElementById(`hist-content-${pid}`);
    const rxs = await api("/prescriptions/patient/" + pid);

    if (!Array.isArray(rxs) || !rxs.length) {
      contentEl.innerHTML = `
        <div class="empty" style="padding:2rem;text-align:center;background:var(--bg2);border:1px dashed var(--border)">
          <div style="font-size:24px;margin-bottom:0.5rem">📂</div>
          <div style="font-size:12px;color:var(--muted2)">No clinical history or prescriptions found for this patient.</div>
        </div>`;
    } else {
      contentEl.innerHTML = rxs.map(rx => {
        let docName = 'Doctor';
        let docDept = rx.dept || '';
        
        if (rx.doctorId && typeof rx.doctorId === 'object') {
          docName = `Dr. ${rx.doctorId.fname} ${rx.doctorId.lname || ''}`;
          docDept = rx.doctorId.spec || docDept;
        } else if (rx.doctorName) {
          docName = rx.doctorName;
        }

        return `<div class="history-item">
          <div class="history-date">📅 ${rx.date} · ${docName} · ${docDept}</div>
          <div class="history-diag">📋 ${rx.diagnosis}</div>
          ${rx.complaint ? `<div style="font-size:12px;color:var(--muted2);margin-bottom:.5rem">Chief Complaint: ${rx.complaint}</div>` : ''}
          <div class="history-meds">
            <div style="font-size:10px;color:var(--muted2);font-family:var(--mono);margin-bottom:6px;text-transform:uppercase">Medications</div>
            ${rx.meds.split('\n').filter(Boolean).map(m => `<div style="margin-bottom:4px">💊 ${m}</div>`).join('')}
          </div>
          ${rx.notes ? `<div style="font-size:11px;color:var(--muted2);margin-top:0.75rem;padding-top:0.75rem;border-top:1px dashed var(--border)">📝 Notes: ${rx.notes}</div>` : ''}
        </div>`;
      }).join('');
    }
  }
}

async function viewPatientHistory(pid, name) {
  const rxs = await api("/prescriptions/patient/" + pid);
  const el = document.getElementById('hist-modal-body');
  document.getElementById('hist-modal-title').textContent = "Patient History — " + name;

  if (!Array.isArray(rxs) || !rxs.length) {
    el.innerHTML = '<div class="empty">No previous prescriptions found.</div>';
  } else {
    el.innerHTML = rxs.map(rx => {
      let docName = 'Doctor';
      if (rx.doctorId && typeof rx.doctorId === 'object') {
        docName = `Dr. ${rx.doctorId.fname} ${rx.doctorId.lname || ''}`;
      } else if (rx.doctorName) {
        docName = rx.doctorName;
      }

      return `<div class="rx-card" style="margin-bottom:1rem; border:2px solid var(--border); padding:1rem">
        <div class="flex-between" style="border-bottom:1px solid var(--border); padding-bottom:0.5rem; margin-bottom:0.5rem">
          <div style="font-weight:700">${rx.date}</div>
          <div style="font-size:11px; color:var(--muted2)">${docName}</div>
        </div>
        <div style="font-weight:600; margin-bottom:0.5rem">📋 Diagnosis: ${rx.diagnosis}</div>
        <div style="font-size:12px; margin-bottom:0.5rem">Chief Complaint: ${rx.complaint || '—'}</div>
        <div style="font-family:var(--mono); font-size:12px; background:var(--bg3); padding:0.5rem">
          ${rx.meds.split('\n').map(m => `<div>💊 ${m}</div>`).join('')}
        </div>
        ${rx.notes ? `<div style="font-size:11px; color:var(--muted2); margin-top:0.5rem">📝 Notes: ${rx.notes}</div>` : ''}
      </div>`;
    }).join('');
  }
  openModal('hist-modal');
}

/* ══════════════════════════════════════════════════════════════
   DOCTOR PROFILE & STATS (API: GET /api/stats/doctor)
══════════════════════════════════════════════════════════════ */
function renderDoctorProfile() {
  const d = currentUser;
  document.getElementById('d-profile-info').innerHTML = `
    <div class="grid-2">
      <div><div class="info-row"><span class="info-lbl">Name</span><span class="info-val">${d.fname} ${d.lname || ''}</span></div>
           <div class="info-row"><span class="info-lbl">Specialty</span><span class="info-val">${d.spec || '—'}</span></div>
           <div class="info-row"><span class="info-lbl">Qualification</span><span class="info-val">${d.qual || '—'}</span></div></div>
      <div><div class="info-row"><span class="info-lbl">Experience</span><span class="info-val">${d.exp || '—'} years</span></div>
           <div class="info-row"><span class="info-lbl">Fee</span><span class="info-val">₹${d.fee || '—'} / consultation</span></div>
           <div class="info-row"><span class="info-lbl">Contact</span><span class="info-val">${d.phone || d.email}</span></div></div>
    </div>`;
}

async function updateDStats() {
  if (!currentUser || currentUser.role !== 'doctor') return;

  const stats = await api("/stats/doctor");

  if (stats && !stats.msg) {
    document.getElementById('d-stat-wait').textContent = stats.waiting || 0;
    document.getElementById('d-stat-serve').textContent = stats.serving || 0;
    document.getElementById('d-stat-done').textContent = stats.servedCount || 0;
    document.getElementById('d-stat-pts').textContent = stats.totalPatients || 0;
  }
}

/* ══════════════════════════════════════════════════════════════
   DOCTOR LIVE REFRESH & ALERTS (API-driven polling)
══════════════════════════════════════════════════════════════ */
async function updateQueueBadge() {
  if (!currentUser || currentUser.role !== 'doctor') return;

  const stats = await api("/stats/doctor");
  const waiting = (stats && stats.waiting) || 0;

  const tab = document.getElementById('d-queue-tab');
  if (!tab) return;
  let badge = tab.querySelector('.q-badge');
  if (waiting > 0) {
    if (!badge) { badge = document.createElement('span'); badge.className = 'q-badge'; tab.appendChild(badge); }
    badge.textContent = waiting;
  } else {
    if (badge) badge.remove();
  }
}

function showAlert(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  const textId = id.replace('alert', 'alert-text');
  const txt = document.getElementById(textId);
  if (txt) txt.textContent = msg;
  el.style.display = 'flex';
  clearTimeout(el._t);
  el._t = setTimeout(() => hideAlert(id), 9000);
}

function hideAlert(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
}

async function liveRefresh() {
  if (!currentUser) return;

  if (currentUser.role === 'doctor') {
    await liveRefreshDoctor();
  } else {
    await liveRefreshPatient();
  }
}

async function liveRefreshDoctor() {
  if (!currentUser || currentUser.role !== 'doctor') return;

  const stats = await api("/stats/doctor");
  const waiting = (stats && stats.waiting) || 0;

  await updateDStats();
  await updateQueueBadge();
  await renderDoctorQueue();
  await renderDashQueue();

  // Show alert if new patients arrived
  if (waiting > _prevWaiting) {
    const diff = waiting - _prevWaiting;
    const msg = `${diff} new patient${diff > 1 ? 's' : ''} booked! (${waiting} waiting)`;
    showAlert('d-dash-alert', msg);
    showAlert('d-queue-alert', msg);
    notif('🔔 ' + msg, 'ok');
  }
  _prevWaiting = waiting;
}

async function liveRefreshPatient() {
  if (!currentUser || currentUser.role !== 'patient') return;
  await renderApptBanner();
}

/* ── DASHBOARD QUEUE PREVIEW ── */
async function renderDashQueue() {
  const el = document.getElementById('d-dash-queue');
  if (!el) return;

  const myQ = await api("/queue/doctor");
  if (!Array.isArray(myQ)) { el.innerHTML = '<div class="empty">—</div>'; return; }

  const active = myQ.filter(e => e.status === 'waiting' || e.status === 'serving');
  if (!active.length) { el.innerHTML = '<div class="empty">Queue is empty — no patients waiting.</div>'; return; }

  el.innerHTML = active.slice(0, 5).map(e => `
    <div class="q-item">
      <div class="q-num${e.status === 'serving' ? ' serving' : ''}">${e.token}</div>
      <div class="q-info">
        <div class="q-name">${e.patientName}</div>
        <div class="q-sub">${e.dept} · ${fmtTime(e.bookedAt)}</div>
      </div>
      <span class="badge ${e.status === 'serving' ? 'badge-serve' : 'badge-wait'}">${e.status === 'serving' ? 'Serving' : 'Waiting'}</span>
    </div>`).join('');

  if (active.length > 5) {
    el.innerHTML += `<div style="font-size:11px;color:var(--muted2);text-align:center;margin-top:.5rem">+${active.length - 5} more…</div>`;
  }
}

/* ══════════════════════════════════════════════════════════════
   AI
══════════════════════════════════════════════════════════════ */
async function callClaude(prompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 200, messages: [{ role: 'user', content: prompt }] })
  });
  const data = await res.json();
  return data.content[0].text;
}

function setAI(id, html, ok = true) { const b = document.getElementById(id); b.innerHTML = html; b.className = 'ai-box' + (ok ? ' ok' : '') }
const thinking = `<div class="ai-dots"><div class="ai-dot"></div><div class="ai-dot"></div><div class="ai-dot"></div></div>`;

async function patientAI() {
  if (!myQueueEntry) { notif('Book a slot first!', 'warn'); return; }

  const me = myQueueEntry;
  const prompt = `I am a patient at a hospital. My token is ${me.token}. My doctor is ${me.doctorName} in ${me.dept}. My current status is: ${me.status}. Give me a brief, helpful update and tips while I wait.`;

  setAI('p-ai-box', thinking, false);

  try { setAI('p-ai-box', await callClaude(prompt)); }
  catch (e) { setAI('p-ai-box', '⚠️ Could not connect to AI. Check network.'); }
}

async function doctorAI() {
  const stats = await api("/stats/doctor");
  const waiting = (stats && stats.waiting) || 0;
  const done = (stats && stats.servedCount) || 0;

  const prompt = `I am a doctor. I have ${waiting} patients waiting and ${done} patients served today. My specialty is ${currentUser.spec || 'General'}. Give me brief queue management suggestions and insights.`;

  setAI('d-ai-box', thinking, false);

  try { setAI('d-ai-box', await callClaude(prompt)); }
  catch (e) { setAI('d-ai-box', '⚠️ Could not connect to AI. Check network.'); }
}

/* ══════════════════════════════════════════════════════════════
   UTILITIES
══════════════════════════════════════════════════════════════ */
function openModal(id) { document.getElementById(id).classList.add('open') }
function closeModal(id) { document.getElementById(id).classList.remove('open') }
function todayStr() { return new Date().toISOString().slice(0, 10) }
function notif(msg, type = 'ok') {
  const a = document.getElementById('notif-area');
  const d = document.createElement('div');
  d.className = 'notif ' + type;
  const dot = type === 'ok' ? 'g' : type === 'warn' ? 'a' : 'r';
  d.innerHTML = `<div class="ndot ${dot}"></div>${msg}`;
  a.appendChild(d);
  setTimeout(() => d.remove(), 4500);
}

/* ══════════════════════════════════════════════════════════════
   AUTO-LOGIN ON PAGE LOAD (if token exists)
══════════════════════════════════════════════════════════════ */
document.addEventListener("DOMContentLoaded", async () => {
  const token = localStorage.getItem("token");
  if (!token) return;

  // Validate the token by fetching user profile
  // We can decode the JWT on client to get userId, but simpler to
  // just try /auth/me endpoint. Since we don't have one, let's
  // try fetching the queue/my or doctors and see if 401 comes back.
  // For now, we'll add a /auth/me endpoint check.

  try {
    const res = await api("/auth/me");
    if (res && res._id) {
      currentUser = res;
      enterApp(currentUser);
    } else {
      // Token expired or invalid
      localStorage.removeItem("token");
    }
  } catch {
    localStorage.removeItem("token");
  }
});
