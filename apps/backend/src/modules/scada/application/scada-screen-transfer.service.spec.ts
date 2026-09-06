import { sanitizeScadaScreenSnapshot } from './scada-screen-transfer.service.js';

describe('sanitizeScadaScreenSnapshot', () => {
  it('preserves visual layout while removing runtime references recursively', () => {
    const assets: string[] = [];
    const input = {
      id: 'screen-widget-id',
      name: 'Tela visual',
      width: 1920,
      height: 1080,
      widgets: [
        {
          id: 'widget-1',
          type: 'label-static',
          x: 12,
          y: 24,
          width: 320,
          height: 80,
          text: 'Sala técnica',
          backgroundColor: '#102030',
          deviceId: 'source-device',
          tag: 'temperature',
          visibility: { mode: 'conditional', deviceId: 'source-device', tag: 'enabled' },
          clickAction: { type: 'navigate', targetScreenId: 'source-screen' },
          popup: {
            widgets: [{
              id: 'popup-widget',
              type: 'dash-chart',
              deviceIds: ['source-device'],
              tag: 'humidity',
              label: 'Histórico',
            }],
          },
        },
        {
          id: 'component-1',
          type: 'component-instance',
          componentId: 'source-component',
          children: [{
            id: 'child-1',
            type: 'point-table',
            rows: [{ deviceId: 'source-device', tag: 'pressure', label: 'Pressão' }],
            backgroundColor: '#203040',
          }],
        },
        {
          id: 'nav',
          type: 'nav-toolbar',
          items: [{ id: 'nav-item', text: 'Resumo', targetScreenId: 'source-screen' }],
          logo: { url: '/scada-assets/source-tenant/logo.png' },
        },
      ],
      settings: {
        backgroundColor: '#0B1220',
        backgroundImage: '/scada-assets/source-tenant/background.webp',
      },
    };

    const result = sanitizeScadaScreenSnapshot(input, (source) => {
      assets.push(source.value);
      return `asset-${assets.length}`;
    }) as Record<string, unknown>;
    const json = JSON.stringify(result);

    expect(result.width).toBe(1920);
    expect((result.widgets as Array<Record<string, unknown>>)[0].text).toBe('Sala técnica');
    expect(json).not.toContain('source-device');
    expect(json).not.toContain('temperature');
    expect(json).not.toContain('targetScreenId');
    expect(json).not.toContain('source-component');
    expect(json).not.toContain('source-tenant');
    expect(json).toContain('asset://asset-1');
    expect(json).toContain('asset://asset-2');
    expect(assets).toEqual(['source-tenant/logo.png', 'source-tenant/background.webp']);
  });

  it('removes telemetry keys from dashboard lists without deleting visual values', () => {
    const result = sanitizeScadaScreenSnapshot({
      type: 'equipment-card',
      title: 'Bombas',
      rows: [{
        id: 'row-1',
        deviceId: 'device-1',
        tag: 'run',
        label: 'Estado',
        valueColor: '#22D3EE',
      }],
      points: [{ deviceId: 'device-2', tag: 'load' }],
      geometry: {
        type: 'pipe',
        points: [{ x: 0, y: 10 }, { x: 80, y: 10 }],
        stroke: '#22D3EE',
      },
    }) as Record<string, unknown>;

    expect(result.title).toBe('Bombas');
    expect((result.rows as Array<Record<string, unknown>>)[0]).toEqual({
      id: 'row-1',
      label: 'Estado',
      valueColor: '#22D3EE',
    });
    expect(result.points).toEqual([]);
    expect(result.geometry).toEqual({
      type: 'pipe',
      points: [{ x: 0, y: 10 }, { x: 80, y: 10 }],
      stroke: '#22D3EE',
    });
  });
});