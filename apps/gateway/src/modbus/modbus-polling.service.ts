import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import ModbusRTU from 'modbus-serial';
import { GatewayMqttService } from '../mqtt/gateway-mqtt.service';
import { PollingMetricsService } from '../observability/polling-metrics.service';
import { computeStartJitterMs } from '../observability/poll-jitter.util';
import { SerialPortManager, SerialSettings } from './serial-port-manager';

/** Registrador Modbus de um device (vem do binding cadastrado no backend). */
interface ModbusRegisterConfig {
  tag: string;
  register: number;
  registerType: 'holding' | 'input' | 'coil' | 'discrete';
  dataType: 'int16' | 'uint16' | 'int32' | 'uint32' | 'float32';
  endianness: 'big' | 'little';
  scale: number;
  offset: number;
  unit: string | null;
}

/** Bloco de config de um device Modbus dentro do payload de config do gateway. */
interface ModbusDeviceBlock {
  deviceId: string;
  name: string;
  protocol?: string;
  /** 'tcp' (rede) ou 'rtu' (serial RS485). Ausente = TCP (configs antigas). */
  connectionType?: 'tcp' | 'rtu';
  ip: string;
  port: number;
  unitId: number;
  /** Parâmetros da porta serial — só no modo RTU. */
  serial?: SerialSettings;
  pollingIntervalMs: number;
  registers: ModbusRegisterConfig[];
}

/** Payload de config publicado pelo backend (tópico .../config). */
interface GatewayConfigPayload {
  tenantId: string;
  gatewayId: string;
  devices: ModbusDeviceBlock[];
}

/** Estado de polling de um device Modbus ativo. */
interface ActiveModbusPoll {
  /** Cliente TCP dedicado — no modo RTU o cliente vive no SerialPortManager. */
  client: ModbusRTU | null;
  handle: ReturnType<typeof setInterval>;
  /** Delay de partida (jitter) — pendente até o primeiro ciclo. */
  startTimeout: ReturnType<typeof setTimeout> | null;
  connecting: boolean;
  /** Ciclo em andamento — evita sobrepor ciclos num escravo RTU lento. */
  busy: boolean;
  /** Porta serial referenciada no SerialPortManager (modo RTU). */
  serialPath?: string;
}

/** Registrador já resolvido para endereço de protocolo + tamanho em words. */
interface PlannedRegister {
  reg: ModbusRegisterConfig;
  /** Endereço 0-based do protocolo (após conversão Modicon). */
  addr: number;
  /** Words (16 bits) ocupados — coil/discrete contam como 1 bit. */
  words: number;
  /** Posição original no array de registradores do device (ordem do payload). */
  originalIndex: number;
}

/** Ponto de telemetria com a posição original, para reordenar o payload. */
interface OrderedTelemetryPoint {
  order: number;
  point: TelemetryPoint;
}

/** Bloco contíguo de registradores do mesmo tipo, lido num único request. */
interface RegisterBlock {
  registerType: ModbusRegisterConfig['registerType'];
  regs: PlannedRegister[];
}

/** Ponto de telemetria individual publicado no tópico canônico. */
interface TelemetryPoint {
  tag: string;
  value: number | null;
  unit: string | null;
}

interface TelemetryPayload {
  timestamp: string;
  deviceId: string;
  points: TelemetryPoint[];
}

/** Timeout de leitura Modbus por request (ms). */
const READ_TIMEOUT_MS = 1500;

/** Máximo de registradores (16 bits) por request Modbus (limite do protocolo). */
const MAX_REGISTERS_PER_READ = 125;
/** Máximo de bits (coils/discrete inputs) por request Modbus. */
const MAX_BITS_PER_READ = 2000;

/**
 * ModbusPollingService
 *
 * Consome a mesma config de polling publicada pelo backend (tópico .../config),
 * mas processa apenas os blocos `protocol: 'modbus'`. Para cada device, mantém
 * uma conexão Modbus TCP e faz polling periódico dos registradores cadastrados,
 * publicando um payload no MESMO tópico canônico de telemetria do BACnet:
 *
 *   bluebee/{tenantId}/gateway/{gatewayId}/telemetry
 *
 * Assim, todo o pipeline downstream (trends, alarmes, status) funciona sem
 * distinção de protocolo. Modbus NÃO tem discovery — os registradores são
 * cadastrados manualmente no backend (mapa do fabricante).
 */
@Injectable()
export class ModbusPollingService implements OnModuleDestroy {
  private readonly logger = new Logger(ModbusPollingService.name);
  private readonly tenantId: string;
  private readonly gatewayId: string;

