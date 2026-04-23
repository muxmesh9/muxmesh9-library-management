/* public/js/app.js — Library System v3 (with password management) */
'use strict';

// ── State ──────────────────────────────────────────────
let currentUser = null;
let currentRole = 'librarian';
let fpToken     = null;   // stores reset token between steps

// ── Core helpers ───────────────────────────────────────

async function api(method, url, body) {
  const opts = { method, credentials:'include', headers:{'Content-Type':'application/json'} };
  if (body) opts.body = JSON.stringify(body);
  const res  = await fetch(url, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function toast(msg, type='success') {
  const el = document.getElementById('toast');
  const icons = { success:'✓', error:'✕', warning:'⚠', info:'ℹ' };
  el.innerHTML = `<span>${icons[type]||'•'}</span> ${msg}`;
  el.className = `show t-${type}`;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.className=''; }, 3500);
}

function fmt(d) {
  if (!d) return '—';
  return new Date(d+'T00:00:00').toLocaleDateString('en-KE',{day:'2-digit',month:'short',year:'numeric'});
}
function todayStr() { return new Date().toISOString().split('T')[0]; }
function addDays(n) { const d=new Date(); d.setDate(d.getDate()+n); return d.toISOString().split('T')[0]; }
function isOverdue(due) { return due && new Date(due) < new Date(todayStr()); }
function initials(name) { return name.split(' ').filter(Boolean).slice(0,2).map(w=>w[0].toUpperCase()).join(''); }
function statusBadge(i) {
  if (i.status==='returned') return '<span class="badge badge-green">Returned</span>';
  if (i.status==='overdue'||isOverdue(i.due_date)) return '<span class="badge badge-red">Overdue</span>';
  return '<span class="badge badge-amber">Active</span>';
}
function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
function val(id)        { return document.getElementById(id)?.value?.trim()||''; }
function enc(s)         { return encodeURIComponent(s); }
function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function emptyState(icon, msg) {
  return `<div class="empty-state"><span class="empty-icon">${icon}</span><p>${msg}</p></div>`;
}

document.querySelectorAll('.overlay').forEach(el => {
  el.addEventListener('click', e => { if (e.target===el) el.classList.remove('open'); });
});

// Live clock
function updateClock() {
  const el = document.getElementById('topbar-clock');
  if (!el) return;
  const now = new Date();
  el.textContent = now.toLocaleDateString('en-KE',{weekday:'short',day:'numeric',month:'short'})
    + '  ' + now.toLocaleTimeString('en-KE',{hour:'2-digit',minute:'2-digit'});
}
setInterval(updateClock, 1000);
updateClock();

// ── Auth panel switching ────────────────────────────────

function showPanel(id) {
  ['panel-login','panel-fp-1','panel-fp-2','panel-fp-3','panel-fp-done'].forEach(p => {
    const el = document.getElementById(p);
    if (el) el.style.display = p===id ? 'block' : 'none';
  });
}

function setRole(r) {
  currentRole = r;
  document.getElementById('tab-lib').classList.toggle('active', r==='librarian');
  document.getElementById('tab-stu').classList.toggle('active', r==='student');
}

// ── Password visibility toggle ──────────────────────────

function togglePw(inputId, btn) {
  const inp = document.getElementById(inputId);
  if (!inp) return;
  const isText = inp.type === 'text';
  inp.type = isText ? 'password' : 'text';
  btn.textContent = isText ? '👁' : '🙈';
}

// ── Password strength checker ───────────────────────────

function checkPwStrength(inputId, strengthId) {
  const pw   = document.getElementById(inputId)?.value || '';
  const wrap = document.getElementById(strengthId);
  const fill = document.getElementById(strengthId+'-fill');
  const lbl  = document.getElementById(strengthId+'-label');
  if (!wrap || !fill || !lbl) return;

  if (!pw) { wrap.style.display='none'; return; }
  wrap.style.display = 'block';

  let score = 0;
  if (pw.length >= 6)  score++;
  if (pw.length >= 10) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw))   score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;

  fill.className = 'pw-strength-fill ' + (score<=2?'weak':score<=3?'medium':'strong');
  lbl.textContent = score<=2 ? 'Weak — add numbers and symbols' : score<=3 ? 'Medium — getting there' : 'Strong password ✓';
}

// ── LOGIN ───────────────────────────────────────────────

