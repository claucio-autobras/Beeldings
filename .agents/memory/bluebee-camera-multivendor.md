---
name: Telemetria de câmera multi-fabricante
description: Regras do motor de 3 camadas de telemetria de câmera (provider registry, sentinelas, real > estimativa)
---

# Regras
- Toda lógica por marca vive no provider-registry do gateway (OIDs enterprise, sentinelas, fallback HTTP). O motor genérico nunca ganha `if` por fabricante — marca nova = entrada nova no registro.
- Ordem por CAMPO: OID do ponto > campo do provider > MIB-II > sintético (ping/estimado). Falha/sentinela de um campo nunca derruba os demais.
- Dado REAL sempre vence estimativa: uptime ISAPI (HTTP) > sysUpTime MIB-II > OID próprio > `state:'estimated'` com valor null (o backend deriva "tempo online estimado" de `config.availability.onlineSince`).
- Intelbras compartilha a árvore enterprise Dahua (1004849) e firmware com bugs: campos válidos respondem 0 fixo → provider `bestEffort` com `sentinels:[0]` marca `unreliable` ("dado não confiável") em vez de exibir zero falso. Empate 1004849 sem cadastro manual resolve como Intelbras.
- OIDs oficiais Dahua (root 1004849.2): cpu 2.1.3.0 e memory 2.1.9.2.0 (escalares %); NÃO existe objeto de temperatura na doc oficial (temp de câmera Dahua/Intelbras = UCD genérico); os antigos …2.1.3.X.1.1 de dumps comunitários eram inválidos.
- Identificação: manufacturer manual > sysDescr/sysObjectID > enterprise dos OIDs dos pontos; com retry por ciclo enquanto a câmera não responde.

**Why:** hardware Intelbras real responde valores impossíveis em OIDs válidos; sem sentinela o painel mostraria 0% de CPU como se fosse leitura boa.

**How to apply:** ao adicionar fabricante/métrica, editar só o provider-registry + testes do engine; UI lê `state`/`unreliable` do ponto (persistidos em DevicePoint.lastValueState).

# Simulação sem hardware
- `scripts/dev-camera-intelbras-sim.cjs` (porta 1162) simula Intelbras com sentinelas; net-snmp Scalar responde em `oid.0` — OIDs de célula de tabela Dahua (…3.N.1.1) precisam de provider Table (coluna + índice), não Scalar.
