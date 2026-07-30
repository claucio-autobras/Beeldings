import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { StoreAndForwardService } from './store-and-forward.service';

describe('StoreAndForwardService', () => {
  let dataDir: string;
  let filePath: string;

  const makeService = (): StoreAndForwardService => {
    const config = {
      get: (key: string, def?: string) => (key === 'STORE_FORWARD_DIR' ? dataDir : def),
    } as unknown as ConfigService;
    const svc = new StoreAndForwardService(config);
    svc.onModuleInit();
    return svc;
  };

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'saf-test-'));
    filePath = path.join(dataDir, 'pending-messages.json');
  });

  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('persiste mensagens em disco de forma assíncrona e atômica', async () => {
    const svc = makeService();
    svc.enqueue('topic/a', '{"v":1}', 1);
    svc.enqueue('topic/b', '{"v":2}', 0);
    await svc.flush();

    // Nenhum arquivo temporário deve sobrar após a escrita.
    expect(fs.existsSync(`${filePath}.tmp`)).toBe(false);

    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].topic).toBe('topic/a');
    expect(parsed[1].qos).toBe(0);
  });

  it('recarrega a fila do disco no boot', async () => {
    const svc = makeService();
    svc.enqueue('topic/a', 'payload', 1);
    await svc.flush();

    const svc2 = makeService();
    expect(svc2.pendingCount()).toBe(1);
    expect(svc2.drain()[0].topic).toBe('topic/a');
  });

  it('tolera arquivo totalmente corrompido sem travar e preserva o original', () => {
    fs.writeFileSync(filePath, 'isto não é json{{{', 'utf-8');
    const svc = makeService();
    expect(svc.pendingCount()).toBe(0);

    // O arquivo corrompido é preservado com sufixo .corrupt-*
    const backups = fs.readdirSync(dataDir).filter((f) => f.includes('.corrupt-'));
    expect(backups.length).toBe(1);
  });

  it('recupera as mensagens íntegras de um array JSON truncado no meio', () => {
    const good = [
      { topic: 't1', payload: 'p1', qos: 1, enqueuedAt: '2026-01-01T00:00:00.000Z' },
      { topic: 't2', payload: 'p2', qos: 1, enqueuedAt: '2026-01-01T00:00:01.000Z' },
    ];
    // Simula escrita não-atômica interrompida: dois objetos completos + terceiro truncado.
    const truncated = `[${JSON.stringify(good[0])},${JSON.stringify(good[1])},{"topic":"t3","pay`;
    fs.writeFileSync(filePath, truncated, 'utf-8');

    const svc = makeService();
    expect(svc.pendingCount()).toBe(2);
    const drained = svc.drain();
    expect(drained.map((m) => m.topic)).toEqual(['t1', 't2']);
  });

  it('regrava a fila recuperada no arquivo canônico e persiste após reboot sem mutação', () => {
    const good = [
      { topic: 't1', payload: 'p1', qos: 1, enqueuedAt: '2026-01-01T00:00:00.000Z' },
      { topic: 't2', payload: 'p2', qos: 1, enqueuedAt: '2026-01-01T00:00:01.000Z' },
    ];
    const truncated = `[${JSON.stringify(good[0])},${JSON.stringify(good[1])},{"topic":"t3","pay`;
    fs.writeFileSync(filePath, truncated, 'utf-8');

    // Primeiro boot: recupera e regrava o arquivo canônico imediatamente.
    const svc = makeService();
    expect(svc.pendingCount()).toBe(2);

    // O arquivo canônico agora contém JSON válido com as mensagens recuperadas.
    const canonical = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(canonical.map((m: { topic: string }) => m.topic)).toEqual(['t1', 't2']);

    // Segundo boot (simula crash antes de qualquer enqueue/drain): dados persistem.
    const svc2 = makeService();
    expect(svc2.drain().map((m) => m.topic)).toEqual(['t1', 't2']);
  });

  it('conta descartes por fila cheia (observável)', async () => {
    const svc = makeService();
    // Acessa o limite via cast para forçar overflow rapidamente no teste.
    const max = (svc as unknown as { maxQueueSize: number }).maxQueueSize;
    for (let i = 0; i < max + 3; i++) {
      svc.enqueue('t', String(i), 1);
    }
    expect(svc.pendingCount()).toBe(max);
    expect(svc.droppedMessages()).toBe(3);
    await svc.flush();
  });

  it('remove arquivo temporário órfão no boot', () => {
    fs.writeFileSync(`${filePath}.tmp`, 'lixo parcial', 'utf-8');
    makeService();
    expect(fs.existsSync(`${filePath}.tmp`)).toBe(false);
  });
});