  /** Polls ativos keyed por `${ip}:${port}` → estado da conexão/intervalo. */
  private readonly activePolls = new Map<string, ActiveModbusPoll>();
  /** Chaves (ip:port) atualmente gerenciadas pela config dinâmica do backend. */
  private dynamicKeys = new Set<string>();

  constructor(
    private readonly mqttService: GatewayMqttService,
    private readonly configService: ConfigService,
    private readonly pollingMetrics: PollingMetricsService,
    private readonly serialPorts: SerialPortManager,
  ) {
    this.tenantId = this.configService.get<string>('TENANT_ID', 'default');
    this.gatewayId = this.configService.get<string>('GATEWAY_ID', 'gw-01');
  }

  onModuleDestroy(): void {
    for (const key of this.activePolls.keys()) {
      this.stopPoll(key);
    }
  }

  /**
   * Recebe a config publicada pelo backend e processa apenas os blocos Modbus.
   * Reutiliza o evento 'mqtt.message' (mesmo barramento do BACnet).
   */
  @OnEvent('mqtt.message')
  handleConfigMessage(event: { topic: string; message: Record<string, unknown> }): void {
    if (!event.topic.endsWith('/config')) {
      return;
    }

    const payload = event.message as unknown as GatewayConfigPayload;
    if (!Array.isArray(payload.devices)) {
      return;
    }

    const modbusDevices = payload.devices.filter((d) => d.protocol === 'modbus');
    this.applyConfig(modbusDevices);
  }

  /** Aplica a config dinâmica: (re)inicia polling dos devices e encerra os removidos. */
  private applyConfig(devices: ModbusDeviceBlock[]): void {
    const newKeys = new Set<string>();

    for (const d of devices) {
      const key = this.deviceKey(d);
      newKeys.add(key);
      this.startPoll(d);
    }

    for (const key of this.dynamicKeys) {
      if (!newKeys.has(key)) {
        this.stopPoll(key);
        this.logger.log(`Polling Modbus encerrado para ${key} (device removido da config)`);
      }
    }
    this.dynamicKeys = newKeys;

    const totalRegs = devices.reduce((acc, d) => acc + (d.registers?.length ?? 0), 0);
    this.logger.log(
      `Config dinâmica Modbus aplicada — ${devices.length} device(s), ${totalRegs} registrador(es)`,
    );
  }

  /** (Re)inicia o intervalo de polling de um device, substituindo o anterior. */
  private startPoll(device: ModbusDeviceBlock): void {
    const key = this.deviceKey(device);
    this.stopPoll(key);

    const registers = device.registers ?? [];
    if (registers.length === 0) {
      this.logger.warn(`Device Modbus ${device.deviceId} (${this.deviceLabel(device)}): sem registradores`);
      return;
    }

    const isRtu = this.isRtu(device);
    if (isRtu && !device.serial?.path) {
      this.logger.error(
        `Device Modbus RTU ${device.deviceId}: config sem caminho da porta serial — polling não iniciado`,
      );
      return;
    }

    const state: ActiveModbusPoll = {
      client: isRtu ? null : new ModbusRTU(),
      handle: undefined as never,
      startTimeout: null,
      connecting: false,
      busy: false,
      serialPath: isRtu ? device.serial!.path : undefined,
    };

    if (isRtu) {
      // Refcount: mantém a porta serial aberta enquanto houver devices neste barramento.
      this.serialPorts.acquire(device.serial!.path, device.deviceId);
    }

    const intervalMs = device.pollingIntervalMs || 15_000;
    // Jitter determinístico de partida: espalha os ciclos dos devices do
    // gateway dentro do intervalo, evitando rajadas sincronizadas no broker.
    const jitterMs = computeStartJitterMs(key, intervalMs);
    this.logger.log(
      `Device Modbus ${device.deviceId} (${this.deviceLabel(device)}, unit ${device.unitId}): ` +
        `polling a cada ${intervalMs}ms — ${registers.length} registrador(es) (partida em ${jitterMs}ms)`,
    );

    // Primeira leitura após o jitter + ciclos subsequentes
    state.startTimeout = setTimeout(() => {
      state.startTimeout = null;
      void this.pollDevice(state, device);
      state.handle = setInterval(() => {
        void this.pollDevice(state, device);
      }, intervalMs);
    }, jitterMs);

    this.activePolls.set(key, state);
  }

