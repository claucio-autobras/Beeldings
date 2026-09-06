---
name: Scroll do shell privado
description: Regra de contenção da viewport nas telas autenticadas do BlueBee.
---

O shell autenticado deve ficar fixo em toda a viewport; `html` e `body` não podem ser os contêineres de rolagem. Sidebar e topbar permanecem ancoradas, enquanto cada página usa a área principal ou cards internos para acessar conteúdo excedente.

**Why:** Apenas aplicar `overflow: hidden` ao documento não basta: o navegador ainda pode preservar ou alterar programaticamente o scroll de uma árvore cujo shell participa do fluxo, deslocando toda a interface.

**How to apply:** Manter o shell privado fora do fluxo com posicionamento fixo e dimensões de viewport, bloquear o overflow de `html/body` enquanto ele estiver montado e garantir `min-height: 0` nos filhos flex. Rotas públicas removem o bloqueio.