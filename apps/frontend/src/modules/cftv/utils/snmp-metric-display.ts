/**
 * Texto seguro para a seleção metric-first: identificadores numéricos SNMP
 * pertencem exclusivamente à área técnica "Avançado".
 */
export function safeSnmpCandidateLabel(label: string | null | undefined): string {
  const normalized = label?.trim() ?? '';
  return normalized && !/^\d[\d.]+$/.test(normalized)
    ? normalized
    : 'Fonte desconhecida';
}