/**
 * Testes do SerialPortManager — foco no contrato crítico do RS485 half-duplex:
 * fila única por porta, setID antes de cada operação, isolamento de falhas por
 * escravo, timeout que não trava a fila e refcount que fecha a porta.
 *
 * O cliente Modbus é mockado (não há porta serial real no ambiente de CI).
 */
import { SerialPortManager, SerialSettings } from './serial-port-manager';

// Mock do modbus-serial: cada `new ModbusRTU()` devolve um cliente falso.
const createdClients: MockClient[] = [];

interface MockClient {
  isOpen: boolean;
  ids: number[];
  connectRTUBuffered: jest.Mock;
  setID: jest.Mock;
  setTimeout: jest.Mock;
  close: jest.Mock;
}

function makeMockClient(): MockClient {
  const client: MockClient = {
    isOpen: false,
    ids: [],
    connectRTUBuffered: jest.fn(async () => {
      client.isOpen = true;
    }),
    setID: jest.fn((id: number) => {
      client.ids.push(id);
    }),
    setTimeout: jest.fn(),
    close: jest.fn((cb?: () => void) => {
      client.isOpen = false;
      cb?.();
    }),
  };
  createdClients.push(client);
  return client;
}

jest.mock('modbus-serial', () => {
  return jest.fn().mockImplementation(() => makeMockClient());
});

const SETTINGS: SerialSettings = {
  path: '/dev/ttyUSB0',
  baudRate: 9600,
  parity: 'none',
  dataBits: 8,
  stopBits: 1,
};

describe('SerialPortManager', () => {
  let manager: SerialPortManager;

  beforeEach(() => {
    createdClients.length = 0;
    manager = new SerialPortManager();
  });

  it('serializa operações concorrentes na mesma porta (nunca duas em voo)', async () => {
    manager.acquire(SETTINGS.path, 'dev-a');
    manager.acquire(SETTINGS.path, 'dev-b');

    let inFlight = 0;
    let maxInFlight = 0;
    const order: number[] = [];

    const op = (n: number) => async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      order.push(n);
      inFlight -= 1;
      return n;
    };

    const results = await Promise.all([
      manager.run(SETTINGS, 1, op(1)),
      manager.run(SETTINGS, 2, op(2)),
      manager.run(SETTINGS, 3, op(3)),
    ]);

    expect(results).toEqual([1, 2, 3]);
    expect(order).toEqual([1, 2, 3]);
    expect(maxInFlight).toBe(1);
    // Uma única porta aberta para os 3 escravos
    expect(createdClients).toHaveLength(1);
  });

  it('faz setID(unitId) imediatamente antes de cada operação', async () => {
    manager.acquire(SETTINGS.path, 'dev-a');
    await manager.run(SETTINGS, 5, async () => undefined);
    await manager.run(SETTINGS, 17, async () => undefined);
    expect(createdClients[0].ids).toEqual([5, 17]);
  });

  it('falha de um escravo não derruba as operações seguintes da fila', async () => {
    manager.acquire(SETTINGS.path, 'dev-a');

    const failing = manager.run(SETTINGS, 1, async () => {
      throw new Error('Modbus exception: illegal data address');
    });
    const following = manager.run(SETTINGS, 2, async () => 'ok');

    await expect(failing).rejects.toThrow('illegal data address');
    await expect(following).resolves.toBe('ok');
    // Exceção Modbus não é erro de porta — a conexão continua aberta
    expect(createdClients[0].isOpen).toBe(true);
  });

  it('timeout de operação não trava a fila', async () => {
    manager.acquire(SETTINGS.path, 'dev-a');

    const hung = manager.run(
      SETTINGS,
      1,
      () => new Promise(() => undefined), // nunca resolve
      50,
    );
    const next = manager.run(SETTINGS, 2, async () => 'depois');

    await expect(hung).rejects.toThrow(/timeout na porta serial/);
    await expect(next).resolves.toBe('depois');
  });

  it('fecha a porta quando o último consumidor libera a referência', async () => {
    manager.acquire(SETTINGS.path, 'dev-a');
    manager.acquire(SETTINGS.path, 'dev-b');
    await manager.run(SETTINGS, 1, async () => undefined);

    manager.release(SETTINGS.path, 'dev-a');
    await new Promise((r) => setTimeout(r, 5));
    expect(createdClients[0].isOpen).toBe(true); // dev-b ainda usa

    manager.release(SETTINGS.path, 'dev-b');
    await new Promise((r) => setTimeout(r, 5));
    expect(createdClients[0].isOpen).toBe(false);
  });

  it('fecha a porta após operação avulsa sem referências (teste de conexão)', async () => {
    await manager.run(SETTINGS, 1, async () => undefined);
    await new Promise((r) => setTimeout(r, 5));
    expect(createdClients[0].isOpen).toBe(false);
  });

  it('rejeita parâmetros diferentes numa porta já aberta', async () => {
    manager.acquire(SETTINGS.path, 'dev-a');
    await manager.run(SETTINGS, 1, async () => undefined);

    await expect(
      manager.run({ ...SETTINGS, baudRate: 19200 }, 2, async () => undefined),
    ).rejects.toThrow(/já está em uso com outros parâmetros/);
  });

  it('trata caminho da porta como case-insensitive (COM3 == com3)', async () => {
    manager.acquire('COM3', 'dev-a');
    const winSettings: SerialSettings = { ...SETTINGS, path: 'COM3' };
    await manager.run(winSettings, 1, async () => undefined);
    await manager.run({ ...winSettings, path: 'com3' }, 2, async () => undefined);
    expect(createdClients).toHaveLength(1);
  });

  it('traduz erro de porta inexistente para mensagem amigável', async () => {
    manager.acquire(SETTINGS.path, 'dev-a');
    // O cliente é criado sincronamente no run(); a abertura roda num microtask
    // seguinte — dá tempo de forçar a falha de open antes de executar.
    const promise = manager.run(SETTINGS, 1, async () => undefined);
    createdClients[0].connectRTUBuffered.mockRejectedValue(
      new Error('Error: No such file or directory, cannot open /dev/ttyUSB0'),
    );
    await expect(promise).rejects.toThrow(/não encontrada/);
  });
});
