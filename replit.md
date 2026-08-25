# [Project name]

_Replace the heading above with the project's name, and this line with one sentence describing what this app does for users._

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Backend API hardening (apps/backend): Helmet ativo, rate limit global 600 req/min por IP (login/confirm-password: 10/min → 429). Envs opcionais: `RATE_LIMIT_MAX`, `RATE_LIMIT_TTL_MS`, `CORS_ORIGINS` (lista separada por vírgula; em produção sem ela, cai para `REPLIT_DOMAINS`; dev é permissivo).
- Imagens do SCADA no App Storage (bucket GCS do Replit): upload via `POST /scada/assets` grava em `<PRIVATE_OBJECT_DIR>/scada/<tenant>/<uuid>.<ext>`; leitura por streaming em `GET /scada-assets/<tenant>/<arquivo>` (cache imutável 7 dias, 404 explícito). Disco (`uploads/scada/`) NÃO é mais usado; `SCADA_UPLOAD_DIR` foi removido do fluxo. Env obrigatórias no runtime (dev e deploy/VM de produção): `PRIVATE_OBJECT_DIR` (e as demais do App Storage: `DEFAULT_OBJECT_STORAGE_BUCKET_ID`, `PUBLIC_OBJECT_SEARCH_PATHS`). **Na VM de produção, antes/logo após o próximo deploy, rodar uma vez** `node scripts/migrate-scada-assets-to-bucket.mjs [dir]` para subir os arquivos antigos de `uploads/scada/` ao bucket (idempotente — pula os que já existem; aceita `SCADA_UPLOAD_DIR`/arg como raiz de origem).

## Espelho externo (Claucio) — sincronização bidirecional

- O remoto `github.com/claucio-autobras/Beeldings` é sincronizado nos DOIS sentidos por `scripts/sync-github.sh` (`push` / `push-snapshot` / `pull` / `status`; precisa de `GITHUB_TOKEN`). Um workflow persistente e o `post-merge` publicam automaticamente snapshots filtrados quando a `main` local avança, sem anexos do chat, vídeos, exports ou saídas geradas; eles não fazem pull/force-push quando o GitHub diverge. O histórico completo local (~3,8 GB) nunca é enviado. Guia completo: `docs/github-sync.md`; procedimento canônico: `.agents/memory/bluebee-claucio-snapshot.md`.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
