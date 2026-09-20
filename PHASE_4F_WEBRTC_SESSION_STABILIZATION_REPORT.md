# PHASE_4F_WEBRTC_SESSION_STABILIZATION_REPORT.md

## 1. Root Causes

### Problem 1 — 405 on `POST /api/v1/session/init`
`api.ts` used `VITE_API_URL` for `BASE`. `socket.ts` used `VITE_BACKEND_URL`. Two different vars. Vercel only had `VITE_BACKEND_URL`. `VITE_API_URL` unset → `BASE = '/api/v1'` relative → hits Vercel static origin → 405.

**Fix:** Consolidated to `VITE_BACKEND_URL` as sole source of truth. `api.ts` now derives `BASE = VITE_BACKEND_URL + '/api/v1'` (non-localhost) or `'/api/v1'` (dev proxy). `VITE_API_URL` kept as legacy fallback.

### Problem 2 — 401 on `GET /session/iceservers`
Cascade from Problem 1. No token in sessionStorage if session init failed → no `X-Session-Token` header → 401.

**Fix (layered):** Problem 1 fix eliminates root cause. Added one ICE retry on 401: validate session → re-init if invalid → retry ICE once. Max 1 retry. No infinite loop. Safe logs only.

### Problem 3 — `Already in queue` / `Too many queue joins`
`ChatRoom.tsx` `joinedRef` was reset to `false` then immediately set to `true` inside the same effect — providing no real protection. On reconnect + status race to `'idle'`, duplicate `join_queue` emitted.

**Fix:** Replaced `joinedRef` with authoritative `QueuePhase` state machine in `useSocket.ts`: `idle → joining → searching → matched`. `joinQueue()` is a no-op unless phase is `'idle'`.

### Problem 4 — `Session is not available for matching`
Transient race during reconnect. Backend already heals. Frontend showed it as a persistent error banner.

**Fix:** `ALREADY_IN_QUEUE` / `SESSION_NOT_AVAILABLE` now silently suppressed. No banner shown while actively searching/matched/connected.

### Problem 5 — Camera OFF→ON blank video (critical)
`ChatRoom.tsx` conditionally **unmounted** `<video>` when camera off. On camera ON, new DOM node mounted. `localVideoRef.current` → new empty node. `useEffect` in `useWebRTC` only fires when `localStream` state changes — same stream object → no re-fire → blank.

Secondary: if track `readyState === 'ended'`, re-enabling does nothing.

**Fix:**
1. Local `<video>` always mounted (CSS `display: none` when off).
2. Callback ref (`localVideoCallbackRef`) assigns `srcObject` on every DOM node mount.
3. `setCameraOff(false)`: checks `readyState === 'live'` → re-enable; if `'ended'` → `getUserMedia()` + `replaceTrack()`. No PeerConnection recreated.

### Problem 6 — Missing remote speaker mute feature
Not implemented previously.

**Fix:** `callStore`: `isRemoteAudioMuted`, `toggleRemoteAudio`, reset in `resetCall`. `useWebRTC`: `setRemoteAudioMuted(muted)` = `remoteVideoRef.current.muted = muted` only. No socket event. No track modification. `ChatRoom`: 🔊/🔇 button with proper aria-labels.

---

## 2. Files Changed

| File | Change |
|------|--------|
| `frontend/src/lib/api.ts` | Single source of truth: `VITE_BACKEND_URL` |
| `frontend/src/hooks/useWebRTC.ts` | ICE 401 retry, camera track reacquisition, `setRemoteAudioMuted`, T0-T7 timing |
| `frontend/src/hooks/useSocket.ts` | Queue phase state machine, silent error suppression |
| `frontend/src/features/chat-room/ChatRoom.tsx` | Always-mounted video, callback ref, speaker button, error filtering |
| `frontend/src/stores/callStore.ts` | `isRemoteAudioMuted`, `toggleRemoteAudio`, reset in `resetCall` |
| `frontend/src/__tests__/apiUrl.test.ts` | **NEW** 24 tests: URL resolution, queue machine, camera state, speaker/mic |
| `frontend/src/__tests__/callStore.test.ts` | +5 remote audio tests |
| `d:/VideoChatWeb/Video-Chat-web/PHASE_4F_WEBRTC_SESSION_STABILIZATION_REPORT.md` | This report |

**Backend:** No changes required. Backend is architecturally correct.

---

## 3. API Routing Fix

- Before: `BASE = VITE_API_URL || '/api/v1'` — unset on Vercel → relative path → 405
- After: `BASE = VITE_BACKEND_URL.replace(/\/$/, '') + '/api/v1'` when not localhost
- All three endpoints (session/init, session/iceservers, socket) now use same backend origin

---

## 4. Session / Auth Fix

- No backend code changes
- ICE 401 → validate → re-init → retry (max 1)
- Logs: `[ICE] unauthorized`, `[ICE] session recovery`, `[ICE] retry success`
- No credentials logged

---

## 5. Queue / Idempotency Fix

