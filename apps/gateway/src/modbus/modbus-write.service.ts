import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import ModbusRTU from 'modbus-serial';
import { GatewayMqttService } from '../mqtt/gateway-mqtt.service';
import { SerialPortManager, SerialSettings } from './serial-port-manager';

/**
 * Comando de escrita Modbus emitido pelo CommandDispatcher.
 * O backend resolve TODO o contexto (conexão + binding do registrador) a partir
 * do cadastro — o gateway só executa a escrita e confirma por releitura.
 */
export interface ModbusWriteCommand {
  command_id: string;
  tenant_id: string;
  gateway_id: string;
  device_id: string;
  /** 'tcp' (rede) ou 'rtu' (serial RS485). Ausente = TCP. */
  connectionType?: 'tcp' | 'rtu';
  ip: string;
  port: number;
  unitId: number;
  /** Parâmetros da porta serial — só no modo RTU. */
  serial?: SerialSettings;
  /** Número do registrador na convenção do cadastro (Modicon ou cru). */
  register: number;
  /** Apenas holding e coil são escrevíveis (input/discrete são somente leitura). */
  registerType: 'holding' | 'coil';
  dataType: 'int16' | 'uint16' | 'int32' | 'uint32' | 'float32';
  endianness: 'big' | 'little';
  scale: number;
  offset: number;
  /** Valor em unidade de engenharia (o gateway reverte scale/offset ao escrever). */
  value: number;
  /** Tag/unidade do ponto — para publicar a telemetria confirmada pós-escrita. */
  tag: string;
  unit: string | null;
}

/** Payload publicado no tópico de resultado do comando. */
interface CommandResult {
  command_id: string;
  success: boolean;
  error: string | null;
}

/** Timeout para abrir o socket Modbus TCP no equipamento. */
const CONNECT_TIMEOUT_MS = 8_000;
/** Timeout por operação Modbus (escrita/releitura). */
const OP_TIMEOUT_MS = 3_000;
/** Orçamento da operação serial enfileirada (escrita + releitura + fila). */
const RTU_BUDGET_MS = 12_000;

/**
 * ModbusWriteService
 *
 * Trata o comando `modbus.write`: escreve um holding register (FC06/FC16) ou
 * coil (FC05) e publica o resultado em .../commands/result. Após a escrita,
 * relê o registrador e publica o valor confirmado no tópico CANÔNICO de
 * telemetria (payload idêntico ao do polling) — os widgets refletem o novo
 * valor em ~1s, sem esperar o próximo ciclo.
 *
 *   - TCP: conexão dedicada curta (connect → write → readback → close), sem
 *     disputar a conexão do polling.
 *   - RTU: TODA a operação passa pela fila única do SerialPortManager (RS485 é
 *     half-duplex — nunca concorre com o polling no barramento).
 */
@Injectable()
export class ModbusWriteService {
  private readonly logger = new Logger(ModbusWriteService.name);

  constructor(
    private readonly mqttService: GatewayMqttService,
    private readonly serialPorts: SerialPortManager,
  ) {}

  @OnEvent('command.modbus.write')
  async handleWriteCommand(command: ModbusWriteCommand): Promise<void> {
    const target =
      command.connectionType === 'rtu'
        ? `${command.serial?.path} (unit ${command.unitId})`
        : `${command.ip}:${command.port} (unit ${command.unitId})`;
    this.logger.log(
      `Comando write Modbus recebido — command_id=${command.command_id} ${target} ` +
        `${command.registerType} reg ${command.register} value=${command.value}`,
    );

    const resultTopic = `bluebee/${command.tenant_id}/gateway/${command.gateway_id}/commands/result`;

    let confirmedValue: number | null = null;
    let error: string | null = null;

    try {
      confirmedValue =
        command.connectionType === 'rtu'
          ? await this.writeRtu(command)
          : await this.writeTcp(command);
    } catch (err) {
      error = this.describeError(err, command);
    }

    const result: CommandResult = {
      command_id: command.command_id,
      success: error === null,
      error,
    };
    this.mqttService.publish(resultTopic, result);

    if (error !== null) {
      this.logger.error(
        `Write Modbus FALHOU — command_id=${command.command_id} ${target}: ${error}`,
      );
      return;
    }

    this.logger.log(
      `Write Modbus OK — command_id=${command.command_id} ${target} ` +
        `reg ${command.register} = ${command.value}` +
        (confirmedValue !== null ? ` (releitura: ${confirmedValue})` : ''),
    );

    // Telemetria confirmada pós-escrita: mesmo payload do polling. Se a
    // releitura não retornou valor, publica o valor comandado — o polling
    // corrige no próximo ciclo caso divirja.
    this.publishConfirmedTelemetry(command, confirmedValue ?? command.value);
  }

