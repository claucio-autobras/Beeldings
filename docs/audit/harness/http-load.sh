#!/usr/bin/env bash
# Fase 2 — carga HTTP. Sobe instância secundária (4001, sem throttle) e roda autocannon.
# Percentis reportados: p50 / p90 / p97.5 / p99 (chaves reais do autocannon; ele não expõe p95).
set -u
cd "$(dirname "$0")/../../../apps/backend" 2>/dev/null || cd /home/runner/workspace/apps/backend
PORT=4001 RATE_LIMIT_MAX=1000000 LOG_LEVEL=warn node dist/src/main.js > /tmp/backend-4001.log 2>&1 &
BPID=$!
trap "kill $BPID 2>/dev/null" EXIT
for i in $(seq 1 30); do curl -sf http://localhost:4001/cluster/status >/dev/null && break; sleep 1; done
cd - >/dev/null

curl -s -X POST http://localhost:4001/auth/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"admin@autobras.com.br\",\"password\":\"$ADMIN_SEED_PASSWORD\"}" -o /tmp/ac-login.json
TOKEN=$(python3 -c "import json;print(json.load(open('/tmp/ac-login.json'))['accessToken'])")
TREND=$(psql "$DATABASE_URL" -tAc "select id from trends where enabled=true limit 1" | tr -d ' ')
IDS=$(psql "$DATABASE_URL" -tAc "select string_agg(id,',') from (select id from trends where enabled=true limit 5) s" | tr -d ' ')

run() { # name path conns dur
  echo "### $1 (c=$3 d=$4s)"
  npx --yes autocannon -j -c "$3" -d "$4" -H "Authorization: Bearer $TOKEN" "http://localhost:4001$2" 2>/dev/null \
    | python3 -c "
import json,sys
d=json.load(sys.stdin)
l=d['latency'];r=d['requests']
print(f\"  p50={l['p50']}ms p90={l['p90']}ms p97.5={l['p97_5']}ms p99={l['p99']}ms max={l['max']}ms | rps avg={r['average']:.0f} | 2xx={d.get('2xx',0)} non2xx={d.get('non2xx',0)} errors={d['errors']} timeouts={d['timeouts']}\")
"
}

run dashboard-overview "/dashboard/overview" 10 20
run alarm-events "/alarm-events?pageSize=50" 10 20
run trend-data "/trends/$TREND/data" 10 20
run trends-history "/trends/history?ids=$IDS&pageSize=100" 10 20
# escalada de concorrência no endpoint mais pesado (busca de saturação)
run dashboard-c25 "/dashboard/overview" 25 15
run dashboard-c50 "/dashboard/overview" 50 15
run dashboard-c100 "/dashboard/overview" 100 15

echo "### login (POST, bcrypt) c=4 d=15s — non2xx esperado = 429 do @Throttle(10/min)"
npx --yes autocannon -j -c 4 -d 15 -m POST -H 'Content-Type: application/json' \
  -b "{\"email\":\"admin@autobras.com.br\",\"password\":\"$ADMIN_SEED_PASSWORD\"}" \
  http://localhost:4001/auth/login 2>/dev/null | python3 -c "
import json,sys
d=json.load(sys.stdin)
l=d['latency'];r=d['requests']
print(f\"  p50={l['p50']}ms p99={l['p99']}ms | rps avg={r['average']:.1f} | 2xx={d.get('2xx',0)} non2xx={d.get('non2xx',0)}\")
"
echo "### latência de login legítimo (5 amostras sequenciais)"
for i in 1 2 3 4 5; do sleep 12; curl -s -o /dev/null -w "  %{http_code} %{time_total}s\n" -X POST http://localhost:4001/auth/login -H 'Content-Type: application/json' -d "{\"email\":\"admin@autobras.com.br\",\"password\":\"$ADMIN_SEED_PASSWORD\"}"; done
echo DONE
