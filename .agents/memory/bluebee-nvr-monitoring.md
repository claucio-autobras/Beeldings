---
name: NVR/DVR monitoring (CFTV)
description: Perfis SNMP de NVR, normalização vendor na fonte, pontos indexados de disco/canal
---
- NVR = Device monitoredDeviceType='NVR' na área CFTV; excluído de BMS e listas de câmeras pelos filtros canônicos existentes; saúde = mesma regra STATUS + gateway liveness das câmeras.
- Toda peculiaridade de fabricante normaliza na FONTE (gateway/sync), nunca na UI. Fontes OFICIAIS: Hikvision hikDiskTable (50001.1.241.1: status col 3 enum oficial→canônico via HIK_DISK_STATUS_MAP, free col 4 / cap col 5 em MB → scale 0.001); usa espaço LIVRE (used = capacity − free). Dahua/Intelbras physicalVolumeInfoTable (1004849.2.4.1.1: status col 5 é TEXTO → null honesto, uso col 6 em % (usedIsPercent), total col 7 em GB NATIVO sem scale). Resposta imediata do sync deve aplicar a MESMA escala/unidade dos pontos persistidos.
- Árvores oficiais: Hikvision enterprise 50001 (hikEntity; 39165 só CPU 1.7.0 de campo — sem CPU na MIB oficial); Dahua root 1004849.2 (cpuUsage 2.1.3.0, memoryUsage 2.1.9.2.0, SEM objeto de temperatura → fallback UCD; …1004849.1 é ipSAN, os antigos dsk/chnTable comunitários eram árvore errada). Canal: 2.10.1.1.1.1.2.
- Scale de binding ≠1 SOBREPÕE o scale do mapping do perfil → migração de OID deve REMOVER scale antigo do binding quando a unidade nativa muda (precedente: official-mib-oid-migration, preserva IDs e republica config).
- Pontos default escalares de NVR têm oid:null → o driver só inclui OIDs de perfil no batch para métricas com binding oid null e não-unsupported (incluir incondicionalmente regride o contrato "unsupported fica fora do batch").
- Contrato de métrica é único ponta-a-ponta: ponto default, mappings de perfil e catálogo do probe devem usar a MESMA metricKey (RAM canônica de NVR = 'memory' %, não 'ram_total').
- Sync-disks sem fabricante: identificar perfil via sysDescr da 1ª resposta (base-nvr NÃO é perfil vendor; tratar como "sem perfil"), persistir profileId detectado sem sobrescrever escolha manual.
- **Why:** 5 rodadas de code review pegaram exatamente esses desalinhamentos silenciosos entre discovery pontual e telemetria contínua.
- **How to apply:** ao adicionar novo tipo monitorado SNMP (padrão switch/NVR), verificar que discovery e polling contínuo compartilham normalização, escala e metricKeys.