  /** Escrita TCP numa conexão dedicada curta (não disputa a conexão do polling). */
  private async writeTcp(command: ModbusWriteCommand): Promise<number | null> {
    const client = new ModbusRTU();
    try {
      await this.withTimeout(
        client.connectTCP(command.ip, { port: command.port || 502 }),
        CONNECT_TIMEOUT_MS,
        'timeout',
      );
      client.setID(command.unitId ?? 1);
      client.setTimeout(OP_TIMEOUT_MS);
      return await this.writeAndReadback(client, command);
    } finally {
      try {
        if (client.isOpen) {
          client.close(() => undefined);
        }
      } catch {
        // fechar é best-effort
      }
    }
  }

  /**
   * Escrita RTU via fila única do SerialPortManager — a operação inteira
   * (escrita + releitura) roda enfileirada, sem colidir com o polling do
   * barramento half-duplex.
   */
  private async writeRtu(command: ModbusWriteCommand): Promise<number | null> {
    if (!command.serial?.path) {
      throw new Error('Parâmetros da porta serial ausentes no comando de escrita.');
    }
    return this.serialPorts.run(
      command.serial,
      command.unitId ?? 1,
      async (client) => {
        client.setTimeout(OP_TIMEOUT_MS);
        return this.writeAndReadback(client, command);
      },
      RTU_BUDGET_MS,
    );
  }

  /**
   * Executa a escrita (coil FC05 / holding FC06-FC16) e relê o registrador
   * para confirmar. A releitura é best-effort: falha na releitura NÃO derruba
   * a escrita já executada — retorna null e o polling cobre no próximo ciclo.
   */
  private async writeAndReadback(
    client: ModbusRTU,
    command: ModbusWriteCommand,
  ): Promise<number | null> {
    const addr = this.protocolAddress(command);

    if (command.registerType === 'coil') {
      const bool = this.coilState(command);
      await client.writeCoil(addr, bool);
      try {
        const res = await client.readCoils(addr, 1);
        const raw = res.data?.[0] ? 1 : 0;
        return raw * (command.scale ?? 1) + (command.offset ?? 0);
      } catch {
        return null;
      }
    }

    // Holding register: reverte scale/offset e codifica conforme o dataType.
    const words = this.encodeRegisters(command);
    if (words.length === 1) {
      await client.writeRegister(addr, words[0]);
    } else {
      await client.writeRegisters(addr, words);
    }

    try {
      const res = await client.readHoldingRegisters(addr, words.length);
      const raw = this.decode(res.buffer, command.dataType, command.endianness);
      if (raw === null) {
        return null;
      }
      return raw * (command.scale ?? 1) + (command.offset ?? 0);
    } catch {
      return null;
    }
  }

  /** Estado booleano do coil a escrever (valor de engenharia ≠ 0 = ligado). */
  private coilState(command: ModbusWriteCommand): boolean {
    // Coils normalmente usam scale=1/offset=0; reverte por consistência.
    const raw = (command.value - (command.offset ?? 0)) / (command.scale ?? 1);
    return raw !== 0;
  }

  /**
   * Converte o valor de engenharia para as words do registrador:
   * raw = (value - offset) / scale, codificado conforme dataType/endianness —
   * exatamente o INVERSO do decode do polling (word-swap em 'little').
   */
  private encodeRegisters(command: ModbusWriteCommand): number[] {
    const scale = command.scale ?? 1;
    if (scale === 0) {
      throw new Error('Escala 0 no cadastro do ponto — escrita impossível.');
    }
    const raw = (command.value - (command.offset ?? 0)) / scale;

    const { dataType, endianness } = command;

    if (dataType === 'int16' || dataType === 'uint16') {
      const n = Math.round(raw);
      const [min, max] = dataType === 'int16' ? [-32768, 32767] : [0, 65535];
      if (n < min || n > max) {
        throw new Error(
          `Valor cru ${n} fora da faixa do tipo ${dataType} (${min}…${max}).`,
        );
      }
      const buf = Buffer.alloc(2);
      if (dataType === 'int16') {
        buf.writeInt16BE(n, 0);
      } else {
        buf.writeUInt16BE(n, 0);
      }
      return [buf.readUInt16BE(0)];
    }

    const buf = Buffer.alloc(4);
    if (dataType === 'int32') {
      const n = Math.round(raw);
      if (n < -2147483648 || n > 2147483647) {
        throw new Error(`Valor cru ${n} fora da faixa do tipo int32.`);
      }
      buf.writeInt32BE(n, 0);
    } else if (dataType === 'uint32') {
      const n = Math.round(raw);
      if (n < 0 || n > 4294967295) {
        throw new Error(`Valor cru ${n} fora da faixa do tipo uint32.`);
      }
      buf.writeUInt32BE(n, 0);
    } else {
      buf.writeFloatBE(raw, 0);
    }

    // 32 bits: 'little' = word-swap (mesma convenção do decode do polling).
    const ordered =
      endianness === 'little'
        ? Buffer.from([buf[2], buf[3], buf[0], buf[1]])
        : buf;
    return [ordered.readUInt16BE(0), ordered.readUInt16BE(2)];
  }

