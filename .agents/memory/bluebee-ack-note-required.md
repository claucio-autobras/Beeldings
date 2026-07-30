---
name: ACK note required
description: Motivo obrigatório no ACK de alarm-events e como o sino legado escapa da exigência
---
Regra: `AlarmEventsService.acknowledge` exige nota não vazia (trim) e o ACK em lote (`POST /alarm-events/acknowledge`, rota estática ANTES de `/:id/acknowledge`) reusa a lógica individual, pulando itens não reconhecíveis.

**Why:** a nota justifica o ACK e sai no relatório de alarmes; o sino legado (alarms-legacy) não tem campo de motivo, então chama o serviço com `requireNote:false` — remover esse bypass quebra o sino.

**How to apply:** qualquer novo consumidor de ACK deve enviar nota; se criar novo fluxo sem UI de motivo, decidir explicitamente sobre `requireNote` em vez de afrouxar a validação central. Falha em lote no frontend mantém a seleção (diálogo só fecha no sucesso).
