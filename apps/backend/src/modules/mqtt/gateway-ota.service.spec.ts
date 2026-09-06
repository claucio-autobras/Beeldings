import {
  GatewayOtaService,
  OTA_CANCELLED_MESSAGE,
  OTA_EXPIRE_MS,
  OTA_EXPIRED_MESSAGE,
} from './gateway-ota.service.js';
import type { GatewayOtaProgress, GatewayOtaStage } from './gateway-ota.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';

/**
 * Expiração de OTA presa em estágio intermediário.
 *
 * Um gateway que publica `restarting` e nunca confirma (serviço não volta,
 * rollback sem reconexão, gateway offline) não pode ficar "Reiniciando…" para
 * sempre: após OTA_EXPIRE_MS o estágio vira o terminal `expired` (persistido),
 * a nova tentativa é liberada, e confirmações tardias (completed/rolled_back)
 * sobrescrevem o estado expirado.
 */
describe('GatewayOtaService — expiração de OTA não confirmada', () => {
  const GW = 'gw-nis-nis-teste';
  let service: GatewayOtaService;
  let update: jest.Mock;
  let findMany: jest.Mock;
  let findUnique: jest.Mock;

  const progress = (stage: GatewayOtaStage, over: Partial<GatewayOtaProgress> = {}): GatewayOtaProgress => ({
    commandId: 'cmd-1',
    stage,
    version: '1.9.0',
    fromVersion: '1.8.2',
    error: null,
    ts: new Date().toISOString(),
    receivedAt: new Date().toISOString(),
    ...over,
  });

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-31T12:00:00.000Z'));
    update = jest.fn().mockResolvedValue({});
    findMany = jest.fn().mockResolvedValue([]);
    findUnique = jest.fn().mockResolvedValue(null);
    const prisma = { gateway: { update, findMany, findUnique } } as unknown as PrismaService;
    service = new GatewayOtaService(prisma);
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
  });

  it('mantém estágio intermediário recente como em andamento', () => {
    service.apply(GW, progress('restarting'));
    jest.advanceTimersByTime(OTA_EXPIRE_MS - 60_000);
    expect(service.get(GW)?.stage).toBe('restarting');
    expect(service.isInProgress(GW)).toBe(true);
  });

  it('expira estágio intermediário velho para o terminal `expired` e persiste', () => {
    service.apply(GW, progress('restarting'));
    jest.advanceTimersByTime(OTA_EXPIRE_MS + 1_000);

    const p = service.get(GW);
    expect(p?.stage).toBe('expired');
    expect(p?.error).toBe(OTA_EXPIRED_MESSAGE);

    // Persistido como estágio terminal (sobrevive a restart do backend).
    expect(update).toHaveBeenCalledWith({
      where: { id: GW },
      data: expect.objectContaining({
        otaState: 'expired',
        otaMessage: OTA_EXPIRED_MESSAGE,
        otaAt: expect.any(Date),
      }),
    });
    // Nunca sobrescreve a versão instalada com a versão alvo não confirmada.
    expect(update.mock.calls[0][0].data.reportedVersion).toBeUndefined();
  });

  it('libera nova tentativa após a expiração (isInProgress = false)', () => {
    service.apply(GW, progress('downloading'));
    expect(service.isInProgress(GW)).toBe(true);
    jest.advanceTimersByTime(OTA_EXPIRE_MS + 1_000);
    expect(service.isInProgress(GW)).toBe(false);
  });

  it('a varredura periódica expira sem depender de leitura', () => {
    service.apply(GW, progress('applying'));
    // Só avança timers (varredura a cada 60s) — sem chamar get().
    jest.advanceTimersByTime(OTA_EXPIRE_MS + 61_000);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ otaState: 'expired' }) }),
    );
  });

  it('confirmação tardia `rolled_back` sobrescreve o estado expirado', () => {
    service.apply(GW, progress('restarting'));
    jest.advanceTimersByTime(OTA_EXPIRE_MS + 1_000);
    expect(service.get(GW)?.stage).toBe('expired');

    service.apply(GW, progress('rolled_back', {
      error: 'serviço não subiu na nova versão',
      receivedAt: new Date().toISOString(),
    }));

    expect(service.get(GW)?.stage).toBe('rolled_back');
    expect(update).toHaveBeenLastCalledWith({
      where: { id: GW },
      data: expect.objectContaining({ otaState: 'rolled_back' }),
    });
  });

  it('confirmação tardia `completed` sobrescreve o expirado e persiste a versão', () => {
    service.apply(GW, progress('restarting'));
    jest.advanceTimersByTime(OTA_EXPIRE_MS + 1_000);
    expect(service.get(GW)?.stage).toBe('expired');

    service.apply(GW, progress('completed', { receivedAt: new Date().toISOString() }));

    expect(service.get(GW)?.stage).toBe('completed');
    expect(update).toHaveBeenLastCalledWith({
      where: { id: GW },
      data: expect.objectContaining({ otaState: 'completed', reportedVersion: '1.9.0' }),
    });
  });

  it('estágios finais nunca expiram', () => {
    service.apply(GW, progress('failed', { error: 'checksum inválido' }));
    jest.advanceTimersByTime(OTA_EXPIRE_MS * 4);
    expect(service.get(GW)?.stage).toBe('failed');
  });

  it('progresso REPETIDO do mesmo estágio não renova o prazo de expiração', () => {
    service.apply(GW, progress('restarting'));
    // A cada 5 min o gateway repete "restarting" (mesma tentativa) sem reconectar.
    for (let i = 0; i < 3; i++) {
      jest.advanceTimersByTime(5 * 60_000 - 61_000);
      service.apply(GW, progress('restarting', { ts: new Date().toISOString(), receivedAt: new Date().toISOString() }));
    }
    // Já se passaram >15 min desde o PRIMEIRO restarting → expirado.
    jest.advanceTimersByTime(OTA_EXPIRE_MS);
    expect(service.get(GW)?.stage).toBe('expired');
  });

  it('transição de estágio intermediário é persistida (sobrevive a restart)', () => {
    service.apply(GW, progress('downloading'));
    expect(update).toHaveBeenCalledWith({
      where: { id: GW },
      data: expect.objectContaining({ otaState: 'downloading', otaMessage: null }),
    });
    update.mockClear();
    // Repetição do mesmo estágio NÃO gera novo UPDATE.
    service.apply(GW, progress('downloading'));
    expect(update).not.toHaveBeenCalled();
  });

  it('varredura expira estágio intermediário só persistido (backend reiniciado)', async () => {
    // Nada em memória; o banco tem um gateway preso em "restarting" velho.
    findMany.mockResolvedValue([{ id: GW }]);
    jest.advanceTimersByTime(61_000);
    await Promise.resolve(); // drena a promise da varredura
    await Promise.resolve();
    expect(update).toHaveBeenCalledWith({
      where: { id: GW },
      data: expect.objectContaining({ otaState: 'expired', otaMessage: OTA_EXPIRED_MESSAGE }),
    });
  });

  it('cancel() com progresso em memória marca terminal e libera novo disparo', async () => {
    service.apply(GW, progress('restarting'));
    expect(service.isInProgress(GW)).toBe(true);

    await expect(service.cancel(GW)).resolves.toBe(true);
    expect(service.get(GW)?.stage).toBe('expired');
    expect(service.get(GW)?.error).toBe(OTA_CANCELLED_MESSAGE);
    expect(service.isInProgress(GW)).toBe(false);
    expect(update).toHaveBeenLastCalledWith({
      where: { id: GW },
      data: expect.objectContaining({ otaState: 'expired', otaMessage: OTA_CANCELLED_MESSAGE }),
    });
  });

  it('cancel() sem memória cancela o estágio intermediário persistido', async () => {
    findUnique.mockResolvedValue({ otaState: 'restarting' });
    await expect(service.cancel(GW)).resolves.toBe(true);
    expect(update).toHaveBeenCalledWith({
      where: { id: GW },
      data: expect.objectContaining({ otaState: 'expired', otaMessage: OTA_CANCELLED_MESSAGE }),
    });
  });

  it('cancel() sem atualização em andamento retorna false', async () => {
    findUnique.mockResolvedValue({ otaState: 'completed' });
    await expect(service.cancel(GW)).resolves.toBe(false);
    findUnique.mockResolvedValue(null);
    await expect(service.cancel(GW)).resolves.toBe(false);
    expect(update).not.toHaveBeenCalled();
  });
});
