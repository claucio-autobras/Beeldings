---
name: BlueBee frontend i18n
description: Convention for pt-BR→en translation in the frontend
---
The pt-BR string IS the dictionary key; missing keys fall back to pt (no crashes). `useT()`/`useLanguage()` hooks in `@/lib/i18n` read the persisted preferences store, so the switch applies instantly without reload; `translate(lang, text)`/`getCurrentLanguage()` for non-hook code.

**Why:** no i18n library (npm firewall + zero refactor of existing pt JSX); language lives in users.preferences.language.

**How to apply:** new pages get a per-module dictionary file registered in `lib/i18n/index.ts`. Never translate backend values, device/tag names, or query params. Beware `t` shadowing in `.map((t) => …)` — rename the map param or use `translate()`.
