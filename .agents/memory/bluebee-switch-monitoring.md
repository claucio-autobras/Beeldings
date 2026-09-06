---
name: Switch monitoring (CFTV)
description: Conventions for SNMP switch monitoring — table walks, counter rates, probe budget, port sync
---

- Switches são Devices protocol='snmp' com monitoredDeviceType='SWITCH' na área CFTV; nunca aparecem em listas de câmeras/BMS (filtros por monitoredDeviceType).
- Tabelas IF-MIB via subtree walk (`readSnmpTable`, GETBULK v2c / GETNEXT v1) com split-on-error; coluna sem entradas = UNSUPPORTED.
- Taxas publicadas em B/s pelo gateway (UI converte p/ Kbps/Mbps). Decremento de contador: wrap só se varbind confirmado Counter32; Counter64/desconhecido ou reboot (sysUpTime menor) → descarta amostra (null), NUNCA fabricar delta 2^32.
- **Why:** Counter64 tratado como wrap32 gera pico falso gigante de tráfego; review de produção rejeitou exatamente isso.
- Capability probe de switch roda as duas pernas (diagnóstico escalar + descoberta de portas) em PARALELO sob um orçamento único (SWITCH_PROBE_BUDGET_MS) e SEMPRE persiste resultados parciais (TEMPORARY_ERROR) — sequencial estoura o timeout HTTP.
- Sync de portas: merge por ifIndex (3 pontos por porta: sw-state/sw-in/sw-out como objectType distintos, instance=ifIndex); portas removidas só saem com confirmação explícita (SensitiveActionGuard). Trend automático só p/ sw-state (ON_CHANGE, 90d) — política de volume: nunca auto-trend de taxas.
- Endpoints de switch precisam de assertGatewayInTenant no create e no update quando gatewayId muda (contra o tenant efetivo do switch).
