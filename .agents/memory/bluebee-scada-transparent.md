---
name: SCADA cor transparente
description: Como "sem cor" (transparente) funciona nos widgets SCADA e a regra para efeitos que concatenam alpha em hex.
---

# Cor transparente nos widgets SCADA

Regra: campos de cor do editor SCADA aceitam o valor CSS literal `transparent`
("sem cor"), armazenado como string no JSON do widget (formato inalterado; hex
existentes seguem válidos). O ColorInput compartilhado e as regras de estado têm
um swatch quadriculado que grava/alterna esse valor.

**Why:** efeitos que concatenam sufixo de opacidade em hex (`${color}66`,
`${color}60` em boxShadow/textShadow/glow) geram CSS inválido com `transparent66`
— o efeito quebrava silenciosamente em vez de sumir.

**How to apply:** nunca concatenar alpha direto em cor vinda de widget. Use os
helpers de `scada.types.ts`: `isTransparentColor(c)` para desativar o efeito e
`scadaColorWithAlpha(c, '66')` para o sufixo seguro. Transparente deve
DESATIVAR glow/borda/LED-shadow (não renderizar efeito "invisível" com custo).
