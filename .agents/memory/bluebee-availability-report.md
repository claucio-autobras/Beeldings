---
name: Relatório de Disponibilidade
description: Como as transições online/offline são persistidas e o uptime calculado (status_events, recorder, sem dados)
---

# Disponibilidade dos equipamentos

- Tabela `status_events` guarda SÓ transições deduplicadas (nunca polling contínuo); primeiro evento de uma entidade marca o INÍCIO da cobertura de dados.
- `AvailabilityRecorderService` (módulo mqtt): grava apenas na líder do cluster; dedup em memória com seed lazy do último evento no banco — é isso que torna a reentrega do status retido no restart inofensiva.
- Sweeper de 30s tem carência de 90s pós-boot: sem ela, todo restart geraria falsas quedas de devices (mapa de recência em memória nasce vazio).
- Câmeras: status = valor do ponto STATUS (1=online) E telemetria recente (<5min); recência sozinha mente (câmera responde com vídeo caído). Valor semeado do `DevicePoint.lastValue` persistido.
- Cálculo (`availability.service.ts` → `computeTimeline` exportada): janela coberta começa em `from` só se existe evento ANTERIOR a `from` (estado conhecido na borda); senão no 1º evento do período. Sem cobertura = "Sem dados", nunca 0%/100% fake.
- **Why:** falso 0% num equipamento recém-cadastrado ou falso 100% num período pré-recurso destruiria a confiança no relatório de SLA.
- **How to apply:** qualquer novo consumidor de `status_events` deve respeitar a semântica "coverage" e nunca assumir estado antes do primeiro evento.
