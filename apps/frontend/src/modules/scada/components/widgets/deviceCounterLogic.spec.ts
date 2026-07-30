import { countDevices, countPoints, formatCount, listCounterPoints } from './deviceCounterLogic';
import type { DeviceCounterWidget } from '../../types/scada.types';
import type { ScreenDevice } from '../../types/virtual.types';
import type { PointStatus } from '../../hooks/useScreenTelemetry';

/** Fabrica um dispositivo mínimo para os testes de contagem. */
function dev(id: string, protocol: string, tags: string[]): ScreenDevice {
  return {
    id,
    name: id,
    protocol,
    points: tags.map((tag) => ({ id: `${id}:${tag}`, tag })),
  } as unknown as ScreenDevice;
}

function widget(partial: Partial<DeviceCounterWidget>): DeviceCounterWidget {
  return {
    id: 'w1', type: 'device-counter', x: 0, y: 0, width: 170, height: 64, zIndex: 1,
    mode: 'point-list', deviceFilter: 'all', scope: 'site', deviceIds: [], pointTag: '',
    points: [], operator: 'eq', value: 1, format: 'fraction', label: 'Lâmpadas', showLabel: true,
    colorOn: '#22C55E', textColor: '#FFF', backgroundColor: '#000', fontSize: 22, borderRadius: 8,
    ...partial,
  } as DeviceCounterWidget;
}

type Values = Record<string, number | boolean | string | null>;
type Statuses = Record<string, PointStatus>;

const getValue = (values: Values) => (deviceId: string, tag: string) =>
  values[`${deviceId}:${tag}`] ?? null;
const getStatus = (statuses: Statuses) => (deviceId: string, tag: string) =>
  statuses[`${deviceId}:${tag}`] ?? 'never';