async function doLogin() {
  const username = val('inp-user');
  const password = val('inp-pass');
  if (!username||!password) { toast('Please enter username and password','error'); return; }

  const btn = document.getElementById('login-btn');
  btn.textContent = 'Signing in…';
  btn.disabled = true;

  try {
    const data = await api('POST','/api/auth/login',{username,password});
    currentUser = data.user;
    enterApp();
  } catch(e) {
    toast(e.message,'error');
    document.getElementById('inp-pass').value = '';
  } finally {
    btn.textContent = 'Sign In →';
    btn.disabled = false;
  }
}

async function doLogout() {
  try { await api('POST','/api/auth/logout'); } catch(_) {}
  currentUser = null;
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('app-shell').style.display   = 'none';
  document.getElementById('inp-user').value = '';
  document.getElementById('inp-pass').value = '';
  showPanel('panel-login');
}

window.addEventListener('load', async () => {
  try {
    const { user } = await api('GET','/api/auth/me');
    if (user) { currentUser=user; enterApp(); }
  } catch(_) {}
});

// ── FORGOT PASSWORD flow ────────────────────────────────

async function fpLookup() {
  const username = val('fp-username');
  const errEl    = document.getElementById('fp1-err');
  errEl.classList.remove('show'); errEl.textContent='';

  if (!username) { errEl.textContent='Please enter your username.'; errEl.classList.add('show'); return; }

  try {
    const data = await api('POST','/api/auth/forgot-password/lookup',{username});
    document.getElementById('fp-name-display').textContent     = data.full_name;
    document.getElementById('fp-question-display').textContent = data.security_question;
    showPanel('panel-fp-2');
  } catch(e) {
    errEl.textContent = e.message;
    errEl.classList.add('show');
  }
}

async function fpVerify() {
  const username = val('fp-username');
  const answer   = val('fp-answer');
  const errEl    = document.getElementById('fp2-err');
  errEl.classList.remove('show'); errEl.textContent='';

  if (!answer) { errEl.textContent='Please enter your answer.'; errEl.classList.add('show'); return; }

  try {
    const data = await api('POST','/api/auth/forgot-password/verify',{username,security_answer:answer});
    fpToken = data.token;
    showPanel('panel-fp-3');
  } catch(e) {
    errEl.textContent = e.message;
    errEl.classList.add('show');
    document.getElementById('fp-answer').value = '';
  }
}

async function fpReset() {
  const new_password     = val('fp-newpass');
  const confirm_password = val('fp-confirmpass');
  const errEl            = document.getElementById('fp3-err');
  errEl.classList.remove('show'); errEl.textContent='';

  if (!new_password||!confirm_password) { errEl.textContent='Both fields are required.'; errEl.classList.add('show'); return; }
  if (new_password!==confirm_password)  { errEl.textContent='Passwords do not match.';   errEl.classList.add('show'); return; }
  if (new_password.length<6)            { errEl.textContent='Password must be at least 6 characters.'; errEl.classList.add('show'); return; }

  try {
    await api('POST','/api/auth/forgot-password/reset',{token:fpToken,new_password,confirm_password});
    fpToken = null;
    ['fp-username','fp-answer','fp-newpass','fp-confirmpass'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value='';
    });
    showPanel('panel-fp-done');
  } catch(e) {
    errEl.textContent = e.message;
    errEl.classList.add('show');
  }
}

// ── APP ENTRY ───────────────────────────────────────────

function enterApp() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app-shell').style.display   = 'block';

  document.getElementById('sb-avatar').textContent = initials(currentUser.full_name);
  document.getElementById('sb-name').textContent   = currentUser.full_name;
  document.getElementById('sb-role').textContent   = currentUser.role==='librarian'?'Librarian':'Student';

  const hr    = new Date().getHours();
  const greet = hr<12?'morning':hr<17?'afternoon':'evening';
  const grEl  = document.getElementById('greeting-time');
  if (grEl) grEl.textContent = greet;

  buildSideNav();

  if (currentUser.role==='librarian') {
    showPage('overview');
  } else {
    const wnEl = document.getElementById('stu-welcome-name');
    if (wnEl) wnEl.textContent = currentUser.full_name.split(' ')[0];
    showPage('stu-overview');
  }

  loadSecurityQuestionsList();
  checkSecurityQuestionStatus();
}

// ── SIDEBAR NAV ─────────────────────────────────────────

