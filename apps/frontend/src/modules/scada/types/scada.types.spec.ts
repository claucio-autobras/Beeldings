import {
  DEVICE_COUNTER_DEFAULT_ICON,
  NAV_TOOLBAR_DEFAULT_GAP,
  NAV_TOOLBAR_DEFAULT_PADDING_X,
  NAV_TOOLBAR_DEFAULT_PADDING_Y,
  NAV_TOOLBAR_DEFAULT_FONT_SIZE,
  NAV_TOOLBAR_DEFAULT_LOGO_HEIGHT,
  NAV_TOOLBAR_DEFAULT_LOGO_WIDTH,
  NAV_TOOLBAR_MAX_GAP,
  NAV_TOOLBAR_MAX_FONT_SIZE,
  NAV_TOOLBAR_MAX_LOGO_HEIGHT,
  NAV_TOOLBAR_MAX_LOGO_WIDTH,
  NAV_TOOLBAR_MAX_PADDING_X,
  NAV_TOOLBAR_MAX_PADDING_Y,
  NAV_TOOLBAR_MIN_FONT_SIZE,
  NAV_TOOLBAR_MIN_LOGO_HEIGHT,
  NAV_TOOLBAR_MIN_LOGO_WIDTH,
  normalizeNavHorizontalAlign,
  normalizeNavSidebarVerticalAlign,
  normalizeNavToolbarGap,
  normalizeNavToolbarFontSize,
  normalizeNavToolbarLogo,
  normalizeNavToolbarLogoFit,
  normalizeNavToolbarLogoHeight,
  normalizeNavToolbarLogoPosition,
  normalizeNavToolbarLogoWidth,
  normalizeNavToolbarPaddingX,
  normalizeNavToolbarPaddingY,
  normalizeNavToolbarVerticalAlign,
  reorderNavMenuItems,
  SCADA_HOVER_DEFAULTS,
  SCADA_HOVER_DEFAULT_TRANSITION_MS,
  SCADA_HOVER_MAX_TRANSITION_MS,
  createScadaHoverDefaults,
  getScadaHoverCapabilities,
  normalizeScadaHover,
  createScadaPopupDefaults,
  hasScreenTelemetryBindings,
  normalizeScadaPopup,
  normalizeScadaPopupHeight,
  normalizeScadaPopupWidth,
  normalizeScadaPolygonPoints,
  scaleScadaPolygonPoints,
  resolveScadaPopupPosition,
  SCADA_POPUP_DEFAULTS,
  SCADA_POPUP_MAX_HEIGHT,
  SCADA_POPUP_MAX_WIDTH,
  SCADA_POPUP_MIN_HEIGHT,
  SCADA_POPUP_MIN_WIDTH,
  scadaPopupOpensOnClick,
  scadaPopupOpensOnHover,
} from './scada.types';
import type { ScadaHoverTarget } from './scada.types';
import { buildDefaultWidget } from '../components/editor/widgetDefaults';
import {
  buildPipeArrowGeometry,
  buildPipeArrowGeometries,
  PipeWidgetView,
} from '../components/widgets/PipeWidget';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import type { PipeWidget } from './scada.types';
import { ShapeWidgetView } from '../components/widgets/ShapeWidget';
import type { NavToolbarWidget } from './scada.types';
import { NavToolbarWidgetView } from '../components/widgets/NavToolbarWidget';

