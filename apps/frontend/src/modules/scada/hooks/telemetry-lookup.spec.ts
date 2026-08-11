import { resolveTelemetryEntry } from './telemetry-lookup';
import { deviceTagKey, deviceTelemetryKey, telemetryKey } from '@/hooks/useBacnetTelemetry';
import type { TelemetryEntry, TelemetryMap } from '@/hooks/useBacnetTelemetry';
import type { ScreenDevice } from '../types/virtual.types';

const entry = (value: number): TelemetryEntry => ({
  value,
  unit: null,
  timestamp: '2026-08-03T12:00:00.000Z',
});

/** Dois Shellys diferentes com pontos de MESMA tag ("rele"). */
const mqttDevice = (id: string): ScreenDevice =>
  ({
    id,
    name: id,
    protocol: 'mqtt',
    points: [{ id: `${id}-p1`, tag: 'rele' }],
  } as unknown as ScreenDevice);

describe('resolveTelemetryEntry — isolamento por deviceId+tag', () => {
  it('dois devices com a MESMA tag não se misturam (cada um vê o próprio valor)', () => {
    const devices = [mqttDevice('shelly-1pm'), mqttDevice('shelly-mini')];
    const byDevice: TelemetryMap = new Map([
      [deviceTagKey('shelly-1pm', 'rele'), entry(1)],
      [deviceTagKey('shelly-mini', 'rele'), entry(0)],
    ]);
    const indexes = { telemetry: new Map(), byDevice };

    expect(resolveTelemetryEntry(indexes, devices, 'shelly-1pm', 'rele')?.value).toBe(1);
    expect(resolveTelemetryEntry(indexes, devices, 'shelly-mini', 'rele')?.value).toBe(0);
  });

  it('NÃO vaza valor de outro device pela tag: sem leitura própria → null', () => {
    // Só o shelly-1pm publicou telemetria; o shelly-mini (mesma tag) não pode
    // "herdar" esse valor — antes o fallback global byTag causava exatamente isso.
    const devices = [mqttDevice('shelly-1pm'), mqttDevice('shelly-mini')];
    const byDevice: TelemetryMap = new Map([
      [deviceTagKey('shelly-1pm', 'rele'), entry(1)],
    ]);
    const indexes = { telemetry: new Map(), byDevice };

    expect(resolveTelemetryEntry(indexes, devices, 'shelly-1pm', 'rele')?.value).toBe(1);
    expect(resolveTelemetryEntry(indexes, devices, 'shelly-mini', 'rele')).toBeNull();
  });

  it('alternar um device não reflete no outro (atualização isolada)', () => {
    const devices = [mqttDevice('shelly-1pm'), mqttDevice('shelly-mini')];
    const byDevice: TelemetryMap = new Map([
      [deviceTagKey('shelly-1pm', 'rele'), entry(0)],
      [deviceTagKey('shelly-mini', 'rele'), entry(0)],
    ]);
    const indexes = { telemetry: new Map(), byDevice };

    // Liga só o 1PM
    byDevice.set(deviceTagKey('shelly-1pm', 'rele'), entry(1));

    expect(resolveTelemetryEntry(indexes, devices, 'shelly-1pm', 'rele')?.value).toBe(1);
    expect(resolveTelemetryEntry(indexes, devices, 'shelly-mini', 'rele')?.value).toBe(0);
  });

  it('device ou ponto desconhecido → null', () => {
    const devices = [mqttDevice('shelly-1pm')];
    const indexes = { telemetry: new Map(), byDevice: new Map() };
    expect(resolveTelemetryEntry(indexes, devices, 'inexistente', 'rele')).toBeNull();
    expect(resolveTelemetryEntry(indexes, devices, 'shelly-1pm', 'outra_tag')).toBeNull();
  });

  it('BACnet continua indexado por objectType:instance (índice global)', () => {
    const dev = {
      id: 'ctrl-1',
      name: 'Controladora',
      protocol: 'bacnet',
      points: [{ id: 'p1', tag: 'temp', objectType: 'AI', instance: 3 }],
    } as unknown as ScreenDevice;
    const telemetry: TelemetryMap = new Map([[telemetryKey(0, 3), entry(21.5)]]);
    const indexes = { telemetry, byDevice: new Map() };

    expect(resolveTelemetryEntry(indexes, [dev], 'ctrl-1', 'temp')?.value).toBe(21.5);
  });

  it('pontos virtuais (bancada) usam o índice isolado por device', () => {
    const dev = {
      id: 'bench-1',
      name: 'Bancada',
      protocol: 'virtual',
      points: [{ id: 'p1', tag: 'bomba', objectType: 'BV', instance: 0, kind: 'digital' }],
    } as unknown as ScreenDevice;
    // Controladora real com o mesmo BV:0 no índice global — NÃO pode vazar.
    const telemetry: TelemetryMap = new Map([[telemetryKey(5, 0), entry(1)]]);
    const byDevice: TelemetryMap = new Map([[deviceTelemetryKey('bench-1', 5, 0), entry(0)]]);
    const indexes = { telemetry, byDevice };

    expect(resolveTelemetryEntry(indexes, [dev], 'bench-1', 'bomba')?.value).toBe(0);
  });
});
