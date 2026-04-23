# 📚 School Library Management System v3

> Full-stack web app with beautiful UI, complete book/student management, and a **full password management system** — including change password and forgot password via security questions.

---

## ✨ New in v3 — Password Management

| Feature | Details |
|---------|---------|
| 🔑 **Change Password** | Any logged-in user (librarian or student) can change their password from Account Settings |
| 🔒 **Password Strength Meter** | Live visual feedback while typing a new password |
| 👁 **Show/Hide Password** | Toggle visibility on all password fields |
| 🛡️ **Security Question** | Users set a secret question + answer for account recovery |
| 🔄 **Forgot Password (3-step)** | Enter username → Answer security question → Set new password |
| 🚫 **Lockout Protection** | 5 failed reset attempts locks the account for 15 minutes |
| 📜 **Password History** | Cannot reuse any of the last 3 passwords |
| 🕵️ **Audit Trail** | All password changes are recorded in the Activity Log |

---

## 🗂 Project Structure

```
library-system/
├── server.js                ← Express server + all API routes
├── package.json
├── .gitignore
├── database/
│   ├── setup.js             ← Run once to create and seed database
│   └── library.db           ← SQLite file (auto-created)
├── public/
│   ├── index.html           ← Full single-page app
│   ├── css/style.css        ← Complete design system
│   └── js/app.js            ← All frontend logic
├── docs/
│   ├── DATABASE.md
│   ├── API.md
│   └── DEPLOYMENT.md        ← Render hosting guide
└── README.md
```

---

## ⚙️ Requirements

- **Node.js v18+** — download from https://nodejs.org (choose LTS)
- **npm** — comes with Node.js

---

## 🚀 Running Locally

```bash
# 1. Enter the project folder
cd library-system

# 2. Install packages (only needed once)
npm install

# 3. Create the database (only needed once, or to reset)
node database/setup.js

# 4. Start the server
npm start
```

Open: **http://localhost:3000**

To stop: press **Ctrl + C**

---

## 🔑 Login Credentials

| Role | Username | Password | Security Question Answer |
|------|----------|----------|--------------------------|
| Librarian | `admin` | `admin123` | `greenfield` |
| Librarian | `mwangi` | `lib456` | `simba` |
| Student | `alice` | `pass123` | `nyeri` |
| Student | `brian` | `pass123` | `rex` |
| Student | `carol` | `pass123` | `cee` |
| Student | `david` | `pass123` | `wanjiku` |

---

## 🔄 How Password Reset Works

1. Click **"Forgot your password?"** on the login screen
2. **Step 1** — Enter your username
3. **Step 2** — Answer your security question (e.g. Alice's answer is `nyeri`)
4. **Step 3** — Enter and confirm your new password
5. Done — sign in with the new password

**Security features:**
- 5 wrong answers → account locked for 15 minutes
- Reset tokens expire after 15 minutes
- Cannot reuse the last 3 passwords

---

## 🌐 Deploy to Render

See `docs/DEPLOYMENT.md` for the full guide.

Quick summary:
1. Push to GitHub
2. Create Web Service on **render.com**
3. Build command: `npm install && node database/setup.js`
4. Start command: `npm start`
5. Environment variable: `SESSION_SECRET=any-random-string`

---

## 🛠 Technologies

| Layer | Technology |
|-------|-----------|
| Server | Node.js + Express |
| Database | SQLite (better-sqlite3) |
| Auth | express-session + bcryptjs |
| Password Reset | Crypto (Node built-in) + Security Questions |
| Frontend | Vanilla HTML/CSS/JavaScript |
| Fonts | Google Fonts (DM Sans + Playfair Display) |

---

## 📄 License

MIT — free for academic use.
