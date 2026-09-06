---
name: SCADA widget popups
description: Regras duráveis para composições popup associadas a widgets SCADA.
---

Popup é uma composição local persistida no próprio JSON do widget, não uma tela, rota, tabela ou fonte de telemetria separada. Seus filhos usam o mesmo renderer e callbacks da tela hospedeira, e nunca podem hospedar outro popup.

**Why:** Manter o popup dentro do contrato opaco existente preserva telas antigas e evita sincronização duplicada. Bloquear recursão evita ciclos, estados ambíguos e interações impossíveis de fechar.

**How to apply:** Qualquer clonagem ou normalização de widgets deve renovar IDs da composição e remover popup dos filhos. No runtime, montar pelo container de portal compatível com fullscreen e distinguir o `role="button"` do próprio âncora de controles interativos realmente internos.