function buildSideNav() {
  const libSections = [
    { label:'Main',   items:[{ key:'overview', icon:'⊞', label:'Dashboard' }] },
    { label:'Library',items:[
      { key:'books',   icon:'◫', label:'Books' },
      { key:'issue',   icon:'↗', label:'Issue Book' },
      { key:'returns', icon:'↙', label:'Returns & Loans' },
    ]},
    { label:'People', items:[
      { key:'students', icon:'◎', label:'Students' },
      { key:'activity', icon:'≡', label:'Activity Log' },
    ]},
    { label:'Account',items:[{ key:'settings', icon:'⚙', label:'Account Settings' }] },
  ];

  const stuSections = [
    { label:'My Portal', items:[
      { key:'stu-overview', icon:'⊞', label:'Dashboard' },
      { key:'search',       icon:'◯', label:'Search Books' },
      { key:'my-books',     icon:'◫', label:'My Books' },
    ]},
    { label:'Account', items:[
      { key:'settings',     icon:'⚙', label:'Account Settings' },
    ]},
  ];

  const sections = currentUser.role==='librarian' ? libSections : stuSections;

  document.getElementById('sidebar-nav').innerHTML = sections.map(sec => `
    <div class="nav-section">
      <div class="nav-section-label">${sec.label}</div>
      ${sec.items.map(item => `
        <button class="nav-item" id="nav-${item.key}" onclick="showPage('${item.key}')">
          <span class="nav-item-icon">${item.icon}</span>
          <span class="nav-item-label">${item.label}</span>
        </button>`).join('')}
    </div>`).join('');
}

// ── PAGE ROUTING ────────────────────────────────────────

const PAGE_TITLES = {
  'overview':'Dashboard','books':'Book Catalogue','issue':'Issue a Book',
  'returns':'Returns & Loans','students':'Students','activity':'Activity Log',
  'stu-overview':'My Dashboard','search':'Search Books','my-books':'My Books',
  'settings':'Account Settings',
};

function showPage(key) {
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  const pg  = document.getElementById(`pg-${key}`);
  const nav = document.getElementById(`nav-${key}`);
  if (pg)  pg.classList.add('active');
  if (nav) nav.classList.add('active');
  document.getElementById('topbar-title').textContent = PAGE_TITLES[key]||key;

  if      (key==='overview')     loadDashboard();
  else if (key==='books')        { loadBooks(); fillCatFilter('book-cat'); }
  else if (key==='issue')        loadIssueForm();
  else if (key==='returns')      loadReturns();
  else if (key==='students')     loadStudents();
  else if (key==='activity')     loadActivity();
  else if (key==='stu-overview') loadStuDash();
  else if (key==='search')       { doSearch(); fillCatFilter('srch-cat'); }
  else if (key==='my-books')     loadMyBooks();
  else if (key==='settings')     loadSettingsPage();
}

// ── LIBRARIAN: Dashboard ────────────────────────────────

async function loadDashboard() {
  try {
    const s = await api('GET','/api/stats');
    document.getElementById('stats-grid').innerHTML = [
      {icon:'📖',label:'Book Titles',    val:s.total_books,      sub:`${s.total_copies} total copies`,accent:'var(--green)',  cls:''},
      {icon:'📦',label:'Available Now',  val:s.books_available,  sub:'ready to borrow',               accent:'var(--blue)',   cls:'blue'},
      {icon:'👥',label:'Students',       val:s.total_students,   sub:'registered',                    accent:'var(--purple)', cls:''},
      {icon:'📤',label:'Active Loans',   val:s.total_issued,     sub:'currently out',                 accent:'var(--amber)',  cls:'amber'},
      {icon:'⚠️',label:'Overdue',        val:s.total_overdue,    sub:'need attention',                accent:'var(--red)',    cls:s.total_overdue>0?'red':''},
      {icon:'💰',label:'Fines Accrued',  val:`KSh ${s.total_fines}`,sub:'outstanding',               accent:'var(--red)',    cls:s.total_fines>0?'red':''},
    ].map(c=>`<div class="stat-card" style="--stat-accent:${c.accent}">
      <div class="stat-icon">${c.icon}</div><div class="stat-label">${c.label}</div>
      <div class="stat-num ${c.cls}">${c.val}</div><div class="stat-sub">${c.sub}</div>
    </div>`).join('');

    const rows = s.recent_issues.length
      ? s.recent_issues.map(i=>`<tr>
          <td><div style="display:flex;align-items:center;gap:10px">
            <div class="book-cover" style="background:${i.cover_color||'#2D6A4F'}">📖</div>
            <div class="td-bold">${esc(i.book_title)}</div>
          </div></td>
          <td>${esc(i.student_name)}</td>
          <td>${fmt(i.issue_date)}</td><td>${fmt(i.due_date)}</td>
          <td>${statusBadge(i)}</td></tr>`).join('')
      : `<tr><td colspan="5">${emptyState('📭','No transactions yet')}</td></tr>`;

    document.getElementById('recent-table').innerHTML = `<table><thead>
      <tr><th>Book</th><th>Student</th><th>Issued</th><th>Due</th><th>Status</th></tr>
    </thead><tbody>${rows}</tbody></table>`;

    document.getElementById('cat-breakdown').innerHTML = s.category_stats.map(c=>`
      <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)">
        <span style="font-size:13px;font-weight:500">${esc(c.category)}</span>
        <div style="display:flex;align-items:center;gap:8px">
          <div style="width:70px;height:6px;background:var(--border-mid);border-radius:3px;overflow:hidden">
            <div style="width:${Math.round((c.available/c.count)*100)}%;height:100%;background:var(--green);border-radius:3px"></div>
          </div>
          <span class="badge badge-green">${c.available}/${c.count}</span>
        </div>
      </div>`).join('')||'<p style="color:var(--text-muted);font-size:13px">No books yet</p>';
  } catch(e) { toast('Failed to load dashboard','error'); }
}