  private stopPoll(key: string): void {
    const state = this.activePolls.get(key);
    if (!state) {
      return;
    }
    if (state.startTimeout) {
      clearTimeout(state.startTimeout);
    }
    if (state.handle) {
      clearInterval(state.handle);
    }
    try {
      if (state.client?.isOpen) {
        state.client.close(() => undefined);
      }
    } catch {
      // fechar conexão é best-effort
    }
    if (state.serialPath) {
      // Libera a referência do barramento — a porta fecha quando o último sai.
      this.serialPorts.release(state.serialPath, this.refKeyFor(key));
    }
    this.activePolls.delete(key);
  }

  /** True quando o device usa Modbus RTU via serial RS485. */
  private isRtu(device: ModbusDeviceBlock): boolean {
    return device.connectionType === 'rtu';
  }

  /** Rótulo de log: ip:porta (TCP) ou porta serial (RTU). */
  private deviceLabel(device: ModbusDeviceBlock): string {
    return this.isRtu(device)
      ? `${device.serial?.path ?? '?'}`
      : `${device.ip}:${device.port}`;
  }

  /**
   * Chave de identidade do poll: TCP usa ip:port (uma conexão por equipamento);
   * RTU usa porta serial + unitId (vários escravos compartilham o barramento —
   * cada um tem seu próprio ciclo, mas a porta é única no SerialPortManager).
   */
  private deviceKey(device: ModbusDeviceBlock): string {
    if (this.isRtu(device)) {
      return `rtu:${device.serial?.path ?? ''}#${device.unitId}:${device.deviceId}`;
    }
    return `${device.ip}:${device.port}`;
  }

  /** deviceId embutido na chave RTU — usado como refKey no SerialPortManager. */
  private refKeyFor(key: string): string {
    const idx = key.lastIndexOf(':');
    return idx >= 0 ? key.slice(idx + 1) : key;
  }

  /** Garante a conexão TCP aberta antes de um ciclo de leitura. */
  private async ensureConnected(
    state: ActiveModbusPoll,
    device: ModbusDeviceBlock,
  ): Promise<boolean> {
    const client = state.client;
    if (!client) {
      return false;
    }
    if (client.isOpen) {
      return true;
    }
    if (state.connecting) {
      return false;
    }
    state.connecting = true;
    try {
      await client.connectTCP(device.ip, { port: device.port || 502 });
      client.setID(device.unitId ?? 1);
      client.setTimeout(READ_TIMEOUT_MS);
      this.logger.log(`Conectado ao device Modbus ${device.ip}:${device.port}`);
      return true;
    } catch (err) {
      this.logger.warn(
        `Falha ao conectar Modbus ${device.ip}:${device.port}: ${(err as Error).message}`,
      );
      return false;
    } finally {
      state.connecting = false;
    }
  }

  /** Executa um ciclo completo de leitura e publica a telemetria. */
  private async pollDevice(state: ActiveModbusPoll, device: ModbusDeviceBlock): Promise<void> {
    if (state.busy) {
      // Ciclo anterior ainda em andamento (barramento lento) — não sobrepõe;
      // pula este ciclo e contabiliza para observabilidade.
      this.pollingMetrics.recordSkipped({
        protocol: 'modbus',
        deviceId: device.deviceId,
        intervalMs: device.pollingIntervalMs || 15_000,
      });
      return;
    }
    state.busy = true;
    try {
      await this.runPollCycle(state, device);
    } finally {
      state.busy = false;
    }
  }

  private async runPollCycle(state: ActiveModbusPoll, device: ModbusDeviceBlock): Promise<void> {
    const isRtu = this.isRtu(device);
    if (!isRtu) {
      const connected = await this.ensureConnected(state, device);
      if (!connected) {
        return;
      }
    }

    const startedAt = Date.now();
    const blocks = this.planBlocks(device.registers);

    const ordered: OrderedTelemetryPoint[] = [];
    for (const block of blocks) {
      if (isRtu) {
        // RS485 é half-duplex: todo acesso à porta passa pela fila única do
        // SerialPortManager, que faz setID(unitId) antes de cada operação.
        // O bloco inteiro (incluindo splits de erro) roda numa única operação
        // enfileirada — nenhuma requisição de outro escravo entra no meio.
        try {
          ordered.push(
            ...(await this.serialPorts.run(
              device.serial!,
              device.unitId ?? 1,
              async (client) => {
                client.setTimeout(READ_TIMEOUT_MS);
                return this.readBlock(client, block, device);
              },
              // Splits podem multiplicar as requisições — orçamento generoso.
              READ_TIMEOUT_MS * Math.max(4, block.regs.length),
            )),
          );
        } catch (err) {
          // Falha deste escravo/porta não derruba os demais Unit IDs do barramento.
          this.logger.warn(
            `[${device.deviceId}] Falha no bloco RTU (${device.serial?.path}, unit ${device.unitId}): ` +
              `${(err as Error).message}`,
          );
        }
      } else {
        ordered.push(...(await this.readBlock(state.client!, block, device)));
      }
    }

    const elapsedMs = Date.now() - startedAt;

    this.pollingMetrics.record({
      protocol: 'modbus',
      deviceId: device.deviceId,
      latencyMs: elapsedMs,
      pointsRead: ordered.length,
      pointsAttempted: device.registers.length,
      intervalMs: device.pollingIntervalMs || 15_000,
    });

    this.logger.debug(
      `[${device.deviceId}] Ciclo Modbus: ${device.registers.length} registrador(es) em ` +
        `${blocks.length} bloco(s) — ${ordered.length} lido(s) em ${elapsedMs}ms`,
    );

    if (ordered.length === 0) {
      return;
    }

    // Blocos reordenam por endereço; restaura a ordem original do payload publicado.
    ordered.sort((a, b) => a.order - b.order);
    const points: TelemetryPoint[] = ordered.map((o) => o.point);

    const topic = `bluebee/${this.tenantId}/gateway/${this.gatewayId}/telemetry`;
    const payload: TelemetryPayload = {
      timestamp: new Date().toISOString(),
      deviceId: device.deviceId,
      points,
    };
    this.mqttService.publish(topic, payload);
  }

