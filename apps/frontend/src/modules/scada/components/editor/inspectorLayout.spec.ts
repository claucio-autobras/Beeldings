import type { EquipmentWidget } from '../../types/scada.types';
import { buildRestoredWidget, inspectorBadgeCounts, resolveInspectorSearchTab } from './inspectorLayout';

describe('SCADA inspector layout logic', () => {
  it.each([
    ['camada', 'general'],
    ['ponto vinculado', 'data'],
    ['cor base', 'style'],
    ['popup', 'interaction'],
    ['visibilidade condicional', 'rules'],
  ] as const)('maps search "%s" to %s', (query, expected) => {
    expect(resolveInspectorSearchTab(query)).toBe(expected);
  });

  it('uses contextual data badges without changing the reference counts', () => {
    expect(inspectorBadgeCounts(true)).toEqual({ general: 6, data: 2, style: 5, interaction: 6, rules: 2 });
    expect(inspectorBadgeCounts(false).data).toBe(1);
  });

  it('restores appearance defaults while preserving identity, geometry, order and bindings', () => {
    const widget = {
      id: 'pump-existing',
      type: 'tank',
      x: 31,
      y: 47,
      width: 222,
      height: 333,
      zIndex: 19,
      opacity: 0.35,
      visible: false,
      deviceId: 'device-1',
      tagStatus: 'STATUS',
      tagLevel: 'LEVEL',
      showLabel: true,
      labelText: 'Custom label',
      baseColor: '#123456',
      stateRules: [],
      levelMin: 0,
      levelMax: 100,
      levelUnit: '%',
      levelColor: '#abcdef',
      editorLabel: 'Camada A',
      visibility: { mode: 'conditional', operator: 'eq', value: 1, behavior: 'hide' },
      clickAction: { type: 'navigate', targetScreenId: 'screen-2' },
      hover: { enabled: true, target: 'widget', fillColor: '#fedcba' },
      popup: { enabled: true, trigger: 'click', title: 'Detalhes', widgets: [] },
    } as unknown as EquipmentWidget;

    const restored = buildRestoredWidget(widget) as EquipmentWidget;
    expect(restored).toMatchObject({
      id: 'pump-existing',
      x: 31,
      y: 47,
      width: 222,
      height: 333,
      zIndex: 19,
      editorLabel: 'Camada A',
      deviceId: 'device-1',
      tagStatus: 'STATUS',
      tagLevel: 'LEVEL',
      opacity: 1,
      visible: true,
      baseColor: '#64748B',
    });
    expect(restored.visibility).toEqual(widget.visibility);
    expect(restored.clickAction).toEqual(widget.clickAction);
    expect(restored.hover).toEqual(widget.hover);
    expect(restored.popup).toEqual(widget.popup);
  });
});