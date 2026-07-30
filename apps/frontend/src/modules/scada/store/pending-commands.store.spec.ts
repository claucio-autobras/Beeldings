/**
 * Contrato do estado otimista de comandos (pending-commands.store):
 * os widgets de comando (slider, controle segmentado, botão) LIMPAM o rascunho
 * local assim que o comando responde ok, porque este store garante que o valor
 * comandado continua sendo servido via getValue até a telemetria confirmar
 * (ou o TTL de segurança expirar). Estes testes fixam esse contrato — se ele
 * mudar, a reconciliação dos widgets precisa mudar em conjunto.
 */
import {
  setPendingCommand,
  clearPendingCommand,
  getPendingCommand,
  subscribePendingCommands,
} from './pending-commands.store';

describe('pending-commands.store (contrato do otimista)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    // limpa qualquer pendente de outros testes
    clearPendingCommand('dev1', 'tag1');
    clearPendingCommand('dev1', 'tag2');
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('comando ok com telemetria atrasada: o valor comandado persiste após o envio', () => {
    setPendingCommand('dev1', 'tag1', 85);
    // Mesmo sem nenhuma telemetria nova (readback atrasado), o valor segue servido.
    jest.advanceTimersByTime(10_000);
    expect(getPendingCommand('dev1', 'tag1')).toBe(85);
  });

  it('comando com falha: clearPendingCommand descarta o pendente na hora', () => {
    setPendingCommand('dev1', 'tag1', 42);
    clearPendingCommand('dev1', 'tag1');
    expect(getPendingCommand('dev1', 'tag1')).toBeNull();
  });

  it('TTL de segurança: pendente expira se a telemetria nunca confirmar', () => {
    setPendingCommand('dev1', 'tag1', 7);
    jest.advanceTimersByTime(26_000); // > PENDING_TTL_MS (25s)
    expect(getPendingCommand('dev1', 'tag1')).toBeNull();
  });

  it('comandos em sequência: o último valor comandado substitui o anterior', () => {
    setPendingCommand('dev1', 'tag1', 1);
    setPendingCommand('dev1', 'tag1', 2);
    expect(getPendingCommand('dev1', 'tag1')).toBe(2);
  });

  it('pendentes são por ponto (deviceId|tag), sem vazar entre pontos', () => {
    setPendingCommand('dev1', 'tag1', 10);
    expect(getPendingCommand('dev1', 'tag2')).toBeNull();
  });

  it('notifica assinantes em set e clear (re-render dos widgets)', () => {
    const fn = jest.fn();
    const unsub = subscribePendingCommands(fn);
    setPendingCommand('dev1', 'tag1', 5);
    clearPendingCommand('dev1', 'tag1');
    expect(fn).toHaveBeenCalledTimes(2);
    unsub();
  });
});
