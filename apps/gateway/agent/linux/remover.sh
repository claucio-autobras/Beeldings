#!/usr/bin/env bash
# ===========================================================================
#  BlueBee IoT Gateway - Remocao do servico systemd
#  Uso: sudo bash remover.sh
# ===========================================================================
set -euo pipefail

SERVICE_NAME="bluebee-gateway"

if [ "$(id -u)" -ne 0 ]; then
  echo "[ERRO] Rode como root: sudo bash remover.sh"
  exit 1
fi

echo "Parando e removendo o servico ${SERVICE_NAME}..."
systemctl stop "${SERVICE_NAME}" 2>/dev/null || true
systemctl disable "${SERVICE_NAME}" 2>/dev/null || true
rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
systemctl daemon-reload

echo "Servico removido. Para reinstalar, rode: sudo bash instalar.sh"