describe('SCADA navigation layout helpers', () => {
  it('keeps legacy alignment defaults when properties are absent or invalid', () => {
    expect(normalizeNavHorizontalAlign(undefined)).toBe('left');
    expect(normalizeNavHorizontalAlign('not-an-alignment')).toBe('left');
    expect(normalizeNavHorizontalAlign('center')).toBe('center');
    expect(normalizeNavSidebarVerticalAlign(undefined)).toBe('top');
    expect(normalizeNavSidebarVerticalAlign('not-an-alignment')).toBe('top');
    expect(normalizeNavSidebarVerticalAlign('bottom')).toBe('bottom');
    expect(normalizeNavToolbarVerticalAlign(undefined)).toBe('top');
    expect(normalizeNavToolbarVerticalAlign('not-an-alignment')).toBe('top');
    expect(normalizeNavToolbarVerticalAlign('center')).toBe('center');
    expect(normalizeNavToolbarVerticalAlign('bottom')).toBe('bottom');
  });

  it('normalizes toolbar spacing and padding to safe limits', () => {
    expect(normalizeNavToolbarGap(undefined)).toBe(NAV_TOOLBAR_DEFAULT_GAP);
    expect(normalizeNavToolbarPaddingX(undefined)).toBe(NAV_TOOLBAR_DEFAULT_PADDING_X);
    expect(normalizeNavToolbarPaddingY(undefined)).toBe(NAV_TOOLBAR_DEFAULT_PADDING_Y);
    expect(normalizeNavToolbarGap(-10)).toBe(0);
    expect(normalizeNavToolbarGap(999)).toBe(NAV_TOOLBAR_MAX_GAP);
    expect(normalizeNavToolbarPaddingX(999)).toBe(NAV_TOOLBAR_MAX_PADDING_X);
    expect(normalizeNavToolbarPaddingY(999)).toBe(NAV_TOOLBAR_MAX_PADDING_Y);
    expect(normalizeNavToolbarPaddingY('not-a-number')).toBe(NAV_TOOLBAR_DEFAULT_PADDING_Y);
  });

  it('creates new navigation widgets with the legacy-compatible defaults', () => {
    const toolbar = buildDefaultWidget('nav-toolbar', 0, 0, 600, 48);
    const sidebar = buildDefaultWidget('nav-sidebar', 0, 0, 180, 400);

    expect(toolbar).toMatchObject({
      contentAlign: 'left',
      verticalAlign: 'top',
      itemGap: NAV_TOOLBAR_DEFAULT_GAP,
      itemPaddingX: NAV_TOOLBAR_DEFAULT_PADDING_X,
      itemPaddingY: NAV_TOOLBAR_DEFAULT_PADDING_Y,
      fontSize: NAV_TOOLBAR_DEFAULT_FONT_SIZE,
    });
    expect(sidebar).toMatchObject({ verticalAlign: 'top', contentAlign: 'left' });
  });

  it('normalizes toolbar font size and optional logo without changing legacy screens', () => {
    expect(normalizeNavToolbarFontSize(undefined)).toBe(NAV_TOOLBAR_DEFAULT_FONT_SIZE);
    expect(normalizeNavToolbarFontSize(1)).toBe(NAV_TOOLBAR_MIN_FONT_SIZE);
    expect(normalizeNavToolbarFontSize(999)).toBe(NAV_TOOLBAR_MAX_FONT_SIZE);
    expect(normalizeNavToolbarFontSize('not-a-number')).toBe(NAV_TOOLBAR_DEFAULT_FONT_SIZE);

    expect(normalizeNavToolbarLogo(undefined)).toBeUndefined();
    expect(normalizeNavToolbarLogo({ url: '' })).toBeUndefined();
    expect(normalizeNavToolbarLogo({
      url: ' /scada-assets/logo.png ',
      position: 'invalid',
      width: 999,
      height: 1,
      fit: 'invalid',
    })).toEqual({
      url: '/scada-assets/logo.png',
      position: 'left',
      width: NAV_TOOLBAR_MAX_LOGO_WIDTH,
      height: NAV_TOOLBAR_MIN_LOGO_HEIGHT,
      fit: 'contain',
    });
    expect(normalizeNavToolbarLogoPosition('right')).toBe('right');
    expect(normalizeNavToolbarLogoFit('cover')).toBe('cover');
    expect(normalizeNavToolbarLogoWidth(undefined)).toBe(NAV_TOOLBAR_DEFAULT_LOGO_WIDTH);
    expect(normalizeNavToolbarLogoWidth(-1)).toBe(NAV_TOOLBAR_MIN_LOGO_WIDTH);
    expect(normalizeNavToolbarLogoHeight(undefined)).toBe(NAV_TOOLBAR_DEFAULT_LOGO_HEIGHT);
    expect(normalizeNavToolbarLogoHeight(999)).toBe(NAV_TOOLBAR_MAX_LOGO_HEIGHT);
  });

  it('keeps the centered menu centered independently from a large logo', () => {
    const widget = {
      ...buildDefaultWidget('nav-toolbar', 0, 0, 600, 48),
      contentAlign: 'center',
      logo: {
        url: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
        position: 'left',
        width: 500,
        height: 110,
        fit: 'contain',
      },
      items: [{ id: 'home', iconName: 'home', text: 'Início', targetScreenId: 'home' }],
    } as NavToolbarWidget;
    const markup = renderToStaticMarkup(createElement(NavToolbarWidgetView, {
      widget,
      currentScreenId: 'home',
      isEditor: true,
    }));

    expect(markup).toContain('data-testid="nav-toolbar-logo"');
    expect(markup).toContain('width:500px;height:110px');
    expect(markup).toContain('justify-content:center');
    // Centered items have only the normal edge padding, not logo-width padding.
    expect(markup).toContain('padding-left:8px;padding-right:8px');
  });

  it('reserves space only when logo and left/right menu alignment share a side', () => {
    const base = buildDefaultWidget('nav-toolbar', 0, 0, 600, 48) as NavToolbarWidget;
    const logo = { url: 'data:image/svg+xml,<svg/>', position: 'left' as const, width: 180, height: 32, fit: 'contain' as const };
    const leftMarkup = renderToStaticMarkup(createElement(NavToolbarWidgetView, {
      widget: { ...base, contentAlign: 'left', logo },
      isEditor: true,
    }));
    const rightMarkup = renderToStaticMarkup(createElement(NavToolbarWidgetView, {
      widget: { ...base, contentAlign: 'right', logo },
      isEditor: true,
    }));

    expect(leftMarkup).toContain('padding-left:192px');
    expect(rightMarkup).toContain('padding-left:8px;padding-right:8px');
  });

  it('reorders only the item array and preserves item objects', () => {
    const first = { id: 'first', text: 'Primeiro', targetScreenId: 'screen-a' };
    const second = { id: 'second', text: 'Segundo', targetScreenId: 'screen-b' };
    const third = { id: 'third', text: 'Terceiro', targetScreenId: 'screen-c' };
    const items = [first, second, third];

    const reordered = reorderNavMenuItems(items, 0, 2);

    expect(reordered.map((item) => item.id)).toEqual(['second', 'third', 'first']);
    expect(reordered[2]).toBe(first);
    expect(items.map((item) => item.id)).toEqual(['first', 'second', 'third']);
  });

  it('does not change the list for no-op or out-of-range moves', () => {
    const items = [{ id: 'only' }];
    expect(reorderNavMenuItems(items, 0, 0)).toBe(items);
    expect(reorderNavMenuItems(items, -1, 0)).toBe(items);
    expect(reorderNavMenuItems(items, 0, 1)).toBe(items);
  });

  it('creates new device counters with the legacy-compatible icon', () => {
    const counter = buildDefaultWidget('device-counter', 0, 0, 170, 64);

    expect(counter).toMatchObject({ type: 'device-counter', iconName: DEVICE_COUNTER_DEFAULT_ICON });
  });

  it('creates new pipes with one explicit visual style', () => {
    const pipe = buildDefaultWidget('pipe', 0, 0, 240, 80);

    expect(pipe).toMatchObject({ type: 'pipe', pipeStyle: 'dash' });
    expect('showDirectionArrow' in pipe).toBe(false);
  });

  it('centers the arrow on the route and reverses its tip without cutting across corners', () => {
    const points = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
    const normal = buildPipeArrowGeometry(points, 12, 10, false);
    const reversed = buildPipeArrowGeometry(points, 12, 10, true);

    expect(normal).not.toBeNull();
    expect(reversed).not.toBeNull();
    expect(normal!.tip.x).toBeGreaterThan(normal!.start.x);
    expect(reversed!.tip.x).toBeLessThan(reversed!.start.x);
    expect(normal!.shaft.length).toBeGreaterThan(2);
    expect(normal!.shaft.some((point) => point.y > 0)).toBe(true);
  });

  it('distributes more arrows on longer routes using arc length', () => {
    const short = buildPipeArrowGeometries([{ x: 0, y: 0 }, { x: 100, y: 0 }], 0, 10, false);
    const long = buildPipeArrowGeometries([{ x: 0, y: 0 }, { x: 500, y: 0 }], 0, 10, false);

    expect(short).toHaveLength(1);
    expect(long.length).toBeGreaterThan(short.length);
    expect(long.length).toBeLessThanOrEqual(12);
    for (let i = 1; i < long.length; i++) {
      expect(long[i].distance - long[i - 1].distance).toBeGreaterThan(0);
    }
  });

  it('keeps curved-route arrows out of the rounded elbow and points them backwards', () => {
    const points = [{ x: 0, y: 0 }, { x: 220, y: 0 }, { x: 220, y: 160 }];
    const arrows = buildPipeArrowGeometries(points, 20, 12, false);
    const reversed = buildPipeArrowGeometries(points, 20, 12, true);

    expect(arrows.length).toBeGreaterThan(1);
    expect(arrows.every((arrow) => arrow.start.x !== arrow.tip.x || arrow.start.y !== arrow.tip.y)).toBe(true);
    expect(reversed).toHaveLength(arrows.length);
    expect(reversed[0].tip.x).toBeLessThan(reversed[0].start.x);
    expect(reversed[reversed.length - 1].tip.y).toBeLessThan(reversed[reversed.length - 1].start.y);
  });

  it('keeps one usable arrow for short and thick paths without clipping its shaft', () => {
    const arrows = buildPipeArrowGeometries([{ x: 0, y: 0 }, { x: 32, y: 0 }], 0, 40, false);

    expect(arrows).toHaveLength(1);
    expect(arrows[0].start.x).toBeGreaterThanOrEqual(0);
    expect(arrows[0].tip.x).toBeLessThanOrEqual(32);
  });

  it.each([
    ['dash', 'trace'],
    ['arrow', 'direction'],
    ['water', 'water'],
  ] as const)('renders only the %s active layer for the %s style', (pipeStyle, expectedLayer) => {
    const widget = {
      ...buildDefaultWidget('pipe', 0, 0, 240, 80),
      points: [{ x: 0, y: 40 }, { x: 240, y: 40 }],
      pipeStyle,
    } as PipeWidget;
    const markup = renderToStaticMarkup(createElement(PipeWidgetView, {
      widget,
      getValue: () => null,
      staticRender: true,
    }));

    expect(markup.match(new RegExp(`data-scada-pipe-layer="${expectedLayer}"`, 'g'))?.length).toBeGreaterThan(0);
    for (const layer of ['trace', 'direction', 'water']) {
      if (layer !== expectedLayer) {
        expect(markup.match(new RegExp(`data-scada-pipe-layer="${layer}"`, 'g'))).toBeNull();
      }
    }
  });

  it('keeps legacy dash and arrow-toggle data from creating a combined style', () => {
    const widget = {
      ...buildDefaultWidget('pipe', 0, 0, 240, 80),
      points: [{ x: 0, y: 40 }, { x: 240, y: 40 }],
      pipeStyle: 'dash',
      showDirectionArrow: true,
    } as PipeWidget;
    const markup = renderToStaticMarkup(createElement(PipeWidgetView, {
      widget,
      getValue: () => null,
      staticRender: true,
    }));

    expect(markup.match(/data-scada-pipe-layer="trace"/g)).toHaveLength(1);
    expect(markup.match(/data-scada-pipe-layer="direction"/g)).toBeNull();
    expect(markup.match(/data-scada-pipe-layer="water"/g)).toBeNull();
  });

  it.each(['dash', 'arrow', 'water'] as const)('renders a static stopped layer without flow indicators for %s', (pipeStyle) => {
    const widget = {
      ...buildDefaultWidget('pipe', 0, 0, 240, 80),
      points: [{ x: 0, y: 40 }, { x: 240, y: 40 }],
      pipeStyle,
      deviceId: 'device-1',
      tagStatus: 'status',
    } as PipeWidget;
    const markup = renderToStaticMarkup(createElement(PipeWidgetView, {
      widget,
      getValue: () => null,
    }));

    expect(markup.match(/data-scada-pipe-layer="stopped"/g)).toHaveLength(1);
    expect(markup.match(/data-scada-pipe-layer="trace"/g)).toBeNull();
    expect(markup.match(/data-scada-pipe-layer="direction"/g)).toBeNull();
    expect(markup.match(/data-scada-pipe-layer="water"/g)).toBeNull();
  });
});

