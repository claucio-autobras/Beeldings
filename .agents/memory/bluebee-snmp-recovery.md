---
name: Recuperação SNMP no gateway
description: Walks de recuperação devem ser condicionados à alcançabilidade e amortizados por cache.
---

O motor SNMP pode recuperar bindings obsoletos com fontes universais e walks sob demanda, mas só depois de um GET responder; resultados positivos viram GETs nos ciclos seguintes e ausência de resultado tem janela de dez minutos.

**Why:** Um walk em host silencioso aumenta timeout e carga sem produzir informação, enquanto repetir descoberta a cada ciclo causa ruído e degradação em firmware sem sensores.

**How to apply:** Preserve a ordem ponto → perfil → MIB universal → descoberta, agregue CPUs e interfaces físicas, e limpe os caches no dispose do driver.