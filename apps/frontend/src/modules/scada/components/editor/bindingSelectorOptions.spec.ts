import {
  dedupePointsByTag,
  deviceOptionLabel,
  formatPointValue,
  pointBadgeLabel,
  pointType,
  pointUnit,
  type AnyPoint,
} from './bindingSelectorOptions';
import type { ScreenDevice } from '../../types/virtual.types';

/** Ponto SNMP mínimo (câmera/switch/controladora compartilham o mesmo shape). */
const snmpPoint = (overrides: Partial<AnyPoint> & { id: string; tag: string }): AnyPoint =>
  ({
    objectName: overrides.tag,
    metric: 'status',
    oid: null,
    unit: '',
    lastValue: null,
    lastValueAt: null,
    lastValueState: null,
    ...overrides,
  }) as AnyPoint;

const camera = (id: string, name: string, points: AnyPoint[] = []): ScreenDevice =>
  ({
    id,
    name,
    protocol: 'onvif',
    // Discrimina Camera de Controller no union ScreenDevice (isCameraDevice).
    monitoringProtocol: 'onvif',
    points,
  }) as unknown as ScreenDevice;

const controller = (id: string, name: string, points: AnyPoint[] = []): ScreenDevice =>
  ({
    id,
    name,
    protocol: 'snmp',
    monitoredDeviceType: 'ACCESS_CONTROLLER',
    points,
  }) as unknown as ScreenDevice;

const virtualDevice = (id: string, name: string): ScreenDevice =>
  ({ id, name, protocol: 'virtual', points: [] }) as unknown as ScreenDevice;

describe('BindingSelector — dedupePointsByTag', () => {
  it('mantém só a primeira ocorrência de cada tag', () => {
    const points = [
      snmpPoint({ id: 'p1', tag: 'MEMORIA', metric: 'memory' }),
      snmpPoint({ id: 'p2', tag: 'CPU', metric: 'cpu' }),
      // Duplicata legado: mesma tag, id/metric diferentes (o bug de origem).
      snmpPoint({ id: 'p3', tag: 'MEMORIA', metric: 'memory_available' }),
    ];
    const result = dedupePointsByTag(points);
    expect(result.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(result.filter((p) => p.tag === 'MEMORIA')).toHaveLength(1);
  });

  it('não altera uma lista já sem duplicatas', () => {
    const points = [
      snmpPoint({ id: 'p1', tag: 'STATUS' }),
      snmpPoint({ id: 'p2', tag: 'UPTIME' }),
    ];
    expect(dedupePointsByTag(points)).toEqual(points);
  });
});

describe('BindingSelector — deviceOptionLabel', () => {
  it('identifica câmeras no seletor genérico', () => {
    expect(deviceOptionLabel(camera('cam-1', 'Entrada Principal'))).toBe('📷 Entrada Principal (CÂMERA)');
  });

  it('identifica bancada de testes (virtual)', () => {
    expect(deviceOptionLabel(virtualDevice('v-1', 'Bancada'))).toBe('🧪 Bancada (Bancada de Testes)');
  });

  it('usa protocolo genérico para os demais equipamentos', () => {
    expect(deviceOptionLabel(controller('ctl-1', 'Catraca 1'))).toBe('Catraca 1 (SNMP)');
  });
});

describe('BindingSelector — formatação de métricas de saúde SNMP', () => {
  it('converte memória em bytes para MB, nunca um número bruto seguido de "bytes"', () => {
    const point = snmpPoint({
      id: 'p-mem',
      tag: 'MEMORIA_TOTAL',
      metric: 'ram_total',
      unit: 'bytes',
    });
    const text = formatPointValue(point, 117 * 1024 * 1024);
    expect(text).toBe('117 MB');
    expect(text).not.toMatch(/bytes/i);
  });

  it('usa o mesmo rótulo canônico da telemetria para o badge de tipo', () => {
    const point = snmpPoint({ id: 'p-mem', tag: 'MEMORIA_TOTAL', metric: 'ram_total', unit: 'bytes' });
    expect(pointBadgeLabel(point)).not.toBe('ram_total');
  });

  it('converte memória disponível em kB para MB (métrica canônica memory_available)', () => {
    const point = snmpPoint({ id: 'p-avail', tag: 'MEMORIA', metric: 'memory_available', unit: 'kB' });
    const text = formatPointValue(point, 61_028);
    expect(text).toBe('60 MB');
    expect(text).not.toMatch(/kB|kb/);
  });

  it('cai no formatador genérico para métricas sem contrato de saúde (ex.: status)', () => {
    const point = snmpPoint({ id: 'p-status', tag: 'STATUS', metric: 'status', unit: '' });
    expect(formatPointValue(point, 1)).toBe('1');
    expect(pointType(point)).toBe('status');
    expect(pointUnit(point)).toBeUndefined();
  });

  it('mostra "—" quando o valor ainda não chegou', () => {
    const point = snmpPoint({ id: 'p-mem', tag: 'MEMORIA_TOTAL', metric: 'ram_total', unit: 'bytes' });
    expect(formatPointValue(point, null)).toBe('—');
  });

  it('trata o alias legado "memory" com unidade de bytes (SCA) como disponibilidade, não percentual', () => {
    // Controladora cadastrada antes da correção do alias (task 1060): o ponto
    // padrão gravava metric='memory' para MEMÓRIA DISPONÍVEL em kB. O alias
    // genérico do contrato ('memory' → memory_used_percent, convenção CFTV)
    // nunca deve fazer esse valor aparecer como "61028%".
    const point = snmpPoint({ id: 'p-legacy', tag: 'MEMORIA', metric: 'memory', unit: 'kB' });
    const text = formatPointValue(point, 61_028);
    expect(text).toBe('60 MB');
    expect(text).not.toContain('%');
  });

  it('preserva a semântica percentual do alias "memory" quando a unidade é "%" (convenção CFTV)', () => {
    const point = snmpPoint({ id: 'p-cftv', tag: 'MEMORY', metric: 'memory', unit: '%' });
    expect(formatPointValue(point, 45)).toBe('45%');
  });
});