describe('SCADA polygon geometry and rendering', () => {
  it('creates a safe polygon default and normalizes incomplete or offset points', () => {
    const widget = buildDefaultWidget('polygon', 10, 20, 200, 100);
    expect(widget.type).toBe('polygon');
    if (widget.type !== 'polygon') return;
    expect(widget.points).toHaveLength(4);
    expect(Math.min(...widget.points.map((point) => point.x))).toBe(0);
    expect(Math.max(...widget.points.map((point) => point.x))).toBe(200);
    expect(normalizeScadaPolygonPoints([{ x: 10, y: 20 }, { x: 30, y: 20 }], 200, 100)).toHaveLength(4);
    expect(normalizeScadaPolygonPoints([{ x: 10, y: 20 }, { x: 30, y: 20 }, { x: 30, y: 40 }], 200, 100)).toEqual([
      { x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 },
    ]);
  });

  it('scales relative vertices without changing their order', () => {
    expect(scaleScadaPolygonPoints([
      { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 },
    ], 100, 50, 200, 100)).toEqual([
      { x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 0, y: 100 },
    ]);
  });

  it('normalizes polygon children in popup JSON without changing the popup contract', () => {
    const popup = normalizeScadaPopup({
      enabled: true,
      widgets: [{
        ...buildDefaultWidget('polygon', 0, 0, 100, 50),
        points: [{ x: 20, y: 10 }, { x: 40, y: 10 }, { x: 30, y: 30 }],
      }],
    });
    expect(popup?.widgets[0].type).toBe('polygon');
    if (popup?.widgets[0].type !== 'polygon') return;
    expect(popup.widgets[0].points).toEqual([
      { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 50 },
    ]);
  });

  it('renders the polygon statically and applies shared value rules only when live', () => {
    const widget = {
      ...buildDefaultWidget('polygon', 0, 0, 120, 80),
      deviceId: 'device-1',
      tagStatus: 'status',
      stateRules: [{ id: 'on', operator: 'eq' as const, value: 1, color: '#00ff00', animation: 'pulse' as const }],
    };
    const getValue = jest.fn(() => 1);
    const staticMarkup = renderToStaticMarkup(createElement(ShapeWidgetView, { widget: widget as never, getValue, staticRender: true }));
    expect(getValue).not.toHaveBeenCalled();
    expect(staticMarkup).toContain('data-scada-polygon="true"');
    expect(staticMarkup).toContain('rgba(6,182,212,');
    const liveMarkup = renderToStaticMarkup(createElement(ShapeWidgetView, { widget: widget as never, getValue }));
    expect(liveMarkup).toContain('#00ff00');
    expect(liveMarkup).toContain('scada-pulse');
  });
});

