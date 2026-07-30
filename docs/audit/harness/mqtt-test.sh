#!/usr/bin/env bash
# Fase 2 — ingestão MQTT: volume, idempotência (dup) e multi-instância.
set -u
cd /home/runner/workspace/.local/audit/tmp
Q() { psql "$DATABASE_URL" -tAc "$1"; }
CNT="select count(*) from trend_records where trend_id like 'audit-load-tr-%'"
BPID_MAIN=$(pgrep -f "dist/src/main" | head -1)
cpu() { ps -o %cpu=,rss= -p "$1" 2>/dev/null; }

echo "== FASE A: 5 msg/s x 20s (200 pts/s) =="
B=$(Q "$CNT"); T0=$(date +%s%3N)
node mqtt-flood.js 5 20
sleep 3
A=$(Q "$CNT")
echo "baseline=$B after=$A inserted=$((A-B)) expected=$((5*20*40))"

echo "== FASE B: 25 msg/s x 30s (1000 pts/s) =="
B=$(Q "$CNT")
( for i in 1 2 3 4 5 6; do sleep 5; echo "cpu/rss backend: $(cpu $BPID_MAIN)"; done ) &
node mqtt-flood.js 25 30
sleep 5
A=$(Q "$CNT")
echo "inserted=$((A-B)) expected=$((25*30*40))"
curl -s http://localhost:4000/health/comms | python3 -c "import json,sys;d=json.load(sys.stdin)['ingestion'];print('ingestion:',d)"

echo "== FASE C: idempotência — mesma mensagem 2x (5 msg/s x 10s dup) =="
B=$(Q "$CNT")
node mqtt-flood.js 5 10 dup
sleep 3
A=$(Q "$CNT")
echo "inserted=$((A-B)) unique_msgs_pts=$((5*10*40)) (se ~2x => sem dedup)"
Q "select count(*) from (select trend_id,timestamp,count(*) c from trend_records where trend_id like 'audit-load-tr-%' group by 1,2 having count(*)>1) d" | xargs echo "pares (trend,timestamp) duplicados:"

echo "== FASE D: multi-instância — 2ª instância + 10 msg/s x 15s =="
cd /home/runner/workspace/apps/backend
PORT=4001 LOG_LEVEL=warn node dist/src/main.js > /tmp/backend-4001.log 2>&1 &
B2=$!
trap "kill $B2 2>/dev/null" EXIT
for i in $(seq 1 30); do curl -sf http://localhost:4001/cluster/status >/dev/null && break; sleep 1; done
curl -s http://localhost:4001/cluster/status; echo
sleep 3
cd /home/runner/workspace/.local/audit/tmp
B=$(Q "$CNT")
node mqtt-flood.js 10 15
sleep 4
A=$(Q "$CNT")
echo "inserted=$((A-B)) expected_1x=$((10*15*40)) (se ~2x => cada instância grava)"
echo "== FASE D2: graceful shutdown — SIGTERM na instância 4001 =="
kill -TERM $B2; sleep 3
tail -5 /tmp/backend-4001.log
kill -0 $B2 2>/dev/null && echo "processo ainda vivo após SIGTERM+3s" || echo "processo encerrou"
echo DONE
