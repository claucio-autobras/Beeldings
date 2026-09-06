---
name: Polling SNMP restrito
description: Regra para manter a coleta contínua alinhada aos bindings persistidos em equipamentos SNMPv1.
---

No polling contínuo com `restrictToBindings`, o lote deve conter somente OIDs escalares e membros declarados nos bindings persistidos. Não adicionar OIDs do perfil, MIB genérica, sysUpTime ou walks de recuperação implicitamente.

**Why:** Em SNMPv1, um OID ausente ou inválido pode fazer o agente rejeitar o GET inteiro. Fallbacks úteis no diagnóstico podem transformar respostas válidas de outras métricas em “sem dados” durante a coleta.

**How to apply:** Mantenha fallback e descoberta em diagnóstico/recovery não restrito; quando o backend publicar bindings concretos, faça o gateway consultar exatamente esse plano e teste pelo menos um perfil proprietário com valores reais.