/**
 * SnmpMibSeedService — seed offline de MIBs padrão.
 *
 * Popula a tabela snmp_mibs com os mapeamentos OID→nome das MIBs oficiais
 * suportadas, usando dados estáticos locais (sem acesso à rede).
 * MIBs suportadas:
 *   - SNMPv2-MIB  (system, snmpStats)
 *   - IF-MIB      (interfaces)
 *   - HOST-RESOURCES-MIB (hrSystem, hrStorage, hrDevice)
 *   - UCD-SNMP-MIB (memory, cpu, temperature)
 *   - ENTITY-MIB  (physicalEntity)
 *   - CONTROLID-MIB (cidSystem, cidOperationMode, cidAntipassback, cidNetwork)
 *
 * Execução idempotente: verifica pelo label antes de inserir.
 * Chamado no bootstrap do módulo (OnModuleInit).
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';

export interface MibSeedEntry {
  oid: string;
  name: string;
  description?: string;
}

/** Nomes canônicos das MIBs do bundle offline (fonte única). */
export const OFFLINE_MIB_LABELS = [
  'SNMPv2-MIB',
  'IF-MIB',
  'HOST-RESOURCES-MIB',
  'UCD-SNMP-MIB',
  'ENTITY-MIB',
  'CONTROLID-MIB',
] as const;

export type OfflineMibLabel = typeof OFFLINE_MIB_LABELS[number];

// ─── Bundle de entradas por MIB ───────────────────────────────────────────────

const SNMPv2_MIB_ENTRIES: MibSeedEntry[] = [
  { oid: '1.3.6.1.2.1.1', name: 'system', description: 'System group' },
  { oid: '1.3.6.1.2.1.1.1.0', name: 'sysDescr', description: 'System description' },
  { oid: '1.3.6.1.2.1.1.2.0', name: 'sysObjectID', description: 'OID of the enterprise' },
  { oid: '1.3.6.1.2.1.1.3.0', name: 'sysUpTime', description: 'Time since last re-initialization (1/100s)' },
  { oid: '1.3.6.1.2.1.1.4.0', name: 'sysContact', description: 'Contact person' },
  { oid: '1.3.6.1.2.1.1.5.0', name: 'sysName', description: 'Hostname' },
  { oid: '1.3.6.1.2.1.1.6.0', name: 'sysLocation', description: 'Physical location' },
  { oid: '1.3.6.1.2.1.1.7.0', name: 'sysServices', description: 'Services bitmask' },
  { oid: '1.3.6.1.2.1.1.8.0', name: 'sysORLastChange', description: 'Last OR table change' },
  { oid: '1.3.6.1.2.1.1.9.1.2', name: 'sysORDescr', description: 'OR entry description' },
  { oid: '1.3.6.1.2.1.1.9.1.3', name: 'sysORUpTime', description: 'OR entry up time' },
  { oid: '1.3.6.1.6.3.1.1.4.1.0', name: 'snmpTrapOID', description: 'Trap OID' },
  { oid: '1.3.6.1.6.3.1.1.4.3.0', name: 'snmpTrapEnterprise', description: 'Trap enterprise OID' },
];

