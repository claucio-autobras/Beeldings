---
name: SCADA pipe widget
description: Como o widget de tubulação (pipe) do SCADA armazena vértices, anima o fluxo e é editado no canvas.
---

# Widget de Tubulação (pipe)

- Vértices `points` são NORMALIZADOS ao bounding box do widget (min = 0); a view escala por `width/naturalW`, `height/naturalH` (guarda ÷0 p/ tubos retos, bbox mínimo 2px). Qualquer edição de vértice deve renormalizar x/y/width/height junto (helper no EditorCanvas).
- Animação = `stroke-dashoffset` via **Web Animations API** (`element.animate` no `FlowPath`), deslocando exatamente um período (traço+vão em px) por ciclo → loop sem "pulo". Direção invertida via `direction: 'reverse'`, velocidade constante em px/s (duração = período/velocidade). Respeita `prefers-reduced-motion`.
- **Why:** o keyframe CSS anterior usava `var(--pipe-period)` DENTRO de `@keyframes` — resolução de CSS var em keyframes falha em algumas composições/navegadores (tracejado congelado no viewer). WAAPI também sobrevive a re-renders (só reinicia quando os parâmetros mudam). Animar comprimentos absolutos causa salto no reinício do loop; período exato garante continuidade.
- Editor mostra aviso âmbar no painel do pipe quando há binding mas nenhuma `flowRule` casa com o valor atual (`PipeFlowMatchHint`) — só feedback, sem mudar semântica.
- Estado: sem binding → decorativo (sempre fluindo); com binding e sem leitura/sem regra casando → parado; regras próprias `flowRules` (flowing + cor alternativa), NÃO reusa EquipmentStateRule. `staticRender` mostra visual "fluindo" porém com animação parada.
- Editor: pipe NÃO usa as 8 alças de resize padrão (só vértices arrastáveis + midpoints para inserir; duplo clique remove); redimensionar continua possível pelos campos do painel. Modo desenhar via flag `pipeDraw` no editor.store (cliques ortogonais por padrão, Alt = livre; Enter/duplo clique finaliza, Esc cancela com listener em capture p/ vencer o Esc global).
- Durante `pipeDraw`, `onWidgetMouseDown` retorna cedo para o clique borbulhar até o canvas (permite rotear a tubulação por cima de equipamentos).
