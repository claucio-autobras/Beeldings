#!/usr/bin/env bash
# Build de produção do BlueBee (backend NestJS + frontend Next.js).
# Executado pelo deploy do Replit (deployment.build em .replit).
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> Instalando dependências"
npm install --no-audit --no-fund

echo "==> Gerando Prisma Client"
(cd apps/backend && npx prisma generate)

echo "==> Build do backend (NestJS)"
(cd apps/backend && npx nest build)

echo "==> Compilando seed do Prisma para JS (sem ts-node em produção)"
(cd apps/backend && npx tsc prisma/seed.ts --outDir dist-seed --module commonjs --target ES2021 --esModuleInterop --skipLibCheck)

echo "==> Build do frontend (Next.js)"
(cd apps/frontend && npx next build)

echo "==> Build de produção concluído"
