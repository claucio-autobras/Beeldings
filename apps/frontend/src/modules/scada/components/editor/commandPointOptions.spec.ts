/**
 * Escopo do seletor de ponto comandável do SCADA (botão, toggle, slider e ação
 * de clique): a lista de pontos deve derivar SOMENTE do equipamento selecionado
 * — nunca misturar pontos de outro device do mesmo gateway — e o filtro de
 * graváveis deve seguir cada protocolo (Modbus holding/coil, BACnet
 * AO/AV/BO/BV/MSO, MQTT com binding de escrita, virtual).
 */
import {
  writableDeviceOptions,
  writableTagOptions,
  sanitizeCommandTag,
  hasHiddenReadOnlyPoints,
  isBacnetDevice,
} from './commandPointOptions';
import type { ScreenDevice } from '../../types/virtual.types';

function modbusPoint(tag: string, registerType: string) {
  return { id: `mb-${tag}`, tag, registerType, displayName: tag };
}
function mqttPoint(tag: string, writable: boolean, valueType: 'number' | 'boolean' = 'number') {
  return {
    id: `mq-${tag}`,
    tag,
    valueType,
    displayName: tag,
    write: writable ? { commandTopic: `cmd/${tag}`, payloadTemplate: '{{value}}' } : undefined,
  };
}
function bacnetPoint(tag: string, objectType: string) {
  return { id: `bn-${tag}`, tag, objectType, instance: 1, objectName: tag };
}
function virtualPoint(tag: string, kind: 'analog' | 'digital' | 'multistate') {
  return {
    id: `vt-${tag}`, tag, objectName: tag, objectType: 'AV', instance: 1, unit: '',
    kind, currentValue: 0, states: [], value: 0, status: 'ok', lastUpdate: '',
  };
}

/** Cenário real de produção: dois devices no MESMO gateway com tag repetida (SETPOINT). */
const modbusDev = {
  id: 'dev-modbus',
  name: 'Teste Modbus',
  protocol: 'modbus',
  gatewayId: 'gw-1',
  tenantId: 't1',
  points: [
    modbusPoint('SETPOINT', 'holding'),
    modbusPoint('LED', 'coil'),
    modbusPoint('TEMPERATURA', 'input'),
    modbusPoint('UMIDADE', 'input'),
    modbusPoint('CONTADOR', 'input'),
    modbusPoint('BOTAO', 'discrete'),
  ],
} as unknown as ScreenDevice;

const mqttDev = {
  id: 'dev-mqtt',
  name: 'Escritório NIS',
  protocol: 'mqtt',
  gatewayId: 'gw-1',
  tenantId: 't1',
  points: [
    mqttPoint('SETPOINT', true),
    mqttPoint('STATUS', false),
    mqttPoint('TV', true, 'boolean'),
  ],
} as unknown as ScreenDevice;

const bacnetDev = {
  id: 'dev-bacnet',
  name: 'AHU-01',
  protocol: 'bacnet',
  gatewayId: 'gw-1',
  tenantId: 't1',
  points: [
    bacnetPoint('SAIDA_AO', 'AO'),
    bacnetPoint('VALOR_AV', 'AV'),
    bacnetPoint('SAIDA_BO', 'BO'),
    bacnetPoint('VALOR_BV', 'BV'),
    bacnetPoint('MULTI_MSO', 'MSO'),
    bacnetPoint('ENTRADA_AI', 'AI'),
    bacnetPoint('ENTRADA_BI', 'BI'),
    bacnetPoint('MULTI_MSI', 'MSI'),
  ],
} as unknown as ScreenDevice;

const virtualDev = {
  id: 'dev-virtual',
  name: 'Bancada',
  protocol: 'virtual',
  gatewayId: null,
  tenantId: 't1',
  points: [
    virtualPoint('ANALOGICO', 'analog'),
    virtualPoint('DIGITAL', 'digital'),
    virtualPoint('MULTI', 'multistate'),
  ],
} as unknown as ScreenDevice;