async function refreshOverdue() {
  const res = await api('POST','/api/issues/update-overdue');
  toast(`Updated ${res.updated} overdue record(s)`);
  loadDashboard();
}

// ── LIBRARIAN: Books ────────────────────────────────────

async function loadBooks() {
  const q   = val('book-q')||'';
  const cat = document.getElementById('book-cat')?.value||'all';
  try {
    const books = await api('GET',`/api/books?q=${enc(q)}&category=${enc(cat)}`);
    if (!books.length) { document.getElementById('books-tbl').innerHTML=emptyState('📭','No books found'); return; }
    document.getElementById('books-tbl').innerHTML = `<table><thead>
      <tr><th>Book</th><th>Category</th><th>ISBN</th><th>Year</th><th>Copies</th><th>Available</th><th></th></tr>
    </thead><tbody>${books.map(b=>`<tr>
      <td><div style="display:flex;align-items:center;gap:12px">
        <div class="book-cover" style="background:${b.cover_color||'#2D6A4F'}">📖</div>
        <div><div class="td-bold">${esc(b.title)}</div><div class="td-muted">${esc(b.author)}</div></div>
      </div></td>
      <td><span class="cat-pill">${esc(b.category)}</span></td>
      <td><span class="td-mono">${b.isbn||'—'}</span></td>
      <td>${b.year||'—'}</td><td>${b.total_copies}</td>
      <td><span class="badge ${b.available>0?'badge-green':'badge-red'}">${b.available}</span></td>
      <td><button class="btn btn-danger btn-sm" onclick="removeBook(${b.id},'${esc(b.title)}')">Remove</button></td>
    </tr>`).join('')}</tbody></table>`;
  } catch(e) { toast('Failed to load books','error'); }
}

async function fillCatFilter(selectId) {
  try {
    const cats = await api('GET','/api/categories');
    const sel  = document.getElementById(selectId);
    if (!sel) return;
    const cur  = sel.value;
    sel.innerHTML = '<option value="all">All Categories</option>'+
      cats.map(c=>`<option value="${esc(c)}" ${c===cur?'selected':''}>${esc(c)}</option>`).join('');
  } catch(_) {}
}

async function submitBook() {
  const body = {
    title:val('nb-title'),author:val('nb-author'),isbn:val('nb-isbn'),
    category:val('nb-cat'),publisher:val('nb-pub'),year:val('nb-year'),
    total_copies:val('nb-copies'),cover_color:val('nb-color'),
  };
  if (!body.title||!body.author) { toast('Title and author required','error'); return; }
  try {
    await api('POST','/api/books',body);
    toast(`"${body.title}" added ✓`);
    closeModal('m-add-book');
    ['nb-title','nb-author','nb-isbn','nb-pub','nb-year'].forEach(id=>{document.getElementById(id).value='';});
    document.getElementById('nb-copies').value='1';
    loadBooks();
  } catch(e) { toast(e.message,'error'); }
}

async function removeBook(id, title) {
  if (!confirm(`Remove "${title}"?\nThis cannot be undone.`)) return;
  try { await api('DELETE',`/api/books/${id}`); toast('Book removed'); loadBooks(); }
  catch(e) { toast(e.message,'error'); }
}

// ── LIBRARIAN: Issue ────────────────────────────────────

