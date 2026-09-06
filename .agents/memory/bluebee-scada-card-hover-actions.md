---
name: SCADA card hover actions
description: Regra de interação para ações sobrepostas nos cards de telas SCADA.
---

As ações sobrepostas de cards SCADA não devem alternar `pointer-events` ou `visibility` no mesmo instante em que o hover as revela. A camada deve permanecer acionável e a apresentação deve variar por opacidade; em dispositivos sem hover, as ações devem ficar sempre visíveis.

**Why:** alternar hit-testing/visibilidade junto ao hover criou uma janela intermitente em que a prévia recebia o clique mesmo com os botões já aparentando estar visíveis. Manter a camada acionável tornou os links determinísticos; mostrar as ações em touch evita alvos transparentes.

**How to apply:** para ações posicionadas sobre miniaturas, use hover apenas para opacidade em ponteiros finos, `focus-within` para teclado e uma regra de exibição permanente para `(hover: none)` ou `(pointer: coarse)`. Nunca mova ou escale o card sob o ponteiro.