const devices = [modbusDev, mqttDev, bacnetDev, virtualDev];

function tags(opts: { value: string }[]): string[] {
  return opts.map((o) => o.value).filter(Boolean);
}

describe('writableTagOptions — escopo por equipamento', () => {
  it('lista SOMENTE pontos graváveis do device Modbus selecionado (nunca TV do MQTT)', () => {
    const t = tags(writableTagOptions(devices, 'dev-modbus'));
    expect(t).toEqual(['SETPOINT', 'LED']);
    expect(t).not.toContain('TV');
    expect(t).not.toContain('TEMPERATURA');
  });

  it('lista SOMENTE pontos graváveis do device MQTT selecionado (nunca LED do Modbus)', () => {
    const t = tags(writableTagOptions(devices, 'dev-mqtt'));
    expect(t).toEqual(['SETPOINT', 'TV']);
    expect(t).not.toContain('LED');
    expect(t).not.toContain('STATUS');
  });

  it('tags duplicadas entre devices do mesmo gateway não vazam entre listas', () => {
    const mb = tags(writableTagOptions(devices, 'dev-modbus'));
    const mq = tags(writableTagOptions(devices, 'dev-mqtt'));
    // SETPOINT existe nos dois, mas cada lista traz só 1 (a do próprio device).
    expect(mb.filter((x) => x === 'SETPOINT')).toHaveLength(1);
    expect(mq.filter((x) => x === 'SETPOINT')).toHaveLength(1);
  });

  it('deviceId vazio ou inexistente → lista vazia (só placeholder)', () => {
    expect(tags(writableTagOptions(devices, ''))).toEqual([]);
    expect(tags(writableTagOptions(devices, 'dev-inexistente'))).toEqual([]);
  });
});

describe('writableTagOptions — filtro de graváveis por protocolo', () => {
  it('Modbus: só holding e coil (input/discrete ficam de fora)', () => {
    expect(tags(writableTagOptions(devices, 'dev-modbus'))).toEqual(['SETPOINT', 'LED']);
  });

  it('BACnet: só AO/AV/BO/BV/MSO (AI/BI/MSI ficam de fora)', () => {
    expect(tags(writableTagOptions(devices, 'dev-bacnet'))).toEqual([
      'SAIDA_AO', 'VALOR_AV', 'SAIDA_BO', 'VALOR_BV', 'MULTI_MSO',
    ]);
  });

  it('MQTT: só pontos com commandTopic + payloadTemplate', () => {
    expect(tags(writableTagOptions(devices, 'dev-mqtt'))).toEqual(['SETPOINT', 'TV']);
  });

  it('virtual: digitais e analógicos (multistate fica de fora)', () => {
    expect(tags(writableTagOptions(devices, 'dev-virtual'))).toEqual(['ANALOGICO', 'DIGITAL']);
  });

  it('analogOnly (slider): Modbus holding, BACnet AO/AV, MQTT numérico, virtual analógico', () => {
    expect(tags(writableTagOptions(devices, 'dev-modbus', true))).toEqual(['SETPOINT']);
    expect(tags(writableTagOptions(devices, 'dev-bacnet', true))).toEqual(['SAIDA_AO', 'VALOR_AV']);
    expect(tags(writableTagOptions(devices, 'dev-mqtt', true))).toEqual(['SETPOINT']); // TV é boolean
    expect(tags(writableTagOptions(devices, 'dev-virtual', true))).toEqual(['ANALOGICO']);
  });
});

