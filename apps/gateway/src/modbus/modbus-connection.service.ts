import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import ModbusRTU from 'modbus-serial';
import { GatewayMqttService } from '../mqtt/gateway-mqtt.service';
import { SerialPortManager, SerialSettings } from './serial-port-manager';

/** Comando de teste de conexão Modbus emitido pelo CommandDispatcher. */
export interface ModbusTestCommand {
  command_id: string;
  tenant_id: string;
  gateway_id: string;
  /** 'tcp' (rede) ou 'rtu' (serial RS485). Ausente = TCP (comandos antigos). */
  connectionType?: 'tcp' | 'rtu';
  ip: string;
  port: number;
  unitId: number;
  /** Parâmetros da porta serial — só no modo RTU. */
  serial?: SerialSettings;
}

/** Timeout para abrir o socket Modbus TCP no equipamento. */
const CONNECT_TIMEOUT_MS = 8_000;

/** Timeout da leitura de teste no escravo RTU (porta + request + resposta). */
const RTU_TEST_TIMEOUT_MS = 6_000;

/**
 * ModbusConnectionService
 *
 * Trata o comando `modbus.test`: valida a comunicação com o equipamento e
 * publica o resultado. Usado pela tela de cadastro para validar a comunicação
 * ANTES de liberar o cadastro de registradores.
 *
 *   - TCP: abre o socket no IP/porta.
 *   - RTU: abre a porta serial (via SerialPortManager — mesma fila do polling,
 *     nunca concorre com requisições em voo no barramento) e faz uma leitura
 *     de teste no escravo. Exceção Modbus (endereço ilegal etc.) conta como
 *     SUCESSO — o escravo respondeu; só timeout/porta inválida falham.
 *
 * Resultado publicado em:
 *   bluebee/{tenantId}/gateway/{gatewayId}/modbus/test-result
 */
@Injectable()
export class ModbusConnectionService {
  private readonly logger = new Logger(ModbusConnectionService.name);

  constructor(
    private readonly mqttService: GatewayMqttService,
    private readonly serialPorts: SerialPortManager,
  ) {}

  @OnEvent('command.modbus.test')
  async handleTestCommand(command: ModbusTestCommand): Promise<void> {
    const target =
      command.connectionType === 'rtu'
        ? `${command.serial?.path} (unit ${command.unitId})`
        : `${command.ip}:${command.port} (unit ${command.unitId})`;
    this.logger.log(`Teste de conexão Modbus — ${target}, command_id=${command.command_id}`);

    const result =
      command.connectionType === 'rtu'
        ? await this.tryConnectRtu(command)
        : await this.tryConnectTcp(command);

    const topic = `bluebee/${command.tenant_id}/gateway/${command.gateway_id}/modbus/test-result`;
    this.mqttService.publish(topic, {
      command_id: command.command_id,
      success: result.success,
      ...(result.success ? {} : { error: result.error }),
    });

    this.logger.log(
      `Teste de conexão Modbus ${result.success ? 'OK' : `falhou: ${result.error}`} — ${target}`,
    );
  }

  /** Abre o socket com timeout e fecha em seguida. Sucesso = conexão estabelecida. */
  private async tryConnectTcp(
    command: ModbusTestCommand,
  ): Promise<{ success: true } | { success: false; error: string }> {
    const client = new ModbusRTU();
    try {
      await this.withTimeout(
        client.connectTCP(command.ip, { port: command.port || 502 }),
        CONNECT_TIMEOUT_MS,
      );
      client.setID(command.unitId ?? 1);
      return { success: true };
    } catch (err) {
      return { success: false, error: this.describeTcpError(err) };
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
   * Abre a porta serial e faz uma leitura de teste (1 holding register) no
   * escravo. Passa pela fila única do SerialPortManager — se o barramento já
   * estiver em polling, o teste entra na fila sem colidir com requisições.
   */
  private async tryConnectRtu(
    command: ModbusTestCommand,
  ): Promise<{ success: true } | { success: false; error: string }> {
    if (!command.serial?.path) {
      return { success: false, error: 'Parâmetros da porta serial ausentes no comando de teste.' };
    }
    try {
      await this.serialPorts.run(
        command.serial,
        command.unitId ?? 1,
        async (client) => {
          client.setTimeout(RTU_TEST_TIMEOUT_MS - 1_000);
          await client.readHoldingRegisters(0, 1);
        },
        RTU_TEST_TIMEOUT_MS,
      );
      return { success: true };
    } catch (err) {
      // Exceção Modbus = o escravo RESPONDEU (só não tem esse registrador).
      if (this.isModbusException(err)) {
        return { success: true };
      }
      return { success: false, error: this.describeRtuError(err, command) };
    }
  }

  /** Erro com código de exceção Modbus — prova de que o escravo está vivo. */
  private isModbusException(err: unknown): boolean {
    const e = err as { modbusCode?: number; message?: string };
    if (typeof e?.modbusCode === 'number') {
      return true;
    }
    const msg = (e?.message ?? '').toLowerCase();
    return msg.includes('illegal') || msg.includes('exception');
  }

  /** Corrida entre a promessa e um timeout — connectTCP pode travar sem timeout próprio. */
  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), ms),
      ),
    ]);
  }

  /** Traduz o erro técnico TCP para uma mensagem amigável ao operador. */
  private describeTcpError(err: unknown): string {
    const message = (err as Error)?.message ?? String(err);
    if (message.includes('timeout')) {
      return 'Tempo esgotado ao conectar — o equipamento não respondeu no IP/porta informados.';
    }
    if (message.includes('ECONNREFUSED')) {
      return 'Conexão recusada — verifique se a porta Modbus TCP está correta e o equipamento ligado.';
    }
    if (message.includes('EHOSTUNREACH') || message.includes('ENETUNREACH')) {
      return 'Host inacessível — o equipamento não está na rede alcançável pelo gateway.';
    }
    return `Falha ao conectar: ${message}`;
  }

  /** Traduz o erro RTU (porta serial / escravo) para mensagem amigável. */
  private describeRtuError(err: unknown, command: ModbusTestCommand): string {
    const message = (err as Error)?.message ?? String(err);
    const lower = message.toLowerCase();
    // Erros de abertura de porta já vêm traduzidos do SerialPortManager.
    if (lower.includes('porta serial')) {
      return message;
    }
    if (lower.includes('timeout') || lower.includes('timed out')) {
      return (
        `O escravo (Unit ID ${command.unitId ?? 1}) não respondeu na porta ` +
        `${command.serial?.path} — verifique o endereço do escravo, a fiação RS485 (A/B) ` +
        'e os parâmetros de comunicação (baud rate, paridade).'
      );
    }
    if (lower.includes('crc')) {
      return 'Resposta com erro de CRC — verifique baud rate, paridade e a qualidade da fiação RS485.';
    }
    return `Falha no teste serial: ${message}`;
  }
}
