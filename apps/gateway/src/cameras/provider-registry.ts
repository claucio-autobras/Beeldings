/**
 * Registro de providers de telemetria de câmera por fabricante.
 *
 * O motor genérico (camera-telemetry.engine) consulta ESTE registro — nunca
 * lógica por marca espalhada. Adicionar um fabricante novo = adicionar uma
 * entrada aqui (OIDs, sentinelas, fallback HTTP), sem tocar no motor.
 *
 * Camadas do pipeline (tentadas em ordem, por campo):
 *   1. MIB-II padrão (LAYER1_OIDS) — universal, sempre tentada primeiro;
 *   2. Provider específico (SNMP enterprise e/ou API HTTP como ISAPI);
 *   3. Fallback sintético do sistema (ping/uptime estimado) — qualquer marca.
 */

/** Métrica canônica de um campo de provider. */
export type ProviderMetric =
  | 'cpu'
  | 'memory'
  | 'ram_total'
  | 'storage'
  | 'temperature'
  | 'packet_loss'
  | 'uptime';

export interface ProviderField {
  metric: ProviderMetric;
  oid: string;
  /** Fator aplicado ao valor cru (ex.: 0.01 p/ TimeTicks → segundos). */
  scale?: number;
  /**
   * Valores-sentinela de bug conhecido do firmware (ex.: campo que responde
   * sempre 0/vazio). Valor igual a uma sentinela → "dado não confiável".
   */
  sentinels?: number[];
}

export interface CameraProvider {
  id: string;
  label: string;
  /** Substrings (lowercase) casadas contra fabricante manual / sysDescr. */
  match: string[];
  /** Números enterprise (1.3.6.1.4.1.N) que identificam a marca no walk. */
  enterpriseNumbers: number[];
  /**
   * Melhor-esforço: a árvore SNMP é "emprestada" de outra marca (ex.:
   * Intelbras usa a árvore Dahua) — valida sentinelas e nunca deixa a falha
   * de um campo derrubar os demais.
   */
  bestEffort?: boolean;
  /** Campos SNMP enterprise da marca (Camada 2). */
  fields: ProviderField[];
  /** Fallback HTTP proprietário para uptime real (Camada 2). */
  httpUptime?: 'isapi' | null;
}

/** OIDs MIB-II universais (Camada 1) — tentados SEMPRE, qualquer marca. */
export const LAYER1_OIDS = {
  sysDescr: '1.3.6.1.2.1.1.1.0',
  sysObjectId: '1.3.6.1.2.1.1.2.0',
  /** TimeTicks (centésimos de segundo) — scale 0.01 → segundos. */
  sysUpTime: '1.3.6.1.2.1.1.3.0',
  ifInDiscards: '1.3.6.1.2.1.2.2.1.13.1',
  ifInErrors: '1.3.6.1.2.1.2.2.1.14.1',
} as const;

/**
 * Árvore enterprise Dahua/Intelbras (indistinguíveis só por SNMP).
 *
 * OIDs OFICIAIS da doc "Dahua Product Management Information Library"
 * (root 1.3.6.1.4.1.1004849.2): cpuUsage 2.1.3.0 (escalar 0–100),
 * memoryInfo.memoryUsage 2.1.9.2.0 (0–100 %).
 * A doc oficial NÃO define objeto de temperatura — campo removido (os OIDs
 * antigos 2.1.3.X.1.1 vinham de dumps comunitários e contradizem a doc:
 * 2.1.3 é um escalar, não uma tabela).
 */
const DAHUA_TREE_FIELDS: ProviderField[] = [
  { metric: 'cpu', oid: '1.3.6.1.4.1.1004849.2.1.3.0' },
  { metric: 'memory', oid: '1.3.6.1.4.1.1004849.2.1.9.2.0' },
];

export const CAMERA_PROVIDERS: CameraProvider[] = [
  {
    id: 'hikvision',
    label: 'Hikvision',
    match: ['hikvision'],
    enterpriseNumbers: [39165],
    fields: [
      { metric: 'cpu', oid: '1.3.6.1.4.1.39165.1.7.0' },
      { metric: 'memory', oid: '1.3.6.1.4.1.39165.1.11.0' },
      { metric: 'ram_total', oid: '1.3.6.1.4.1.39165.1.10.0' },
      { metric: 'storage', oid: '1.3.6.1.4.1.39165.1.9.0' },
    ],
    // Uptime real via GET /ISAPI/System/status (digest) — prioridade sobre
    // a estimativa da Camada 3.
    httpUptime: 'isapi',
  },
  {
    id: 'dahua',
    label: 'Dahua',
    match: ['dahua'],
    enterpriseNumbers: [1004849],
    fields: DAHUA_TREE_FIELDS,
  },
  {
    id: 'intelbras',
    label: 'Intelbras',
    match: ['intelbras'],
    enterpriseNumbers: [1004849],
    // Firmware Intelbras deriva do Dahua — mesma árvore, em melhor-esforço:
    // bugs conhecidos respondem 0 fixo em campos válidos → sentinela marca
    // "dado não confiável" em vez de exibir um zero falso.
    bestEffort: true,
    fields: DAHUA_TREE_FIELDS.map((f) =>
      f.metric === 'cpu' || f.metric === 'memory'
        ? { ...f, sentinels: [0] }
        : f,
    ),
  },
];

/** Extrai o número enterprise de um OID `1.3.6.1.4.1.N...` (null se não for). */
export function enterpriseNumberOf(oid: string | null | undefined): number | null {
  if (!oid) return null;
  const m = /^1\.3\.6\.1\.4\.1\.(\d+)/.exec(oid.trim());
  return m ? Number(m[1]) : null;
}

/**
 * Identificação automática do fabricante, na ordem de precedência:
 *   1. Config manual do cadastro (manufacturer);
 *   2. sysDescr / sysObjectID lidos da câmera;
 *   3. Número enterprise dos OIDs já cadastrados (substituto do walk).
 * Empate Dahua×Intelbras por enterprise (1004849): sem cadastro manual,
 * resolve como Intelbras (modo melhor-esforço protege ambas as marcas).
 * Sem identificação → null (motor vai direto à Camada 3).
 */
export function resolveProvider(input: {
  manufacturer?: string | null;
  sysDescr?: string | null;
  sysObjectId?: string | null;
  pointOids?: Array<string | null | undefined>;
}): CameraProvider | null {
  const byText = (text: string | null | undefined): CameraProvider | null => {
    const t = (text ?? '').toLowerCase();
    if (!t) return null;
    return CAMERA_PROVIDERS.find((p) => p.match.some((m) => t.includes(m))) ?? null;
  };

  const manual = byText(input.manufacturer);
  if (manual) return manual;

  const bySys = byText(input.sysDescr);
  if (bySys) return bySys;

  const enterprises = new Set<number>();
  const sysEnt = enterpriseNumberOf(input.sysObjectId);
  if (sysEnt !== null) enterprises.add(sysEnt);
  for (const oid of input.pointOids ?? []) {
    const n = enterpriseNumberOf(oid);
    if (n !== null) enterprises.add(n);
  }
  for (const n of enterprises) {
    if (n === 1004849) {
      // Ambíguo Dahua/Intelbras sem cadastro manual → melhor-esforço (Intelbras).
      return CAMERA_PROVIDERS.find((p) => p.id === 'intelbras') ?? null;
    }
    const p = CAMERA_PROVIDERS.find((pr) => pr.enterpriseNumbers.includes(n));
    if (p) return p;
  }
  return null;
}
