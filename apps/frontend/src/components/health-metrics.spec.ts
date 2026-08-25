import {
  buildHealthTiles,
  formatMb,
  isHealthTileRemovable,
  type HealthPointLike,
} from './health-metrics';

const point = (
  metric: string,
  unit: string,
  unsupported = false,
): HealthPointLike => ({
  tag: metric.toUpperCase(),
  metric,
  unit,
  unsupported,
});

describe('buildHealthTiles', () => {
  it('deriva memória UCD e preserva um ponto não suportado', () => {
    const points = [
      point('cpu', '%'),
      point('memory', 'kB'),
      point('ram_total', 'MB'),
      point('temperature', '°C', true),
      point('packet_loss', 'pkts'),
    ];
    const readings = new Map([
      ['CPU', { value: 20 }],
      ['MEMORY', { value: 31780 }],
      ['RAM_TOTAL', { value: 116.6 }],
      ['PACKET_LOSS', { value: 0 }],
    ]);
    const tiles = buildHealthTiles(points, (tag) => readings.get(tag) ?? null);

    expect(tiles.find((tile) => tile.key === 'cpu')).toMatchObject({ text: '20%', pct: 20 });
    const memoryUsed = tiles.find((tile) => tile.key === 'memory_used');
    expect(memoryUsed).toMatchObject({ text: '73%', title: '31.0 MB livres de 117 MB' });
    expect(memoryUsed?.pct).toBeCloseTo(73.38, 2);
    expect(tiles.find((tile) => tile.key === 'ram_total')).toMatchObject({ text: '117 MB' });
    expect(tiles.find((tile) => tile.key === 'temperature')).toMatchObject({
      emptyState: 'não suportado',
    });
    expect(tiles.find((tile) => tile.key === 'packet_loss')).toMatchObject({
      text: '0 pkts',
      pct: null,
    });
  });

  it('mostra memória disponível quando não há RAM total', () => {
    const tiles = buildHealthTiles([point('memory', 'kB')], () => ({ value: 27844 }));
    expect(tiles).toEqual([
      expect.objectContaining({ key: 'memory_avail', text: '27.2 MB', pct: null }),
    ]);
  });

  it('calcula memória usada com memória recuperável composta', () => {
    const tiles = buildHealthTiles(
      [point('memory_available', 'bytes'), point('ram_total', 'bytes')],
      (tag) => tag === 'MEMORY_AVAILABLE'
        ? { value: 61_028 * 1024 }
        : { value: 119_424 * 1024 },
    );
    expect(tiles.find((tile) => tile.key === 'memory_used')).toMatchObject({
      text: '49%',
    });
    expect(tiles.find((tile) => tile.key === 'memory_used')?.pct).toBeCloseTo(48.9, 1);
    expect(tiles.find((tile) => tile.key === 'ram_total')).toMatchObject({
      text: '117 MB',
    });
  });

  it('preserva o percentual nativo de memória sem duplicar disponibilidade', () => {
    const tiles = buildHealthTiles([point('memory', '%')], () => ({ value: 77 }));
    expect(tiles).toEqual([
      expect.objectContaining({ key: 'memory_used', text: '77%', pct: 77 }),
    ]);
    expect(tiles.some((tile) => tile.key === 'memory_avail')).toBe(false);
  });

  it('reconhece bindings canônicos aplicados no diagnóstico e converte bytes', () => {
    const points = [
      point('cpu_usage', '%'),
      point('memory_used_percent', '%'),
      point('memory_total', 'bytes'),
      point('cpu_temperature', '°C'),
      point('net_discard_rate', 'pkts'),
      point('storage_used_percent', '%'),
    ];
    const readings = new Map([
      ['CPU_USAGE', { value: 32 }],
      ['MEMORY_USED_PERCENT', { value: 68 }],
      ['MEMORY_TOTAL', { value: 2 * 1024 * 1024 * 1024 }],
      ['CPU_TEMPERATURE', { value: 42.5 }],
      ['NET_DISCARD_RATE', { value: 4 }],
      ['STORAGE_USED_PERCENT', { value: 91 }],
    ]);
    const tiles = buildHealthTiles(points, (tag) => readings.get(tag) ?? null);

    expect(tiles.map((tile) => tile.key)).toEqual([
      'cpu',
      'memory_used',
      'ram_total',
      'temperature',
      'packet_loss',
      'storage',
    ]);
    expect(tiles.find((tile) => tile.key === 'ram_total')).toMatchObject({ text: '2.0 GB' });
    expect(tiles.find((tile) => tile.key === 'storage')).toMatchObject({ text: '91%', pct: 91 });
  });

  it('ordena apenas as métricas cadastradas', () => {
    const tiles = buildHealthTiles(
      [point('storage', '%'), point('ping_loss', '%')],
      (tag) => ({ value: tag === 'PING_LOSS' ? 3 : 51 }),
    );
    expect(tiles.map((tile) => tile.key)).toEqual(['ping_loss', 'storage']);
  });

  it('distingue sem dados e propaga leituras não confiáveis', () => {
    const tiles = buildHealthTiles(
      [point('cpu', '%'), point('temperature', '°C')],
      (tag) => (tag === 'CPU' ? { value: 30, unreliable: true } : null),
    );
    expect(tiles.find((tile) => tile.key === 'cpu')).toMatchObject({ unreliable: true });
    expect(tiles.find((tile) => tile.key === 'temperature')).toMatchObject({
      emptyState: 'sem dados',
    });
  });

  it('não exibe valor residual de temperatura não suportada', () => {
    const temperature = {
      ...point('temperature', '°C'),
      id: 'temperature-point',
      healthState: 'unsupported',
      healthReason: 'not_exposed_by_firmware',
    };
    const tiles = buildHealthTiles([temperature], () => ({ value: 0 }));
    expect(tiles).toEqual([
      expect.objectContaining({
        key: 'temperature',
        text: null,
        emptyState: 'não suportado',
      }),
    ]);
  });

  it('não exibe temperatura fora da faixa plausível', () => {
    const tiles = buildHealthTiles([point('temperature', '°C')], () => ({ value: 85827 }));
    expect(tiles[0]).toMatchObject({ text: null, emptyState: 'sem dados' });
  });

  it('preserva a ação de remoção somente para pontos persistidos e removíveis', () => {
    const removable = buildHealthTiles(
      [{ ...point('cpu', '%'), id: 'point-cpu', removable: true }],
      () => ({ value: 12 }),
    )[0];
    const protectedPoint = buildHealthTiles(
      [{ ...point('cpu', '%'), id: 'point-cpu', removable: false }],
      () => ({ value: 12 }),
    )[0];
    expect(isHealthTileRemovable(removable)).toBe(true);
    expect(isHealthTileRemovable(protectedPoint)).toBe(false);
  });
});

describe('formatMb', () => {
  it('formata MB e GB sem expor kB ou bytes', () => {
    expect(formatMb(31.04)).toBe('31.0 MB');
    expect(formatMb(116.6)).toBe('117 MB');
    expect(formatMb(2048)).toBe('2.0 GB');
  });
});