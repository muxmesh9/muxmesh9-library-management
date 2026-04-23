/**
 * database/setup.js
 * Run ONCE before starting the server: node database/setup.js
 * Creates all tables and seeds sample data including security questions.
 */

'use strict';

const Database = require('sqlite3').verbose();
const bcrypt   = require('bcryptjs');
const path     = require('path');
const fs       = require('fs');

const DB_PATH = path.join(__dirname, 'library.db');

if (fs.existsSync(DB_PATH)) {
  console.log("Creating new database...");
  console.log('🗑  Old database removed.');
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Schema ────────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    username             TEXT    NOT NULL UNIQUE,
    password             TEXT    NOT NULL,
    role                 TEXT    NOT NULL CHECK(role IN ('librarian','student')),
    full_name            TEXT    NOT NULL,
    email                TEXT,
    -- Security question for password reset
    security_question    TEXT,
    security_answer      TEXT,   -- bcrypt-hashed answer
    -- Password reset token (generated when "Forgot Password" is requested)
    reset_token          TEXT    UNIQUE,
    reset_token_expires  DATETIME,
    -- Lockout after too many failed reset attempts
    reset_attempts       INTEGER DEFAULT 0,
    reset_locked_until   DATETIME,
    created_at           DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS students (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id    TEXT    NOT NULL UNIQUE,
    user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
    full_name     TEXT    NOT NULL,
    grade         TEXT    NOT NULL,
    email         TEXT,
    phone         TEXT,
    registered_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS books (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    title         TEXT    NOT NULL,
    author        TEXT    NOT NULL,
    isbn          TEXT    UNIQUE,
    category      TEXT    NOT NULL,
    publisher     TEXT,
    year          INTEGER,
    total_copies  INTEGER NOT NULL DEFAULT 1,
    available     INTEGER NOT NULL DEFAULT 1,
    cover_color   TEXT    DEFAULT '#1D9E75',
    added_at      DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS issues (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id       INTEGER NOT NULL REFERENCES books(id),
    student_id    TEXT    NOT NULL REFERENCES students(student_id),
    issued_by     INTEGER REFERENCES users(id),
    issue_date    DATE    NOT NULL,
    due_date      DATE    NOT NULL,
    return_date   DATE,
    status        TEXT    NOT NULL DEFAULT 'issued'
                          CHECK(status IN ('issued','returned','overdue')),
    fine_amount   REAL    DEFAULT 0,
    notes         TEXT,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS activity_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER REFERENCES users(id),
    user_name  TEXT,
    action     TEXT    NOT NULL,
    details    TEXT,
    logged_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS password_history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    password    TEXT    NOT NULL,   -- hashed
    changed_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

console.log('✅  Tables created.');

// ── Helpers ───────────────────────────────────────────────────────────────────

const hash = p => bcrypt.hashSync(p, 10);

// Security questions list (same list shown in UI)
const SECURITY_QUESTIONS = [
  "What was the name of your first pet?",
  "What is your mother's maiden name?",
  "What was the name of your primary school?",
  "What is the name of the town where you were born?",
  "What was your childhood nickname?",
];

// ── Seed users ────────────────────────────────────────────────────────────────

const insertUser = db.prepare(`
  INSERT INTO users
    (username, password, role, full_name, email, security_question, security_answer)
  VALUES
    (@username, @password, @role, @full_name, @email, @security_question, @security_answer)
`);

const usersData = [
  {
    username: 'admin',     password: hash('admin123'), role: 'librarian',
    full_name: 'Admin Librarian', email: 'admin@school.ac.ke',
    security_question: SECURITY_QUESTIONS[2], security_answer: hash('greenfield'),
  },
  {
    username: 'mwangi',    password: hash('lib456'),   role: 'librarian',
    full_name: 'Jane Wanjiku', email: 'jwanjiku@school.ac.ke',
    security_question: SECURITY_QUESTIONS[0], security_answer: hash('simba'),
  },
  {
    username: 'alice',     password: hash('pass123'),  role: 'student',
    full_name: 'Alice Mwangi', email: 'alice@school.ac.ke',
    security_question: SECURITY_QUESTIONS[3], security_answer: hash('nyeri'),
  },
  {
    username: 'brian',     password: hash('pass123'),  role: 'student',
    full_name: 'Brian Otieno', email: 'brian@school.ac.ke',
    security_question: SECURITY_QUESTIONS[0], security_answer: hash('rex'),
  },
  {
    username: 'carol',     password: hash('pass123'),  role: 'student',
    full_name: 'Carol Njeri', email: 'carol@school.ac.ke',
    security_question: SECURITY_QUESTIONS[4], security_answer: hash('cee'),
  },
  {
    username: 'david',     password: hash('pass123'),  role: 'student',
    full_name: 'David Kamau', email: 'david@school.ac.ke',
    security_question: SECURITY_QUESTIONS[1], security_answer: hash('wanjiku'),
  },
];

const uids = {};
for (const u of usersData) { uids[u.username] = insertUser.run(u).lastInsertRowid; }
console.log(`✅  ${usersData.length} users created.`);

// ── Seed students ─────────────────────────────────────────────────────────────

const insertStudent = db.prepare(`
  INSERT INTO students (student_id, user_id, full_name, grade, email, phone)
  VALUES (@student_id, @user_id, @full_name, @grade, @email, @phone)
`);

const studentsData = [
  { student_id:'S001', user_id:uids['alice'], full_name:'Alice Mwangi', grade:'Form 3', email:'alice@school.ac.ke', phone:'0712 345 001' },
  { student_id:'S002', user_id:uids['brian'], full_name:'Brian Otieno', grade:'Form 2', email:'brian@school.ac.ke', phone:'0712 345 002' },
  { student_id:'S003', user_id:uids['carol'], full_name:'Carol Njeri',  grade:'Form 4', email:'carol@school.ac.ke', phone:'0712 345 003' },
  { student_id:'S004', user_id:uids['david'], full_name:'David Kamau',  grade:'Form 1', email:'david@school.ac.ke', phone:'0712 345 004' },
];

for (const s of studentsData) insertStudent.run(s);
console.log(`✅  ${studentsData.length} students created.`);

// ── Seed books ────────────────────────────────────────────────────────────────

const insertBook = db.prepare(`
  INSERT INTO books (title,author,isbn,category,publisher,year,total_copies,available,cover_color)
  VALUES (@title,@author,@isbn,@category,@publisher,@year,@total_copies,@available,@cover_color)
`);

const booksData = [
  { title:'Introduction to Algorithms',         author:'Cormen, Leiserson & Rivest', isbn:'978-0262033848', category:'Computer Science', publisher:'MIT Press',        year:2022, total_copies:3, available:2, cover_color:'#0F6E56' },
  { title:'To Kill a Mockingbird',              author:'Harper Lee',                  isbn:'978-0061935466', category:'Literature',       publisher:'HarperCollins',    year:2002, total_copies:4, available:4, cover_color:'#185FA5' },
  { title:'Calculus: Early Transcendentals',    author:'James Stewart',               isbn:'978-1285741550', category:'Mathematics',      publisher:'Cengage Learning', year:2015, total_copies:2, available:1, cover_color:'#BA7517' },
  { title:'Biology: Unity of Life',             author:'Starr & Taggart',             isbn:'978-0538741590', category:'Science',          publisher:'Cengage Learning', year:2012, total_copies:3, available:3, cover_color:'#639922' },
  { title:'The Great Gatsby',                   author:'F. Scott Fitzgerald',         isbn:'978-0743273565', category:'Literature',       publisher:'Scribner',         year:2004, total_copies:2, available:2, cover_color:'#534AB7' },
  { title:'Physics for Scientists & Engineers', author:'Serway & Jewett',             isbn:'978-1337553278', category:'Science',          publisher:'Cengage Learning', year:2018, total_copies:3, available:3, cover_color:'#993C1D' },
  { title:'History of East Africa',             author:'B.A. Ogot',                   isbn:'978-9966250551', category:'History',          publisher:'E.A. Publishers',  year:2009, total_copies:2, available:2, cover_color:'#6B3A2A' },
  { title:'Python Crash Course',                author:'Eric Matthes',                isbn:'978-1593279288', category:'Computer Science', publisher:'No Starch Press',  year:2023, total_copies:2, available:2, cover_color:'#3B6D11' },
  { title:'Animal Farm',                        author:'George Orwell',               isbn:'978-0451526342', category:'Literature',       publisher:'Signet Classics',  year:1996, total_copies:3, available:3, cover_color:'#993556' },
  { title:'A Brief History of Time',            author:'Stephen Hawking',             isbn:'978-0553380163', category:'Science',          publisher:'Bantam Books',     year:1998, total_copies:2, available:2, cover_color:'#0C447C' },
  { title:'Swahili Grammar & Exercises',        author:'E.O. Ashton',                 isbn:'978-0582620162', category:'Languages',        publisher:'Longman',          year:2006, total_copies:4, available:4, cover_color:'#5F3DC4' },
  { title:'Elements of Geography',             author:'P.K. Githinji',               isbn:'978-9966252340', category:'Geography',        publisher:'Kenya LPB',        year:2011, total_copies:3, available:3, cover_color:'#087F5B' },
];

const bookIds = [];
for (const b of booksData) { bookIds.push(insertBook.run(b).lastInsertRowid); }
console.log(`✅  ${booksData.length} books created.`);

// ── Seed issues ───────────────────────────────────────────────────────────────

const insertIssue = db.prepare(`
  INSERT INTO issues (book_id,student_id,issued_by,issue_date,due_date,return_date,status,fine_amount)
  VALUES (@book_id,@student_id,@issued_by,@issue_date,@due_date,@return_date,@status,@fine_amount)
`);
const decAvail = db.prepare('UPDATE books SET available = available - 1 WHERE id = ?');

const issuesData = [
  { book_id:bookIds[2], student_id:'S001', issued_by:uids['admin'], issue_date:'2026-03-20', due_date:'2026-04-10', return_date:null,         status:'overdue',  fine_amount:25 },
  { book_id:bookIds[0], student_id:'S002', issued_by:uids['admin'], issue_date:'2026-04-01', due_date:'2026-04-22', return_date:null,         status:'issued',   fine_amount:0  },
  { book_id:bookIds[4], student_id:'S003', issued_by:uids['admin'], issue_date:'2026-04-05', due_date:'2026-04-26', return_date:null,         status:'issued',   fine_amount:0  },
  { book_id:bookIds[1], student_id:'S001', issued_by:uids['admin'], issue_date:'2026-02-10', due_date:'2026-03-03', return_date:'2026-03-01', status:'returned', fine_amount:0  },
  { book_id:bookIds[6], student_id:'S004', issued_by:uids['admin'], issue_date:'2026-03-01', due_date:'2026-03-22', return_date:'2026-03-20', status:'returned', fine_amount:0  },
  { book_id:bookIds[9], student_id:'S002', issued_by:uids['admin'], issue_date:'2026-01-15', due_date:'2026-02-05', return_date:'2026-02-03', status:'returned', fine_amount:0  },
];

for (const i of issuesData) {
  insertIssue.run(i);
  if (i.status !== 'returned') decAvail.run(i.book_id);
}
console.log(`✅  ${issuesData.length} issue records created.`);

// ── Seed activity ─────────────────────────────────────────────────────────────

const logStmt = db.prepare('INSERT INTO activity_log (user_id,user_name,action,details) VALUES (?,?,?,?)');
logStmt.run(uids['admin'], 'Admin Librarian', 'login',      'System initialized');
logStmt.run(uids['admin'], 'Admin Librarian', 'add_book',   'Added: Introduction to Algorithms');
logStmt.run(uids['admin'], 'Admin Librarian', 'issue_book', 'Issued "Calculus" to Alice Mwangi');
logStmt.run(uids['admin'], 'Admin Librarian', 'add_student','Registered: David Kamau (S004)');

db.close();

console.log('\n🎉  Database setup complete!');
console.log('    File: database/library.db\n');
console.log('    Security questions are set for all demo accounts.');
console.log('    Alice\'s answer: nyeri   |   Brian\'s answer: rex');
console.log('    Carol\'s answer: cee     |   David\'s answer: wanjiku\n');
console.log('    Run: npm start');
console.log('    Open: http://localhost:3000\n');
