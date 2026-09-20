# Production Deployment Guide

> **Phase 3 — Final Production Verification & Public Release Gate**
>
> This document is the authoritative reference for deploying VideoChatWeb to production.
> Follow every section in order. Do not skip the release gate checklist at the end.

---

## Table of Contents

1. [Secret Generation](#1-secret-generation)
2. [Required Backend Environment Variables](#2-required-backend-environment-variables)
3. [Backend Deployment](#3-backend-deployment)
4. [Frontend Deployment](#4-frontend-deployment)
5. [CORS Configuration](#5-cors-configuration)
6. [TURN Server Setup](#6-turn-server-setup)
7. [DNS & HTTPS](#7-dns--https)
8. [Post-Deploy Verification](#8-post-deploy-verification)
9. [Release Gate Checklist](#9-release-gate-checklist)

---

## 1. Secret Generation

Run these commands **once** to generate cryptographically random secrets.
Store the output in a password manager or secret vault — **never in source control**.

```sh
# SESSION_HMAC_SECRET (minimum 32 chars — signs and verifies every session token)
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# ADMIN_API_TOKEN (minimum 20 chars — protects /health/detailed and /health/analytics/live)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# TURN_SERVER_SECRET (minimum 20 chars — signs time-limited TURN credentials)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> [!CAUTION]
> Never reuse development placeholder values in production.
> The following values are **blocklisted** and will crash the server at startup:
> `change-me-in-production-minimum-32-chars!!`, `change-me-turn-shared-secret`, `development-admin-token`

---

## 2. Required Backend Environment Variables

Set these on your hosting platform (not in a `.env` file committed to the repo):

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `NODE_ENV` | ✅ | Must be `production` | `production` |
| `PORT` | ✅ | HTTP port | `3001` |
| `SESSION_HMAC_SECRET` | ✅ | ≥32 char random hex | *(generated above)* |
| `ADMIN_API_TOKEN` | ✅ | ≥20 char random hex | *(generated above)* |
| `CORS_ORIGIN` | ✅ | Exact frontend URL(s), comma-separated, no wildcard | `https://yourdomain.com` |
| `MONGODB_URI` | ✅ | MongoDB Atlas connection string | `mongodb+srv://...` |
| `MONGODB_DB_NAME` | ✅ | Database name | `videochat_prod` |
| `REDIS_URL` | ✅ | Redis Cloud connection string | `redis://default:pass@host:port` |
| `REDIS_TLS` | ✅ | Must be `true` for cloud Redis | `true` |
| `TURN_SERVER_URLS` | ⚠️ | Real TURN server URL (not localhost) | `turn:turn.yourdomain.com:3478` |
| `TURN_SERVER_SECRET` | ⚠️ | ≥20 char shared secret | *(generated above)* |
| `LOG_LEVEL` | ✅ | Set to `info` in production | `info` |
| `METRICS_ENABLED` | optional | Prometheus metrics | `true` |

> [!IMPORTANT]
> `TURN_SERVER_URLS` with a **localhost** value is automatically excluded from ICE configs in production.
> Without a real TURN server, users behind symmetric NAT cannot connect via WebRTC.

---

## 3. Backend Deployment

### Option A — Render (Recommended)

1. Create a new **Web Service** on [render.com](https://render.com)
2. Connect your GitHub repo
3. Set build command: `npm ci && npm run build`
4. Set start command: `node dist/server.js`
5. Set environment: **Node 20**
6. Add all env vars from Section 2 in the **Environment** tab
7. Set `PORT=3001` (Render auto-binds to it)

Health check path: `/health/live`

### Option B — Railway

1. Create a new project on [railway.app](https://railway.app)
2. Link the GitHub repo, select the `backend/` directory as root
3. Railway auto-detects Node.js and uses `npm start` → `node dist/server.js`
4. Add env vars under **Variables**

### Option C — Fly.io

```sh
cd backend
fly launch --name videochat-backend --region sin
fly secrets set NODE_ENV=production SESSION_HMAC_SECRET=<your-secret> ...
fly deploy
```

### Option D — Docker (VPS / self-hosted)

```sh
# From backend/ directory
docker build -t videochat-backend .

docker run -d \
  --name videochat-backend \
  -p 3001:3001 \
  --env-file /path/to/production.env \
  --restart unless-stopped \
  videochat-backend
```

Or use the provided `docker-compose.prod.yml`:

```sh
# Set all required vars in your shell or a .env.prod file first
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

---

## 4. Frontend Deployment

### Vercel (configured — `vercel.json` already present)

1. Import the repo on [vercel.com](https://vercel.com)
2. Set **Root Directory** to `frontend`
3. Set **Build Command** to `npm run build`
4. Set **Output Directory** to `dist`
5. Under **Environment Variables**, set:

```
VITE_BACKEND_URL = https://your-backend.onrender.com
VITE_API_URL     = https://your-backend.onrender.com/api/v1
```

### Netlify (configured — `netlify.toml` already present)

1. Import the repo on [netlify.app](https://netlify.app)
2. Set **Base directory** to `frontend`
3. Under **Site configuration → Environment variables**, set:

```
VITE_BACKEND_URL = https://your-backend.onrender.com
VITE_API_URL     = https://your-backend.onrender.com/api/v1
```

> [!IMPORTANT]
> Environment variables set on the hosting platform are **baked into the production build** by Vite.
> After changing them, you must trigger a new deployment for changes to take effect.

> [!WARNING]
> The `frontend/.env` file contains `localhost` URLs — these are for local development only.
> They are **never** used in production builds (Vite uses platform env vars).
> The frontend code contains a localhost-detection safety guard that falls back to same-origin
> even if a dev `.env` is accidentally deployed.

---

## 5. CORS Configuration

Set `CORS_ORIGIN` on the backend to exactly match the frontend origin:

```
# Single domain
CORS_ORIGIN=https://yourdomain.com

# Multiple (www + apex)
CORS_ORIGIN=https://yourdomain.com,https://www.yourdomain.com

# Staging + production
CORS_ORIGIN=https://yourdomain.com,https://staging.yourdomain.com
```

> [!CAUTION]
> Never use `CORS_ORIGIN=*` in production. The `env.ts` validation will reject it and crash the server.

To verify CORS is working after deployment:

```sh
# Should succeed with status 200
curl -H "Origin: https://yourdomain.com" \
     -H "Access-Control-Request-Method: POST" \
     -X OPTIONS \
     https://your-backend.onrender.com/api/v1/session/init -v

# Should fail with 403 (CORS blocked)
curl -H "Origin: https://evil.example.com" \
     -H "Access-Control-Request-Method: POST" \
     -X OPTIONS \
     https://your-backend.onrender.com/api/v1/session/init -v
```

---

## 6. TURN Server Setup

Without TURN, users behind symmetric NAT (many corporate and mobile networks) cannot establish
peer-to-peer WebRTC connections.

### Option A — Metered.ca (Easiest)

1. Sign up at [metered.ca](https://www.metered.ca)
2. Create a TURN server application
3. Set backend env vars:
   ```
   TURN_SERVER_URLS=turn:global.turn.twilio.com:3478,turns:global.turn.twilio.com:443?transport=tcp
   TURN_SERVER_SECRET=<from metered dashboard>
   ```

### Option B — Twilio Network Traversal Service

1. Sign up at [twilio.com](https://www.twilio.com)
2. Create NTS credentials
3. Set backend env vars with Twilio TURN server URL and secret

### Option C — Self-hosted Coturn

```sh
# Install on Ubuntu/Debian
sudo apt install coturn

# /etc/turnserver.conf (minimal config)
listening-port=3478
tls-listening-port=5349
realm=yourdomain.com
server-name=yourdomain.com
lt-cred-mech
use-auth-secret
static-auth-secret=<TURN_SERVER_SECRET>
no-multicast-peers
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
```

Then set:
```
TURN_SERVER_URLS=turn:yourdomain.com:3478,turns:yourdomain.com:5349
TURN_SERVER_SECRET=<your-static-auth-secret>
```

### Verifying TURN

After deploying, verify TURN is working from a real browser:

1. Open `chrome://webrtc-internals` in Chrome
2. Start a video chat session
3. Look for `relay` type ICE candidates in the ICE gathering stats
4. The connection should use `typ relay` if STUN candidates alone cannot connect

---

## 7. DNS & HTTPS

HTTPS is **required** for:
- WebRTC (getUserMedia blocked in insecure contexts)
- `withCredentials: true` cross-origin CORS requests
- Socket.IO `wss://` connections

### Vercel / Netlify
Both provision TLS automatically via Let's Encrypt for custom domains.

### Custom Domain on Render
1. Go to **Settings → Custom Domain**
2. Add your domain, configure the CNAME/A record as shown
3. Render provisions TLS automatically

### Verify HTTPS is working
```sh
# Backend
curl -s https://your-backend.onrender.com/health | jq .

# Frontend
curl -sI https://yourdomain.com | head -5
```

---

## 8. Post-Deploy Verification

Run these commands against the **live production** URL after every deployment:

```sh
export BACKEND_URL=https://your-backend.onrender.com

# 1. Pre-deploy check (environment validation)
cd backend
NODE_ENV=production npx ts-node scripts/pre-deploy-check.ts

# 2. Security boundary tests
BACKEND_URL=$BACKEND_URL npx ts-node scripts/security-verify.ts

# 3. Full E2E session flow
BACKEND_URL=$BACKEND_URL npx ts-node scripts/e2e-session-flow.ts
```

Manual browser verification:

```sh
# Verify health from browser console (or curl)
curl https://your-backend.onrender.com/health
# Expected: {"status":"ok","timestamp":...}

curl https://your-backend.onrender.com/health/ready
# Expected: {"ready":true,"checks":{"mongodb":...,"redis":...,"matchingEngine":"running","turn":"ok"}}

# Verify TURN is not localhost:
curl -H "X-Session-Token: <your-token>" \
  https://your-backend.onrender.com/api/v1/session/iceservers | jq .
```

---

## 9. Release Gate Checklist

This is the final gate. Do not declare production-ready until every item is verified with **actual evidence**.

### Infrastructure

| Check | Evidence Required | Status |
|-------|-------------------|--------|
| Backend reachable via HTTPS | `curl https://backend-url/health` → `{"status":"ok"}` | ⬜ |
| Frontend loads via HTTPS | Browser → no mixed-content warnings | ⬜ |
| `/health/ready` returns `ready: true` | All checks green: mongodb, redis, matchingEngine | ⬜ |
| TURN configured and not localhost | `/health/ready` → `"turn":"ok"` | ⬜ |

### Security

| Check | Evidence Required | Status |
|-------|-------------------|--------|
| `SESSION_HMAC_SECRET` is non-placeholder ≥32 chars | `pre-deploy-check.ts` PASS | ⬜ |
| `ADMIN_API_TOKEN` is non-placeholder ≥20 chars | `pre-deploy-check.ts` PASS | ⬜ |
| `TURN_SERVER_SECRET` is non-placeholder ≥20 chars | `pre-deploy-check.ts` PASS | ⬜ |
| `CORS_ORIGIN` has no wildcard | `security-verify.ts` PASS | ⬜ |
| Invalid session token → 401 | `security-verify.ts` PASS | ⬜ |
| Wrong admin token → 403 | `security-verify.ts` PASS | ⬜ |
| `X-Powered-By` header absent | `security-verify.ts` PASS | ⬜ |
| CSP header present | `security-verify.ts` PASS | ⬜ |
| No secrets in error responses | `security-verify.ts` PASS | ⬜ |
| Rate limiting active | `security-verify.ts` PASS | ⬜ |

### Session & Socket

| Check | Evidence Required | Status |
|-------|-------------------|--------|
| Full session flow passes | `e2e-session-flow.ts` → 10/10 steps PASS | ⬜ |
| Socket connects via WSS | Browser DevTools → WS frames visible | ⬜ |

### WebRTC

> [!WARNING]
> **This section cannot be verified by scripts alone.**
> Manual browser testing with two real clients is required.

| Check | Evidence Required | Status |
|-------|-------------------|--------|
| ICE gathering completes | `chrome://webrtc-internals` → `iceGatheringState: complete` | ⬜ |
| At least one relay candidate | `webrtc-internals` → `typ relay` candidate present | ⬜ |
| Video connection established | Two browser windows → video visible both ways | ⬜ |
| Mobile browser tested | Safari iOS or Chrome Android → video visible | ⬜ |
| Symmetric NAT relay tested | Tested from mobile network (not same WiFi as server) | ⬜ |

### Regression

| Check | Evidence Required | Status |
|-------|-------------------|--------|
| All unit tests pass | `npm test` → 33/33 | ⬜ |
| TypeScript compiles clean | `npm run type-check` → 0 errors | ⬜ |

---

> [!IMPORTANT]
> **The WebRTC/TURN release gate remains open until relay-candidate testing is done from a real mobile network.**
> All other gates can be verified with the scripts and commands above.
