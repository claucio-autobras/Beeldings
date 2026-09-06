#!/usr/bin/env bash
# Inicialização de desenvolvimento do backend com build limpo.
#
# O Nest executa o código compilado em dist/, mesmo no modo watch. Remover esse
# diretório antes de subir impede que um workflow reiniciado carregue controllers
# antigos que ficaram de uma execução anterior.
set -euo pipefail

cd "$(dirname "$0")/../apps/backend"

echo "==> Limpando build anterior do backend"
rm -rf dist

exec npm run start:dev