  /**
   * Converte o número de registrador informado (convenção Modicon do manual,
   * ex.: 40001 = primeiro holding) para o endereço 0-based do protocolo, que é
   * o que a lib espera. Se o usuário já informar o endereço cru (abaixo da
   * faixa Modicon), usa como está.
   *
   *   holding  4xxxx → addr = reg - 40001
   *   input    3xxxx → addr = reg - 30001
   *   coil     0xxxx → addr = reg - 1        (1-based no manual)
   *   discrete 1xxxx → addr = reg - 10001
   */
  private protocolAddress(reg: ModbusRegisterConfig): number {
    const r = reg.register;
    switch (reg.registerType) {
      case 'holding':
        return r >= 40001 ? r - 40001 : r;
      case 'input':
        return r >= 30001 ? r - 30001 : r;
      case 'discrete':
        return r >= 10001 ? r - 10001 : r;
      case 'coil':
        // Coils costumam vir 1-based no manual (000001…); 0 fica 0.
        return r >= 1 && r < 10000 ? r - 1 : r;
      default:
        return r;
    }
  }

  /** Words (16 bits) que um registrador ocupa. Coil/discrete = 1 bit. */
  private wordsFor(reg: ModbusRegisterConfig): number {
    if (reg.registerType === 'coil' || reg.registerType === 'discrete') {
      return 1;
    }
    return reg.dataType === 'int16' || reg.dataType === 'uint16' ? 1 : 2;
  }

  /**
   * Agrupa os registradores em blocos contíguos por tipo, respeitando o limite
   * por request (125 registros / 2000 bits) e quebrando em lacunas de endereço
   * (registros não adjacentes viram blocos separados).
   */
  private planBlocks(registers: ModbusRegisterConfig[]): RegisterBlock[] {
    const types: ModbusRegisterConfig['registerType'][] = [
      'holding',
      'input',
      'coil',
      'discrete',
    ];
    const blocks: RegisterBlock[] = [];

    for (const type of types) {
      const planned: PlannedRegister[] = registers
        .map((reg, originalIndex) => ({ reg, originalIndex }))
        .filter(({ reg }) => reg.registerType === type)
        .map(({ reg, originalIndex }) => ({
          reg,
          addr: this.protocolAddress(reg),
          words: this.wordsFor(reg),
          originalIndex,
        }))
        .sort((a, b) => a.addr - b.addr);
      if (planned.length === 0) {
        continue;
      }

      const maxSize =
        type === 'coil' || type === 'discrete' ? MAX_BITS_PER_READ : MAX_REGISTERS_PER_READ;

      let current: PlannedRegister[] = [];
      let blockStart = 0;
      let blockEnd = 0;

      for (const p of planned) {
        const pEnd = p.addr + p.words;
        if (current.length === 0) {
          current = [p];
          blockStart = p.addr;
          blockEnd = pEnd;
          continue;
        }
        const contiguous = p.addr <= blockEnd; // sem lacuna de endereço
        const newEnd = Math.max(blockEnd, pEnd);
        const withinSize = newEnd - blockStart <= maxSize;
        if (contiguous && withinSize) {
          current.push(p);
          blockEnd = newEnd;
        } else {
          blocks.push({ registerType: type, regs: current });
          current = [p];
          blockStart = p.addr;
          blockEnd = pEnd;
        }
      }
      if (current.length > 0) {
        blocks.push({ registerType: type, regs: current });
      }
    }

    return blocks;
  }

