---
name: CFTV saúde híbrida SNMP
description: Canal SNMP opcional de saúde em câmeras ONVIF (CPU/memória/temperatura/pacotes) e regras que o cercam
---

## Regras
- Câmera ONVIF pode ter `config.snmpHealth` (enabled/port/snmpVersion/community). Os pontos de saúde têm `objectType='snmp'` e tags CPU/MEMORIA/TEMPERATURA/PACOTES_PERDIDOS — é assim que se distinguem dos pontos ONVIF.
- **Falha SNMP nunca afeta o STATUS ONVIF**: o gateway (onvif-polling) lê os OIDs em paralelo e publica `null` na métrica que falhar; a UI mostra "sem dados".
- Perfis de OIDs por fabricante em `camera-oid-profiles.ts` (Hikvision/Dahua/Axis/Intelbras/genérico), pré-selecionados pelo `deviceInfo.manufacturer` do probe ONVIF. Override manual de OID → scale 1 (valor cru), unit do perfil.
- Habilitar/editar o canal faz **upsert por tag** (preserva IDs → trends/alarmes sobrevivem); desabilitar apaga só os pontos `objectType='snmp'`.
- Teste SNMP (`POST /cftv/test-snmp`) é req/resp via MQTT (discovery/snmp-test-result) — mesmo padrão do probe ONVIF.

**Why:** câmeras que só falam ONVIF ficariam "offline" se o SNMP contasse para o status; e delete+create de pontos mata trends (lição de bacnet-sync-replace).

**How to apply:** qualquer consumidor que conte/filtre pontos de câmera ONVIF deve considerar que pode haver pontos snmp misturados; novas métricas de saúde entram em HEALTH_METRIC_META + perfis.
