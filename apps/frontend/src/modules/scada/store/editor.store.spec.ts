import { buildDefaultWidget } from '../components/editor/widgetDefaults';
import type { SavedComponent, ScadaScreen, Widget } from '../types/scada.types';
import { useEditorStore } from './editor.store';

function screenWith(widgets: Widget[]): ScadaScreen {
  return {
    id: 'screen-test',
    tenantId: 'tenant-test',
    name: 'Tela de teste',
    width: 1200,
    height: 800,
    status: 'active',
    isHome: false,
    updatedAt: new Date().toISOString(),
    settings: { backgroundColor: '#0f172a', gridSize: 10, gridOpacity: 1 },
    widgets,
  } as ScadaScreen;
}

function widget(type: Widget['type'], id: string, x: number, y: number): Widget {
  return { ...buildDefaultWidget(type, x, y, 100, 40), id } as Widget;
}

describe('SCADA editor component instances and group movement', () => {
  beforeEach(() => {
    useEditorStore.setState({
      screen: null,
      selectedIds: [],
      components: [],
      clipboard: [],
      history: [],
      historyIndex: -1,
      isDirty: false,
      showProperties: false,
      toasts: [],
      pipeDraw: false,
      polygonDraw: false,
    });
  });

  it('moves only movable widgets by a common delta and preserves relative offsets', () => {
    const first = widget('label-static', 'first', 100, 120);
    const second = widget('label-static', 'second', 275, 190);
    const locked = { ...widget('label-static', 'locked', 500, 500), locked: true };
    const fixed = { ...buildDefaultWidget('nav-toolbar', 0, 0, 500, 48), id: 'fixed', pinnedToProject: true } as Widget;
    const widgets = [first, second, locked, fixed];

    useEditorStore.setState({
      screen: screenWith(widgets),
      selectedIds: widgets.map((item) => item.id),
      history: [{ widgets }],
      historyIndex: 0,
    });

    useEditorStore.getState().moveWidgets([
      { id: 'first', x: 160, y: 155 },
      { id: 'second', x: 335, y: 225 },
      { id: 'locked', x: 700, y: 700 },
      { id: 'fixed', x: 100, y: 100 },
    ], { history: false });

    const moved = useEditorStore.getState().screen!.widgets;
    expect(moved.find((item) => item.id === 'first')).toMatchObject({ x: 160, y: 155 });
    expect(moved.find((item) => item.id === 'second')).toMatchObject({ x: 335, y: 225 });
    expect(moved.find((item) => item.id === 'locked')).toMatchObject({ x: 500, y: 500 });
    expect(moved.find((item) => item.id === 'fixed')).toMatchObject({ x: 0, y: 0 });
    expect(moved[1].x - moved[0].x).toBe(175);
    expect(moved[1].y - moved[0].y).toBe(70);
  });

  it('inserts an independent instance and keeps child geometry immutable', () => {
    const sourceChild = widget('label-static', 'source-child', 20, 30);
    const nestedChild = widget('value-dynamic', 'nested-child', 130, 55);
    const source: SavedComponent = {
      id: 'component-test',
      name: 'Cards de iluminação',
      width: 260,
      height: 140,
      widgets: [{
        ...widget('component-instance', 'nested-source', 0, 0),
        type: 'component-instance',
        componentId: 'nested',
        componentName: 'Subcomponente',
        children: [nestedChild],
      } as Widget, sourceChild],
    };

    useEditorStore.setState({
      screen: screenWith([]),
      components: [source],
      history: [{ widgets: [] }],
      historyIndex: 0,
    });
    useEditorStore.getState().insertComponent('component-test', { x: 300, y: 220 });

    const instance = useEditorStore.getState().screen!.widgets[0];
    expect(instance.type).toBe('component-instance');
    if (instance.type !== 'component-instance') return;
    expect(instance).toMatchObject({ x: 300, y: 220, width: 260, height: 140, componentName: 'Cards de iluminação' });
    expect(instance.children).toHaveLength(2);
    const childId = instance.children.find((child) => child.type === 'label-static')!.id;
    const copiedSourceChild = instance.children.find((child) => child.type === 'label-static')!;
    expect(copiedSourceChild.id).not.toBe(sourceChild.id);
    expect(copiedSourceChild).toMatchObject({ x: sourceChild.x, y: sourceChild.y });
    expect(copiedSourceChild).not.toBe(source.widgets[1]);
    const copiedNested = instance.children.find((child) => child.type === 'component-instance')!;
    if (copiedNested.type !== 'component-instance') return;
    expect(copiedNested.children[0].id).not.toBe(nestedChild.id);

    useEditorStore.getState().updateComponentChild(instance.id, childId, {
      x: 999,
      y: 999,
      width: 999,
      height: 999,
      labelText: 'Iluminação atualizada',
    });
    const updated = useEditorStore.getState().screen!.widgets[0];
    expect(updated.type).toBe('component-instance');
    if (updated.type !== 'component-instance') return;
    const updatedChild = updated.children.find((child) => child.id === childId)!;
    expect(updatedChild).toMatchObject({ x: 20, y: 30, width: 100, height: 40, labelText: 'Iluminação atualizada' });
    expect(sourceChild).toMatchObject({ x: 20, y: 30 });
  });

  it('resizes an instance as one unit and scales nested children without changing the source', () => {
    const nestedChild = widget('label-static', 'nested-child', 10, 15);
    const nested = {
      ...widget('component-instance', 'nested', 80, 20),
      type: 'component-instance' as const,
      componentId: 'nested-source',
      componentName: 'Subcomponente',
      width: 100,
      height: 50,
      children: [nestedChild],
    };
    const child = widget('label-static', 'child', 20, 30);
    const instance = {
      ...widget('component-instance', 'instance', 100, 120),
      type: 'component-instance' as const,
      componentId: 'source',
      componentName: 'Composição',
      width: 200,
      height: 100,
      children: [child, nested],
    };
    const widgets = [instance];
    useEditorStore.setState({
      screen: screenWith(widgets),
      history: [{ widgets }],
      historyIndex: 0,
    });

    useEditorStore.getState().resizeComponentInstance('instance', {
      x: 140,
      y: 160,
      width: 400,
      height: 200,
    });

    const resized = useEditorStore.getState().screen!.widgets[0];
    expect(resized).toMatchObject({ x: 140, y: 160, width: 400, height: 200 });
    if (resized.type !== 'component-instance') return;
    expect(resized.children.find((item) => item.id === 'child')).toMatchObject({
      x: 40, y: 60, width: 200, height: 80,
    });
    const resizedNested = resized.children.find((item) => item.id === 'nested');
    expect(resizedNested).toMatchObject({ x: 160, y: 40, width: 200, height: 100 });
    if (!resizedNested || resizedNested.type !== 'component-instance') return;
    expect(resizedNested.children[0]).toMatchObject({ x: 20, y: 30, width: 200, height: 80 });
    expect(instance.children[0]).toMatchObject({ x: 20, y: 30, width: 100, height: 40 });
    expect(useEditorStore.getState().history).toHaveLength(2);

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().screen!.widgets[0]).toMatchObject({ width: 200, height: 100 });
    useEditorStore.getState().redo();
    expect(useEditorStore.getState().screen!.widgets[0]).toMatchObject({ width: 400, height: 200 });
  });

  it('scales polygon vertices when resizing a widget and a component instance', () => {
    const polygon = buildDefaultWidget('polygon', 20, 30, 100, 50);
    const componentPolygon = buildDefaultWidget('polygon', 10, 10, 50, 25);
    const instance = {
      ...widget('component-instance', 'instance-polygon', 0, 0),
      type: 'component-instance' as const,
      componentId: 'polygon-source',
      componentName: 'Polígonos',
      width: 100,
      height: 50,
      children: [componentPolygon],
    };
    useEditorStore.setState({
      screen: screenWith([polygon, instance]),
      history: [{ widgets: [polygon, instance] }],
      historyIndex: 0,
    });

    useEditorStore.getState().resizeWidget(polygon.id, 200, 100);
    const resized = useEditorStore.getState().screen!.widgets[0];
    expect(resized.type).toBe('polygon');
    if (resized.type !== 'polygon') return;
    expect(resized.points).toEqual([
      { x: 0, y: 0 }, { x: 200, y: 0 }, { x: 164, y: 100 }, { x: 36, y: 100 },
    ]);

    useEditorStore.getState().resizeComponentInstance('instance-polygon', {
      x: 0, y: 0, width: 200, height: 100,
    });
    const resizedInstance = useEditorStore.getState().screen!.widgets[1];
    expect(resizedInstance.type).toBe('component-instance');
    if (resizedInstance.type !== 'component-instance') return;
    const child = resizedInstance.children[0];
    expect(child.type).toBe('polygon');
    if (child.type !== 'polygon') return;
    expect(child.points).toEqual([
      { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 82, y: 50 }, { x: 18, y: 50 },
    ]);
  });

  it('preserves editor labels through copy/paste and uses them before content in layers', () => {
    const labeled = { ...widget('label-static', 'labeled', 10, 10), editorLabel: 'Área norte', text: 'Texto visível' };
    useEditorStore.setState({
      screen: screenWith([labeled]),
      selectedIds: ['labeled'],
      history: [{ widgets: [labeled] }],
      historyIndex: 0,
    });

    useEditorStore.getState().copySelection();
    useEditorStore.getState().paste();

    const pasted = useEditorStore.getState().screen!.widgets[1];
    expect(pasted.editorLabel).toBe('Área norte');
    expect(pasted.id).not.toBe('labeled');
  });

  it('deep-copies popup compositions with fresh ids and no nested popups', () => {
    const child = { ...widget('label-static', 'popup-child', 5, 5), text: 'Popup' };
    const nested = {
      ...widget('rectangle', 'nested-anchor', 10, 40),
      popup: {
        enabled: true, trigger: 'click' as const, title: 'Inválido', width: 200, height: 120,
        backgroundColor: '#000', borderColor: '#fff', borderWidth: 1, borderRadius: 8,
        shadow: true, closeOnOutside: true, closeOnEscape: true, placement: 'auto' as const,
        offset: 8, widgets: [],
      },
    };
    const anchor = {
      ...widget('rectangle', 'anchor', 10, 10),
      popup: {
        enabled: true, trigger: 'click' as const, title: 'Detalhes', width: 300, height: 200,
        backgroundColor: '#000', borderColor: '#fff', borderWidth: 1, borderRadius: 8,
        shadow: true, closeOnOutside: true, closeOnEscape: true, placement: 'auto' as const,
        offset: 8, widgets: [child, nested],
      },
    };
    useEditorStore.setState({
      screen: screenWith([anchor]),
      selectedIds: ['anchor'],
      history: [{ widgets: [anchor] }],
      historyIndex: 0,
    });
    useEditorStore.getState().copySelection();
    useEditorStore.getState().paste();
    const pasted = useEditorStore.getState().screen!.widgets[1];
    expect(pasted.popup?.widgets).toHaveLength(2);
    expect(pasted.popup?.widgets[0].id).not.toBe('popup-child');
    expect(pasted.popup?.widgets[1].popup).toBeUndefined();
    expect(anchor.popup.widgets[0].id).toBe('popup-child');
  });
});