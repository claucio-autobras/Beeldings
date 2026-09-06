---
name: SCADA dashboard widgets
description: Durable decisions behind the "Dashboard / Cards" widget family in the SCADA editor
---

- Dashboard cards use explicit per-widget colors instead of the app theme, because the SCADA canvas background is per-screen — never make cards read the app light/dark mode.
- Sparkline/chart history is resolved point→trend (list trends of the device, match by tag). A point without a configured trend legitimately shows "sem dados"; never synthesize a series or a fake 0.
- The event feed is scoped by the screen's tenant/site, threaded through the renderer — never let a screen's feed show cross-tenant alarms.
- Frontend ESLint enforces React-compiler rules as errors: no ref reads/writes during render, no synchronous setState in effects (derive during render, use the "adjust state during render" pattern, or reset in event handlers — optimistic drafts clear on command success because the pending store already reflects the value via getValue), and memo deps must be simple expressions.

**Why:** "sem dados" honesty and tenant scoping are product-level guarantees; the effect-free reconciliation pattern is required for the codebase's lint rules and avoids cascading renders.
**How to apply:** any new dashboard-style widget follows the same pattern (explicit colors, trend-based history, staticRender placeholder, scoped feeds, derive-not-effect state reconciliation).
