import type { Widget } from '../../types/scada.types';
import { readWidgetBinding, writeWidgetBinding } from '../../types/scada.types';
import { buildDefaultWidget } from './widgetDefaults';

export type InspectorTabId = 'general' | 'data' | 'style' | 'interaction' | 'rules';

export function resolveInspectorSearchTab(search: string): InspectorTabId | null {
  const query = search.trim().toLowerCase();
  if (!query) return null;
  if (/(ponto|equipamento|controladora|unidade|leitura|telemetria|binding)/.test(query)) return 'data';
  if (/(cor|ícone|icone|rótulo|rotulo|fonte|padding|tamanho|aparência|aparencia)/.test(query)) return 'style';
  if (/(ação|acao|clique|hover|popup|status)/.test(query)) return 'interaction';
  if (/(regra|visib|anima|condição|condicao)/.test(query)) return 'rules';
  if (/(nome|camada|posição|posicao|largura|altura|rotação|rotacao|opacidade)/.test(query)) return 'general';
  return null;
}

export function inspectorBadgeCounts(hasUnifiedBinding: boolean) {
  return {
    general: 6,
    data: hasUnifiedBinding ? 2 : 1,
    style: 5,
    interaction: 6,
    rules: 2,
  } satisfies Record<InspectorTabId, number>;
}

export function buildRestoredWidget(widget: Widget): Widget {
  const defaults = buildDefaultWidget(widget.type, widget.x, widget.y, widget.width, widget.height);
  const current = widget as unknown as Record<string, unknown>;
  const preserved: Record<string, unknown> = {};

  for (const key of Object.keys(current)) {
    if (
      [
        'id', 'x', 'y', 'width', 'height', 'zIndex', 'editorLabel',
        'componentId', 'componentName', 'children', 'parentId',
        'popup', 'clickAction', 'status', 'hover', 'visibility',
      ].includes(key)
      || /^(device|tag)/i.test(key)
      || /binding/i.test(key)
    ) {
      preserved[key] = current[key];
    }
  }

  let restored = { ...defaults, ...preserved } as Widget;
  const binding = readWidgetBinding(widget);
  restored = { ...restored, ...writeWidgetBinding(restored, binding.deviceId, binding.tag) } as Widget;
  return restored;
}