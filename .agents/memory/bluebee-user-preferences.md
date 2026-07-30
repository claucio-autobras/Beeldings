---
name: BlueBee user preferences & dark mode
description: How per-user preferences (theme/bell/language) and Tailwind v4 dark mode work; pitfalls with @theme inline and Turbopack cache.
---

# Preferências do usuário

- Fonte da verdade: `users.preferences` (JSONB). Backend sanitiza campo a campo; em PATCH parcial, `sanitizeUserPreferences(raw, base)` recebe as prefs ATUAIS como base — valor inválido preserva o atual, nunca volta ao default.
- Login devolve `user.preferences`; frontend cacheia em localStorage `bluebee_prefs` (limpo no signOut — prefs são por usuário) e sincroniza via GET/PATCH `/account/preferences`.
- Script no-flash inline no `<head>` lê `bluebee_prefs` e aplica `.dark` antes do paint.

# Dark mode (Tailwind v4)

- Tokens de cor ficam em `@theme` SEM `inline` — utilities compilam para `var(--color-*)` e podem ser sobrescritas sob `.dark { ... }`. `@theme inline` (necessário só para fontes do next/font) inlina os valores e IMPEDE override por classe.
- **Why:** com `inline`, `.bg-card` vira `background-color:#FFF` fixo; sem, vira `var(--color-card)`.
- Overrides sob `.dark`: tokens semânticos + slate-50..600 + tints -50/-100/-200 (cyan/red/emerald/amber/orange/blue/purple). NÃO tocar slate-700/800/900 (sidebar e editor SCADA são escuros por design) nem branco dos knobs de toggle.
- `bg-white` foi trocado por `bg-card` em massa (idêntico no claro); novos componentes devem usar tokens (`bg-card`, `text-foreground`, `border-border`), não cores fixas claras.
- **Gotcha Turbopack:** mudanças estruturais no globals.css (novo bloco `.dark`, mover @theme) podem não aparecer no CSS servido mesmo após restart — é preciso `rm -rf .next` e reiniciar.

# Sino/notificações

- Filtros por preferência aplicados em `buildNotifications` (Topbar): offlineEnabled, automationEnabled, minSeverity (alarme sem severidade sempre passa). Beep WebAudio em novo alarme se soundEnabled (sem asset de áudio; bloqueado até 1º gesto do usuário).
- Idioma pt-BR/en apenas persiste — a UI ainda não é traduzida (aviso na própria página).
