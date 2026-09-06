---
name: Tenant branding (topbar)
description: Regras de produto e decisões duráveis da identidade visual do cliente (logo + cor).
---

- Assets visuais por tenant (logo, etc.) reusam o pipeline de assets SCADA (App Storage + rota pública com UUID imprevisível). Não criar bucket/rota separados para novos assets de tenant.
- **Why:** a rota pública, cache imutável e a limpeza por prefixo no delete de cliente já cobrem qualquer asset por tenant.
- A cor de destaque do cliente é usada só como acento (linha/dot/brilho), NUNCA como fundo de texto — assim não há problema de contraste em claro/escuro; paleta curada em vez de color picker livre.
- Regras de produto: cliente sem logo mostra só o nome (nunca avatar com iniciais); admin em "Todos Clientes" não mostra identidade; em telas estreitas o bloco encolhe (some o rótulo, logo menor), nunca é ocultado por completo.