async function loadIssueForm() {
  document.getElementById('iss-date').value = todayStr();
  document.getElementById('iss-due').value  = addDays(21);
  try {
    const [students,books] = await Promise.all([api('GET','/api/students'),api('GET','/api/books')]);
    document.getElementById('iss-student').innerHTML = students.length
      ? students.map(s=>`<option value="${s.student_id}">${s.student_id} — ${esc(s.full_name)} (${esc(s.grade)})</option>`).join('')
      : '<option disabled>No students registered</option>';
    const avail = books.filter(b=>b.available>0);
    document.getElementById('iss-book').innerHTML = avail.length
      ? avail.map(b=>`<option value="${b.id}">${esc(b.title)} — ${esc(b.author)} (${b.available} left)</option>`).join('')
      : '<option disabled>No books available</option>';
  } catch(e) { toast('Failed to load form','error'); }
}

async function doIssue() {
  const body = {
    book_id:val('iss-book'),student_id:val('iss-student'),
    issue_date:val('iss-date'),due_date:val('iss-due'),notes:val('iss-notes'),
  };
  if (!body.book_id||!body.student_id||!body.issue_date||!body.due_date) return toast('All fields required','error');
  if (body.due_date<=body.issue_date) return toast('Due date must be after issue date','error');
  try {
    await api('POST','/api/issues',body);
    toast('Book issued ✓');
    document.getElementById('iss-notes').value='';
    loadIssueForm();
  } catch(e) { toast(e.message,'error'); }
}

// ── LIBRARIAN: Returns ──────────────────────────────────

async function loadReturns() {
  const status = document.getElementById('ret-status')?.value||'issued';
  try {
    const issues = await api('GET',`/api/issues?status=${status}`);
    if (!issues.length) { document.getElementById('returns-tbl').innerHTML=emptyState('✅',`No ${status} books`); return; }
    const showRet = status!=='returned';
    document.getElementById('returns-tbl').innerHTML = `<table><thead>
      <tr><th>Book</th><th>Student</th><th>Issue Date</th><th>Due Date</th><th>Status</th><th>Fine</th>${showRet?'<th></th>':''}</tr>
    </thead><tbody>${issues.map(i=>`<tr>
      <td><div style="display:flex;align-items:center;gap:10px">
        <div class="book-cover" style="background:${i.cover_color||'#2D6A4F'}">📖</div>
        <div><div class="td-bold">${esc(i.book_title)}</div><div class="td-muted">${esc(i.book_author)}</div></div>
      </div></td>
      <td><div style="display:flex;align-items:center;gap:8px">
        <div class="stu-av" style="width:28px;height:28px;font-size:10px">${initials(i.student_name)}</div>
        <div><div class="td-bold">${esc(i.student_name)}</div><div class="td-muted">${i.student_id}</div></div>
      </div></td>
      <td>${fmt(i.issue_date)}</td><td>${fmt(i.due_date)}</td>
      <td>${statusBadge(i)}</td>
      <td>${i.fine_amount>0?`<span class="badge badge-red">KSh ${i.fine_amount}</span>`:'—'}</td>
      ${showRet?`<td><button class="btn btn-success btn-sm" onclick="confirmReturn(${i.id},'${esc(i.book_title)}','${esc(i.student_name)}',${i.fine_amount||0})">Return</button></td>`:''}
    </tr>`).join('')}</tbody></table>`;
  } catch(e) { toast('Failed to load returns','error'); }
}

function confirmReturn(id, bookTitle, studentName, fine) {
  document.getElementById('return-msg').innerHTML =
    `Return <strong>${esc(bookTitle)}</strong> from <strong>${esc(studentName)}</strong>.<br/>Return date: <strong>${fmt(todayStr())}</strong>`;
  document.getElementById('fine-preview').innerHTML = fine>0
    ? `<div class="alert alert-red">⚠️ Accrued fine: <strong>KSh ${fine}</strong>. Collect before returning.</div>`
    : '<div class="alert alert-green">✓ No outstanding fines on this loan</div>';
  document.getElementById('return-confirm-btn').onclick = ()=>processReturn(id);
  openModal('m-return');
}

async function processReturn(id) {
  try {
    const data = await api('PUT',`/api/issues/${id}/return`);
    closeModal('m-return');
    toast(data.days_late>0?`Returned — ${data.days_late} day(s) late. Fine: KSh ${data.fine}`:'Returned on time ✓', data.days_late>0?'warning':'success');
    loadReturns();
  } catch(e) { toast(e.message,'error'); }
}

// ── LIBRARIAN: Students ─────────────────────────────────

