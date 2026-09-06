---
name: SNMP card tiles constraint
description: Barras de progresso nos cards SNMP só com escala real conhecida; visual em tiles é opt-in por card, nunca imposto ao CFTV.
---

# SNMP card tiles — restrição durável

Nos cards de saúde SNMP, barra de progresso/rótulo qualitativo só aparece quando a métrica tem escala real conhecida (percentual, temperatura, qualidade de pacotes). Métrica sem faixa (ex.: memória em kB sem total) mostra só o valor — nunca percentual inventado.

**Why:** o usuário confirmou essa semântica no redesign do card SCA; barra fake mascara ausência de dado e contraria o modelo "o card mostra o que o equipamento realmente expõe".

**How to apply:** o componente de métricas é compartilhado entre CFTV e SCA — qualquer mudança visual de destaque deve ser opt-in por card (variante), nunca alterar o outro card sem decisão consciente. Ao dar escala nova a uma métrica, exija uma faixa real (total conhecido, limite físico), não heurística de aparência.
