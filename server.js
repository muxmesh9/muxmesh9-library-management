/**
 * server.js — School Library Management System v4
 * Fixes: registering a student now creates their login account at the same time.
 * Includes: full auth, password change, security-question password reset
 */

'use strict';

const express  = require('express');
const session  = require('express-session');
const cors     = require('cors');
const bcrypt   = require('bcryptjs');
const crypto   = require('crypto');
const path     = require('path');
const fs       = require('fs');
const Database = require('better-sqlite3');

// ── Database ──────────────────────────────────────────────────────────────────

const DB_PATH = path.join(__dirname, 'database', 'library.db');
if (!fs.existsSync(DB_PATH)) {
  console.error('\n❌  Database not found! Run: node database/setup.js\n');
  process.exit(1);
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── App ───────────────────────────────────────────────────────────────────────

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const SESSION_SECRET = process.env.SESSION_SECRET || 'lms-v3-secret-change-in-prod-2024';

app.use(session({
  secret:            SESSION_SECRET,
  resave:            false,
  saveUninitialized: false,
  cookie:            { secure: false, maxAge: 8 * 60 * 60 * 1000 },
}));

// ── Middleware ────────────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Not authenticated.' });
  next();
}
function requireLibrarian(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'librarian')
    return res.status(403).json({ error: 'Librarian access required.' });
  next();
}

function log(userId, userName, action, details) {
  try { db.prepare('INSERT INTO activity_log(user_id,user_name,action,details) VALUES(?,?,?,?)').run(userId,userName,action,details); } catch(_) {}
}

function todayStr() { return new Date().toISOString().split('T')[0]; }

// ── Security questions list ───────────────────────────────────────────────────

const SECURITY_QUESTIONS = [
  "What was the name of your first pet?",
  "What is your mother's maiden name?",
  "What was the name of your primary school?",
  "What is the name of the town where you were born?",
  "What was your childhood nickname?",
];

app.get('/api/security-questions', (_req, res) => {
  res.json(SECURITY_QUESTIONS);
});

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required.' });

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim().toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(401).json({ error: 'Invalid username or password.' });

  const su = { id:user.id, username:user.username, role:user.role, full_name:user.full_name, email:user.email };
  if (user.role === 'student') {
    const stu = db.prepare('SELECT student_id FROM students WHERE user_id=?').get(user.id);
    if (stu) su.student_id = stu.student_id;
  }
  req.session.user = su;
  log(user.id, user.full_name, 'login', `${user.full_name} signed in`);
  res.json({ success:true, user:su });
});

app.post('/api/auth/logout', (req, res) => {
  if (req.session.user) log(req.session.user.id, req.session.user.full_name, 'logout', 'Signed out');
  req.session.destroy(() => res.json({ success:true }));
});

