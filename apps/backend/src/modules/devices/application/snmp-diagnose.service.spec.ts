import { SnmpDiagnoseService } from './snmp-diagnose.service.js';
import type { MqttService } from '../../mqtt/mqtt.service.js';

/**
 * Progresso e resolução do diagnóstico SNMP entre instâncias.
 *
 * O progresso vive num Map em memória alimentado pelo MQTT — que chega em
 * TODAS as instâncias do backend. As regras testadas aqui:
 *  - progresso "unknown" (null) antes de qualquer registro;
 *  - progresso inicial disponível na instância que originou o POST;
 *  - progresso vindo do MQTT fica disponível mesmo SEM pendência local
 *    (instância que não originou o POST);
 *  - o resultado marca done=true em toda instância (com ou sem pendência)
 *    e resolve a pendência na instância de origem;
 *  - progresso atrasado não "revive" um diagnóstico concluído.
 */
describe('SnmpDiagnoseService (backend) — progresso e resultado', () => {
  let service: SnmpDiagnoseService;
  let publishedTopics: string[];
  let messageHandler: (topic: string, payload: Buffer) => void;

  const mqttMock = () =>
    ({
      subscribe: jest.fn(),
      onMessage: jest.fn((h: (t: string, p: Buffer) => void) => {
        messageHandler = h;
      }),
      publish: jest.fn((topic: string) => {
        publishedTopics.push(topic);
        return Promise.resolve();
      }),
    }) as unknown as MqttService;

  const emitProgress = (commandId: string, tested: number, total: number) =>
    messageHandler(
      'bluebee/t1/gateway/gw1/discovery/snmp-diagnose-progress',
      Buffer.from(
        JSON.stringify({ command_id: commandId, phase: 'oids', tested, total }),
      ),
    );

  const emitResult = (commandId: string, extra: Record<string, unknown> = {}) =>
    messageHandler(
      'bluebee/t1/gateway/gw1/discovery/snmp-diagnose-result',
      Buffer.from(
        JSON.stringify({
          command_id: commandId,
          success: true,
          reachable: true,
          oidResults: {},
          walk: [],
          durationMs: 10,
          ...extra,
        }),
      ),
    );

  const baseDto = {
    tenantId: 't1',
    gatewayId: 'gw1',
    ip: '10.0.0.5',
    port: 161,
    snmpVersion: '2c' as const,
    community: 'public',
    current: [],
    candidates: [],
  };

  beforeEach(() => {
    publishedTopics = [];
    service = new SnmpDiagnoseService(mqttMock());
    service.onModuleInit();
  });

  it('progresso desconhecido retorna null', () => {
    expect(service.getProgress('nao-existe')).toBeNull();
  });

  it('registra progresso inicial (0/0) na instância que originou o POST', async () => {
    const promise = service.diagnose({ ...baseDto, diagnoseId: 'diag-1' });
    expect(service.getProgress('diag-1')).toEqual({
      phase: 'oids',
      tested: 0,
      total: 0,
      done: false,
      tenantId: 't1',
    });
    emitResult('diag-1');
    await promise;
  });

  it('progresso via MQTT fica disponível mesmo sem pendência local (outra instância)', () => {
    // Nenhum diagnose() chamado nesta "instância": só a mensagem MQTT chega.
    emitProgress('diag-remoto', 3, 50);
    expect(service.getProgress('diag-remoto')).toEqual({
      phase: 'oids',
      tested: 3,
      total: 50,
      done: false,
      tenantId: 't1',
    });
  });

  it('resultado resolve a pendência da instância de origem e marca done', async () => {
    const promise = service.diagnose({ ...baseDto, diagnoseId: 'diag-2' });
    emitProgress('diag-2', 10, 50);
    emitResult('diag-2');
    const result = await promise;
    expect(result.success).toBe(true);
    expect(service.getProgress('diag-2')).toMatchObject({ done: true });
  });

  it('resultado marca done mesmo em instância SEM pendência', () => {
    emitProgress('diag-3', 5, 50);
    emitResult('diag-3');
    expect(service.getProgress('diag-3')).toMatchObject({ done: true });
  });

  it('resultado sem progresso prévio ainda cria entrada done (instância sem histórico)', () => {
    emitResult('diag-4');
    expect(service.getProgress('diag-4')).toMatchObject({ done: true });
  });

  it('progresso atrasado não revive um diagnóstico concluído', () => {
    emitResult('diag-5');
    emitProgress('diag-5', 40, 50);
    expect(service.getProgress('diag-5')).toMatchObject({ done: true });
  });

  it('resultado alcançável tem cause=null', async () => {
    const promise = service.diagnose({ ...baseDto, diagnoseId: 'diag-c1' });
    emitResult('diag-c1');
    const result = await promise;
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.reachable).toBe(true);
      expect(result.cause).toBeNull();
    }
  });

  it('resultado inalcançável propaga cause=community do gateway', async () => {
    const promise = service.diagnose({ ...baseDto, diagnoseId: 'diag-c2' });
    emitResult('diag-c2', { reachable: false, cause: 'community' });
    const result = await promise;
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.reachable).toBe(false);
      expect(result.cause).toBe('community');
    }
  });

  it('resultado inalcançável sem cause explícita cai em no_response', async () => {
    const promise = service.diagnose({ ...baseDto, diagnoseId: 'diag-c3' });
    emitResult('diag-c3', { reachable: false });
    const result = await promise;
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.cause).toBe('no_response');
    }
  });

  it('resultado de falha (gateway ocupado) resolve com o erro do gateway', async () => {
    const promise = service.diagnose({ ...baseDto, diagnoseId: 'diag-6' });
    emitResult('diag-6', {
      success: false,
      busy: true,
      error: 'Já existe um diagnóstico SNMP em andamento neste gateway',
    });
    const result = await promise;
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('em andamento');
    }
  });
});
