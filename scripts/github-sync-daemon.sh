#!/bin/bash
set -u

# Mantém o main remoto atualizado sem enviar anexos de conversa ou mídia.
# O processo é deliberadamente unidirecional: se o GitHub avançar fora do
# Replit, a sincronização para e deixa a divergência visível no log.

ROOT_DIR="$(git rev-parse --show-toplevel)"
cd "$ROOT_DIR"

INTERVAL_SECONDS="${GITHUB_SYNC_INTERVAL_SECONDS:-60}"

while true; do
  if bash scripts/sync-github.sh push-snapshot; then
    :
  else
    status=$?
    echo "GitHub sync: tentativa falhou (exit=${status}); nova tentativa em ${INTERVAL_SECONDS}s." >&2
  fi
  sleep "$INTERVAL_SECONDS"
done