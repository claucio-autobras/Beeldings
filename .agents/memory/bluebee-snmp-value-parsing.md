---
name: SNMP value normalization (Hikvision OCTET STRING)
description: Câmeras respondem métricas como OCTET STRING com sufixo de unidade; parsing central obrigatório no gateway.
---

# Normalização de valores SNMP

Câmeras Hikvision (enterprise 1.3.6.1.4.1.39165.1.*) respondem métricas como
OCTET STRING com sufixo de unidade — "45 PERCENT", "256 MB", "0.0 GB" — em vez
de INTEGER. `Number(vb.value)` vira NaN → telemetria "sem dados" enquanto o
diagnóstico (que mostra o raw) parece funcionar.

**Regra:** todo parsing de varbind SNMP passa por `parseSnmpNumber` em
`apps/gateway/src/snmp/snmp-read.util.ts` (polling, teste e diagnóstico usam a
mesma função — nunca parsing paralelo divergente). Extrai prefixo numérico,
aceita vírgula decimal e Buffer.

**Semântica dos OIDs Hikvision:** `.1.7.0` CPU %, `.1.9.0` é uso de
ARMAZENAMENTO SD (não RAM!), `.1.10.0` RAM total MB, `.1.11.0` uso real de RAM
%. `.1.8.0` = tamanho do disco em GB. Métricas `ram_total`/`storage` existem
como HealthMetric (backend+frontend em lockstep); pontos criados por backfill
(remap do OID legado `.1.9.0` em memory) e sob demanda no apply do diagnóstico.

**Atenção:** o fix de parsing roda no GATEWAY — gateways de campo com código
antigo continuam publicando null até serem atualizados (pacote de agente).
