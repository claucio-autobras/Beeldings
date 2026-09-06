import type { WidgetType } from '../../types/scada.types';
import { buildDefaultWidget } from './widgetDefaults';
import { SCADA_WIDGET_CATEGORIES, SCADA_WIDGET_DEFAULT_SIZES } from './WidgetPalette';

describe('SCADA shared widget palette', () => {
  it('builds every popup/main palette item with the shared default size and overrides', () => {
    const items = SCADA_WIDGET_CATEGORIES.flatMap((category) =>
      category.items.filter((item) => item.id !== 'pipe-draw'),
    );

    expect(items.length).toBeGreaterThan(40);
    for (const item of items) {
      const size = item.size ?? SCADA_WIDGET_DEFAULT_SIZES[item.type];
      expect(size).toBeDefined();
      const widget = buildDefaultWidget(item.type, 0, 0, size!.w, size!.h);
      const configured = { ...widget, ...item.overrides };
      expect(configured.type).toBe(item.type);
      expect(configured).toMatchObject(item.overrides ?? {});
    }
  });

  it('keeps default sizes for every widget type exposed by the palette', () => {
    const exposed = new Set<WidgetType>(
      SCADA_WIDGET_CATEGORIES.flatMap((category) => category.items.map((item) => item.type)),
    );
    for (const type of exposed) expect(SCADA_WIDGET_DEFAULT_SIZES[type]).toBeDefined();
  });

  it('exposes polygon drawing with the operator-facing instruction', () => {
    const polygon = SCADA_WIDGET_CATEGORIES
      .flatMap((category) => category.items)
      .find((item) => item.id === 'polygon-draw');

    expect(polygon).toMatchObject({
      type: 'polygon',
      label: 'Polígono — desenhar no canvas',
    });
    expect(SCADA_WIDGET_DEFAULT_SIZES.polygon).toEqual({ w: 180, h: 140 });
  });
});