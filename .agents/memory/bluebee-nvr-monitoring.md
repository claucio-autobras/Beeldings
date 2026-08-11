---
name: NVR/DVR monitoring (CFTV)
description: Perfis SNMP de NVR, normalização vendor na fonte, pontos indexados de disco/canal
---
- NVR = Device monitoredDeviceType='NVR' na área CFTV; excluído de BMS e listas de câmeras pelos filtros canônicos existentes; saúde = mesma regra STATUS + gateway liveness das câmeras.
- Toda peculiaridade de fabricante normaliza na FONTE (gateway/sync), nunca na UI: Hikvision expõe espaço LIVRE (used = capacity − free), Dahua/Intelbras reportam MB (scale 0.001) e enum de status de disco invertido (mapa p/ enum canônico Hikvision 0=sem disco,1=normal,2=erro). Resposta imediata do sync deve aplicar a MESMA escala dos pontos persistidos.
- Pontos default escalares de NVR têm oid:null → o driver só inclui OIDs de perfil no batch para métricas com binding oid null e não-unsupported (incluir incondicionalmente regride o contrato "unsupported fica fora do batch").
- Contrato de métrica é único ponta-a-ponta: ponto default, mappings de perfil e catálogo do probe devem usar a MESMA metricKey (RAM canônica de NVR = 'memory' %, não 'ram_total').
- Sync-disks sem fabricante: identificar perfil via sysDescr da 1ª resposta (base-nvr NÃO é perfil vendor; tratar como "sem perfil"), persistir profileId detectado sem sobrescrever escolha manual.
- **Why:** 5 rodadas de code review pegaram exatamente esses desalinhamentos silenciosos entre discovery pontual e telemetria contínua.
- **How to apply:** ao adicionar novo tipo monitorado SNMP (padrão switch/NVR), verificar que discovery e polling contínuo compartilham normalização, escala e metricKeys.