describe('SCADA configurable hover capabilities', () => {
  it('only exposes native surfaces for shapes and line-like widgets', () => {
    const rounded = buildDefaultWidget('circle', 0, 0, 100, 100);
    const line = buildDefaultWidget('line', 0, 0, 100, 4);
    const polygon = buildDefaultWidget('polygon', 0, 0, 100, 100);
    const image = buildDefaultWidget('image', 0, 0, 100, 100);

    expect(getScadaHoverCapabilities(rounded).targets).toEqual(['border', 'content']);
    expect(getScadaHoverCapabilities(polygon).targets).toEqual(['border', 'content']);
    expect(getScadaHoverCapabilities(line).targets).toEqual(['border']);
    expect(getScadaHoverCapabilities(image).targets).toEqual([]);
  });

  it('does not offer text when the widget has no visible text surface', () => {
    const label = { ...buildDefaultWidget('label-static', 0, 0, 100, 30), text: '' };
    const icon = buildDefaultWidget('icon', 0, 0, 40, 40);
    const camera = { ...buildDefaultWidget('camera', 0, 0, 160, 120), showLabel: false, labelText: '' };

    expect(getScadaHoverCapabilities(label).targets).not.toContain('text');
    expect(getScadaHoverCapabilities(icon).targets).toEqual(['border']);
    expect(getScadaHoverCapabilities(camera).targets).not.toContain('text');
  });

  it('keeps legacy hover data intact while consumers can intersect incompatible targets', () => {
    const line = buildDefaultWidget('line', 0, 0, 100, 4);
    const legacy = {
      ...line,
      hover: {
        ...createScadaHoverDefaults(),
        enabled: true,
        targets: ['border', 'content', 'text'] as ScadaHoverTarget[],
      },
    };
    const supported = getScadaHoverCapabilities(legacy).targets;
    expect(legacy.hover?.targets).toEqual(['border', 'content', 'text']);
    expect(legacy.hover?.targets.filter((target) => supported.includes(target))).toEqual(['border']);
  });
});

