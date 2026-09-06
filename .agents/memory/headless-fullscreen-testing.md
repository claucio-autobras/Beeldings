---
name: Headless fullscreen testing
description: Why visual checks can't validate fullscreen portal fixes in Playwright headless
---
Headless Chromium sets `document.fullscreenElement` on `requestFullscreen()` but does NOT do real top-layer promotion: `position:fixed` content portaled to `document.body` still paints "over" the fullscreen element, unlike a real browser where it becomes invisible.

**Why:** During the Device Counter fullscreen-modal fix, the modal looked correct in test screenshots even though the portal target was still `document.body` — the visual check was a false positive.

**How to apply:** Any fullscreen-portal fix must be asserted structurally in tests: evaluate `document.fullscreenElement.contains(overlay)` in-page, never rely on screenshots. Reusable portal target is the global `usePortalContainer` hook (promoted to `src/hooks/`; fullscreenElement ?? body, reacts to `fullscreenchange`).

Also: the standalone SCADA viewer route (`/scada-view/...`) lives OUTSIDE the private layout — no Topbar. Global overlays (e.g. the new-alarm popup) mounted in the Topbar simply don't exist there; they need a self-contained host (`NewAlarmPopupHost`) mounted explicitly on Topbar-less pages, with its own realtime subscription.
