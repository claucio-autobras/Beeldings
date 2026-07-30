#!/bin/bash
# Renderização determinística frame a frame (relógio virtual) do vídeo comercial.
# Imune a lentidão de CPU: cada frame é capturado no tempo virtual exato.
#
# Pré-requisitos:
#   - build de produção servido estaticamente (BASE_PATH=/ npm run build; servir dist/public)
#   - playwright-core instalado num diretório de trabalho (npm i playwright-core)
#   - CHROMIUM_BIN apontando para o binário do chromium
#
# Uso: WORKDIR=/tmp/vidcap bash scripts/export-deterministic.sh
set -euo pipefail
ART_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WORKDIR="${WORKDIR:-/tmp/vidcap}"
PORT="${HTTP_PORT:-4173}"
OUT_MP4="${OUT_MP4:-$ART_DIR/exports/bluebee-comercial.mp4}"
TOTAL_MS="${TOTAL_MS:-113500}"

for bin in node ffmpeg python3; do
  command -v "$bin" >/dev/null || { echo "ERRO: '$bin' não encontrado no PATH" >&2; exit 1; }
done
[ -n "${CHROMIUM_BIN:-}" ] && [ -x "$CHROMIUM_BIN" ] || echo "AVISO: CHROMIUM_BIN não definido/executável — Playwright usará o chromium padrão" >&2

mkdir -p "$WORKDIR" "$(dirname "$OUT_MP4")"

if [ ! -d "$WORKDIR/node_modules/playwright-core" ]; then
  (cd "$WORKDIR" && npm init -y >/dev/null 2>&1 && npm install playwright-core >/dev/null 2>&1)
fi

cd "$ART_DIR/dist/public"
python3 -m http.server "$PORT" >"$WORKDIR/http.log" 2>&1 &
HTTP_PID=$!
trap 'kill $HTTP_PID 2>/dev/null || true' EXIT
sleep 2

cd "$WORKDIR"
URL="http://localhost:$PORT/" TOTAL_MS="$TOTAL_MS" OUT="$WORKDIR/det.mp4" \
  node "$ART_DIR/scripts/export-deterministic.js"

ffmpeg -y -i "$WORKDIR/det.mp4" -i "$ART_DIR/public/audio/composite_audio.mp3" \
  -map 0:v -map 1:a -c:v copy -c:a aac -b:a 160k -shortest -movflags +faststart \
  "$OUT_MP4"
DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT_MP4")
echo "OK: $OUT_MP4 (duração: ${DUR}s, esperado ~$(awk "BEGIN{print $TOTAL_MS/1000}")s)"
