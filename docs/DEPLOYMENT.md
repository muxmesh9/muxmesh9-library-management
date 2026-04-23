# 🚀 Deployment Guide — Render

## Part 1: Push to GitHub

### 1.1 Create a GitHub account
Go to **https://github.com** and sign up (free).

### 1.2 Create a new repository
1. Click **+** → **New repository**
2. Name: `school-library-system`
3. Set to **Public**
4. Click **Create repository**

### 1.3 Initialize Git in the project folder

Open a terminal inside your `library-system` folder:

```bash
git init
git add .
git commit -m "Initial commit: School Library System v3"
git remote add origin https://github.com/YOUR_USERNAME/school-library-system.git
git branch -M main
git push -u origin main
```

> When Git asks for a password, use a **Personal Access Token** (not your GitHub password).
> Create one at: GitHub → Settings → Developer Settings → Personal Access Tokens → Generate New Token → select `repo` scope.

---

## Part 2: Deploy on Render

### 2.1 Create a Render account
Go to **https://render.com** and sign up with your GitHub account.

### 2.2 Create a Web Service
1. Dashboard → **+ New** → **Web Service**
2. Click **Connect a repository** → select your repo
3. Click **Connect**

### 2.3 Configuration

| Setting | Value |
|---------|-------|
| Name | `school-library` |
| Region | Any (closest to you) |
| Branch | `main` |
| Runtime | `Node` |
| Build Command | `npm install && node database/setup.js` |
| Start Command | `npm start` |
| Instance Type | `Free` |

### 2.4 Environment Variables

In the **Environment** section, add:

| Key | Value |
|-----|-------|
| `SESSION_SECRET` | Any long random string (e.g. `kL9mQ3rT8vXz2nPw5LibraryKE`) |
| `NODE_ENV` | `production` |

### 2.5 Deploy

Click **Create Web Service**. Render will:
1. Clone your repo
2. Run `npm install` + `node database/setup.js`
3. Start the server

Takes **3–5 minutes**. Your live URL:
```
https://school-library.onrender.com
```

---

## Part 3: Redeploying After Changes

```bash
git add .
git commit -m "Describe what you changed"
git push
```

Render detects the push and redeploys automatically.

---

## Part 4: Troubleshooting

| Problem | Fix |
|---------|-----|
| "Database not found" on startup | Make sure Build Command includes `node database/setup.js` |
| Login fails after deploy | Check build logs — database setup may have failed. Manual Deploy → Deploy latest commit |
| Slow first load (30s+) | Normal on free tier — service "sleeps" after 15 min inactivity |
| Module not found error | Make sure `node_modules` is in `.gitignore` and `package.json` is correct |

---

## Part 5: Important Notes

**Free tier limitations:**
- App sleeps after 15 minutes of inactivity (slow first load)
- SQLite database resets on every redeploy (sample data only — good for demos)
- For persistent data: upgrade to Render paid plan with disk storage

**Sharing your project:**
```
🔗 Live: https://school-library.onrender.com

Login:
  Librarian: admin / admin123
  Student:   alice / pass123
```