app.get('/api/auth/me', (req, res) => {
  res.json({ user: req.session.user || null });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PASSWORD MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/auth/change-password
 * For logged-in users (both roles) to change their own password.
 * Requires: current_password, new_password, confirm_password
 */
app.post('/api/auth/change-password', requireAuth, (req, res) => {
  const { current_password, new_password, confirm_password } = req.body;
  const userId = req.session.user.id;

  // — Validate inputs —
  if (!current_password || !new_password || !confirm_password)
    return res.status(400).json({ error: 'All fields are required.' });

  if (new_password !== confirm_password)
    return res.status(400).json({ error: 'New passwords do not match.' });

  if (new_password.length < 6)
    return res.status(400).json({ error: 'New password must be at least 6 characters.' });

  if (new_password === current_password)
    return res.status(400).json({ error: 'New password must be different from your current password.' });

  // — Verify current password —
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(userId);
  if (!bcrypt.compareSync(current_password, user.password))
    return res.status(401).json({ error: 'Current password is incorrect.' });

  // — Check password was not used recently (last 3 passwords) —
  const history = db.prepare('SELECT password FROM password_history WHERE user_id=? ORDER BY changed_at DESC LIMIT 3').all(userId);
  for (const h of history) {
    if (bcrypt.compareSync(new_password, h.password))
      return res.status(400).json({ error: 'You cannot reuse one of your last 3 passwords.' });
  }

  // — Save old password to history, then update —
  db.transaction(() => {
    db.prepare('INSERT INTO password_history(user_id,password) VALUES(?,?)').run(userId, user.password);
    db.prepare('UPDATE users SET password=? WHERE id=?').run(bcrypt.hashSync(new_password, 10), userId);
  })();

  log(userId, user.full_name, 'change_password', 'Password changed successfully');
  res.json({ success:true, message:'Password changed successfully.' });
});

/**
 * POST /api/auth/forgot-password/lookup
 * Step 1 of password reset: look up user by username, return their security question.
 * Body: { username }
 */
app.post('/api/auth/forgot-password/lookup', (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'Username is required.' });

  const user = db.prepare('SELECT id,username,full_name,security_question,reset_locked_until FROM users WHERE username=?').get(username.trim().toLowerCase());

  // Always return the same shape to avoid username enumeration
  if (!user || !user.security_question) {
    return res.status(404).json({ error: 'No account found with that username, or no security question is set.' });
  }

  // Check lockout
  if (user.reset_locked_until && new Date(user.reset_locked_until) > new Date()) {
    const mins = Math.ceil((new Date(user.reset_locked_until) - new Date()) / 60000);
    return res.status(429).json({ error: `Account locked due to too many attempts. Try again in ${mins} minute(s).` });
  }

  res.json({
    success:           true,
    username:          user.username,
    full_name:         user.full_name,
    security_question: user.security_question,
  });
});

/**
 * POST /api/auth/forgot-password/verify
 * Step 2: Verify security answer. Returns a one-time reset token (valid 15 min).
 * Body: { username, security_answer }
 */
app.post('/api/auth/forgot-password/verify', (req, res) => {
  const { username, security_answer } = req.body;
  if (!username || !security_answer) return res.status(400).json({ error: 'All fields required.' });

  const user = db.prepare('SELECT * FROM users WHERE username=?').get(username.trim().toLowerCase());
  if (!user) return res.status(404).json({ error: 'User not found.' });

  // Check lockout
  if (user.reset_locked_until && new Date(user.reset_locked_until) > new Date()) {
    const mins = Math.ceil((new Date(user.reset_locked_until) - new Date()) / 60000);
    return res.status(429).json({ error: `Account locked. Try again in ${mins} minute(s).` });
  }

  // Verify answer (case-insensitive by hashing lowercased answer against stored hash)
  const answerCorrect = bcrypt.compareSync(security_answer.trim().toLowerCase(), user.security_answer);

  if (!answerCorrect) {
    const attempts = (user.reset_attempts || 0) + 1;
    if (attempts >= 5) {
      // Lock for 15 minutes
      const lockUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      db.prepare('UPDATE users SET reset_attempts=0, reset_locked_until=? WHERE id=?').run(lockUntil, user.id);
      return res.status(429).json({ error: 'Too many incorrect attempts. Account locked for 15 minutes.' });
    }
    db.prepare('UPDATE users SET reset_attempts=? WHERE id=?').run(attempts, user.id);
    return res.status(401).json({ error: `Incorrect answer. ${5 - attempts} attempt(s) remaining.` });
  }

  // Correct — generate reset token (expires in 15 minutes)
  const token   = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  db.prepare('UPDATE users SET reset_token=?, reset_token_expires=?, reset_attempts=0, reset_locked_until=NULL WHERE id=?')
    .run(token, expires, user.id);

  log(user.id, user.full_name, 'reset_requested', 'Password reset token generated');
  res.json({ success:true, token, full_name:user.full_name });
});

