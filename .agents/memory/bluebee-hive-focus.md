---
name: Foco dinâmico da Colmeia
description: Regra de prioridade visual para escolher o KPI central do Dashboard.
---

O KPI central da Colmeia deve destacar uma condição operacional relevante, em vez de manter sempre IOT/BMS online:

- 3 ou mais alarmes ativos: centralizar Alarmes ativos.
- Caso contrário, 20% ou mais dos dispositivos offline: centralizar Dispositivos offline.
- Caso contrário: visão Admin centraliza Clientes ativos; visão de cliente mantém IOT/BMS online.

Alarmes têm precedência sobre indisponibilidade. O tom visual do hexágono central acompanha a condição (crítico, offline neutro ou marca); o estado offline mantém o tom cinza/azul original, sem virar laranja.

**Why:** O centro da Colmeia é a área de maior atenção visual; usar sempre disponibilidade IoT escondia situações operacionais mais urgentes. A regra aprovada evita destacar qualquer oscilação pequena e mantém o contexto estável quando não há alerta relevante.

**How to apply:** Preserve os limites de 3 alarmes e 20% offline ao ajustar o Dashboard. Se a regra mudar, atualize o cálculo compartilhado e seus testes junto com o tratamento visual do centro. Não use o tom de alerta laranja para a célula offline.