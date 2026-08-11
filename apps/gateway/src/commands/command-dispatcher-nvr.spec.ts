/**
 * CommandDispatcherService — parseDiskOids para discover_nvr_tables.
 *
 * Verifica que o campo freeGb é propagado corretamente para o NvrDiscoverTablesCommand
 * (Bug 2 — Hikvision hikHddFreeSpace perdida no dispatcher antes da correção).
 *
 * Testa via emissão de evento real: instancia o serviço com um EventEmitter2 mock
 * e verifica que o comando emitido contém os campos esperados.
 */

import { EventEmitter2 } from '@nestjs/event-emitter';
import { CommandDispatcherService } from './command-dispatcher.service';
import type { NvrDiscoverTablesCommand } from '../snmp/snmp-nvr-tables.service';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeDispatcher() {
  const emitter = new EventEmitter2();
  const captured: NvrDiscoverTablesCommand[] = [];
  emitter.on('command.snmp.discover_nvr_tables', (cmd: NvrDiscoverTablesCommand) => {
    captured.push(cmd);
  });
  const svc = new CommandDispatcherService(emitter);
  return { svc, captured };
}

const BASE_EVENT = {
  topic: 'bluebee/t1/gateway/gw1/commands',
  message: {
    command_id: 'cmd-123',
    tenant_id: 't1',
    device_id: 'nvr-1',
    gateway_id: 'gw1',
    protocol: 'snmp',
    action: 'discover_nvr_tables',
    params: {
      ip: '10.0.1.100',
      port: 161,
      snmpVersion: '2c',
      community: 'public',
    },
  } as Record<string, unknown>,
};

// ─── Testes ───────────────────────────────────────────────────────────────────

describe('CommandDispatcherService — discover_nvr_tables parseDiskOids', () => {
  it('propaga freeGb quando presente no payload (Hikvision)', () => {
    const { svc, captured } = makeDispatcher();

    svc.handleMqttMessage({
      topic: BASE_EVENT.topic,
      message: {
        ...BASE_EVENT.message,
        params: {
          ...(BASE_EVENT.message.params as Record<string, unknown>),
          diskTableOids: {
            status:     '1.3.6.1.4.1.39165.1.4.1.1',
            capacityGb: '1.3.6.1.4.1.39165.1.4.1.2',
            // freeGb = hikHddFreeSpace (col 3 = espaço LIVRE, não usado)
            freeGb:     '1.3.6.1.4.1.39165.1.4.1.3',
          },
          channelTableOids: { status: '1.3.6.1.4.1.39165.1.5.1.1' },
        },
      },
    });

    expect(captured).toHaveLength(1);
    const cmd = captured[0];
    expect(cmd.diskTableOids.freeGb).toBe('1.3.6.1.4.1.39165.1.4.1.3');
    expect(cmd.diskTableOids.status).toBe('1.3.6.1.4.1.39165.1.4.1.1');
    expect(cmd.diskTableOids.capacityGb).toBe('1.3.6.1.4.1.39165.1.4.1.2');
    // usedGb ausente para Hikvision (mutuamente exclusivo com freeGb)
    expect(cmd.diskTableOids.usedGb).toBeUndefined();
  });

  it('propaga usedGb e NÃO freeGb quando payload é Dahua/Intelbras', () => {
    const { svc, captured } = makeDispatcher();

    svc.handleMqttMessage({
      topic: BASE_EVENT.topic,
      message: {
        ...BASE_EVENT.message,
        params: {
          ...(BASE_EVENT.message.params as Record<string, unknown>),
          diskTableOids: {
            status:     '1.3.6.1.4.1.1004849.1.1.1.2',
            capacityGb: '1.3.6.1.4.1.1004849.1.1.1.3',
            usedGb:     '1.3.6.1.4.1.1004849.1.1.1.4',
            // freeGb ausente para Dahua
          },
          channelTableOids: { status: '1.3.6.1.4.1.1004849.1.2.1.2' },
        },
      },
    });

    expect(captured).toHaveLength(1);
    const cmd = captured[0];
    expect(cmd.diskTableOids.usedGb).toBe('1.3.6.1.4.1.1004849.1.1.1.4');
    expect(cmd.diskTableOids.freeGb).toBeUndefined();
  });

  it('ignora freeGb se valor não é string (segurança de parsing)', () => {
    const { svc, captured } = makeDispatcher();

    svc.handleMqttMessage({
      topic: BASE_EVENT.topic,
      message: {
        ...BASE_EVENT.message,
        params: {
          ...(BASE_EVENT.message.params as Record<string, unknown>),
          diskTableOids: {
            status:     '1.3.6.1.4.1.39165.1.4.1.1',
            capacityGb: '1.3.6.1.4.1.39165.1.4.1.2',
            freeGb:     12345,  // número — deve ser ignorado (exige string)
          },
          channelTableOids: {},
        },
      },
    });

    expect(captured).toHaveLength(1);
    const cmd = captured[0];
    expect(cmd.diskTableOids.freeGb).toBeUndefined();
  });

  it('campos vazios são ignorados', () => {
    const { svc, captured } = makeDispatcher();

    svc.handleMqttMessage({
      topic: BASE_EVENT.topic,
      message: {
        ...BASE_EVENT.message,
        params: {
          ...(BASE_EVENT.message.params as Record<string, unknown>),
          diskTableOids: {
            status:     '',   // string vazia → ignorada
            capacityGb: '1.3.6.1.4.1.39165.1.4.1.2',
            freeGb:     '',   // string vazia → ignorada
          },
          channelTableOids: {},
        },
      },
    });

    expect(captured).toHaveLength(1);
    const cmd = captured[0];
    expect(cmd.diskTableOids.status).toBeUndefined();
    expect(cmd.diskTableOids.freeGb).toBeUndefined();
    expect(cmd.diskTableOids.capacityGb).toBe('1.3.6.1.4.1.39165.1.4.1.2');
  });
});
