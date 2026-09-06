/**
 * SnmpMibService — CRUD de arquivos MIB importados pelo admin.
 *
 * Responsabilidades:
 * - Persistir os mapeamentos OID→nome parseados no banco (snmp_mibs).
 * - Expor `enrichDiscovered` para o diagnóstico: adiciona `mibName` aos objetos
 *   descobertos cujo `known` ainda é null (a tabela semântica tem precedência).
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { parseMib, type MibEntry } from './snmp-mib-parser.util.js';
import type { DiscoveredSnmpObjectView } from './snmp-oid-semantics.js';
import { OFFLINE_MIB_BUNDLE } from './snmp-mib-seed.service.js';

@Injectable()
export class SnmpMibService {
  constructor(private readonly prisma: PrismaService) {}

  /** Parseia o conteúdo ASN.1 e persiste as entradas. Retorna o registro criado. */
  async create(label: string, content: string, sourceFilename?: string, manufacturer?: string) {
    const cleanLabel = label.trim();
    if (!cleanLabel) throw new Error('Informe um nome para a MIB.');
    if (!content.trim()) throw new Error('O conteúdo da MIB não pode estar vazio.');
    const entries = parseMib(content);
    if (entries.length === 0) {
      throw new Error('Nenhum OID válido foi encontrado no arquivo MIB.');
    }
    return this.prisma.snmpMib.create({
      data: {
        label: cleanLabel,
        manufacturer: manufacturer?.trim() || null,
        sourceFilename: sourceFilename ?? null,
        entries: entries as unknown as import('@prisma/client').Prisma.JsonArray,
      },
    });
  }

  /** Lista todas as MIBs cadastradas (sem os entries, para economia de banda). */
  async findAll() {
    const mibs = await this.prisma.snmpMib.findMany({
      orderBy: { createdAt: 'asc' },
    });
    return mibs.map((m) => ({
      id: m.id,
      label: m.label,
      sourceFilename: m.sourceFilename,
      manufacturer: m.manufacturer,
      isOffline: m.isOffline,
      entryCount: (m.entries as unknown as MibEntry[]).length,
      conflictCount: 0,
      createdAt: m.createdAt,
    }));
  }

  /** Remove uma MIB pelo id. Retorna null se não existir. */
  async remove(id: string) {
    try {
      return await this.prisma.snmpMib.delete({ where: { id } });
    } catch {
      return null;
    }
  }

  /**
   * Enriquece a lista de objetos descobertos com nomes da MIB.
   *
   * Para cada objeto onde `known` é null, busca o OID exato ou o prefixo mais
   * longo nas MIBs cadastradas e preenche `mibName`. A ordem das MIBs determina
   * qual nome "ganha" em caso de sobreposição (primeira MIB encontrada vence).
   *
   * Deve ser chamado DEPOIS de `buildDiscoveredObjects` — a classificação
   * semântica (snmp-oid-semantics.ts) sempre tem precedência.
   */
  async enrichDiscovered(
    discovered: DiscoveredSnmpObjectView[],
    mibId?: string | null,
    manufacturer?: string | null,
  ): Promise<void> {
    // Se não há objetos desconhecidos, pular consulta ao banco.
    const unknownCount = discovered.filter((d) => d.known === null).length;
    if (unknownCount === 0) return;

    // Construir mapa OID→nome: seed offline (sempre disponível) + MIBs do banco.
    const exactMap = new Map<string, string>();

    // 1. Bundle offline (resolução local sem banco).
    for (const entries of Object.values(OFFLINE_MIB_BUNDLE)) {
      for (const e of entries) {
        if (!exactMap.has(e.oid)) {
          exactMap.set(e.oid, e.name);
        }
      }
    }

    // 2. MIBs importadas pelo admin (podem sobrescrever o bundle offline se
    //    houver conflito de OID — o admin tem precedência).
    let dbMibs: Array<{
      id: string;
      entries: unknown;
      label: string;
      manufacturer: string | null;
      isOffline: boolean;
    }> = [];
    try {
      const imported = await this.prisma.snmpMib.findMany({
        orderBy: { createdAt: 'asc' },
        select: { id: true, entries: true, label: true, manufacturer: true, isOffline: true },
      });
      const wantedManufacturer = normalizeMibContext(manufacturer);
      // A legacy explicit link remains valid even when its manufacturer
      // metadata is absent or differs. New devices use every imported MIB
      // belonging to the selected manufacturer as one deterministic set.
      dbMibs = imported.filter((m) =>
        m.isOffline ||
        (mibId && m.id === mibId) ||
        (Boolean(wantedManufacturer) &&
          normalizeMibContext(m.manufacturer) === wantedManufacturer),
      );
    } catch {
      // Tabela ainda não criada (migration pendente) — usa só o bundle offline.
    }
    const importedMib = dbMibs.find((m) => !m.isOffline);
    const mibSource = importedMib?.label ?? (dbMibs.length > 0 ? 'MIB padrão/offline' : null);
    for (const mib of dbMibs) {
      const entries = mib.entries as unknown as MibEntry[];
      for (const e of entries) {
         exactMap.set(e.oid, e.name); // DB overrides bundle
      }
    }

    // Prefixos ordenados por comprimento decrescente para longest-prefix match.
    const prefixList: Array<{ oid: string; name: string }> = [...exactMap].map(
      ([oid, name]) => ({ oid, name }),
    );
    prefixList.sort((a, b) => b.oid.length - a.oid.length);

    for (const obj of discovered) {
      if (obj.known !== null) continue; // semântica tem precedência

      // Tentativa 1: match exato
      const exact = exactMap.get(obj.oid);
      if (exact) {
        obj.mibName = exact;
        obj.mibSource = mibSource;
        continue;
      }

      // Tentativa 2: OID é instância de uma entrada de tabela (prefixo + .n)
      for (const p of prefixList) {
        if (obj.oid.startsWith(`${p.oid}.`)) {
          obj.mibName = p.name;
          obj.mibSource = mibSource;
          break;
        }
      }
    }
  }
}

/** Compara fabricante como contexto, não como nome de arquivo/MIB. */
function normalizeMibContext(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}