describe('SCADA configurable hover', () => {
  it('adds disabled defaults to new widgets without sharing mutable targets', () => {
    const first = buildDefaultWidget('rectangle', 0, 0, 100, 60);
    const second = buildDefaultWidget('label-static', 0, 0, 100, 60);

    expect(first.hover).toEqual({
      ...SCADA_HOVER_DEFAULTS,
      targets: [],
    });
    expect(first.hover?.transitionMs).toBe(SCADA_HOVER_DEFAULT_TRANSITION_MS);
    expect(first.hover?.targets).not.toBe(second.hover?.targets);
    expect(createScadaHoverDefaults()).toMatchObject({ enabled: false, targets: [] });
  });

  it('keeps absent hover undefined for legacy screens and normalizes unsafe JSON', () => {
    expect(normalizeScadaHover(undefined)).toBeUndefined();
    expect(normalizeScadaHover({
      enabled: true,
      targets: ['border', 'content', 'content', 'unknown', 'text'],
      borderColor: '',
      contentColor: 'rgba(0,0,0,.2)',
      transitionMs: 99999,
      easing: 'not-an-easing',
    })).toEqual({
      enabled: true,
      targets: ['border', 'content', 'text'],
      borderColor: SCADA_HOVER_DEFAULTS.borderColor,
      contentColor: 'rgba(0,0,0,.2)',
      textColor: SCADA_HOVER_DEFAULTS.textColor,
      transitionMs: SCADA_HOVER_MAX_TRANSITION_MS,
      easing: SCADA_HOVER_DEFAULTS.easing,
    });
  });

  it('clamps negative and fractional transition durations', () => {
    expect(normalizeScadaHover({ transitionMs: -20 })?.transitionMs).toBe(0);
    expect(normalizeScadaHover({ transitionMs: 123.7 })?.transitionMs).toBe(124);
    expect(normalizeScadaHover({ transitionMs: 'not-a-number' })?.transitionMs).toBe(SCADA_HOVER_DEFAULT_TRANSITION_MS);
  });
});