const IF_MIB_ENTRIES: MibSeedEntry[] = [
  { oid: '1.3.6.1.2.1.2', name: 'interfaces', description: 'Interfaces group' },
  { oid: '1.3.6.1.2.1.2.1.0', name: 'ifNumber', description: 'Number of interfaces' },
  { oid: '1.3.6.1.2.1.2.2', name: 'ifTable', description: 'Interface table' },
  { oid: '1.3.6.1.2.1.2.2.1.1', name: 'ifIndex', description: 'Interface index' },
  { oid: '1.3.6.1.2.1.2.2.1.2', name: 'ifDescr', description: 'Interface description' },
  { oid: '1.3.6.1.2.1.2.2.1.3', name: 'ifType', description: 'Interface type' },
  { oid: '1.3.6.1.2.1.2.2.1.4', name: 'ifMtu', description: 'Maximum transmission unit' },
  { oid: '1.3.6.1.2.1.2.2.1.5', name: 'ifSpeed', description: 'Bandwidth in bits per second' },
  { oid: '1.3.6.1.2.1.2.2.1.6', name: 'ifPhysAddress', description: 'Physical address' },
  { oid: '1.3.6.1.2.1.2.2.1.7', name: 'ifAdminStatus', description: 'Admin status' },
  { oid: '1.3.6.1.2.1.2.2.1.8', name: 'ifOperStatus', description: 'Operational status (1=up, 2=down)' },
  { oid: '1.3.6.1.2.1.2.2.1.9', name: 'ifLastChange', description: 'Last status change' },
  { oid: '1.3.6.1.2.1.2.2.1.10', name: 'ifInOctets', description: 'Bytes received' },
  { oid: '1.3.6.1.2.1.2.2.1.11', name: 'ifInUcastPkts', description: 'Unicast packets received' },
  { oid: '1.3.6.1.2.1.2.2.1.13', name: 'ifInDiscards', description: 'Inbound discarded packets' },
  { oid: '1.3.6.1.2.1.2.2.1.14', name: 'ifInErrors', description: 'Inbound errors' },
  { oid: '1.3.6.1.2.1.2.2.1.16', name: 'ifOutOctets', description: 'Bytes sent' },
  { oid: '1.3.6.1.2.1.2.2.1.17', name: 'ifOutUcastPkts', description: 'Unicast packets sent' },
  { oid: '1.3.6.1.2.1.2.2.1.19', name: 'ifOutDiscards', description: 'Outbound discarded packets' },
  { oid: '1.3.6.1.2.1.2.2.1.20', name: 'ifOutErrors', description: 'Outbound errors' },
  { oid: '1.3.6.1.2.1.31.1.1.1.1', name: 'ifName', description: 'Interface name (ifXTable)' },
  { oid: '1.3.6.1.2.1.31.1.1.1.6', name: 'ifHCInOctets', description: 'HC bytes received' },
  { oid: '1.3.6.1.2.1.31.1.1.1.10', name: 'ifHCOutOctets', description: 'HC bytes sent' },
  { oid: '1.3.6.1.2.1.31.1.1.1.15', name: 'ifHighSpeed', description: 'Interface speed (Mbps)' },
  { oid: '1.3.6.1.2.1.31.1.1.1.18', name: 'ifAlias', description: 'Interface alias' },
];

const HOST_RESOURCES_MIB_ENTRIES: MibSeedEntry[] = [
  { oid: '1.3.6.1.2.1.25.1', name: 'hrSystem', description: 'Host system group' },
  { oid: '1.3.6.1.2.1.25.1.1.0', name: 'hrSystemUptime', description: 'System uptime' },
  { oid: '1.3.6.1.2.1.25.1.2.0', name: 'hrSystemDate', description: 'System date/time' },
  { oid: '1.3.6.1.2.1.25.1.5.0', name: 'hrSystemNumUsers', description: 'Number of users' },
  { oid: '1.3.6.1.2.1.25.1.6.0', name: 'hrSystemProcesses', description: 'Number of processes' },
  { oid: '1.3.6.1.2.1.25.2', name: 'hrStorage', description: 'Storage group' },
  { oid: '1.3.6.1.2.1.25.2.2.0', name: 'hrMemorySize', description: 'Total RAM in kB' },
  { oid: '1.3.6.1.2.1.25.2.3', name: 'hrStorageTable', description: 'Storage table' },
  { oid: '1.3.6.1.2.1.25.2.3.1.1', name: 'hrStorageIndex', description: 'Storage index' },
  { oid: '1.3.6.1.2.1.25.2.3.1.2', name: 'hrStorageType', description: 'Storage type OID' },
  { oid: '1.3.6.1.2.1.25.2.3.1.3', name: 'hrStorageDescr', description: 'Storage description' },
  { oid: '1.3.6.1.2.1.25.2.3.1.4', name: 'hrStorageAllocationUnits', description: 'Allocation unit size' },
  { oid: '1.3.6.1.2.1.25.2.3.1.5', name: 'hrStorageSize', description: 'Storage size in units' },
  { oid: '1.3.6.1.2.1.25.2.3.1.6', name: 'hrStorageUsed', description: 'Storage used in units' },
  { oid: '1.3.6.1.2.1.25.3', name: 'hrDevice', description: 'Device group' },
  { oid: '1.3.6.1.2.1.25.3.3', name: 'hrProcessorTable', description: 'Processor table' },
  { oid: '1.3.6.1.2.1.25.3.3.1.2', name: 'hrProcessorLoad', description: 'CPU load % (last minute)' },
];