- Frontend phase gate: `idle → joining → searching → matched`
- `joinQueue()` no-op unless `phase === 'idle'`
- `ALREADY_IN_QUEUE` silently suppressed
- Rate limit (20/hour) preserved for abuse protection

---

## 6. Camera Lifecycle Fix

- `<video>` always in DOM (hidden not unmounted)
- Callback ref re-assigns `srcObject` on every mount
- `setCameraOff(false)` reacquires ended track via `getUserMedia()` + `replaceTrack()`
- No PeerConnection destroyed, no renegotiation

---

## 7. Microphone Preservation

- `setMicMuted()`: `audioTrack.enabled = !muted` — **unchanged** ✅
- No microphone logic modified

---

## 8. Remote Speaker Mute/Unmute

- Button: 🔊 / 🔇 with `aria-label`
- Implementation: `remoteVideoRef.current.muted = muted` only
- No socket event ✅, no remote track modified ✅, no renegotiation ✅
- State reset to `false` on `resetCall()` ✅
- Re-applied on `remoteStream` change ✅

---

## 9. WebRTC Latency Measurements

**NOT VERIFIED in live browser.** T0–T7 timing logs implemented (console only). Existing Phase 4C optimizations preserved (ICE cache, `iceCandidatePoolSize: 4`, pre-warm on mount).

---

## 10. ICE/TURN Handling

- 401 → explicit recovery attempt + retry
- Other failure → STUN-only fallback with explicit log
- TURN credentials never logged ✅

---

## 11. Reconnect Behavior

- Phase resets to `idle` on disconnect during `joining`/`searching`
- `joinQueue()` idempotent (phase gate)
- Disconnect grace period: backend unchanged (30s reconnect window) ✅

---

## 12. Socket Listener Audit

- `useSocket.ts`: listeners registered once per token. No duplicate registration on reconnect. ✅
- `useWebRTC.ts`: signaling listeners cleaned up via `socket.off()` in effect cleanup. ✅
- No listener explosion. ✅

---

## 13. Automated Test Results

### Frontend (Vitest)
```
✓ socketEvents.test.ts  21 tests  16ms
✓ apiUrl.test.ts        24 tests  27ms  ← NEW
✓ session.test.ts        8 tests  83ms
✓ utils.test.ts         16 tests  15ms
✓ callStore.test.ts      9 tests  18ms  ← +5 new

Test Files: 5 passed (5)
Tests:      78 passed (78)
```

### Backend (Jest)
```
PASS test/phase2.test.ts
PASS test/phase1.test.ts
PASS test/env.test.ts

Suites: 3 passed (3)
Tests:  33 passed (33)
```

### TypeScript + Build
```
npx tsc --noEmit  → exit 0 ✅
npm run build     → exit 0 ✅ (3.39s, 470 modules)
```

---

## 14. Browser Test Results

**NOT VERIFIED.** Requires live deployment + two physical devices.

| Test | Status |
|------|--------|
| A. Session init — no 405 | NOT VERIFIED |
| B. ICE auth — no 401 | NOT VERIFIED |
| C. Two-browser match | NOT VERIFIED |
| D. Camera ON→OFF→ON no blank | NOT VERIFIED |
| E. Microphone toggle | NOT VERIFIED |
| F. Speaker mute/unmute | NOT VERIFIED |
| G. Next → immediate requeue | NOT VERIFIED |
| H. Socket reconnect during search | NOT VERIFIED |
| I. Network loss → recovery | NOT VERIFIED |
| J. Mobile Chrome (Android) | NOT VERIFIED |

---

## 15. WebRTC Internals

**NOT VERIFIED.** T0–T7 diagnostics implemented and will appear in browser console.

---

## 16. Remaining Issues

1. **Vercel env var required:** `VITE_BACKEND_URL=https://video-chat-web-gluc.onrender.com` must be set (no trailing slash). This is the only deployment config change needed to fix Problems 1 and 2.
2. **TURN server:** Backend must have real `TURN_SERVER_URLS` configured. Localhost TURN is excluded in production (logged as warning).
3. **`setCameraOff` is now async:** `ChatRoom.tsx` calls it via `void setCameraOff(isCameraOff)`. Callers must be aware of async nature.
4. **Mobile lifecycle:** Code is in place but NOT VERIFIED on physical Android device.

---

## 17. Production Readiness Status

```
NOT PRODUCTION READY
```

**Reason:** Browser verification has not been performed. All code changes are complete, architecturally correct, and all 111 automated tests pass. But the following have not been verified on live infrastructure:

- Session init against actual Vercel + Render
- ICE auth with actual token flow
- Camera OFF→ON with actual camera hardware
- Speaker mute with actual remote audio
- Mobile Chrome (Android)

**To reach PRODUCTION READY:**
1. Set `VITE_BACKEND_URL=https://video-chat-web-gluc.onrender.com` in Vercel environment settings
2. Deploy frontend
3. Execute Tests A–J from Section 14 with two real browsers
4. Verify chrome://webrtc-internals shows T0→T7 ≤2s on local network

**Never hide failures. Never claim production readiness without real browser verification.**