describe('SCADA widget popups', () => {
  it('normalizes missing, fractional and out-of-range dimensions with shared limits', () => {
    expect(normalizeScadaPopupWidth(undefined)).toBe(SCADA_POPUP_DEFAULTS.width);
    expect(normalizeScadaPopupHeight('invalid')).toBe(SCADA_POPUP_DEFAULTS.height);
    expect(normalizeScadaPopupWidth(420.6)).toBe(421);
    expect(normalizeScadaPopupHeight(260.4)).toBe(260);
    expect(normalizeScadaPopupWidth(1)).toBe(SCADA_POPUP_MIN_WIDTH);
    expect(normalizeScadaPopupHeight(1)).toBe(SCADA_POPUP_MIN_HEIGHT);
    expect(normalizeScadaPopupWidth(9999)).toBe(SCADA_POPUP_MAX_WIDTH);
    expect(normalizeScadaPopupHeight(9999)).toBe(SCADA_POPUP_MAX_HEIGHT);
  });

  it('keeps legacy absence and safely normalizes incomplete popup JSON', () => {
    expect(normalizeScadaPopup(undefined)).toBeUndefined();
    expect(normalizeScadaPopup({ enabled: true, width: 20, height: 9999, trigger: 'invalid' })).toMatchObject({
      enabled: true,
      trigger: 'click',
      width: 180,
      height: 700,
      widgets: [],
    });
    expect(createScadaPopupDefaults()).toMatchObject({ enabled: false, trigger: 'click', widgets: [] });
  });

  it('blocks nested popups while preserving popup child telemetry bindings', () => {
    const child = {
      ...buildDefaultWidget('value-dynamic', 0, 0, 100, 40),
      deviceId: 'device-1',
      tag: 'TEMP',
      popup: { ...createScadaPopupDefaults(), enabled: true },
    };
    const popup = normalizeScadaPopup({ enabled: true, widgets: [child] })!;
    expect(popup.widgets[0].popup).toBeUndefined();
    expect(hasScreenTelemetryBindings([{ popup }])).toBe(true);
  });

  it('maps triggers and flips/clamps the panel close to viewport edges', () => {
    expect(scadaPopupOpensOnHover('hover-click')).toBe(true);
    expect(scadaPopupOpensOnClick('hover-click')).toBe(true);
    expect(scadaPopupOpensOnClick('hover')).toBe(false);
    const position = resolveScadaPopupPosition(
      { left: 460, top: 360, right: 500, bottom: 400, width: 40, height: 40 },
      { width: 220, height: 160 },
      'bottom',
      12,
      { left: 0, top: 0, right: 500, bottom: 400, width: 500, height: 400 },
    );
    expect(position.placement).toBe('top');
    expect(position.left).toBeLessThanOrEqual(272);
    expect(position.top).toBeGreaterThanOrEqual(8);
  });

  it('uses the effectively available panel size in a viewport narrower than legacy popup defaults', () => {
    const bounds = { left: 0, top: 0, right: 160, bottom: 240, width: 160, height: 240 };
    const position = resolveScadaPopupPosition(
      { left: 130, top: 190, right: 150, bottom: 210, width: 20, height: 20 },
      { width: 360, height: 278 },
      'right',
      12,
      bounds,
    );
    expect(position.left).toBe(8);
    expect(position.top).toBe(8);
    expect(position.left + 144).toBeLessThanOrEqual(bounds.right - 8);
    expect(position.top + 224).toBeLessThanOrEqual(bounds.bottom - 8);
  });
});
