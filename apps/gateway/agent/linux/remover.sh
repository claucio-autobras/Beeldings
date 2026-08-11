#!/usr/bin/env bash
# ===========================================================================
#  Beeldings IoT Gateway - Remocao do servico systemd
#  Uso: sudo bash remover.sh
# ===========================================================================
set -euo pipefail

SERVICE_NAME="beeldings-gateway"
LEGACY_SERVICE_NAME="bluebee-gateway"

if [ "$(id -u)" -ne 0 ]; then
  echo "[ERRO] Rode como root: sudo bash remover.sh"
  exit 1
fi

echo "Parando e removendo o servico ${SERVICE_NAME}..."
systemctl stop "${SERVICE_NAME}" 2>/dev/null || true
systemctl disable "${SERVICE_NAME}" 2>/dev/null || true
rm -f "/etc/systemd/system/${SERVICE_NAME}.service"

# Limpa tambem o servico LEGADO (nome antigo BlueBee), se existir.
if [ -f "/etc/systemd/system/${LEGACY_SERVICE_NAME}.service" ]; then
  echo "Removendo tambem o servico legado ${LEGACY_SERVICE_NAME}..."
  systemctl stop "${LEGACY_SERVICE_NAME}" 2>/dev/null || true
  systemctl disable "${LEGACY_SERVICE_NAME}" 2>/dev/null || true
  rm -f "/etc/systemd/system/${LEGACY_SERVICE_NAME}.service"
fi

systemctl daemon-reload

echo "Servico removido. Para reinstalar, rode: sudo bash instalar.sh"