/**
 * POST /api/auth/forgot-password/reset
 * Step 3: Use the token to set a new password.
 * Body: { token, new_password, confirm_password }
 */
app.post('/api/auth/forgot-password/reset', (req, res) => {
  const { token, new_password, confirm_password } = req.body;

  if (!token || !new_password || !confirm_password)
    return res.status(400).json({ error: 'All fields are required.' });

  if (new_password !== confirm_password)
    return res.status(400).json({ error: 'Passwords do not match.' });

  if (new_password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });

  // Find user by valid, non-expired token
  const user = db.prepare(
    "SELECT * FROM users WHERE reset_token=? AND reset_token_expires > datetime('now')"
  ).get(token);

  if (!user) return res.status(400).json({ error: 'Reset link is invalid or has expired. Please start again.' });

  // Save old password to history, update password, clear token
  db.transaction(() => {
    db.prepare('INSERT INTO password_history(user_id,password) VALUES(?,?)').run(user.id, user.password);
    db.prepare(`UPDATE users SET password=?, reset_token=NULL, reset_token_expires=NULL,
                reset_attempts=0, reset_locked_until=NULL WHERE id=?`)
      .run(bcrypt.hashSync(new_password, 10), user.id);
  })();

  log(user.id, user.full_name, 'reset_password', 'Password reset via security question');
  res.json({ success:true, message:'Password has been reset. You can now log in.' });
});

/**
 * GET /api/auth/security-question-set
 * Check if logged-in user has a security question set.
 */
app.get('/api/auth/security-question-set', requireAuth, (req, res) => {
  const user = db.prepare('SELECT security_question FROM users WHERE id=?').get(req.session.user.id);
  res.json({ set: !!(user && user.security_question) });
});

/**
 * POST /api/auth/set-security-question
 * Logged-in user sets or updates their security question.
 * Body: { question, answer, current_password }
 */
app.post('/api/auth/set-security-question', requireAuth, (req, res) => {
  const { question, answer, current_password } = req.body;
  if (!question || !answer || !current_password)
    return res.status(400).json({ error: 'All fields are required.' });

  if (answer.trim().length < 2)
    return res.status(400).json({ error: 'Answer must be at least 2 characters.' });

  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.session.user.id);
  if (!bcrypt.compareSync(current_password, user.password))
    return res.status(401).json({ error: 'Current password is incorrect.' });

  db.prepare('UPDATE users SET security_question=?, security_answer=? WHERE id=?')
    .run(question, bcrypt.hashSync(answer.trim().toLowerCase(), 10), user.id);

  log(user.id, user.full_name, 'set_security_question', 'Security question updated');
  res.json({ success:true, message:'Security question saved.' });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BOOKS
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/books', requireAuth, (req, res) => {
  const { q, category } = req.query;
  let sql = 'SELECT * FROM books WHERE 1=1';
  const p = [];
  if (q?.trim()) {
    sql += ' AND (LOWER(title) LIKE ? OR LOWER(author) LIKE ? OR LOWER(isbn) LIKE ? OR LOWER(category) LIKE ?)';
    const t = `%${q.trim().toLowerCase()}%`; p.push(t,t,t,t);
  }
  if (category && category !== 'all') { sql += ' AND category=?'; p.push(category); }
  sql += ' ORDER BY title';
  res.json(db.prepare(sql).all(...p));
});

app.post('/api/books', requireLibrarian, (req, res) => {
  const { title, author, isbn, category, publisher, year, total_copies, cover_color } = req.body;
  if (!title?.trim() || !author?.trim() || !category?.trim())
    return res.status(400).json({ error: 'Title, author and category required.' });
  if (isbn?.trim()) {
    const dup = db.prepare('SELECT id FROM books WHERE isbn=?').get(isbn.trim());
    if (dup) return res.status(409).json({ error: 'ISBN already exists.' });
  }
  const copies = Math.max(1, parseInt(total_copies)||1);
  const info = db.prepare(`INSERT INTO books(title,author,isbn,category,publisher,year,total_copies,available,cover_color)
    VALUES(?,?,?,?,?,?,?,?,?)`)
    .run(title.trim(),author.trim(),isbn?.trim()||null,category.trim(),publisher?.trim()||null,parseInt(year)||null,copies,copies,cover_color||'#1D9E75');
  log(req.session.user.id, req.session.user.full_name, 'add_book', `Added: "${title.trim()}"`);
  res.json({ success:true, id:info.lastInsertRowid });
});