describe('writableDeviceOptions', () => {
  it('inclui só devices com ao menos um ponto comandável', () => {
    const ids = writableDeviceOptions(devices).map((o) => o.value).filter(Boolean);
    expect(ids).toEqual(['dev-modbus', 'dev-mqtt', 'dev-bacnet', 'dev-virtual']);
  });

  it('device 100% somente leitura não aparece', () => {
    const readOnly = {
      ...modbusDev,
      id: 'dev-ro',
      points: [modbusPoint('T1', 'input'), modbusPoint('B1', 'discrete')],
    } as unknown as ScreenDevice;
    const ids = writableDeviceOptions([readOnly, mqttDev]).map((o) => o.value).filter(Boolean);
    expect(ids).toEqual(['dev-mqtt']);
  });
});

describe('sanitizeCommandTag — tag salva de outro equipamento não sobrevive', () => {
  it("tag de outro device é rejeitada (TV salvo com controladora Modbus → '')", () => {
    expect(sanitizeCommandTag(devices, 'dev-modbus', 'TV')).toBe('');
  });

  it('tag válida do próprio device é mantida', () => {
    expect(sanitizeCommandTag(devices, 'dev-modbus', 'SETPOINT')).toBe('SETPOINT');
    expect(sanitizeCommandTag(devices, 'dev-mqtt', 'TV')).toBe('TV');
  });

  it("tag existente mas somente leitura é rejeitada (input register → '')", () => {
    expect(sanitizeCommandTag(devices, 'dev-modbus', 'TEMPERATURA')).toBe('');
    expect(sanitizeCommandTag(devices, 'dev-mqtt', 'STATUS')).toBe('');
  });

  it('analogOnly: coil (digital) não passa como analógico', () => {
    expect(sanitizeCommandTag(devices, 'dev-modbus', 'LED', true)).toBe('');
    expect(sanitizeCommandTag(devices, 'dev-modbus', 'SETPOINT', true)).toBe('SETPOINT');
  });

  it('sem device ou sem tag → vazio', () => {
    expect(sanitizeCommandTag(devices, '', 'SETPOINT')).toBe('');
    expect(sanitizeCommandTag(devices, 'dev-modbus', '')).toBe('');
    expect(sanitizeCommandTag(devices, 'dev-x', 'SETPOINT')).toBe('');
  });
});

describe('hasHiddenReadOnlyPoints — nota explicativa', () => {
  it('true quando o device tem pontos somente leitura escondidos (Modbus input/discrete)', () => {
    expect(hasHiddenReadOnlyPoints(devices, 'dev-modbus')).toBe(true);
    expect(hasHiddenReadOnlyPoints(devices, 'dev-mqtt')).toBe(true); // STATUS sem escrita
    expect(hasHiddenReadOnlyPoints(devices, 'dev-bacnet')).toBe(true); // AI/BI/MSI
  });

  it('false quando todos os pontos do device são comandáveis', () => {
    const allWritable = {
      ...mqttDev,
      id: 'dev-w',
      points: [mqttPoint('A', true), mqttPoint('B', true)],
    } as unknown as ScreenDevice;
    expect(hasHiddenReadOnlyPoints([allWritable], 'dev-w')).toBe(false);
  });

  it('analogOnly: pontos digitais graváveis também contam como escondidos no slider', () => {
    const holdingOnly = {
      ...modbusDev,
      id: 'dev-h',
      points: [modbusPoint('SP', 'holding')],
    } as unknown as ScreenDevice;
    expect(hasHiddenReadOnlyPoints([holdingOnly], 'dev-h', true)).toBe(false);
    expect(hasHiddenReadOnlyPoints(devices, 'dev-modbus', true)).toBe(true); // LED coil escondido
  });

  it('sem device selecionado → false', () => {
    expect(hasHiddenReadOnlyPoints(devices, '')).toBe(false);
  });
});

describe('isBacnetDevice', () => {
  it('true só para o device BACnet selecionado', () => {
    expect(isBacnetDevice(devices, 'dev-bacnet')).toBe(true);
    expect(isBacnetDevice(devices, 'dev-modbus')).toBe(false);
    expect(isBacnetDevice(devices, '')).toBe(false);
  });
});
