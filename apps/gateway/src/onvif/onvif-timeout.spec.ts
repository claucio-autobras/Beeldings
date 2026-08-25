import {
  getDeviceInformation,
  OnvifConnectionError,
  type OnvifCam,
} from './onvif-connection';
import { OnvifDriver } from '../drivers/onvif.driver';

/**
 * Prova de robustez ONVIF: callbacks da lib que nunca respondem
 * (GetDeviceInformation / GetStreamUri pendurados) estouram timeout explícito
 * em vez de deixar a Promise presa para sempre — o ciclo falha, o busy guard é
 * liberado e a câmera volta a ser tentada no próximo ciclo.
 */
describe('ONVIF — timeout em chamadas penduráveis', () => {
  const hungCam: OnvifCam = {
    on: () => undefined,
    removeAllListeners: () => undefined,
    // Callback NUNCA é chamado — simula câmera que aceita TCP mas não responde SOAP.
    getDeviceInformation: () => undefined,
    getStreamUri: () => undefined,
    getSnapshotUri: () => undefined,
  };

  it('getDeviceInformation rejeita com UNREACHABLE quando o callback nunca responde', async () => {
    await expect(getDeviceInformation(hungCam, 50)).rejects.toMatchObject({
      name: 'OnvifConnectionError',
      code: 'UNREACHABLE',
    } as Partial<OnvifConnectionError>);
  });

  it('getDeviceInformation resolve normalmente quando o callback responde a tempo', async () => {
    const cam: OnvifCam = {
      ...hungCam,
      getDeviceInformation: (cb) =>
        cb(null, { manufacturer: 'Acme', model: 'X1' }),
    };
    const info = await getDeviceInformation(cam, 50);
    expect(info.manufacturer).toBe('Acme');
    expect(info.model).toBe('X1');
  });

  it('checkStream rejeita quando GetStreamUri nunca responde', async () => {
    const driver = new OnvifDriver({
      deviceId: 'cam-1',
      ip: '10.0.0.10',
      port: 80,
      username: 'u',
      password: 'p',
      pollingIntervalMs: 30_000,
      points: [{ tag: 'stream', metric: 'stream' }],
    });
    const checkStream = (
      driver as unknown as {
        checkStream(cam: OnvifCam, timeoutMs?: number): Promise<number>;
      }
    ).checkStream.bind(driver);

    await expect(checkStream(hungCam, 50)).rejects.toThrow(/não respondeu/);
    driver.dispose();
  });

  it('runCycle com câmera pendurada completa o ciclo como offline (nunca trava)', async () => {
    const config = {
      deviceId: 'cam-1',
      ip: '10.0.0.10',
      port: 80,
      username: 'u',
      password: 'p',
      pollingIntervalMs: 30_000,
      points: [{ tag: 'cam_status', metric: 'status' }],
    };
    const driver = new OnvifDriver(config);
    // Injeta uma conexão "existente" pendurada — GetDeviceInformation jamais
    // responde; o timeout interno deve encerrar o ciclo como falha.
    (driver as unknown as { cam: OnvifCam | null }).cam = hungCam;

    jest.useFakeTimers();
    try {
      const cycle = driver.runCycle(config);
      await jest.advanceTimersByTimeAsync(11_000); // > ONVIF_TIMEOUT_MS (10s)
      const result = await cycle;

      expect(result.reachable).toBe(false);
      expect(result.points).toEqual([
        { tag: 'cam_status', value: 0, unit: null },
      ]);
      // Conexão descartada — o próximo ciclo reconecta do zero.
      expect((driver as unknown as { cam: OnvifCam | null }).cam).toBeNull();
    } finally {
      jest.useRealTimers();
      driver.dispose();
    }
  });
});
