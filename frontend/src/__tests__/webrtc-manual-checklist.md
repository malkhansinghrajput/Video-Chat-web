# WebRTC Manual Test Checklist

> **Status: NOT FULLY AUTOMATED**
>
> Full browser WebRTC automation (real camera/mic, real peer connections,
> real network traversal) cannot be reliably performed in this environment.
> The tests below must be performed manually on real or simulated devices.

---

## Environment Requirements

- Two browser tabs or two different devices
- Backend running locally (`cd backend && npm start`)
- Frontend running locally (`cd frontend && npm run dev`)
- Camera and microphone attached

---

## Test Suite 1: Session Initialization

| # | Test | Expected | Pass/Fail |
|---|------|----------|-----------|
| 1 | Open `/chat` — backend online | Session init completes, socket connects, searching state appears | |
| 2 | Open `/chat` — backend offline | Error message shown, no crash, ErrorBoundary NOT triggered | |
| 3 | Refresh page while in `/chat` | Session token reused from sessionStorage, reconnects | |
| 4 | Close and reopen tab | sessionStorage cleared (new session on next open) | |
| 5 | Backend returns 429 | "Too many requests" message shown, no retry loop | |

---

## Test Suite 2: Camera and Microphone

| # | Test | Expected | Pass/Fail |
|---|------|----------|-----------|
| 1 | Allow camera+mic | Local video appears in PiP, permission banner disappears | |
| 2 | Deny camera+mic | Red permission banner shown, "Allow & Retry" button visible | |
| 3 | Click "Allow & Retry" | Browser permission dialog reopens | |
| 4 | Camera only unavailable (no device) | "No camera or microphone found" error shown | |
| 5 | Toggle camera off | PiP shows 📷❌ placeholder, remote peer sees black | |
| 6 | Toggle camera back on | PiP shows live video again | |
| 7 | Toggle mic off | 🔇 icon shown, remote peer hears silence | |
| 8 | Toggle mic back on | 🎤 icon shown, remote peer hears audio | |

---

## Test Suite 3: WebRTC Connection

| # | Test | Expected | Pass/Fail |
|---|------|----------|-----------|
| 1 | Two users match | Remote video appears within 5s of matching | |
| 2 | Initiator role (offer created) | Offer sent, answer received, ICE negotiation completes | |
| 3 | Responder role (answer created) | Offer received, answer sent, ICE negotiation completes | |
| 4 | ICE candidates arrive before remote description | Candidates queued, processed after setRemoteDescription | |
| 5 | Connection state: `connected` | HUD shows "HD • Xms", call timer starts | |
| 6 | Connection quality polling | Quality dot updates every 3s based on RTT | |

---

## Test Suite 4: Call Controls During Active Call

| # | Test | Expected | Pass/Fail |
|---|------|----------|-----------|
| 1 | Press Space key | Skip triggered, searching state resumes | |
| 2 | Swipe up on mobile | Skip triggered, swipe feedback overlay shown | |
| 3 | Click ⏭ (Next) button | Skip triggered | |
| 4 | Click ✖ (Leave) button | Leaves chat, navigates to `/` | |
| 5 | Open chat panel | Panel slides in from right, keyboard focus moves inside | |
| 6 | Send a message | Message appears in partner's chat | |
| 7 | Receive a message | Message appears, unread badge on 💬 if chat closed | |
| 8 | Close chat panel | Panel slides out, focus returns to controls | |
| 9 | Drag local video PiP | PiP follows finger/cursor within bounds | |

---

## Test Suite 5: Reconnection and Failure

| # | Test | Expected | Pass/Fail |
|---|------|----------|-----------|
| 1 | Simulate network drop (airplane mode) | Offline banner appears, reconnecting state | |
| 2 | Restore network | Socket reconnects, search resumes | |
| 3 | Partner leaves mid-call | Status resets to searching, call timer stops | |
| 4 | WebRTC `disconnected` state held for 5s | "Connection timed out — skipping" error shown | |
| 5 | WebRTC `failed` state | "Connection failed — try skipping" error shown | |
| 6 | Socket server sends `webrtc:restart` | ICE restart attempted automatically | |

---

## Test Suite 6: Responsive Layout (Manual)

| # | Viewport | Test | Pass/Fail |
|---|----------|------|-----------|
| 1 | 1920×1080 | All controls visible, no overflow | |
| 2 | 1366×768 | Controls not clipped | |
| 3 | 1024×768 | Chat panel opens correctly (320px width) | |
| 4 | 768×1024 (tablet portrait) | Chat panel full-screen, controls not clipped | |
| 5 | 430×932 (iPhone 14 Plus) | Controls above safe area, local video top-right | |
| 6 | 375×812 (iPhone X) | Notch/safe-area insets respected | |
| 7 | 360×800 (Android) | No horizontal scroll | |
| 8 | 390×844 landscape | Controls not hidden behind browser UI | |

---

## Test Suite 7: Browser Compatibility

| Browser | Tested | Result |
|---------|--------|--------|
| Chrome desktop (latest) | NOT TESTED | — |
| Edge (latest) | NOT TESTED | — |
| Firefox (latest) | NOT TESTED | — |
| Safari desktop | NOT TESTED | — |
| Chrome Android | NOT TESTED | — |
| Safari iOS | NOT TESTED | — |

> Browser compatibility tests require manual device access. Never convert "NOT TESTED" to "compatible" without actual verification.

---

## Test Suite 8: Error Scenarios

| # | Scenario | Expected | Pass/Fail |
|---|----------|----------|-----------|
| 1 | React rendering error | ErrorBoundary shows, "Reload Page" button visible | |
| 2 | Socket connect_error | Error banner shown with message | |
| 3 | Session banned | "Your session has been banned" error, socket disconnects | |
| 4 | Session error | Error shown in HUD | |
| 5 | Rate limited (429) | Specific message, no retry loop | |

---

*Last updated: Phase 2 — September 2026*
