#!/bin/bash
set -e

# Post-merge setup for the BlueBee npm monorepo.
# Idempotent and non-interactive: installs/updates workspace dependencies
# so newly merged code (new packages, modules) has what it needs.
npm install --no-audit --no-fund

# Apply any pending Prisma migrations and regenerate the client so newly
# merged code that adds tables/models works without a manual step.
# `migrate deploy` is idempotent (only applies pending migrations) and
# non-interactive; it is a no-op when the schema is already up to date.
if [ -z "$DATABASE_URL" ]; then
  echo "DATABASE_URL is not set; the backend requires it. Failing so schema drift is caught early." >&2
  exit 1
fi
(cd apps/backend && npx prisma migrate deploy && npx prisma generate)

# O backend de desenvolvimento roda o JavaScript compilado em dist/. Depois de
# um merge, força o watcher do Nest a recompilar e reiniciar o processo filho,
# para que controllers/rotas recém-mergeados sejam carregados sem intervenção
# manual. Se o workflow estiver parado, a próxima subida já fará build limpo
# por scripts/start-backend-dev.sh.
if pgrep -f "nest start --watch" >/dev/null 2>&1; then
  touch apps/backend/src/main.ts
  echo "Backend em desenvolvimento sinalizado para recompilar após o merge."
fi