async function loadStudents() {
  const q = val('stu-q')||'';
  try {
    const students = await api('GET',`/api/students?q=${enc(q)}`);
    if (!students.length) { document.getElementById('students-tbl').innerHTML=emptyState('👥','No students found'); return; }
    document.getElementById('students-tbl').innerHTML = `<table><thead>
      <tr><th>Student</th><th>ID</th><th>Username</th><th>Grade</th><th>Contact</th><th>Registered</th><th></th></tr>
    </thead><tbody>${students.map(s=>`<tr>
      <td><div style="display:flex;align-items:center;gap:10px">
        <div class="stu-av">${initials(s.full_name)}</div>
        <div class="td-bold">${esc(s.full_name)}</div>
      </div></td>
      <td><span class="td-mono">${s.student_id}</span></td>
      <td><span class="td-mono" style="color:var(--green-dark)">${esc(s.username||'—')}</span></td>
      <td>${esc(s.grade)}</td>
      <td><div class="td-muted">${s.email||'—'}</div><div class="td-muted">${s.phone||'—'}</div></td>
      <td>${fmt(s.registered_at)}</td>
      <td><button class="btn btn-danger btn-sm" onclick="removeStudent('${s.student_id}','${esc(s.full_name)}')">Remove</button></td>
    </tr>`).join('')}</tbody></table>`;
  } catch(e) { toast('Failed to load students','error'); }
}

async function submitStudent() {
  const full_name = val('ns-name');
  const grade     = val('ns-grade');
  const email     = val('ns-email');
  const phone     = val('ns-phone');
  const username  = val('ns-username').toLowerCase().replace(/\s+/g,'');
  const password  = val('ns-password');

  if (!full_name)       { toast('Full name is required','error'); return; }
  if (!username)        { toast('Username is required','error'); return; }
  if (!/^[a-z0-9._-]+$/.test(username)) { toast('Username can only contain letters, numbers, dots, dashes','error'); return; }
  if (!password || password.length < 6) { toast('Password must be at least 6 characters','error'); return; }

  try {
    const data = await api('POST', '/api/students', { full_name, grade, email, phone, username, password });

    // Show success panel with credentials
    document.getElementById('succ-sid').textContent      = data.student_id;
    document.getElementById('succ-name').textContent     = full_name;
    document.getElementById('succ-username').textContent = data.username;
    document.getElementById('succ-password').textContent = data.temp_password;

    document.getElementById('m-add-student-body').style.display         = 'none';
    document.getElementById('m-add-student-success').style.display      = 'block';
    document.getElementById('m-add-student-footer').style.display       = 'none';
    document.getElementById('m-add-student-done-footer').style.display  = 'flex';

    loadStudents();
  } catch(e) { toast(e.message,'error'); }
}

