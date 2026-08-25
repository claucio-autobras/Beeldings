/**
 * Serviço de administração de MIBs SNMP.
 * Permite importar, listar e remover arquivos MIB para resolução de OIDs.
 */
import { apiDelete, apiGet, apiPost } from '@/lib/api-client';

export interface SnmpMibSummary {
  id: string;
  label: string;
  sourceFilename: string | null;
  manufacturer: string | null;
  isOffline: boolean;
  entryCount: number;
  conflictCount: number;
  createdAt: string;
}

/** Lista todas as MIBs importadas. */
export async function listSnmpMibs(): Promise<SnmpMibSummary[]> {
  return apiGet<SnmpMibSummary[]>('/devices/snmp-mibs');
}

/** Importa e parseia um arquivo MIB ASN.1. */
export async function createSnmpMib(
  label: string,
  content: string,
  filename?: string,
  manufacturer?: string,
): Promise<SnmpMibSummary> {
  return apiPost<SnmpMibSummary>('/devices/snmp-mibs', {
    label,
    content,
    filename,
    manufacturer,
  });
}

/** Remove uma MIB pelo id. */
export async function deleteSnmpMib(id: string): Promise<void> {
  return apiDelete(`/devices/snmp-mibs/${id}`);
}
