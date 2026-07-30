---
name: SCADA editor static (design) render
description: Why editor-canvas widgets need an explicit staticRender flag instead of just a null value getter.
---

SCADA value-reactive widgets treat `getValue()===null` as an **offline/no-data** state
(grey `colorOffline`/`#475569`, `—`, `WifiOff`, grayscale). So feeding a bound widget a
neutral `() => null` getter in the editor does NOT produce a neutral design look — it
produces the broken "offline" look.

**Rule:** the editor canvas (edit mode, NOT Preview) passes an explicit `staticRender`
flag threaded EditorCanvas → WidgetRenderer → each `*WidgetView`. Each widget has a
dedicated static branch: base color, placeholder `––`, empty levels/pcts, no
blink/spin/pulse, and it must NOT reuse the offline branch.

**Why:** offline (live telemetry lost) and design-time (no live source at all) are
distinct visual intents that happened to share the `raw === null` condition.

**How to apply:** WidgetRenderer also skips per-point status resolution and live
conditional-visibility eval when `staticRender`. Preview branch (isEditor=false) and the
published viewer are untouched — they stay fully live. PropertiesPanel/BindingSelector use
their own telemetry hooks and are independent of the canvas.
