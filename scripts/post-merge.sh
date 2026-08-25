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

# Non-fatal immediate sync after a Replit merge. A persistent sync workflow also
# checks periodically so commits outside this hook are covered.
if [ -n "${GITHUB_TOKEN:-}" ]; then
  bash scripts/sync-github.sh push-snapshot || \
    echo "REMINDER: GitHub was not synchronized automatically; inspect the sync log and resolve any divergence." >&2
else
  echo "NOTE: GITHUB_TOKEN not set; skipped automatic GitHub sync." >&2
fi