  /**
   * Lê um bloco contíguo num único request e decodifica cada registrador a
   * partir da sua fatia. Em erro/timeout: bloco com mais de um registrador é
   * dividido ao meio e re-tentado (isola o endereço problemático); bloco de um
   * único registrador é apenas pulado — degradação graciosa, sem derrubar o ciclo.
   */
  private async readBlock(
    client: ModbusRTU,
    block: RegisterBlock,
    device: ModbusDeviceBlock,
  ): Promise<OrderedTelemetryPoint[]> {
    const { registerType, regs } = block;
    const start = Math.min(...regs.map((r) => r.addr));
    const end = Math.max(...regs.map((r) => r.addr + r.words));
    const count = end - start;

    try {
      if (registerType === 'coil') {
        const res = await client.readCoils(start, count);
        return this.decodeBits(regs, start, res.data);
      }
      if (registerType === 'discrete') {
        const res = await client.readDiscreteInputs(start, count);
        return this.decodeBits(regs, start, res.data);
      }
      const res =
        registerType === 'input'
          ? await client.readInputRegisters(start, count)
          : await client.readHoldingRegisters(start, count);
      return this.decodeRegisters(regs, start, res.buffer);
    } catch (err) {
      if (regs.length === 1) {
        this.logger.debug(
          `[${device.deviceId}] Falha ao ler ${regs[0].reg.tag} ` +
            `(reg ${regs[0].reg.register}): ${(err as Error).message}`,
        );
        return [];
      }
      const mid = Math.ceil(regs.length / 2);
      const left = await this.readBlock(
        client,
        { registerType, regs: regs.slice(0, mid) },
        device,
      );
      const right = await this.readBlock(
        client,
        { registerType, regs: regs.slice(mid) },
        device,
      );
      return [...left, ...right];
    }
  }

  /** Extrai/decode registradores holding/input da fatia do buffer do bloco. */
  private decodeRegisters(
    regs: PlannedRegister[],
    blockStart: number,
    buffer: Buffer,
  ): OrderedTelemetryPoint[] {
    const points: OrderedTelemetryPoint[] = [];
    for (const p of regs) {
      const byteOffset = (p.addr - blockStart) * 2;
      const slice = buffer.subarray(byteOffset, byteOffset + p.words * 2);
      const raw = this.decode(slice, p.reg.dataType, p.reg.endianness);
      if (raw === null) {
        continue;
      }
      const value = raw * (p.reg.scale ?? 1) + (p.reg.offset ?? 0);
      points.push({
        order: p.originalIndex,
        point: { tag: p.reg.tag, value, unit: p.reg.unit ?? null },
      });
    }
    return points;
  }

  /** Extrai coils/discrete inputs (booleanos 0/1) da resposta do bloco. */
  private decodeBits(
    regs: PlannedRegister[],
    blockStart: number,
    data: boolean[],
  ): OrderedTelemetryPoint[] {
    const points: OrderedTelemetryPoint[] = [];
    for (const p of regs) {
      const idx = p.addr - blockStart;
      if (idx < 0 || idx >= data.length) {
        continue;
      }
      const raw = data[idx] ? 1 : 0;
      const value = raw * (p.reg.scale ?? 1) + (p.reg.offset ?? 0);
      points.push({
        order: p.originalIndex,
        point: { tag: p.reg.tag, value, unit: p.reg.unit ?? null },
      });
    }
    return points;
  }

  /** Decodifica o buffer (big-endian por word) conforme o tipo e a endianness. */
  private decode(
    buffer: Buffer,
    dataType: ModbusRegisterConfig['dataType'],
    endianness: ModbusRegisterConfig['endianness'],
  ): number | null {
    if (buffer.length < 2) {
      return null;
    }

    if (dataType === 'int16') {
      return buffer.readInt16BE(0);
    }
    if (dataType === 'uint16') {
      return buffer.readUInt16BE(0);
    }

    if (buffer.length < 4) {
      return null;
    }

    // 32 bits: 'little' = word-swap (alguns dispositivos invertem a ordem das words)
    const buf =
      endianness === 'little'
        ? Buffer.from([buffer[2], buffer[3], buffer[0], buffer[1]])
        : buffer;

    if (dataType === 'int32') {
      return buf.readInt32BE(0);
    }
    if (dataType === 'uint32') {
      return buf.readUInt32BE(0);
    }
    return buf.readFloatBE(0);
  }
}