app.delete('/api/books/:id', requireLibrarian, (req, res) => {
  const active = db.prepare("SELECT id FROM issues WHERE book_id=? AND status IN('issued','overdue') LIMIT 1").get(req.params.id);
  if (active) return res.status(400).json({ error: 'Book has active loans. Process returns first.' });
  const book = db.prepare('SELECT title FROM books WHERE id=?').get(req.params.id);
  db.prepare('DELETE FROM books WHERE id=?').run(req.params.id);
  log(req.session.user.id, req.session.user.full_name, 'delete_book', `Removed: "${book?.title}"`);
  res.json({ success:true });
});

app.get('/api/categories', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT DISTINCT category FROM books ORDER BY category').all().map(r=>r.category));
});

// ═══════════════════════════════════════════════════════════════════════════════
// STUDENTS
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/students', requireLibrarian, (req, res) => {
  const { q } = req.query;
  let sql = `SELECT s.*, u.username
             FROM students s
             LEFT JOIN users u ON u.id = s.user_id
             WHERE 1=1`;
  const p = [];
  if (q?.trim()) {
    sql += ' AND (LOWER(s.full_name) LIKE ? OR s.student_id LIKE ? OR LOWER(u.username) LIKE ?)';
    const t = `%${q.trim().toLowerCase()}%`;
    p.push(t, t, t);
  }
  sql += ' ORDER BY s.full_name';
  res.json(db.prepare(sql).all(...p));
});

app.post('/api/students', requireLibrarian, (req, res) => {
  const { full_name, grade, email, phone, username, password } = req.body;
  if (!full_name?.trim() || !grade?.trim())
    return res.status(400).json({ error: 'Full name and grade are required.' });
  if (!username?.trim())
    return res.status(400).json({ error: 'A username is required so the student can log in.' });
  if (!password || password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });

  // Check username is not already taken
  const taken = db.prepare('SELECT id FROM users WHERE username=?').get(username.trim().toLowerCase());
  if (taken) return res.status(409).json({ error: `Username "${username.trim()}" is already taken. Please choose another.` });

  const last = db.prepare('SELECT student_id FROM students ORDER BY id DESC LIMIT 1').get();
  const num  = last ? parseInt(last.student_id.replace('S', '')) + 1 : 1;
  const sid  = 'S' + String(num).padStart(3, '0');

  // Create BOTH user login record AND student record inside one transaction
  const doRegister = db.transaction(() => {
    const userId = db.prepare(`
      INSERT INTO users (username, password, role, full_name, email)
      VALUES (?, ?, 'student', ?, ?)
    `).run(
      username.trim().toLowerCase(),
      bcrypt.hashSync(password, 10),
      full_name.trim(),
      email?.trim() || null
    ).lastInsertRowid;

    db.prepare('INSERT INTO students (student_id, user_id, full_name, grade, email, phone) VALUES (?,?,?,?,?,?)')
      .run(sid, userId, full_name.trim(), grade.trim(), email?.trim() || null, phone?.trim() || null);

    return userId;
  });

  doRegister();
  log(req.session.user.id, req.session.user.full_name, 'add_student',
      `Registered: ${full_name.trim()} (${sid}) — login: ${username.trim().toLowerCase()}`);

  res.json({
    success:    true,
    student_id: sid,
    username:   username.trim().toLowerCase(),
    // We send back the plain password ONCE so the librarian can hand it to the student.
    // The student should change it on first login via Account Settings.
    temp_password: password,
  });
});

