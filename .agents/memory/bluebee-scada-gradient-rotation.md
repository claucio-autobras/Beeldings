---
name: SCADA gradiente e rotação
description: Formato do valor de cor gradiente e da rotação base dos widgets SCADA; armadilhas (alpha concat, SVG fill).
---

- **Gradiente**: campos de cor de preenchimento/fundo aceitam a string CSS pronta `linear-gradient(<ângulo>deg, c1, c2)` no MESMO campo string das cores sólidas (retrocompatível com hex e 'transparent'). Helpers centrais em scada.types: `isGradientColor` / `parseScadaGradient` / `makeScadaGradient` / `scadaBackgroundStyle` (espalhar no style → `background` p/ gradiente, `backgroundColor` p/ sólida).
- **Nunca** concatenar sufixo alpha hex (`${cor}66`) num valor que pode ser gradiente — `scadaColorWithAlpha` degrada p/ a 1ª cor do gradiente; efeitos que exigem cor sólida usam `scadaGradientStop`.
- **SVG (ShapeWidget)** não aceita CSS gradient em `fill`: converter p/ `<linearGradient>` com vetor dx=sin(A), dy=-cos(A) (CSS 0deg = para cima, horário), id derivado do widget.id.
- **Rotação**: `rotation?: number` no WidgetBase (scada.types E no espelho em mocks/data/scada.mock), aplicada só como `transform: rotate()` no wrapper do WidgetRenderer — cobre editor/preview/viewer de uma vez; drag/resize seguem no bbox não-rotacionado e continuam usáveis. Ausente = 0 (telas antigas intactas).
- Só preenchimento/fundo viram gradiente (FillColorInput); texto/traço/cores de estado seguem no ColorInput sólido.

**Why:** decisão do formato string evita migração de schema e mantém telas salvas válidas; alpha-concat em gradiente geraria CSS inválido silencioso.
**How to apply:** qualquer widget novo com fundo deve usar `scadaBackgroundStyle` e o `FillColorInput` no painel; novos efeitos de brilho devem passar por `scadaColorWithAlpha`.
