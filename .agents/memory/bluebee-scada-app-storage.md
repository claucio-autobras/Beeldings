---
name: SCADA assets no App Storage
description: Imagens das telas SCADA vivem no bucket GCS do Replit; contrato de URL e requisitos de ambiente/produção.
---

## Regra
As imagens do SCADA são gravadas e servidas do App Storage (bucket GCS via sidecar `127.0.0.1:1106`), em `<PRIVATE_OBJECT_DIR>/scada/<tenant>/<uuid>.<ext>`. O contrato de URL `/scada-assets/<tenant>/<arquivo>` é IMUTÁVEL — está persistido dentro do JSON `widgets`/`settings` das telas; mudar o formato quebra telas existentes.

**Why:** o filesystem do deploy é recriado a cada publicação; disco perdia todas as imagens. Sem fallback para disco de propósito (404 explícito) para não mascarar ambiente mal configurado.

**How to apply:**
- Backend exige `PRIVATE_OBJECT_DIR` no ambiente (dev E deploy/VM de produção) — falha alto se ausente. As vars do App Storage não são secretas.
- Na VM de produção, rodar 1x `node scripts/migrate-scada-assets-to-bucket.mjs` (idempotente) para subir os uploads antigos de disco.
- Servir por streaming com Cache-Control `public, max-age=604800, immutable` + CORP cross-origin (o Helmet global já cobre, mas a rota reforça).
- Imagens órfãs no bucket não são limpas (fora de escopo — há follow-up).
