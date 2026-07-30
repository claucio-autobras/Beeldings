---
name: SCADA click action
description: Regras da "Ação ao clicar" genérica em widgets de tela sinótica
---
- A ação genérica de clique só executa quando `isEditor=false` E o renderer NÃO recebeu `onClick` (editor passa onClick para seleção; viewer/Preview não passam). Nunca condicionar só em isEditor.
- Widgets com interação própria ficam fora via `CLICK_ACTION_EXCLUDED_TYPES` (command-*, hotspot, nav-*, camera); novos widgets interativos devem entrar nesse set.
- **Why:** um clickAction num command-button criaria duplo comando; e no editor o clique precisa continuar apenas selecionando.
- Toast fora do editor: `useEditorStore.getState().addToast` é um store zustand global — funciona no viewer, desde que a página monte `<ToastNotification />`.
- Toggle deriva o próximo valor da telemetria atual (`toScadaNumber(getValue…)` vs offValue); pontos graváveis validados por `isWritablePoint` (mesma regra dos widgets de comando).