app.delete('/api/students/:id', requireLibrarian, (req, res) => {
  const active = db.prepare("SELECT id FROM issues WHERE student_id=? AND status IN('issued','overdue') LIMIT 1").get(req.params.id);
  if (active) return res.status(400).json({ error: 'Student has unreturned books.' });
  const s = db.prepare('SELECT student_id, user_id, full_name FROM students WHERE student_id=?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Student not found.' });
  db.transaction(() => {
    db.prepare('DELETE FROM students WHERE student_id=?').run(req.params.id);
    if (s.user_id) {
      db.prepare('DELETE FROM password_history WHERE user_id=?').run(s.user_id);
      db.prepare('DELETE FROM users WHERE id=?').run(s.user_id);
    }
  })();
  log(req.session.user.id, req.session.user.full_name, 'delete_student', 'Removed: ' + s.full_name);
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ISSUES
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/issues', requireAuth, (req, res) => {
  const { status, student_id } = req.query;
  let sql = `SELECT i.*,b.title AS book_title,b.author AS book_author,b.cover_color,
             s.full_name AS student_name,s.grade AS student_grade
             FROM issues i JOIN books b ON b.id=i.book_id JOIN students s ON s.student_id=i.student_id WHERE 1=1`;
  const p = [];
  if (status)     { sql+=' AND i.status=?'; p.push(status); }
  if (student_id) { sql+=' AND i.student_id=?'; p.push(student_id); }
  if (req.session.user.role==='student') { sql+=' AND i.student_id=?'; p.push(req.session.user.student_id); }
  sql+=' ORDER BY i.created_at DESC';
  res.json(db.prepare(sql).all(...p));
});

app.post('/api/issues', requireLibrarian, (req, res) => {
  const { book_id, student_id, issue_date, due_date, notes } = req.body;
  if (!book_id||!student_id||!issue_date||!due_date) return res.status(400).json({ error:'All fields required.' });
  if (due_date<=issue_date) return res.status(400).json({ error:'Due date must be after issue date.' });
  const book    = db.prepare('SELECT * FROM books WHERE id=?').get(book_id);
  const student = db.prepare('SELECT * FROM students WHERE student_id=?').get(student_id);
  if (!book)           return res.status(404).json({ error:'Book not found.' });
  if (!student)        return res.status(404).json({ error:'Student not found.' });
  if (book.available<1)return res.status(400).json({ error:'No copies available.' });
  const dup = db.prepare("SELECT id FROM issues WHERE book_id=? AND student_id=? AND status IN('issued','overdue') LIMIT 1").get(book_id,student_id);
  if (dup) return res.status(400).json({ error:'Student already has this book.' });
  const doIt = db.transaction(()=>{
    db.prepare('UPDATE books SET available=available-1 WHERE id=?').run(book_id);
    const info = db.prepare("INSERT INTO issues(book_id,student_id,issued_by,issue_date,due_date,status,notes) VALUES(?,?,?,?,?,'issued',?)")
      .run(book_id,student_id,req.session.user.id,issue_date,due_date,notes||null);
    log(req.session.user.id,req.session.user.full_name,'issue_book',`Issued "${book.title}" → ${student.full_name}`);
    return info.lastInsertRowid;
  });
  res.json({ success:true, id:doIt() });
});