describe('countPoints (modo point-list)', () => {
  const ctrl = dev('ctrl1', 'bacnet', ['L1', 'L2', 'L3', 'L4']);

  it('conta quantos pontos satisfazem a condição (5/10 lâmpadas → aqui 2/4)', () => {
    const w = widget({ points: [
      { deviceId: 'ctrl1', tag: 'L1' }, { deviceId: 'ctrl1', tag: 'L2' },
      { deviceId: 'ctrl1', tag: 'L3' }, { deviceId: 'ctrl1', tag: 'L4' },
    ] });
    const values: Values = { 'ctrl1:L1': 1, 'ctrl1:L2': 1, 'ctrl1:L3': 0, 'ctrl1:L4': 0 };
    const statuses: Statuses = { 'ctrl1:L1': 'live', 'ctrl1:L2': 'live', 'ctrl1:L3': 'live', 'ctrl1:L4': 'live' };
    const r = countPoints(w, [ctrl], getValue(values), getStatus(statuses));
    expect(r).toEqual({ on: 2, off: 2, noData: 0, total: 4 });
    expect(formatCount(w, r)).toBe('2/4');
  });

  it('respeita a condição (operador + valor)', () => {
    const w = widget({ operator: 'gte', value: 50, points: [
      { deviceId: 'ctrl1', tag: 'L1' }, { deviceId: 'ctrl1', tag: 'L2' },
    ] });
    const values: Values = { 'ctrl1:L1': 80, 'ctrl1:L2': 20 };
    const statuses: Statuses = { 'ctrl1:L1': 'live', 'ctrl1:L2': 'live' };
    expect(countPoints(w, [ctrl], getValue(values), getStatus(statuses)))
      .toEqual({ on: 1, off: 1, noData: 0, total: 2 });
  });

  it('ponto stale ou sem valor conta como "sem dados", nunca desligado', () => {
    const w = widget({ points: [
      { deviceId: 'ctrl1', tag: 'L1' }, { deviceId: 'ctrl1', tag: 'L2' }, { deviceId: 'ctrl1', tag: 'L3' },
    ] });
    const values: Values = { 'ctrl1:L1': 1, 'ctrl1:L2': 0, 'ctrl1:L3': null };
    // L2 tem valor mas leitura desatualizada (stale) → sem dados; L3 sem valor → sem dados.
    const statuses: Statuses = { 'ctrl1:L1': 'live', 'ctrl1:L2': 'stale' };
    expect(countPoints(w, [ctrl], getValue(values), getStatus(statuses)))
      .toEqual({ on: 1, off: 0, noData: 2, total: 3 });
  });

  it('mistura pontos de dispositivos diferentes', () => {
    const ctrl2 = dev('ctrl2', 'modbus', ['R1']);
    const w = widget({ points: [
      { deviceId: 'ctrl1', tag: 'L1' }, { deviceId: 'ctrl2', tag: 'R1' },
    ] });
    const values: Values = { 'ctrl1:L1': 1, 'ctrl2:R1': 0 };
    const statuses: Statuses = { 'ctrl1:L1': 'live', 'ctrl2:R1': 'live' };
    expect(countPoints(w, [ctrl, ctrl2], getValue(values), getStatus(statuses)))
      .toEqual({ on: 1, off: 1, noData: 0, total: 2 });
  });

  it('pontos de dispositivos virtuais (Bancada) ou ausentes ficam fora do total', () => {
    const virt = dev('virt1', 'virtual', ['V1']);
    const w = widget({ points: [
      { deviceId: 'ctrl1', tag: 'L1' },
      { deviceId: 'virt1', tag: 'V1' },      // virtual: ignorado
      { deviceId: 'ghost', tag: 'X' },        // dispositivo fora da tela: ignorado
    ] });
    const values: Values = { 'ctrl1:L1': 1, 'virt1:V1': 1 };
    const statuses: Statuses = { 'ctrl1:L1': 'live', 'virt1:V1': 'live' };
    expect(countPoints(w, [ctrl, virt], getValue(values), getStatus(statuses)))
      .toEqual({ on: 1, off: 0, noData: 0, total: 1 });
  });

  it('tag inexistente no dispositivo conta como "sem dados"', () => {
    const w = widget({ points: [{ deviceId: 'ctrl1', tag: 'NAO_EXISTE' }] });
    expect(countPoints(w, [ctrl], getValue({}), getStatus({})))
      .toEqual({ on: 0, off: 0, noData: 1, total: 1 });
  });

  it('câmera usa o seed persistido: valor vale mesmo sem leitura live', () => {
    const cam = dev('cam1', 'onvif', ['motion']);
    const w = widget({ points: [{ deviceId: 'cam1', tag: 'motion' }] });
    const values: Values = { 'cam1:motion': 1 };
    // Sem status live — mas câmera aceita o valor (seed) como no modo point-value.
    expect(countPoints(w, [cam], getValue(values), getStatus({})))
      .toEqual({ on: 1, off: 0, noData: 0, total: 1 });
  });

  it('countDevices delega para countPoints quando mode=point-list', () => {
    const w = widget({ points: [{ deviceId: 'ctrl1', tag: 'L1' }] });
    const values: Values = { 'ctrl1:L1': 1 };
    const statuses: Statuses = { 'ctrl1:L1': 'live' };
    expect(countDevices(w, [ctrl], getValue(values), getStatus(statuses)))
      .toEqual({ on: 1, off: 0, noData: 0, total: 1 });
  });
});

