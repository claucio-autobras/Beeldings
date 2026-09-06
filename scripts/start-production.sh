#!/usr/bin/env bash
# Start de produção do BlueBee (deployment.run em .replit).
# - NÃO aplica migrations aqui: o schema de produção é sincronizado pelo fluxo
#   de Publish da Replit (diff dev→prod na publicação). Rodar `prisma migrate
#   deploy` no start conflitava com esse sync ("column already exists" →
#   migration marcada como falha → P3009 → crash loop do deploy).
# - Semeia tenant + usuário ADMIN (idempotente; não sobrescreve senha existente)
# - Sobe backend (porta 4000, interno) e frontend (porta 8080 -> externa 80)
# Se qualquer um dos dois processos morrer, o script encerra para que a
# plataforma reinicie o deploy inteiro.
set -euo pipefail

cd "$(dirname "$0")/.."

export NODE_ENV=production

echo "==> Semeando tenant + admin (idempotente)"
(cd apps/backend && node dist-seed/seed.js)

echo "==> Subindo backend (porta 4000)"
(cd apps/backend && PORT=4000 node dist/src/main.js) &
BACKEND_PID=$!

echo "==> Subindo frontend (porta 8080)"
(cd apps/frontend && npx next start -p 8080 -H 0.0.0.0) &
FRONTEND_PID=$!

trap 'kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true' EXIT

# Encerra assim que QUALQUER um dos dois cair (a plataforma reinicia o deploy).
wait -n "$BACKEND_PID" "$FRONTEND_PID"
EXIT_CODE=$?
echo "==> Um dos processos encerrou (exit ${EXIT_CODE}); finalizando deploy para reinício."
exit "$EXIT_CODE"