function closeStudentModal() {
  closeModal('m-add-student');
  // Reset modal back to form state for next use
  setTimeout(() => {
    document.getElementById('m-add-student-body').style.display        = 'block';
    document.getElementById('m-add-student-success').style.display     = 'none';
    document.getElementById('m-add-student-footer').style.display      = 'flex';
    document.getElementById('m-add-student-done-footer').style.display = 'none';
    ['ns-name','ns-email','ns-phone','ns-username','ns-password'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
  }, 350);
}

async function removeStudent(id, name) {
  if (!confirm(`Remove "${name}" (${id})?\n\nThis will also delete their login account.`)) return;
  try { await api('DELETE',`/api/students/${id}`); toast('Student removed'); loadStudents(); }
  catch(e) { toast(e.message,'error'); }
}

// ── LIBRARIAN: Activity ─────────────────────────────────

async function loadActivity() {
  try {
    const logs = await api('GET','/api/activity');
    if (!logs.length) { document.getElementById('activity-tbl').innerHTML=emptyState('📋','No activity yet'); return; }
    const cols={login:'badge-blue',logout:'badge-gray',add_book:'badge-green',delete_book:'badge-red',
                add_student:'badge-green',delete_student:'badge-red',issue_book:'badge-amber',return_book:'badge-green',
                change_password:'badge-teal',reset_password:'badge-amber',set_security_question:'badge-blue',reset_requested:'badge-amber'};
    document.getElementById('activity-tbl').innerHTML = `<table><thead>
      <tr><th>Time</th><th>User</th><th>Action</th><th>Details</th></tr>
    </thead><tbody>${logs.map(l=>`<tr>
      <td style="white-space:nowrap;font-size:12px;color:var(--text-muted)">${new Date(l.logged_at).toLocaleString('en-KE',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}</td>
      <td style="font-weight:600;font-size:13px">${esc(l.user_name||'System')}</td>
      <td><span class="badge ${cols[l.action]||'badge-gray'}">${l.action.replace(/_/g,' ')}</span></td>
      <td style="font-size:13px;color:var(--text-2)">${esc(l.details||'—')}</td>
    </tr>`).join('')}</tbody></table>`;
  } catch(e) { toast('Failed to load activity','error'); }
}

// ── STUDENT: Dashboard ──────────────────────────────────

async function loadStuDash() {
  try {
    const [stats,issues] = await Promise.all([api('GET','/api/student-stats'),api('GET','/api/issues')]);
    document.getElementById('stu-stats').innerHTML = [
      {icon:'📤',label:'Currently Borrowed',val:stats.active,  accent:'var(--amber)',  cls:'amber'},
      {icon:'⚠️',label:'Overdue',           val:stats.overdue, accent:'var(--red)',    cls:stats.overdue>0?'red':''},
      {icon:'✅',label:'Books Returned',     val:stats.history, accent:'var(--green)',  cls:'green'},
      {icon:'💰',label:'Accrued Fines',      val:`KSh ${stats.fines}`,accent:'var(--red)',cls:stats.fines>0?'red':''},
    ].map(c=>`<div class="stat-card" style="--stat-accent:${c.accent}">
      <div class="stat-icon">${c.icon}</div><div class="stat-label">${c.label}</div>
      <div class="stat-num ${c.cls}">${c.val}</div></div>`).join('');

    const active = issues.filter(i=>i.status!=='returned');
    document.getElementById('stu-active-tbl').innerHTML = active.length
      ? `<table><thead><tr><th>Book</th><th>Issue Date</th><th>Due Date</th><th>Status</th><th>Fine</th></tr></thead>
        <tbody>${active.map(i=>`<tr>
          <td><div style="display:flex;align-items:center;gap:10px">
            <div class="book-cover" style="background:${i.cover_color||'#2D6A4F'}">📖</div>
            <div><div class="td-bold">${esc(i.book_title)}</div><div class="td-muted">${esc(i.book_author)}</div></div>
          </div></td>
          <td>${fmt(i.issue_date)}</td><td>${fmt(i.due_date)}</td>
          <td>${statusBadge(i)}</td>
          <td>${i.fine_amount>0?`<span class="badge badge-red">KSh ${i.fine_amount}</span>`:'—'}</td>
        </tr>`).join('')}</tbody></table>`
      : emptyState('📚','No books currently borrowed');
  } catch(e) { toast('Failed to load dashboard','error'); }
}

// ── STUDENT: Search ─────────────────────────────────────

async function doSearch() {
  const q   = val('srch-q')||'';
  const cat = document.getElementById('srch-cat')?.value||'all';
  try {
    const books = await api('GET',`/api/books?q=${enc(q)}&category=${enc(cat)}`);
    document.getElementById('search-grid').innerHTML = books.length
      ? books.map(b=>`<div class="book-card">
          <div class="book-card-cover" style="background:${b.cover_color||'#2D6A4F'}">📖</div>
          <div>
            <div class="book-card-title">${esc(b.title)}</div>
            <div class="book-card-author">${esc(b.author)}</div>
            ${b.isbn?`<div style="font-size:11px;color:var(--text-muted);margin-top:2px">ISBN: ${esc(b.isbn)}</div>`:''}
          </div>
          <div class="book-card-footer">
            <span class="cat-pill">${esc(b.category)}</span>
            <span class="badge ${b.available>0?'badge-green':'badge-red'}">${b.available>0?`${b.available} available`:'Unavailable'}</span>
          </div>
        </div>`).join('')
      : `<div style="grid-column:1/-1">${emptyState('🔍','No books found')}</div>`;
  } catch(e) { toast('Search failed','error'); }
}

// ── STUDENT: My Books ───────────────────────────────────

async function loadMyBooks() {
  try {
    const issues  = await api('GET','/api/issues');
    const active  = issues.filter(i=>i.status!=='returned');
    const history = issues.filter(i=>i.status==='returned');
    const fined   = active.filter(i=>i.fine_amount>0||isOverdue(i.due_date));
    let html = '';
    if (fined.length) html+=`<div class="alert alert-red">⚠️ You have <strong>${fined.length}</strong> overdue book(s). Fines accrue at <strong>KSh 5/day</strong>.</div>`;
    html+=`<div class="card" style="margin-bottom:1.5rem">
      <div class="card-header"><span class="card-title">Currently Borrowed (${active.length})</span></div>
      ${active.length?`<div class="table-wrap"><table><thead>
        <tr><th>Book</th><th>Issue Date</th><th>Due Date</th><th>Status</th><th>Fine</th></tr>
      </thead><tbody>${active.map(i=>`<tr>
        <td><div style="display:flex;align-items:center;gap:10px">
          <div class="book-cover" style="background:${i.cover_color||'#2D6A4F'}">📖</div>
          <div><div class="td-bold">${esc(i.book_title)}</div><div class="td-muted">${esc(i.book_author)}</div></div>
        </div></td>
        <td>${fmt(i.issue_date)}</td><td>${fmt(i.due_date)}</td>
        <td>${statusBadge(i)}</td>
        <td>${i.fine_amount>0?`<span class="badge badge-red">KSh ${i.fine_amount}</span>`:'—'}</td>
      </tr>`).join('')}</tbody></table></div>`
      :`<div class="card-body">${emptyState('📚','No books currently borrowed')}</div>`}
    </div>`;
    if (history.length) html+=`<div class="card">
      <div class="card-header"><span class="card-title">Borrowing History (${history.length})</span></div>
      <div class="table-wrap"><table><thead>
        <tr><th>Book</th><th>Issue Date</th><th>Due Date</th><th>Returned</th></tr>
      </thead><tbody>${history.map(i=>`<tr>
        <td><div style="display:flex;align-items:center;gap:10px">
          <div class="book-cover" style="background:${i.cover_color||'#2D6A4F'}">📖</div>
          <div><div class="td-bold">${esc(i.book_title)}</div><div class="td-muted">${esc(i.book_author)}</div></div>
        </div></td>
        <td>${fmt(i.issue_date)}</td><td>${fmt(i.due_date)}</td><td>${fmt(i.return_date)}</td>
      </tr>`).join('')}</tbody></table></div></div>`;
    document.getElementById('my-books-body').innerHTML = html;
  } catch(e) { toast('Failed to load your books','error'); }
}

// ── SETTINGS: Change Password ───────────────────────────

async function doChangePassword() {
  const current  = val('cp-current');
  const newpw    = val('cp-new');
  const confirm  = val('cp-confirm');

  if (!current||!newpw||!confirm) { toast('All fields are required','error'); return; }
  if (newpw!==confirm) { toast('New passwords do not match','error'); return; }
  if (newpw.length<6)  { toast('Password must be at least 6 characters','error'); return; }

  try {
    await api('POST','/api/auth/change-password',{current_password:current,new_password:newpw,confirm_password:confirm});
    toast('Password changed successfully ✓');
    ['cp-current','cp-new','cp-confirm'].forEach(id=>{document.getElementById(id).value='';});
    const s=document.getElementById('cp-strength');
    if(s) s.style.display='none';
  } catch(e) { toast(e.message,'error'); }
}

// ── SETTINGS: Security Question ─────────────────────────

async function loadSecurityQuestionsList() {
  try {
    const questions = await api('GET','/api/security-questions');
    const sel = document.getElementById('sq-question');
    if (!sel) return;
    sel.innerHTML = questions.map(q=>`<option value="${esc(q)}">${esc(q)}</option>`).join('');
  } catch(_) {}
}

async function checkSecurityQuestionStatus() {
  try {
    const res   = await api('GET','/api/auth/security-question-set');
    const alert = document.getElementById('sq-status-alert');
    if (!alert) return;
    if (res.set) {
      alert.className    = 'alert alert-green';
      alert.style.display= 'flex';
      alert.innerHTML    = '🛡️ &nbsp;Security question is set. You can update it below.';
    } else {
      alert.className    = 'alert alert-amber';
      alert.style.display= 'flex';
      alert.innerHTML    = '⚠️ &nbsp;No security question set. Set one below so you can recover your account if you forget your password.';
    }
  } catch(_) {}
}

async function doSetSecurityQuestion() {
  const question   = val('sq-question');
  const answer     = val('sq-answer');
  const currentpw  = val('sq-currentpw');

  if (!question||!answer||!currentpw) { toast('All fields are required','error'); return; }
  if (answer.length<2) { toast('Answer must be at least 2 characters','error'); return; }

  try {
    await api('POST','/api/auth/set-security-question',{question,answer,current_password:currentpw});
    toast('Security question saved ✓');
    ['sq-answer','sq-currentpw'].forEach(id=>{document.getElementById(id).value='';});
    checkSecurityQuestionStatus();
  } catch(e) { toast(e.message,'error'); }
}

function loadSettingsPage() {
  checkSecurityQuestionStatus();
  // Clear change-password fields for freshness
  ['cp-current','cp-new','cp-confirm'].forEach(id=>{
    const el=document.getElementById(id); if(el) el.value='';
  });
  const s=document.getElementById('cp-strength'); if(s) s.style.display='none';
}