const UCD_SNMP_MIB_ENTRIES: MibSeedEntry[] = [
  { oid: '1.3.6.1.4.1.2021.4', name: 'memory', description: 'UCD memory group' },
  { oid: '1.3.6.1.4.1.2021.4.3.0', name: 'memTotalSwap', description: 'Total swap in kB' },
  { oid: '1.3.6.1.4.1.2021.4.4.0', name: 'memAvailSwap', description: 'Available swap in kB' },
  { oid: '1.3.6.1.4.1.2021.4.5.0', name: 'memTotalReal', description: 'Total RAM in kB' },
  { oid: '1.3.6.1.4.1.2021.4.6.0', name: 'memAvailReal', description: 'Available RAM in kB' },
  { oid: '1.3.6.1.4.1.2021.4.11.0', name: 'memTotalFree', description: 'Total free memory in kB' },
  { oid: '1.3.6.1.4.1.2021.4.14.0', name: 'memBuffer', description: 'Buffered memory in kB' },
  { oid: '1.3.6.1.4.1.2021.4.15.0', name: 'memCached', description: 'Cached memory in kB' },
  { oid: '1.3.6.1.4.1.2021.10', name: 'laTable', description: 'Load average table' },
  { oid: '1.3.6.1.4.1.2021.10.1.3.1', name: 'laLoad1', description: 'Load average 1 minute' },
  { oid: '1.3.6.1.4.1.2021.10.1.3.2', name: 'laLoad5', description: 'Load average 5 minutes' },
  { oid: '1.3.6.1.4.1.2021.10.1.3.3', name: 'laLoad15', description: 'Load average 15 minutes' },
  { oid: '1.3.6.1.4.1.2021.11', name: 'systemStats', description: 'System statistics' },
  { oid: '1.3.6.1.4.1.2021.11.9.0', name: 'ssCpuUser', description: 'CPU user time %' },
  { oid: '1.3.6.1.4.1.2021.11.10.0', name: 'ssCpuSystem', description: 'CPU system time %' },
  { oid: '1.3.6.1.4.1.2021.11.11.0', name: 'ssCpuIdle', description: 'CPU idle %' },
  { oid: '1.3.6.1.4.1.2021.11.50.0', name: 'ssCpuRawUser', description: 'CPU raw user ticks' },
  { oid: '1.3.6.1.4.1.2021.11.51.0', name: 'ssCpuRawNice', description: 'CPU raw nice ticks' },
  { oid: '1.3.6.1.4.1.2021.11.52.0', name: 'ssCpuRawSystem', description: 'CPU raw system ticks' },
  { oid: '1.3.6.1.4.1.2021.11.53.0', name: 'ssCpuRawIdle', description: 'CPU raw idle ticks' },
  { oid: '1.3.6.1.4.1.2021.13.16', name: 'lmTempSensorsTable', description: 'lm-sensors temperature table' },
  { oid: '1.3.6.1.4.1.2021.13.16.2', name: 'lmTempSensorsDevice', description: 'Temperature sensor entry' },
  { oid: '1.3.6.1.4.1.2021.13.16.2.1.2', name: 'lmTempSensorsDescr', description: 'Sensor description' },
  { oid: '1.3.6.1.4.1.2021.13.16.2.1.3', name: 'lmTempSensorsValue', description: 'Temperature in milli-°C' },
];

const ENTITY_MIB_ENTRIES: MibSeedEntry[] = [
  { oid: '1.3.6.1.2.1.47.1.1', name: 'entPhysicalTable', description: 'Physical entity table' },
  { oid: '1.3.6.1.2.1.47.1.1.1.1.2', name: 'entPhysicalDescr', description: 'Physical entity description' },
  { oid: '1.3.6.1.2.1.47.1.1.1.1.3', name: 'entPhysicalVendorType', description: 'Vendor type OID' },
  { oid: '1.3.6.1.2.1.47.1.1.1.1.4', name: 'entPhysicalContainedIn', description: 'Parent entity index' },
  { oid: '1.3.6.1.2.1.47.1.1.1.1.5', name: 'entPhysicalClass', description: 'Physical class (chassis/module/…)' },
  { oid: '1.3.6.1.2.1.47.1.1.1.1.7', name: 'entPhysicalName', description: 'Entity name' },
  { oid: '1.3.6.1.2.1.47.1.1.1.1.8', name: 'entPhysicalHardwareRev', description: 'Hardware revision' },
  { oid: '1.3.6.1.2.1.47.1.1.1.1.9', name: 'entPhysicalFirmwareRev', description: 'Firmware revision' },
  { oid: '1.3.6.1.2.1.47.1.1.1.1.10', name: 'entPhysicalSoftwareRev', description: 'Software revision' },
  { oid: '1.3.6.1.2.1.47.1.1.1.1.11', name: 'entPhysicalSerialNum', description: 'Serial number' },
  { oid: '1.3.6.1.2.1.47.1.1.1.1.12', name: 'entPhysicalMfgName', description: 'Manufacturer name' },
  { oid: '1.3.6.1.2.1.47.1.1.1.1.13', name: 'entPhysicalModelName', description: 'Model name' },
  { oid: '1.3.6.1.2.1.47.1.1.1.1.16', name: 'entPhysicalAssetID', description: 'Asset identifier' },
  { oid: '1.3.6.1.2.1.47.1.1.1.1.17', name: 'entPhysicalIsFRU', description: 'Is field-replaceable unit' },
  { oid: '1.3.6.1.2.1.47.1.1.1.1.18', name: 'entPhysicalMfgDate', description: 'Manufacturing date' },
  { oid: '1.3.6.1.2.1.47.1.1.1.1.19', name: 'entPhysicalUris', description: 'URIs for documentation' },
  { oid: '1.3.6.1.2.1.47.1.4.1', name: 'entLogicalDescr', description: 'Logical entity description' },
];