describe('listCounterPoints (popup "quais pontos estão ligados")', () => {
  const ctrl = dev('ctrl1', 'bacnet', ['L1', 'L2', 'L3']);

  it('lista cada ponto com o mesmo estado da contagem (ligado/desligado/sem dados)', () => {
    const w = widget({ points: [
      { deviceId: 'ctrl1', tag: 'L1' }, { deviceId: 'ctrl1', tag: 'L2' }, { deviceId: 'ctrl1', tag: 'L3' },
    ] });
    const values: Values = { 'ctrl1:L1': 1, 'ctrl1:L2': 0, 'ctrl1:L3': null };
    const statuses: Statuses = { 'ctrl1:L1': 'live', 'ctrl1:L2': 'live' };
    const details = listCounterPoints(w, [ctrl], getValue(values), getStatus(statuses));
    expect(details).toEqual([
      { deviceId: 'ctrl1', deviceName: 'ctrl1', tag: 'L1', pointName: 'L1', state: 'on' },
      { deviceId: 'ctrl1', deviceName: 'ctrl1', tag: 'L2', pointName: 'L2', state: 'off' },
      { deviceId: 'ctrl1', deviceName: 'ctrl1', tag: 'L3', pointName: 'L3', state: 'no-data' },
    ]);
    // Coerência com a contagem exibida no widget.
    const r = countPoints(w, [ctrl], getValue(values), getStatus(statuses));
    expect(details.filter((d) => d.state === 'on').length).toBe(r.on);
    expect(details.length).toBe(r.total);
  });

  it('usa objectName como nome amigável quando existir', () => {
    const d = {
      id: 'ctrl2', name: 'Controladora 2', protocol: 'bacnet',
      points: [{ id: 'p1', tag: 'L1', objectName: 'Lâmpada Recepção' }],
    } as unknown as ScreenDevice;
    const w = widget({ points: [{ deviceId: 'ctrl2', tag: 'L1' }] });
    const details = listCounterPoints(w, [d], getValue({ 'ctrl2:L1': 1 }), getStatus({ 'ctrl2:L1': 'live' }));
    expect(details[0].pointName).toBe('Lâmpada Recepção');
    expect(details[0].deviceName).toBe('Controladora 2');
  });

  it('omite pontos de dispositivos virtuais ou ausentes, como na contagem', () => {
    const virt = dev('virt1', 'virtual', ['V1']);
    const w = widget({ points: [
      { deviceId: 'ctrl1', tag: 'L1' },
      { deviceId: 'virt1', tag: 'V1' },
      { deviceId: 'ghost', tag: 'X' },
    ] });
    const details = listCounterPoints(w, [ctrl, virt], getValue({ 'ctrl1:L1': 1 }), getStatus({ 'ctrl1:L1': 'live' }));
    expect(details).toHaveLength(1);
    expect(details[0].tag).toBe('L1');
  });

  it('ponto stale entra como "sem dados" (nunca desligado)', () => {
    const w = widget({ points: [{ deviceId: 'ctrl1', tag: 'L1' }] });
    const details = listCounterPoints(w, [ctrl], getValue({ 'ctrl1:L1': 1 }), getStatus({ 'ctrl1:L1': 'stale' }));
    expect(details[0].state).toBe('no-data');
  });
});

describe('formatCount (modo point-list respeita os formatos existentes)', () => {
  const r = { on: 5, off: 3, noData: 2, total: 10 };
  it.each([
    ['fraction', '5/10'],
    ['on-only', '5'],
    ['off-only', '3'],
    ['total-only', '10'],
  ] as const)('formato %s → %s', (format, expected) => {
    expect(formatCount(widget({ format }), r)).toBe(expected);
  });
});

describe('retrocompatibilidade dos modos existentes', () => {
  const ctrl = dev('ctrl1', 'bacnet', ['relay']);
  const cam = dev('cam1', 'snmp', ['STATUS']);
  const virt = dev('virt1', 'virtual', ['V1']);

  it('modo point-value continua contando por dispositivo (widget antigo sem campo points)', () => {
    const w = widget({ mode: 'point-value', pointTag: 'relay', points: undefined });
    const values: Values = { 'ctrl1:relay': 1 };
    const statuses: Statuses = { 'ctrl1:relay': 'live' };
    expect(countDevices(w, [ctrl, virt], getValue(values), getStatus(statuses)))
      .toEqual({ on: 1, off: 0, noData: 0, total: 1 });
  });

  it('modo connectivity continua funcionando (câmera por STATUS, demais por frescor)', () => {
    const w = widget({ mode: 'connectivity', points: undefined });
    const values: Values = { 'cam1:STATUS': 1 };
    const statuses: Statuses = { 'ctrl1:relay': 'stale' };
    expect(countDevices(w, [ctrl, cam, virt], getValue(values), getStatus(statuses)))
      .toEqual({ on: 1, off: 1, noData: 0, total: 2 });
  });

  it('widget point-list sem nenhum ponto selecionado → total 0 (vira "sem dados" no render)', () => {
    const w = widget({ points: [] });
    expect(countDevices(w, [ctrl], getValue({}), getStatus({})))
      .toEqual({ on: 0, off: 0, noData: 0, total: 0 });
  });
});
