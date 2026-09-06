---
name: SCADA dark chrome scope
description: How the dark-by-design SCADA editor/viewer stays legible under the app's dark theme and gets dark native selects.
---

Rule: any SCADA surface that is dark-by-design in BOTH app themes (editor root, viewer root, floating bench panel) must carry the `scada-dark-chrome` class (globals.css).

**Why:** the global `.dark` override remaps slate-50..600 to dark tones for light-styled screens; inside the already-dark editor that turns slate text invisible (grey-on-grey). The scope restores original slate values (same trick as `.app-sidebar`) and sets `color-scheme: dark` so native `<select>` dropdowns open dark instead of the browser's light default. `.dark` also sets `color-scheme: dark` app-wide.

**How to apply:** new dark-chromed SCADA panels/pages → add `scada-dark-chrome` to their root. Light-themed SCADA modals (e.g. Bancada de Testes) must NOT use it — they follow theme tokens; avoid `text-slate-700+` for text there (stays dark under `.dark`), use `text-foreground`.