const CONTROLID_MIB_ENTRIES: MibSeedEntry[] = [
  { oid: '1.3.6.1.4.1.49617', name: 'controlId', description: 'Control iD enterprise root' },
  { oid: '1.3.6.1.4.1.49617.1', name: 'cidObjects', description: 'Control iD MIB objects' },
  { oid: '1.3.6.1.4.1.49617.1.1', name: 'cidSystem', description: 'System information' },
  { oid: '1.3.6.1.4.1.49617.1.1.1.0', name: 'cidFirmwareVersion', description: 'Firmware version string' },
  { oid: '1.3.6.1.4.1.49617.1.1.2.0', name: 'cidSerialNumber', description: 'Serial number' },
  { oid: '1.3.6.1.4.1.49617.1.1.3.0', name: 'cidLoadAverage', description: 'Load average (1/5/15 min)' },
  { oid: '1.3.6.1.4.1.49617.1.1.4.0', name: 'cidCpuUsage', description: 'CPU usage % (fw 5.13.9+)' },
  { oid: '1.3.6.1.4.1.49617.1.1.5.0', name: 'cidCpuTemperature', description: 'CPU temperature in milli-°C' },
  { oid: '1.3.6.1.4.1.49617.1.1.6.0', name: 'cidDeviceDateTime', description: 'Device date/time' },
  { oid: '1.3.6.1.4.1.49617.1.1.7.0', name: 'cidNtpEnabled', description: 'NTP enabled (TruthValue)' },
  { oid: '1.3.6.1.4.1.49617.1.1.8.0', name: 'cidNtpServers', description: 'NTP server list' },
  { oid: '1.3.6.1.4.1.49617.1.2', name: 'cidOperationMode', description: 'Operation mode settings' },
  { oid: '1.3.6.1.4.1.49617.1.2.1.0', name: 'cidOnlineModeEnabled', description: 'Online mode enabled' },
  { oid: '1.3.6.1.4.1.49617.1.2.2.0', name: 'cidDevicePort', description: 'Communication port' },
  { oid: '1.3.6.1.4.1.49617.1.3', name: 'cidAntipassback', description: 'Anti-passback settings' },
  { oid: '1.3.6.1.4.1.49617.1.3.1.0', name: 'cidAntipassbackEnabled', description: 'Anti-passback enabled' },
  { oid: '1.3.6.1.4.1.49617.1.3.2.0', name: 'cidAntipassbackTimeout', description: 'Anti-passback timeout in seconds' },
  { oid: '1.3.6.1.4.1.49617.1.3.3.0', name: 'cidAntipassbackMode', description: 'Anti-passback mode' },
  { oid: '1.3.6.1.4.1.49617.1.4', name: 'cidNetwork', description: 'Network settings' },
  { oid: '1.3.6.1.4.1.49617.1.4.1.0', name: 'cidDhcpEnabled', description: 'DHCP enabled' },
  { oid: '1.3.6.1.4.1.49617.1.4.2', name: 'cidIfDuplex', description: 'Interface duplex mode table' },
  { oid: '1.3.6.1.4.1.49617.1.5', name: 'cidBuzzer', description: 'Buzzer settings' },
  { oid: '1.3.6.1.4.1.49617.1.6', name: 'cidSip', description: 'SIP intercom settings' },
  { oid: '1.3.6.1.4.1.49617.1.6.1.0', name: 'cidSipEnabled', description: 'SIP enabled (TruthValue)' },
  { oid: '1.3.6.1.4.1.49617.1.7', name: 'cidApplication', description: 'Application (users/identification)' },
  { oid: '1.3.6.1.4.1.49617.1.8', name: 'cidRtsp', description: 'RTSP video streaming' },
  { oid: '1.3.6.1.4.1.49617.1.9', name: 'cidAlarms', description: 'Device alarms' },
  { oid: '1.3.6.1.4.1.49617.1.9.1.0', name: 'cidDoorSensorAlarmEnabled', description: 'Door sensor alarm enabled' },
  { oid: '1.3.6.1.4.1.49617.1.9.7.0', name: 'cidDeviceViolationAlarmEnabled', description: 'Device violation alarm enabled' },
  { oid: '1.3.6.1.4.1.49617.1.10', name: 'cidSecBox', description: 'SecBox door module' },
];

