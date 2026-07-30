#!/usr/bin/env bash
# ===========================================================================
#  BlueBee IoT Gateway - Instalacao (npm + servico systemd)
#  Uso: sudo bash instalar.sh
#  Coloque o gateway-config.env (ou .env) nesta mesma pasta antes de rodar.
# ===========================================================================
set -euo pipefail

SERVICE_NAME="bluebee-gateway"
DISPLAY="BlueBee IoT Gateway"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ "$(id -u)" -ne 0 ]; then
  echo "[ERRO] Rode como root: sudo bash instalar.sh"
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "[ERRO] Node.js nao encontrado. Instale o Node.js 20+ e tente novamente."
  exit 1
fi
NODE="$(command -v node)"
echo "Node encontrado: ${NODE}"

# Configuracao (.env)
if [ ! -f "${DIR}/.env" ]; then
  if [ -f "${DIR}/gateway-config.env" ]; then
    cp "${DIR}/gateway-config.env" "${DIR}/.env"
    echo "gateway-config.env copiado para .env"
  else
    echo "[AVISO] .env nao encontrado. Coloque o gateway-config.env nesta pasta."
  fi
fi

echo "Instalando dependencias (npm install)..."
( cd "${DIR}" && npm install )

echo "Compilando o gateway (npm run build)..."
( cd "${DIR}" && npm run build )

if [ ! -f "${DIR}/dist/main.js" ]; then
  echo "[ERRO] dist/main.js nao foi gerado pelo build."
  exit 1
fi

if [ ! -f "${DIR}/run.js" ]; then
  echo "[ERRO] run.js (launcher OTA) nao encontrado no pacote."
  exit 1
fi

echo "Criando o servico systemd ${SERVICE_NAME}..."
cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=${DISPLAY} (BACnet/Modbus -> MQTT)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${DIR}
ExecStart=${NODE} ${DIR}/run.js
EnvironmentFile=-${DIR}/.env
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "${SERVICE_NAME}"
systemctl restart "${SERVICE_NAME}"

echo
echo "==========================================================================="
echo " Servico ${SERVICE_NAME} instalado e iniciado."
echo "  - Status: systemctl status ${SERVICE_NAME}"
echo "  - Logs:   journalctl -u ${SERVICE_NAME} -f"
echo "==========================================================================="
