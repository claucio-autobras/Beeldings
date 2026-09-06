import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GatewayMqttService } from './gateway-mqtt.service';
import { StoreAndForwardService } from './store-and-forward.service';

/**
 * Prova do drain crash-safe do store-and-forward:
 *  - mensagem só sai da fila persistida após confirmação de publicação;
 *  - falha de publicação mantém a mensagem na fila (reenvio na próxima conexão);
 *  - queda de conexão no meio do reenvio preserva as restantes;
 *  - crash no meio do reenvio → mensagens não confirmadas sobrevivem ao reboot.
 */
describe('GatewayMqttService — drain crash-safe', () => {
  let dataDir: string;

  const makeConfig = (): ConfigService =>
    ({
      get: (key: string, def?: string) =>
        key === 'STORE_FORWARD_DIR' ? dataDir : def,
    }) as unknown as ConfigService;

  const makeSaf = (): StoreAndForwardService => {
    const saf = new StoreAndForwardService(makeConfig());
    saf.onModuleInit();
    return saf;
  };

  /** Cria o serviço SEM onModuleInit (sem conexão real) e injeta um client fake. */
  const makeService = (
    saf: StoreAndForwardService,
    publishImpl: (topic: string, cb: (err?: Error) => void) => void,
    connected = true,
  ): GatewayMqttService => {
    const svc = new GatewayMqttService(
      makeConfig(),
      new EventEmitter2(),
      saf,
    );
    (svc as unknown as { client: unknown }).client = {
      connected,
      publish: (
        topic: string,
        _payload: string,
        _opts: unknown,
        cb: (err?: Error) => void,
      ) => publishImpl(topic, cb),
    };
    return svc;
  };

  const drain = (svc: GatewayMqttService): Promise<void> =>
    (svc as unknown as { drainPendingMessages(): Promise<void> }).drainPendingMessages();

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-drain-test-'));
  });

  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('remove da fila somente as mensagens confirmadas pelo broker', async () => {
    const saf = makeSaf();
    saf.enqueue('ok/1', 'p1', 1);
    saf.enqueue('fail/2', 'p2', 1);
    saf.enqueue('ok/3', 'p3', 1);

    const svc = makeService(saf, (topic, cb) =>
      cb(topic.startsWith('fail') ? new Error('puback timeout') : undefined),
    );

    await drain(svc);
    await saf.flush();

    // Confirmadas saíram; a que falhou permanece para a próxima reconexão.
    expect(saf.peekAll().map((m) => m.topic)).toEqual(['fail/2']);

    // Reboot (crash depois do drain parcial): estado do disco é consistente.
    const safReboot = makeSaf();
    expect(safReboot.peekAll().map((m) => m.topic)).toEqual(['fail/2']);
  });

  it('queda de conexão antes do reenvio preserva todas as mensagens', async () => {
    const saf = makeSaf();
    saf.enqueue('t/1', 'p1', 1);
    saf.enqueue('t/2', 'p2', 1);

    const svc = makeService(saf, (_topic, cb) => cb(), /* connected */ false);

    await drain(svc);
    expect(saf.pendingCount()).toBe(2);
  });

  it('crash no meio do reenvio (sem confirmações) não perde nenhuma mensagem', async () => {
    const saf = makeSaf();
    saf.enqueue('t/1', 'p1', 1);
    saf.enqueue('t/2', 'p2', 1);
    await saf.flush();

    // Publicações que nunca confirmam (gateway "cai" antes do puback):
    // o drain fica pendente e NENHUMA mensagem é removida.
    const svc = makeService(saf, () => undefined);
    void drain(svc); // nunca resolve — simula o processo morrendo aqui

    await saf.flush();
    expect(saf.pendingCount()).toBe(2);

    // Reboot: fila completa recarregada do disco.
    const safReboot = makeSaf();
    expect(safReboot.peekAll().map((m) => m.topic)).toEqual(['t/1', 't/2']);
  });

  it('guarda de reentrância: reconexões em sequência não sobrepõem drains', async () => {
    const saf = makeSaf();
    saf.enqueue('t/1', 'p1', 1);

    let publishCount = 0;
    let release: (() => void) | null = null;
    const svc = makeService(saf, (_topic, cb) => {
      publishCount += 1;
      release = () => cb();
    });

    const first = drain(svc);
    const second = drain(svc); // reentrante — deve retornar sem republicar
    await second;
    expect(publishCount).toBe(1);

    release!();
    await first;
    expect(saf.pendingCount()).toBe(0);
  });
});