/** Bundle completo de entradas por label de MIB. */
export const OFFLINE_MIB_BUNDLE: Record<OfflineMibLabel, MibSeedEntry[]> = {
  'SNMPv2-MIB': SNMPv2_MIB_ENTRIES,
  'IF-MIB': IF_MIB_ENTRIES,
  'HOST-RESOURCES-MIB': HOST_RESOURCES_MIB_ENTRIES,
  'UCD-SNMP-MIB': UCD_SNMP_MIB_ENTRIES,
  'ENTITY-MIB': ENTITY_MIB_ENTRIES,
  'CONTROLID-MIB': CONTROLID_MIB_ENTRIES,
};

@Injectable()
export class SnmpMibSeedService implements OnModuleInit {
  private readonly logger = new Logger(SnmpMibSeedService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    // Seed é melhor-esforço: falha aqui (tabela não criada ainda, migration
    // pendente) não deve impedir o startup do módulo.
    try {
      await this.seedOfflineMibs();
    } catch (err) {
      this.logger.warn(
        `Seed de MIBs offline falhou (não bloqueia startup): ${(err as Error).message}`,
      );
    }
  }

  /**
   * Semente as MIBs offline na tabela snmp_mibs.
   * Idempotente: verifica pelo label antes de inserir.
   */
  async seedOfflineMibs(): Promise<void> {
    // Verifica se a tabela existe antes de tentar acessá-la
    // (migration pode ainda não ter sido aplicada).
    let existing: Array<{ label: string }>;
    try {
      existing = await this.prisma.snmpMib.findMany({
        select: { label: true },
      });
    } catch {
      this.logger.warn('Tabela snmp_mibs não encontrada — seed adiado para após migration');
      return;
    }
    const existingLabels = new Set(existing.map((m) => m.label));

    let seeded = 0;
    for (const label of OFFLINE_MIB_LABELS) {
      if (existingLabels.has(label)) continue;
      const entries = OFFLINE_MIB_BUNDLE[label];
      await this.prisma.snmpMib.create({
        data: {
          label,
          sourceFilename: `${label}.mib`,
          entries: entries as unknown as import('@prisma/client').Prisma.JsonArray,
        },
      });
      seeded++;
      this.logger.log(`MIB offline semeada: ${label} (${entries.length} entradas)`);
    }
    if (seeded === 0) {
      this.logger.debug('MIBs offline já presentes — seed ignorado');
    }
  }

  /**
   * Resolve o nome de um OID a partir do bundle offline.
   * Retorna 'Unknown OID {oid}' se não encontrado (nunca o número cru em
   * saídas não-avançadas).
   */
  resolveOidName(oid: string, advanced = false): string {
    // Tenta match exato primeiro.
    for (const entries of Object.values(OFFLINE_MIB_BUNDLE)) {
      const exact = entries.find((e) => e.oid === oid);
      if (exact) return exact.name;
    }
    // Prefixo mais longo (para instâncias de tabela, ex.: ifDescr.1).
    let bestMatch: MibSeedEntry | null = null;
    let bestLen = 0;
    for (const entries of Object.values(OFFLINE_MIB_BUNDLE)) {
      for (const e of entries) {
        if (oid.startsWith(`${e.oid}.`) && e.oid.length > bestLen) {
          bestMatch = e;
          bestLen = e.oid.length;
        }
      }
    }
    if (bestMatch) {
      const suffix = oid.slice(bestMatch.oid.length + 1);
      return `${bestMatch.name}.${suffix}`;
    }
    // Desconhecido: retorna rótulo amigável ou OID bruto (somente no modo avançado).
    return advanced ? oid : `Unknown OID ${oid}`;
  }
}
