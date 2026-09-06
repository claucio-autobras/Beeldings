---
name: SCADA visual transfer
description: Regra para sanitizar telas SCADA exportadas sem destruir geometria visual.
---

Ao exportar uma tela SCADA, `points` é ambíguo: pode ser uma lista de bindings/telemetria ou a geometria visual de polígonos e tubulações. Não remova a chave globalmente. Remova referências runtime recursivamente e descarte apenas entradas que ficarem vazias; preserve pontos com coordenadas, estilos e demais propriedades visuais.

**Why:** Uma remoção global de `points` deixa a tela importada sem a forma de tubos/polígonos, embora elimine corretamente alguns vínculos de equipamento.

**How to apply:** Em qualquer sanitizador de transferência, teste ao mesmo tempo uma lista de pontos runtime e uma lista de pontos `{x,y}` visuais.