import {
  canonicalHealthKey,
  formatHealthValue,
  normalizeHealthReading,
  normalizeHealthValue,
  selectOperationalPoints,
} from './snmp-health';
import type { CameraPoint } from '../services/cftv.service';

const point = (metric: string, tag: string): CameraPoint =>
  ({
    id: tag,
    tag,
    objectName: tag,
    metric,
    oid: null,
    unit: metric === 'memory_total' ? 'kB' : '%',
    lastValue: null,
    lastValueAt: null,
    lastValueState: null,
  }) as CameraPoint;

describe('SNMP operational health', () => {
  it('normaliza aliases e mantém a ordem operacional', () => {
    expect(canonicalHealthKey('cpu')).toBe('cpu_usage');
    expect(canonicalHealthKey('cpu_usage')).toBe('cpu_usage');
    expect(canonicalHealthKey('cpu_temperature')).toBe('temperature');
    expect(canonicalHealthKey('temperature')).toBe('temperature');
    expect(canonicalHealthKey('memory_usage')).toBe('memory_used_percent');
    expect(canonicalHealthKey('ping_loss')).toBe('ping_loss');
    expect(
      selectOperationalPoints([
        point('cpu', 'CPU-2'),
        point('cpu_usage', 'CPU-1'),
        point('temperature', 'TEMP'),
        point('memory_total', 'RAM'),
        point('sysDescr', 'SYS'),
        point('uptime', 'UPTIME'),
      ]).map((p) => p.metric),
    ).toEqual(['memory_total', 'cpu', 'temperature', 'uptime']);
  });

  it('rejeita temperatura impossível e memória em kB como percentual', () => {
    expect(normalizeHealthValue('temperature', 85827, '°C')).toBeNull();
    expect(normalizeHealthValue('memory', 102400, 'kB')).toBeNull();
    expect(normalizeHealthValue('memory_used_percent', 72, '%')).toBe(72);
  });

  it('limita percentuais e aceita duração não negativa', () => {
    expect(normalizeHealthValue('cpu_usage', 101, '%')).toBeNull();
    expect(normalizeHealthValue('packet_loss', 4, '%')).toBe(4);
    expect(normalizeHealthValue('uptime', 3600, 's')).toBe(3600);
  });

  it('aplica escala de temperatura e memória uma única vez', () => {
    expect(normalizeHealthReading('temperature', 38500, 'milli°C')).toBe(38.5);
    expect(normalizeHealthReading('temperature', 301.65, 'K')).toBeCloseTo(28.5, 5);
    expect(normalizeHealthReading('memory_total', 4, 'GB', 1024 ** 3)).toBe(4 * 1024 ** 3);
    expect(normalizeHealthReading('memory', 102400, 'kB')).toBeNull();
  });

  it('formata aliases com a mesma precisão em todas as superfícies', () => {
    expect(formatHealthValue('cpu_temperature', 38.56, '°C')).toBe('38.6°C');
    expect(formatHealthValue('memory_used_percent', 72.4, '%')).toBe('72%');
    expect(formatHealthValue('packet_loss', 0, '%')).toBe('0%');
    expect(formatHealthValue('uptime', 90061, 's')).toBe('1d 1h');
    expect(formatHealthValue('ram_total', 117 * 1024 * 1024, 'bytes')).toBe('117 MB');
  });
});