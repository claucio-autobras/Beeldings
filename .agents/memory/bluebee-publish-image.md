---
name: Publish image & fontes offline
description: Deploy build sem rede p/ Google Fonts; .replitignore controla tamanho da imagem (limite 8 GiB)
---

**Regra:** o ambiente de build do Publish NÃO acessa fonts.googleapis.com — toda fonte do frontend deve ser `next/font/local` com os woff2 no repositório (`apps/frontend/src/app/fonts/`, variáveis CSS `--font-inter`/`--font-fira-code` preservadas). Nunca reintroduzir `next/font/google`.

**Why:** o publish quebrava no `next build` por falha de download de fonte; e a imagem estourava o limite de 8 GiB (workspace ~9 GB dominado por `.git`, `.next` de dev, caches, attached_assets).

**How to apply:** `.replitignore` exclui `.git`, `apps/frontend/.next`, `.pythonlibs`, `.cache`, `attached_assets`, `backups`, `exports`, `*.mp4`, artifacts de mockup/vídeo e docs — nada disso é lido por build/start nem servido em runtime. Antes de excluir algo novo, conferir que scripts e backend não o leem (apps/gateway é NECESSÁRIO em runtime p/ o zip do agente). Checklist pós-publish em docs/publish-checklist.md.

## Lição crítica (11/08/2026)
- `.replitignore` também remove ARQUIVOS GERADOS NO BUILD da imagem final: excluir `apps/frontend/.next` fez o publish "dar certo" (build ok) mas o runtime caiu em crash loop com "Could not find a production build in the '.next' directory" → Internal Server Error no domínio.
- Regra: excluir só `apps/frontend/.next/cache`, nunca o `.next` inteiro.

- (ago/2026) Publish travado em "Bundle": `.next/dev` (Turbopack, ~1,7 GB de artefatos do dev server) NÃO estava no .replitignore e dobrou a imagem. Excluir `apps/frontend/.next/dev` (o build de prod recria .next); manter a regra de nunca excluir .next inteiro.