  /** Decodifica o buffer da releitura — mesma lógica do polling. */
  private decode(
    buffer: Buffer,
    dataType: ModbusWriteCommand['dataType'],
    endianness: ModbusWriteCommand['endianness'],
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

  /**
   * Converte o número do registrador (convenção Modicon do manual) para o
   * endereço 0-based do protocolo — mesma regra do polling.
   */
  private protocolAddress(command: ModbusWriteCommand): number {
    const r = command.register;
    if (command.registerType === 'holding') {
      return r >= 40001 ? r - 40001 : r;
    }
    // coil: 1-based no manual (000001…); 0 fica 0.
    return r >= 1 && r < 10000 ? r - 1 : r;
  }

  /**
   * Publica o valor confirmado no tópico CANÔNICO de telemetria com payload
   * idêntico ao do polling Modbus — todo o pipeline downstream (socket, trends,
   * alarmes, pending-commands do SCADA) processa sem distinção.
   */
  private publishConfirmedTelemetry(
    command: ModbusWriteCommand,
    value: number,
  ): void {
    const topic = `bluebee/${command.tenant_id}/gateway/${command.gateway_id}/telemetry`;
    const payload = {
      timestamp: new Date().toISOString(),
      deviceId: command.device_id,
      points: [{ tag: command.tag, value, unit: command.unit ?? null }],
    };
    this.mqttService.publish(topic, payload);
    this.logger.log(
      `Telemetria imediata pós-escrita publicada — device=${command.device_id} ` +
        `${command.tag}=${value}`,
    );
  }

  /** Corrida entre a promessa e um timeout — connectTCP pode travar sem timeout próprio. */
  private withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(label)), ms),
      ),
    ]);
  }

  /** Traduz o erro técnico para uma mensagem amigável ao operador. */
  private describeError(err: unknown, command: ModbusWriteCommand): string {
    const message = (err as Error)?.message ?? String(err);
    const lower = message.toLowerCase();
    // Erros de abertura de porta já vêm traduzidos do SerialPortManager.
    if (lower.includes('porta serial')) {
      return message;
    }
    if (lower.includes('fora da faixa') || lower.includes('escala 0')) {
      return message;
    }
    if (lower.includes('illegal data address')) {
      return `O equipamento rejeitou o endereço do registrador ${command.register} (Illegal Data Address) — confira o mapa Modbus do fabricante.`;
    }
    if (lower.includes('illegal data value')) {
      return 'O equipamento rejeitou o valor escrito (Illegal Data Value) — confira a faixa aceita pelo registrador.';
    }
    if (lower.includes('illegal function')) {
      return 'O equipamento não suporta a função de escrita usada (Illegal Function) — o registrador pode ser somente leitura.';
    }
    if (lower.includes('timeout') || lower.includes('timed out')) {
      return command.connectionType === 'rtu'
        ? `O escravo (Unit ID ${command.unitId ?? 1}) não respondeu na porta ${command.serial?.path} — verifique o endereço do escravo e a fiação RS485.`
        : 'Tempo esgotado — o equipamento não respondeu no IP/porta informados.';
    }
    if (message.includes('ECONNREFUSED')) {
      return 'Conexão recusada — verifique se a porta Modbus TCP está correta e o equipamento ligado.';
    }
    if (message.includes('EHOSTUNREACH') || message.includes('ENETUNREACH')) {
      return 'Host inacessível — o equipamento não está na rede alcançável pelo gateway.';
    }
    if (lower.includes('crc')) {
      return 'Resposta com erro de CRC — verifique baud rate, paridade e a qualidade da fiação RS485.';
    }
    return `Falha na escrita Modbus: ${message}`;
  }
}
