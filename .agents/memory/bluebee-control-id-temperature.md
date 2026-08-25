---
name: Perfil térmico Control iD
description: Regra de capacidade térmica do firmware iDFlex e isolamento do fallback genérico.
---

O firmware iDFlex validado em campo não oferece um sensor de temperatura utilizável. O perfil Control iD deve sobrescrever explicitamente o mapping térmico genérico com ausência de OID, mantendo o ponto como não suportado/sem dados e fora da coleta.

**Why:** O fallback UCD lm-sensors é válido para outros firmwares, mas no iDFlex respostas da árvore proprietária foram interpretadas como temperatura e chegaram a alimentar a operação com um valor falso.

**How to apply:** Preserve a temperatura no catálogo genérico para outros fabricantes; filtre apenas o perfil Control iD e migre bindings antigos para `unsupported` com valor nulo. A CPU Control iD usa a média da tabela `hrProcessorLoad`, nunca o OID proprietário de uso agregado. Nunca trate perda de ping como contador SNMP de pacotes.