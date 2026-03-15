# Deployment Guide

## Overview

```
Netlify  →  hosts index.html + css/ + js/  (frontend, already deployed)
Railway  →  hosts server/                  (new backend, deployed below)
```

---

## Step 1 — Push to GitHub

Put the full project in a GitHub repo if you haven't already.

Your repo structure should look like:

```
ambient-generator/          ← Netlify root
  index.html
  css/
  js/
  server/                   ← Railway root
    index.js
    Dockerfile
    package.json
    engine/
    export/
    routes/
```

---

## Step 2 — Deploy server to Railway

1. Go to https://railway.app and sign in with GitHub
2. Click **New Project → Deploy from GitHub repo**
3. Select your repository
4. Railway will detect the Dockerfile automatically
5. Set the **Root Directory** to `server` in Railway settings
6. Add these environment variables in Railway dashboard:

```
FRONTEND_URL = https://your-app.netlify.app
TEMP_DIR     = /tmp
NODE_ENV     = production
```

7. Click **Deploy**
8. Wait ~2 minutes for the build
9. Copy your Railway URL — looks like: `https://ambient-generator-production.up.railway.app`

---

## Step 3 — Connect frontend to server

Open `index.html` and find this line near the top:

```js
window.AMBIENT_SERVER_URL = '';
```

Change it to your Railway URL:

```js
window.AMBIENT_SERVER_URL = 'https://ambient-generator-production.up.railway.app';
```

Save and redeploy to Netlify (push to GitHub — Netlify auto-deploys).

---

## Step 4 — Test

1. Open your Netlify URL
2. Pick a duration (try 10 min first)
3. Click **Generate Music** — visual appears, audio preview loads
4. Click **Download WAV** — server renders and downloads in seconds
5. Click **Download Video** — server renders MP4, downloads when ready

---

## Server speed reference (Railway Starter — 2 vCPU / 512 MB RAM)

| Audio duration | WAV download | MP3 download | Video 1080p |
|---|---|---|---|
| 5 min | ~1 sec | ~3 sec | ~30 sec |
| 30 min | ~4 sec | ~8 sec | ~3 min |
| 1 hour | ~8 sec | ~14 sec | ~6 min |
| 3 hours | ~22 sec | ~40 sec | ~18 min |

Upgrade to Railway Pro (4 vCPU) to halve all times.

---

## Local development

Run the server locally:

```bash
cd server
cp .env.example .env
# Edit .env: set FRONTEND_URL=* for local dev
npm install
npm run dev
```

Then in `index.html` set:

```js
window.AMBIENT_SERVER_URL = 'http://localhost:3001';
```

Open `index.html` with Live Server (VS Code) or any static file server.

---

## Troubleshooting

**CORS error** — Make sure `FRONTEND_URL` in Railway matches your exact Netlify URL including `https://`.

**ffmpeg not found** — The Dockerfile installs ffmpeg. If deploying without Docker, install ffmpeg on the server manually.

**canvas module fails to build** — The Dockerfile installs all required system libraries (`libcairo2-dev` etc.). Railway uses the Dockerfile automatically.

**Progress bar not moving** — SSE (Server-Sent Events) requires the server to not buffer responses. The server sets `X-Accel-Buffering: no` for nginx compatibility.