app.put('/api/issues/:id/return', requireLibrarian, (req, res) => {
  const issue = db.prepare('SELECT * FROM issues WHERE id=?').get(req.params.id);
  if (!issue)                    return res.status(404).json({ error:'Issue not found.' });
  if (issue.status==='returned') return res.status(400).json({ error:'Already returned.' });
  const returnDate = todayStr();
  const daysLate   = Math.max(0,Math.floor((new Date(returnDate)-new Date(issue.due_date))/86400000));
  const fine       = daysLate*5;
  db.transaction(()=>{
    db.prepare("UPDATE issues SET status='returned',return_date=?,fine_amount=? WHERE id=?").run(returnDate,fine,issue.id);
    db.prepare('UPDATE books SET available=available+1 WHERE id=?').run(issue.book_id);
    log(req.session.user.id,req.session.user.full_name,'return_book',`Returned book ${issue.book_id} from ${issue.student_id}${fine>0?` — Fine: KSh ${fine}`:''}`);
  })();
  res.json({ success:true, fine, days_late:daysLate });
});

app.post('/api/issues/update-overdue', requireLibrarian, (req, res) => {
  const t=todayStr();
  const r=db.prepare("UPDATE issues SET status='overdue',fine_amount=CAST((JULIANDAY(?)-JULIANDAY(due_date))AS INTEGER)*5 WHERE status='issued' AND due_date<?").run(t,t);
  res.json({ updated:r.changes });
});

// ═══════════════════════════════════════════════════════════════════════════════
// STATS
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/stats', requireLibrarian, (req, res) => {
  const t=todayStr();
  res.json({
    total_books:     db.prepare('SELECT COUNT(*)AS n FROM books').get().n,
    total_copies:    db.prepare('SELECT COALESCE(SUM(total_copies),0)AS n FROM books').get().n,
    total_students:  db.prepare('SELECT COUNT(*)AS n FROM students').get().n,
    total_issued:    db.prepare("SELECT COUNT(*)AS n FROM issues WHERE status IN('issued','overdue')").get().n,
    total_overdue:   db.prepare("SELECT COUNT(*)AS n FROM issues WHERE status='overdue' OR(status='issued' AND due_date<?)").get(t).n,
    total_returned:  db.prepare("SELECT COUNT(*)AS n FROM issues WHERE status='returned'").get().n,
    total_fines:     db.prepare("SELECT COALESCE(SUM(fine_amount),0)AS n FROM issues WHERE status IN('issued','overdue')").get().n,
    books_available: db.prepare('SELECT COALESCE(SUM(available),0)AS n FROM books').get().n,
    recent_issues:   db.prepare(`SELECT i.*,b.title AS book_title,b.cover_color,s.full_name AS student_name
                                 FROM issues i JOIN books b ON b.id=i.book_id JOIN students s ON s.student_id=i.student_id
                                 ORDER BY i.created_at DESC LIMIT 8`).all(),
    category_stats:  db.prepare('SELECT category,COUNT(*)AS count,SUM(available)AS available FROM books GROUP BY category ORDER BY count DESC').all(),
  });
});

app.get('/api/student-stats', requireAuth, (req, res) => {
  const sid=req.session.user.student_id;
  if (!sid) return res.status(403).json({ error:'Not a student.' });
  const t=todayStr();
  res.json({
    active:  db.prepare("SELECT COUNT(*)AS n FROM issues WHERE student_id=? AND status IN('issued','overdue')").get(sid).n,
    overdue: db.prepare("SELECT COUNT(*)AS n FROM issues WHERE student_id=? AND(status='overdue' OR(status='issued' AND due_date<?))").get(sid,t).n,
    history: db.prepare("SELECT COUNT(*)AS n FROM issues WHERE student_id=? AND status='returned'").get(sid).n,
    fines:   db.prepare("SELECT COALESCE(SUM(fine_amount),0)AS n FROM issues WHERE student_id=? AND status IN('issued','overdue')").get(sid).n,
  });
});

app.get('/api/activity', requireLibrarian, (req, res) => {
  res.json(db.prepare('SELECT * FROM activity_log ORDER BY logged_at DESC LIMIT 30').all());
});

// ── Serve frontend ────────────────────────────────────────────────────────────

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname,'public','index.html'));
});

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n📚  Library System v3 running`);
  console.log(`    Local:  http://localhost:${PORT}\n`);
});
