/**
 * Camada de interpretação semântica de OIDs descobertos no walk SNMP.
 *
 * Arquitetura (spec de descoberta robusta): primeiro DESCOBRIR (walk genérico
 * no gateway → OID, tipo, valor bruto, valor normalizado, índice), depois
 * INTERPRETAR (este módulo: OID → nome → categoria → unidade → métrica
 * normalizada). OIDs sem correspondência NUNCA são descartados — viram
 * "OID desconhecido" selecionável e classificável depois.
 *
 * O conhecimento por fabricante é ADITIVO: cada entrada casa por OID exato ou
 * por prefixo, sem nenhum ramo condicional por marca. Uma MIB instalada pode
 * enriquecer esta tabela no futuro; o fallback numérico é o comportamento
 * padrão (Requisito 4 da spec).
 *
 * PLAUSIBILIDADE (proteção contra deslocamento de árvore entre firmwares):
 * mapear por posição de OID pode quebrar quando um firmware omite um objeto
 * (ex.: iDFlex fw 5.13.9 não expõe hasProVersion e desloca cidSystem em um
 * índice vs a doc oficial). Por isso cada entrada pode declarar o tipo ASN.1
 * e o padrão/faixa esperados do valor real; leitura incompatível NÃO recebe o
 * rótulo — vira "não confirmado" (nome sugerido, sem métrica canônica).
 */

/** Categorias de classificação (Requisito 5 da spec + subárvores de campo). */
export type SnmpSemanticCategory =
  | 'identification'
  | 'performance'
  | 'hardware'
  | 'system'
  | 'network'
  | 'storage'
  | 'security'
  | 'application';

/** Rótulos pt-BR das categorias (fonte única p/ payloads de card e UI). */
export const SNMP_CATEGORY_LABELS: Record<SnmpSemanticCategory, string> = {
  identification: 'Identificação',
  performance: 'Desempenho',
  hardware: 'Hardware',
  system: 'Sistema',
  network: 'Rede',
  storage: 'Armazenamento',
  security: 'Segurança',
  application: 'Aplicação',
};

/** Importância p/ ordenação/destaque nos cards (default: 'secondary'). */
export type SnmpImportance = 'primary' | 'secondary' | 'info';

/** Padrões de valor verificáveis sem conhecer o fabricante. */
export type SnmpValuePattern =
  | 'percent' // numérico 0–100
  | 'loadavg' // "1.42 1.17 0.73" (2–3 números)
  | 'datetime' // contém padrão de data
  | 'numeric' // qualquer número finito
  | 'boolean-int' // INTEGER 0/1/2 (SNMP TruthValue-like)
  | 'nonempty-text';

export interface SnmpValueExpectation {
  /** Tipos ASN.1 aceitos (case-insensitive). 'Unknown'/vazio sempre passa. */
  types?: string[];
  pattern?: SnmpValuePattern;
  /** Faixa aplicada ao valor numérico APÓS o scale da entrada. */
  min?: number;
  max?: number;
}

export interface SnmpOidSemantic {
  /** OID exato (escalares) OU prefixo com `.` implícito p/ instâncias. */
  oid: string;
  /** true → casa qualquer instância sob o prefixo (tabelas/índices). */
  prefix?: boolean;
  /** Nome legível em pt-BR. */
  name: string;
  category: SnmpSemanticCategory;
  /**
   * Métrica normalizada interna (modelo canônico — ex.: OIDs diferentes de
   * CPU em fabricantes diferentes → mesma métrica 'cpu_usage').
   */
  metricKey?: string;
  unit?: string;
  /** Fator valor cru → unidade exibida (ex.: 0.001 p/ mili-°C → °C). */
  scale?: number;
  /** Natureza do valor p/ exibição ('number' default; texto/booleano viram informação). */
  valueKind?: 'number' | 'text' | 'boolean';
  importance?: SnmpImportance;
  /** Validação de plausibilidade contra o valor real lido. */
  expect?: SnmpValueExpectation;
}

/**
 * Tabela semântica global — MIB-II padrão + fabricantes confirmados em campo.
 * Entradas EXATAS devem vir antes de entradas de prefixo da mesma subárvore
 * (a classificação percorre em ordem).
 *
 * Control iD (enterprise 49617): significados validados contra a MIB oficial
 * (CONTROLID-MIB, 10 subárvores sob …49617.1) E a árvore REAL do fw 5.13.9.
 * O fw 5.13.9 NÃO expõe hasProVersion → cidSystem deslocada em um índice vs a
 * doc; os OIDs abaixo seguem o fw real e as expectativas de valor protegem
 * contra firmwares com o layout da doc (valor incompatível → não confirmado).
 */
export const SNMP_OID_SEMANTICS: SnmpOidSemantic[] = [
  // ── MIB-II system (universal) ─────────────────────────────────────────────
  { oid: '1.3.6.1.2.1.1.1.0', name: 'Descrição do sistema (sysDescr)', category: 'identification', valueKind: 'text', importance: 'info' },
  { oid: '1.3.6.1.2.1.1.2.0', name: 'Identificador do fabricante (sysObjectID)', category: 'identification', valueKind: 'text', importance: 'info' },
  { oid: '1.3.6.1.2.1.1.3.0', name: 'Tempo ligado (sysUpTime)', category: 'system', metricKey: 'uptime', unit: 's', importance: 'secondary' },
  { oid: '1.3.6.1.2.1.1.4.0', name: 'Contato (sysContact)', category: 'identification', valueKind: 'text', importance: 'info' },
  { oid: '1.3.6.1.2.1.1.5.0', name: 'Nome do equipamento (sysName)', category: 'identification', valueKind: 'text', importance: 'info' },
  { oid: '1.3.6.1.2.1.1.6.0', name: 'Localização (sysLocation)', category: 'identification', valueKind: 'text', importance: 'info' },
  // ── MIB-II interfaces (universal, indexado) ───────────────────────────────
  { oid: '1.3.6.1.2.1.2.1.0', name: 'Número de interfaces (ifNumber)', category: 'network', importance: 'info' },
  { oid: '1.3.6.1.2.1.2.2.1.2', prefix: true, name: 'Interface — descrição (ifDescr)', category: 'network', valueKind: 'text', importance: 'info' },
  { oid: '1.3.6.1.2.1.2.2.1.8', prefix: true, name: 'Interface — status operacional (ifOperStatus)', category: 'network', metricKey: 'if_oper_status', importance: 'secondary' },
  { oid: '1.3.6.1.2.1.2.2.1.10', prefix: true, name: 'Interface — bytes recebidos (ifInOctets)', category: 'network', metricKey: 'if_in_octets', unit: 'B', importance: 'secondary' },
  { oid: '1.3.6.1.2.1.2.2.1.13', prefix: true, name: 'Interface — descartes de entrada (ifInDiscards)', category: 'network', metricKey: 'packet_loss', unit: 'pkts', importance: 'primary' },
  { oid: '1.3.6.1.2.1.2.2.1.14', prefix: true, name: 'Interface — erros de entrada (ifInErrors)', category: 'network', metricKey: 'packet_loss', unit: 'pkts', importance: 'secondary' },
  { oid: '1.3.6.1.2.1.2.2.1.16', prefix: true, name: 'Interface — bytes enviados (ifOutOctets)', category: 'network', metricKey: 'if_out_octets', unit: 'B', importance: 'secondary' },
  // ── HOST-RESOURCES (universal) ────────────────────────────────────────────
  { oid: '1.3.6.1.2.1.25.3.3.1.2', prefix: true, name: 'CPU — carga por processador (hrProcessorLoad)', category: 'performance', metricKey: 'cpu_usage', unit: '%', importance: 'primary', expect: { pattern: 'percent' } },
  { oid: '1.3.6.1.2.1.25.2.2.0', name: 'Memória RAM total (hrMemorySize)', category: 'performance', metricKey: 'ram_total', unit: 'bytes', scale: 1024, importance: 'secondary' },
  // ── UCD-SNMP (Linux embarcado) ────────────────────────────────────────────
  { oid: '1.3.6.1.4.1.2021.4.6.0', name: 'Memória disponível (memAvailReal)', category: 'performance', metricKey: 'memory_available', unit: 'kB', importance: 'primary' },
  { oid: '1.3.6.1.4.1.2021.10.1.3.1', name: 'Load average 1 min', category: 'performance', metricKey: 'load_average', importance: 'secondary' },
  { oid: '1.3.6.1.4.1.2021.13.16.2.1.3.1', name: 'Temperatura (lm-sensors)', category: 'hardware', metricKey: 'temperature', unit: '°C', scale: 0.001, importance: 'primary', expect: { pattern: 'numeric', min: -40, max: 150 } },
  // ── Control iD (enterprise 49617) — cidSystem, layout do fw 5.13.9 ───────
  { oid: '1.3.6.1.4.1.49617.1.1.1.0', name: 'Versão de firmware', category: 'identification', metricKey: 'firmware_version', valueKind: 'text', importance: 'info', expect: { pattern: 'nonempty-text' } },
  { oid: '1.3.6.1.4.1.49617.1.1.2.0', name: 'Número de série', category: 'identification', metricKey: 'serial_number', valueKind: 'text', importance: 'info', expect: { pattern: 'nonempty-text' } },
  { oid: '1.3.6.1.4.1.49617.1.1.3.0', name: 'Load average (1/5/15 min)', category: 'performance', metricKey: 'load_average', valueKind: 'text', importance: 'secondary', expect: { pattern: 'loadavg' } },
  // fw 5.13.9: cpuUsage em .4 (STRING "23.436" = 23,4 %). Em firmwares com o
  // layout da doc (.4 = loadAverage) o padrão 'percent' falha → não confirmado.
  { oid: '1.3.6.1.4.1.49617.1.1.4.0', name: 'Uso de CPU', category: 'performance', metricKey: 'cpu_usage', unit: '%', importance: 'primary', expect: { pattern: 'percent' } },
  // fw 5.13.9: cpuTemperature em .5 (Gauge32 em mili-°C, ex.: 91991 → 91,99 °C).
  { oid: '1.3.6.1.4.1.49617.1.1.5.0', name: 'Temperatura da CPU', category: 'hardware', metricKey: 'temperature', unit: '°C', scale: 0.001, importance: 'primary', expect: { types: ['Gauge32', 'Unsigned32', 'Integer', 'Counter32'], pattern: 'numeric', min: 1, max: 150 } },
  { oid: '1.3.6.1.4.1.49617.1.1.6.0', name: 'Data/hora do equipamento', category: 'system', metricKey: 'device_datetime', valueKind: 'text', importance: 'info', expect: { pattern: 'datetime' } },
  { oid: '1.3.6.1.4.1.49617.1.1.7.0', name: 'NTP habilitado', category: 'system', metricKey: 'ntp_enabled', valueKind: 'boolean', importance: 'info', expect: { pattern: 'boolean-int' } },
  { oid: '1.3.6.1.4.1.49617.1.1.8.0', name: 'Servidores NTP', category: 'system', metricKey: 'ntp_servers', valueKind: 'text', importance: 'info' },
  // ── Control iD — cidOperationMode ─────────────────────────────────────────
  { oid: '1.3.6.1.4.1.49617.1.2.1.0', name: 'Modo online habilitado', category: 'system', metricKey: 'device_online_mode', valueKind: 'boolean', importance: 'info', expect: { pattern: 'boolean-int' } },
  { oid: '1.3.6.1.4.1.49617.1.2.2.0', name: 'Porta de comunicação do equipamento', category: 'network', metricKey: 'device_port', importance: 'info', expect: { pattern: 'numeric', min: 1, max: 65535 } },
  // ── Control iD — cidAntipassback ──────────────────────────────────────────
  { oid: '1.3.6.1.4.1.49617.1.3.1.0', name: 'Anti-passback habilitado', category: 'security', metricKey: 'antipassback_enabled', valueKind: 'boolean', importance: 'info', expect: { pattern: 'boolean-int' } },
  { oid: '1.3.6.1.4.1.49617.1.3.2.0', name: 'Anti-passback — tempo limite', category: 'security', metricKey: 'antipassback_timeout', unit: 's', importance: 'info', expect: { pattern: 'numeric', min: 0 } },
  { oid: '1.3.6.1.4.1.49617.1.3.3.0', name: 'Anti-passback — modo', category: 'security', metricKey: 'antipassback_mode', valueKind: 'text', importance: 'info' },
  // ── Control iD — cidNetwork ───────────────────────────────────────────────
  { oid: '1.3.6.1.4.1.49617.1.4.1.0', name: 'DHCP habilitado', category: 'network', metricKey: 'dhcp_enabled', valueKind: 'boolean', importance: 'info', expect: { pattern: 'boolean-int' } },
  { oid: '1.3.6.1.4.1.49617.1.4.2', prefix: true, name: 'Modo duplex da interface', category: 'network', metricKey: 'if_duplex', valueKind: 'text', importance: 'info' },
  // ── Control iD — demais subárvores da MIB oficial (informações nomeadas).
  // Layouts internos variam entre firmwares → nome no nível da subárvore, sem
  // métrica canônica (objetos individuais podem ser refinados via MIB).
  { oid: '1.3.6.1.4.1.49617.1.5', prefix: true, name: 'Avisos sonoros (buzzer)', category: 'system', importance: 'info' },
  { oid: '1.3.6.1.4.1.49617.1.6.1.0', name: 'Interfone SIP habilitado', category: 'application', metricKey: 'sip_enabled', valueKind: 'boolean', importance: 'info', expect: { pattern: 'boolean-int' } },
  { oid: '1.3.6.1.4.1.49617.1.6', prefix: true, name: 'Interfone SIP', category: 'application', importance: 'info' },
  { oid: '1.3.6.1.4.1.49617.1.7', prefix: true, name: 'Aplicação (usuários e identificação)', category: 'application', importance: 'info' },
  { oid: '1.3.6.1.4.1.49617.1.8', prefix: true, name: 'Streaming de vídeo (RTSP)', category: 'application', importance: 'info' },
  { oid: '1.3.6.1.4.1.49617.1.9.1.0', name: 'Alarme — sensor de porta habilitado', category: 'security', metricKey: 'door_sensor_alarm_enabled', valueKind: 'boolean', importance: 'info', expect: { pattern: 'boolean-int' } },
  { oid: '1.3.6.1.4.1.49617.1.9.7.0', name: 'Alarme — violação do equipamento habilitado', category: 'security', metricKey: 'device_violation_alarm_enabled', valueKind: 'boolean', importance: 'info', expect: { pattern: 'boolean-int' } },
  { oid: '1.3.6.1.4.1.49617.1.9', prefix: true, name: 'Alarmes do equipamento', category: 'security', importance: 'info' },
  { oid: '1.3.6.1.4.1.49617.1.10', prefix: true, name: 'SecBox (módulo de porta)', category: 'security', importance: 'info' },
  // ── Hikvision (enterprise 39165 — compartilhado câmeras/controladoras) ────
  { oid: '1.3.6.1.4.1.39165.1.7.0', name: 'Uso de CPU', category: 'performance', metricKey: 'cpu_usage', unit: '%', importance: 'primary', expect: { pattern: 'percent' } },
  { oid: '1.3.6.1.4.1.39165.1.11.0', name: 'Uso de memória', category: 'performance', metricKey: 'memory_usage', unit: '%', importance: 'primary', expect: { pattern: 'percent' } },
  { oid: '1.3.6.1.4.1.39165.1.10.0', name: 'Memória RAM total', category: 'performance', metricKey: 'ram_total', unit: 'MB', importance: 'secondary' },

  // ── Hikvision OFICIAL (HIKVISION-MIB, enterprise 50001, árvore hikEntity) ──
  // Fonte: MIB oficial fornecida pelo fabricante (hikEntity = 1.3.6.1.4.1.50001.1).
  // Escalares registrados com instância .0; colunas de tabela como prefixo.
  { oid: '1.3.6.1.4.1.50001.1.1.0', name: 'Endereço IP do equipamento', category: 'network', metricKey: 'device_ip', valueKind: 'text', importance: 'info', expect: { pattern: 'nonempty-text' } },
  { oid: '1.3.6.1.4.1.50001.1.2.0', name: 'Porta de gerenciamento', category: 'network', metricKey: 'device_port', importance: 'info', expect: { pattern: 'numeric', min: 1, max: 65535 } },
  { oid: '1.3.6.1.4.1.50001.1.3.0', name: 'Número de série', category: 'identification', metricKey: 'serial_number', valueKind: 'text', importance: 'info', expect: { pattern: 'nonempty-text' } },
  { oid: '1.3.6.1.4.1.50001.1.100.0', name: 'Tipo de produto (DVR/NVR/IPC)', category: 'identification', metricKey: 'product_type', importance: 'info' },
  { oid: '1.3.6.1.4.1.50001.1.101.0', name: 'Subtipo de produto', category: 'identification', metricKey: 'product_subtype', importance: 'info' },
  { oid: '1.3.6.1.4.1.50001.1.102.0', name: 'Equipamento online (hikOnline)', category: 'system', metricKey: 'device_online', valueKind: 'boolean', importance: 'secondary', expect: { pattern: 'boolean-int' } },
  { oid: '1.3.6.1.4.1.50001.1.103.0', name: 'Serviço Hikvision (hikService)', category: 'application', importance: 'info' },
  { oid: '1.3.6.1.4.1.50001.1.104.0', name: 'Tipo de definição CMS', category: 'application', importance: 'info' },
  { oid: '1.3.6.1.4.1.50001.1.105.0', name: 'Identificador do objeto (hikObjectID)', category: 'identification', valueKind: 'text', importance: 'info' },
  { oid: '1.3.6.1.4.1.50001.1.106.0', name: 'Nome do equipamento', category: 'identification', metricKey: 'device_name', valueKind: 'text', importance: 'info', expect: { pattern: 'nonempty-text' } },
  { oid: '1.3.6.1.4.1.50001.1.110.0', name: 'IP do host de traps', category: 'network', valueKind: 'text', importance: 'info' },
  { oid: '1.3.6.1.4.1.50001.1.200.0', name: 'Número de CPUs', category: 'hardware', metricKey: 'cpu_count', importance: 'info', expect: { pattern: 'numeric', min: 1, max: 128 } },
  { oid: '1.3.6.1.4.1.50001.1.201.0', name: 'Frequência da CPU', category: 'hardware', metricKey: 'cpu_frequency', valueKind: 'text', importance: 'info', expect: { pattern: 'nonempty-text' } },
  { oid: '1.3.6.1.4.1.50001.1.220.0', name: 'Memória RAM total', category: 'performance', metricKey: 'ram_total', unit: 'MB', importance: 'secondary', expect: { pattern: 'numeric', min: 1 } },
  { oid: '1.3.6.1.4.1.50001.1.221.0', name: 'Uso de memória', category: 'performance', metricKey: 'memory_usage', unit: '%', importance: 'primary', expect: { pattern: 'percent' } },
  { oid: '1.3.6.1.4.1.50001.1.230.0', name: 'Status do dispositivo (hikDeviceStatus)', category: 'system', metricKey: 'device_status', importance: 'secondary', expect: { pattern: 'numeric', min: 0 } },
  { oid: '1.3.6.1.4.1.50001.1.231.0', name: 'Idioma do dispositivo', category: 'system', importance: 'info' },
  { oid: '1.3.6.1.4.1.50001.1.240.0', name: 'Número de discos (hikDiskNum)', category: 'storage', metricKey: 'disk_count', importance: 'secondary', expect: { pattern: 'numeric', min: 0, max: 256 } },
  // hikDiskTable (50001.1.241.1.<col>.<índice>) — uma linha por disco.
  { oid: '1.3.6.1.4.1.50001.1.241.1.1', prefix: true, name: 'Disco — índice', category: 'storage', importance: 'info' },
  { oid: '1.3.6.1.4.1.50001.1.241.1.2', prefix: true, name: 'Disco — volume', category: 'storage', valueKind: 'text', importance: 'info' },
  { oid: '1.3.6.1.4.1.50001.1.241.1.3', prefix: true, name: 'Disco — status', category: 'storage', metricKey: 'disk_status_raw', importance: 'secondary', expect: { pattern: 'numeric', min: 0, max: 11 } },
  // Unidade oficial: MB ("if we get 100, means free space is 100M") → scale 0.001 → GB.
  { oid: '1.3.6.1.4.1.50001.1.241.1.4', prefix: true, name: 'Disco — espaço livre', category: 'storage', metricKey: 'disk_free', unit: 'GB', scale: 0.001, importance: 'secondary', expect: { pattern: 'numeric', min: 0 } },
  { oid: '1.3.6.1.4.1.50001.1.241.1.5', prefix: true, name: 'Disco — capacidade', category: 'storage', metricKey: 'disk_capacity', unit: 'GB', scale: 0.001, importance: 'secondary', expect: { pattern: 'numeric', min: 0 } },
  { oid: '1.3.6.1.4.1.50001.1', prefix: true, name: 'Hikvision — entidade (hikEntity)', category: 'system', importance: 'info' },

  // ── Dahua/Intelbras OFICIAL (root 1.3.6.1.4.1.1004849.2) ──────────────────
  // Fonte: doc oficial "Dahua Product Management Information Library".
  // (A sub-árvore …1004849.1 é do ipSAN — não usada por câmeras/NVR/DVR.)
  // systemInfo.versionInfo (2.1.1)
  { oid: '1.3.6.1.4.1.1004849.2.1.1.1.0', name: 'Versão de software', category: 'identification', metricKey: 'firmware_version', valueKind: 'text', importance: 'info', expect: { pattern: 'nonempty-text' } },
  { oid: '1.3.6.1.4.1.1004849.2.1.1.2.0', name: 'Versão de hardware', category: 'identification', valueKind: 'text', importance: 'info', expect: { pattern: 'nonempty-text' } },
  // systemInfo.productInfo (2.1.2)
  { oid: '1.3.6.1.4.1.1004849.2.1.2.1.0', name: 'Número de canais de vídeo', category: 'application', metricKey: 'video_channels', importance: 'secondary', expect: { pattern: 'numeric', min: 0, max: 1024 } },
  { oid: '1.3.6.1.4.1.1004849.2.1.2.2.0', name: 'Entradas de alarme', category: 'hardware', importance: 'info', expect: { pattern: 'numeric', min: 0 } },
  { oid: '1.3.6.1.4.1.1004849.2.1.2.3.0', name: 'Saídas de alarme', category: 'hardware', importance: 'info', expect: { pattern: 'numeric', min: 0 } },
  { oid: '1.3.6.1.4.1.1004849.2.1.2.4.0', name: 'Número de série', category: 'identification', metricKey: 'serial_number', valueKind: 'text', importance: 'info', expect: { pattern: 'nonempty-text' } },
  { oid: '1.3.6.1.4.1.1004849.2.1.2.5.0', name: 'Versão do sistema', category: 'identification', valueKind: 'text', importance: 'info' },
  { oid: '1.3.6.1.4.1.1004849.2.1.2.6.0', name: 'Tipo de equipamento', category: 'identification', metricKey: 'product_type', valueKind: 'text', importance: 'info' },
  { oid: '1.3.6.1.4.1.1004849.2.1.2.7.0', name: 'Classe do equipamento', category: 'identification', valueKind: 'text', importance: 'info' },
  { oid: '1.3.6.1.4.1.1004849.2.1.2.8.0', name: 'Status do dispositivo (0=ruim, 1=bom)', category: 'system', metricKey: 'device_status', valueKind: 'boolean', importance: 'secondary', expect: { pattern: 'boolean-int' } },
  { oid: '1.3.6.1.4.1.1004849.2.1.2.9.0', name: 'Nome da máquina', category: 'identification', metricKey: 'device_name', valueKind: 'text', importance: 'info' },
  { oid: '1.3.6.1.4.1.1004849.2.1.2.10.0', name: 'Localização', category: 'identification', valueKind: 'text', importance: 'info' },
  // cpuUsage (2.1.3) — ESCALAR oficial (os dumps comunitários 2.1.3.X.1.1 são inválidos).
  { oid: '1.3.6.1.4.1.1004849.2.1.3.0', name: 'Uso de CPU', category: 'performance', metricKey: 'cpu_usage', unit: '%', importance: 'primary', expect: { pattern: 'percent' } },
  { oid: '1.3.6.1.4.1.1004849.2.1.4.0', name: 'Último evento', category: 'system', valueKind: 'text', importance: 'info' },
  { oid: '1.3.6.1.4.1.1004849.2.1.5.0', name: 'Número de encoder', category: 'identification', valueKind: 'text', importance: 'info' },
  // deviceUpTime — TimeTicks (centésimos de segundo → scale 0.01 → s).
  { oid: '1.3.6.1.4.1.1004849.2.1.6.0', name: 'Tempo ligado do equipamento', category: 'system', metricKey: 'uptime', unit: 's', scale: 0.01, importance: 'secondary', expect: { pattern: 'numeric', min: 0 } },
  { oid: '1.3.6.1.4.1.1004849.2.1.7.0', name: 'Status do sistema', category: 'system', importance: 'info' },
  { oid: '1.3.6.1.4.1.1004849.2.1.8.0', name: 'Data/hora do sistema', category: 'system', metricKey: 'device_datetime', valueKind: 'text', importance: 'info', expect: { pattern: 'datetime' } },
  // memoryInfo (2.1.9) — memoryTotal sem unidade documentada (tratado como número puro).
  { oid: '1.3.6.1.4.1.1004849.2.1.9.1.0', name: 'Memória total', category: 'performance', importance: 'info', expect: { pattern: 'numeric', min: 0 } },
  { oid: '1.3.6.1.4.1.1004849.2.1.9.2.0', name: 'Uso de memória', category: 'performance', metricKey: 'memory_usage', unit: '%', importance: 'primary', expect: { pattern: 'percent' } },
  // operatingSystemInfo (2.1.10)
  { oid: '1.3.6.1.4.1.1004849.2.1.10.1.0', name: 'Sistema operacional', category: 'system', valueKind: 'text', importance: 'info' },
  { oid: '1.3.6.1.4.1.1004849.2.1.10.2.0', name: 'Versão do sistema operacional', category: 'system', valueKind: 'text', importance: 'info' },
  // networkInfo (2.2) / configInfo (2.3 — objetos de configuração R/W, só nome).
  { oid: '1.3.6.1.4.1.1004849.2.2.1', prefix: true, name: 'Portas de rede', category: 'network', importance: 'info' },
  { oid: '1.3.6.1.4.1.1004849.2.2.2', prefix: true, name: 'Configuração TCP/IP', category: 'network', importance: 'info' },
  { oid: '1.3.6.1.4.1.1004849.2.3', prefix: true, name: 'Configuração do equipamento', category: 'system', importance: 'info' },
  // storageInfo.physicalVolumeInfoTable (2.4.1.1.<col>.<physicNo>) — volumes físicos.
  { oid: '1.3.6.1.4.1.1004849.2.4.1.1.2', prefix: true, name: 'Volume físico — número físico', category: 'storage', importance: 'info' },
  { oid: '1.3.6.1.4.1.1004849.2.4.1.1.3', prefix: true, name: 'Volume físico — número lógico', category: 'storage', importance: 'info' },
  { oid: '1.3.6.1.4.1.1004849.2.4.1.1.4', prefix: true, name: 'Volume físico — nome', category: 'storage', valueKind: 'text', importance: 'info' },
  // Status é DisplayString oficial: "Error" / "Offline" / "Running".
  { oid: '1.3.6.1.4.1.1004849.2.4.1.1.5', prefix: true, name: 'Volume físico — status', category: 'storage', metricKey: 'disk_status_text', valueKind: 'text', importance: 'secondary', expect: { pattern: 'nonempty-text' } },
  { oid: '1.3.6.1.4.1.1004849.2.4.1.1.6', prefix: true, name: 'Volume físico — uso', category: 'storage', metricKey: 'disk_usage_pct', unit: '%', importance: 'secondary', expect: { pattern: 'percent' } },
  { oid: '1.3.6.1.4.1.1004849.2.4.1.1.7', prefix: true, name: 'Volume físico — capacidade', category: 'storage', metricKey: 'disk_capacity', unit: 'GB', importance: 'secondary', expect: { pattern: 'numeric', min: 0 } },
  // products (2.10): dvr.videoChannelStatusTable / nvr.remoteDeviceInfoTable.
  { oid: '1.3.6.1.4.1.1004849.2.10.1.1.1.1.2', prefix: true, name: 'Canal de vídeo — status (1=online, 0=offline)', category: 'application', metricKey: 'channel_status_raw', importance: 'secondary', expect: { pattern: 'boolean-int' } },
  { oid: '1.3.6.1.4.1.1004849.2.10.2.1.1.0', name: 'Número de dispositivos remotos', category: 'application', importance: 'info', expect: { pattern: 'numeric', min: 0 } },
  { oid: '1.3.6.1.4.1.1004849.2.10.2.1.2.1.2', prefix: true, name: 'Dispositivo remoto — IP', category: 'network', valueKind: 'text', importance: 'info' },
  { oid: '1.3.6.1.4.1.1004849.2.10.2.1.2.1.3', prefix: true, name: 'Dispositivo remoto — status', category: 'application', valueKind: 'text', importance: 'info' },
  { oid: '1.3.6.1.4.1.1004849.2.11', prefix: true, name: 'Notificações de eventos (traps)', category: 'system', importance: 'info' },
  { oid: '1.3.6.1.4.1.1004849.2', prefix: true, name: 'Dahua/Intelbras — informações do produto', category: 'system', importance: 'info' },
];

/** Classificação de um OID: semântica conhecida ou null (OID desconhecido). */
export function classifySnmpOid(oid: string): SnmpOidSemantic | null {
  for (const s of SNMP_OID_SEMANTICS) {
    if (s.prefix) {
      if (oid.startsWith(`${s.oid}.`)) return s;
    } else if (oid === s.oid) {
      return s;
    }
  }
  return null;
}

/**
 * Ponte semântica → catálogo canônico dos cards de saúde.
 *
 * Chaves semânticas da descoberta (qualquer fabricante) resolvem para as
 * métricas canônicas usadas nos pontos/perfis; chaves sem correspondência
 * permanecem como métrica exibível própria (nada fica invisível).
 */
export const SEMANTIC_TO_CANONICAL_METRIC: Record<string, string> = {
  cpu_usage: 'cpu',
  memory_usage: 'memory',
  memory_available: 'memory',
  ram_total: 'ram_total',
  storage_usage: 'storage',
  temperature: 'temperature',
  packet_loss: 'packet_loss',
  uptime: 'uptime',
};

/** Resolve chave semântica → métrica canônica (null quando não há ponte). */
export function resolveCanonicalMetric(metricKey?: string | null): string | null {
  if (!metricKey) return null;
  return SEMANTIC_TO_CANONICAL_METRIC[metricKey] ?? null;
}

const LOADAVG_RE = /^\s*\d+(\.\d+)?(\s+\d+(\.\d+)?){1,2}\s*$/;
const DATETIME_RE = /\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}/;

function numericOf(raw: string): number | null {
  const trimmed = (raw ?? '').trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/**
 * Verifica se o valor real lido é plausível para a expectativa declarada.
 * Sem expectativa → sempre plausível. Tipo 'Unknown'/vazio (gateway antigo)
 * não reprova pela lista de tipos, mas os padrões de valor ainda valem.
 */
export function checkSnmpPlausibility(
  semantic: Pick<SnmpOidSemantic, 'expect' | 'scale'>,
  type: string | undefined,
  raw: string,
): boolean {
  const expect = semantic.expect;
  if (!expect) return true;
  const t = (type ?? '').trim().toLowerCase();
  if (expect.types && t && t !== 'unknown') {
    if (!expect.types.some((x) => x.toLowerCase() === t)) return false;
  }
  const text = raw ?? '';
  switch (expect.pattern) {
    case 'percent': {
      const n = numericOf(text);
      if (n === null || n < 0 || n > 100) return false;
      break;
    }
    case 'loadavg':
      if (!LOADAVG_RE.test(text)) return false;
      break;
    case 'datetime':
      if (!DATETIME_RE.test(text)) return false;
      break;
    case 'numeric':
      if (numericOf(text) === null) return false;
      break;
    case 'boolean-int': {
      const n = numericOf(text);
      if (n === null || ![0, 1, 2].includes(n)) return false;
      break;
    }
    case 'nonempty-text':
      if (text.trim() === '') return false;
      break;
    default:
      break;
  }
  if (expect.min !== undefined || expect.max !== undefined) {
    const n = numericOf(text);
    if (n === null) return false;
    const scaled = n * (semantic.scale ?? 1);
    if (expect.min !== undefined && scaled < expect.min) return false;
    if (expect.max !== undefined && scaled > expect.max) return false;
  }
  return true;
}

/** Objeto descoberto no walk, já classificado (ou não) semanticamente. */
export interface DiscoveredSnmpObjectView {
  oid: string;
  /** Nome do tipo ASN.1 ('OctetString', 'Gauge32', …) — 'Unknown' p/ gateway antigo. */
  type: string;
  /** Valor bruto textual. */
  raw: string;
  /** Valor normalizado numérico (null quando não numérico). */
  value: number | null;
  /** Índice de instância (tabelas/não-.0) — null p/ escalares. */
  index: number | null;
  /** Subárvore de origem (raiz do walk). */
  sectionRoot: string;
  /**
   * Classificação semântica — null = "OID desconhecido" (armazenável e
   * classificável depois; NUNCA descartado).
   */
  known: {
    name: string;
    category: SnmpSemanticCategory;
    metricKey: string | null;
    unit: string | null;
    scale: number;
    valueKind: 'number' | 'text' | 'boolean';
    importance: SnmpImportance;
    /**
     * false = o valor real não bate com a expectativa da entrada (tipo/padrão/
     * faixa) — provável deslocamento de árvore entre firmwares. O nome vira
     * sugestão "não confirmada" e a métrica canônica é suprimida para nunca
     * exibir rótulo errado.
     */
    confirmed: boolean;
  } | null;
  /**
   * Nome resolvido via MIB importada pelo admin — presente SOMENTE quando
   * `known` é null (a classificação semântica tem sempre precedência).
   * Preenchido por SnmpMibService.enrichDiscovered após buildDiscoveredObjects.
   */
  mibName?: string | null;
  /** Origem do nome auxiliar: MIB importada (sem efeito na coleta). */
  mibSource?: string | null;
}

interface WalkSectionLike {
  root: string;
  entries: Array<{
    oid: string;
    value: string;
    type?: string;
    numeric?: number | null;
    index?: number | null;
    /**
     * Natureza do valor normalizado pelo gateway ('duration' = TimeTicks já
     * convertido em segundos; 'counter' = acumulador). Gateways antigos não
     * enviam — o backend converte TimeTicks brutos por conta própria.
     */
    kind?: string;
  }>;
}

// ─── Contexto de interfaces IF-MIB no walk (Bug 3 — loopback/down) ───────────

/** Prefixo da ifTable (colunas indexadas por ifIndex). */
export const IF_TABLE_PREFIX = '1.3.6.1.2.1.2.2.1.';
/** ifType = 24 → softwareLoopback (RFC 1573) — nunca é interface monitorável. */
export const SOFTWARE_LOOPBACK_IF_TYPE = 24;
/** ifOperStatus = 2 → down. */
export const IF_OPER_STATUS_DOWN = 2;

export interface WalkInterfaceInfo {
  ifType: number | null;
  operStatus: number | null;
  /** ifDescr — rótulo humano da interface (nunca rotular só pelo ifIndex). */
  descr: string | null;
  /** ifName — preferência moderna de rótulo quando disponível. */
  name?: string | null;
}

/**
 * Extrai, do próprio walk, o contexto por ifIndex (ifType/ifOperStatus/ifDescr)
 * para filtrar loopback/down e rotular entradas de interface pelo nome.
 */
export function buildInterfaceWalkInfo(
  walk: WalkSectionLike[],
): Map<number, WalkInterfaceInfo> {
  const map = new Map<number, WalkInterfaceInfo>();
  for (const section of walk) {
    for (const entry of section.entries) {
      if (!entry.oid?.startsWith(IF_TABLE_PREFIX)) continue;
      const rest = entry.oid.slice(IF_TABLE_PREFIX.length).split('.');
      if (rest.length !== 2) continue;
      const col = Number(rest[0]);
      const idx = Number(rest[1]);
      if (!Number.isInteger(col) || !Number.isInteger(idx)) continue;
      let info = map.get(idx);
      if (!info) {
        info = { ifType: null, operStatus: null, descr: null };
        map.set(idx, info);
      }
      if (col === 2) {
        info.descr = (entry.value ?? '').trim() || null;
        continue;
      }
      const numeric =
        entry.numeric !== undefined && entry.numeric !== null
          ? entry.numeric
          : /^\d+$/.test((entry.value ?? '').trim())
            ? Number(entry.value)
            : null;
      if (col === 3) info.ifType = numeric;
      else if (col === 8) info.operStatus = numeric;
    }
  }
  // ifXTable is a separate subtree; merge labels without making it required.
  for (const section of walk) {
    for (const entry of section.entries) {
      if (!entry.oid?.startsWith('1.3.6.1.2.1.31.1.1.1.1.')) continue;
      const idx = Number(entry.oid.slice('1.3.6.1.2.1.31.1.1.1.1.'.length));
      if (!Number.isInteger(idx)) continue;
      const info = map.get(idx) ?? { ifType: null, operStatus: null, descr: null };
      info.name = (entry.value ?? '').trim() || null;
      map.set(idx, info);
    }
  }
  return map;
}

/**
 * true quando a interface merece pontos/recomendação: descarta loopback
 * (ifType 24) e omite interfaces down. Sem contexto no walk → não esconde
 * por suposição (falha explícita > filtro silencioso).
 */
export function isMonitorableWalkInterface(
  info: WalkInterfaceInfo | undefined,
): boolean {
  if (!info) return true;
  if (info.ifType === SOFTWARE_LOOPBACK_IF_TYPE) return false;
  if (info.operStatus === IF_OPER_STATUS_DOWN) return false;
  return true;
}

/**
 * Constrói a lista de objetos descobertos a partir do walk do diagnóstico —
 * TODOS os objetos, na ordem: primeiro registra a descoberta, depois aplica a
 * interpretação (com validação de plausibilidade). Compatível com gateways
 * antigos (entradas só com oid/value: tipo vira 'Unknown' e o normalizado é
 * derivado do texto).
 */
export function buildDiscoveredObjects(
  walk: WalkSectionLike[],
): DiscoveredSnmpObjectView[] {
  const seen = new Set<string>();
  const out: DiscoveredSnmpObjectView[] = [];
  const ifInfo = buildInterfaceWalkInfo(walk);
  for (const section of walk) {
    for (const entry of section.entries) {
      if (!entry.oid || seen.has(entry.oid)) continue;
      seen.add(entry.oid);
      const semantic = classifySnmpOid(entry.oid);
      const confirmed = semantic
        ? checkSnmpPlausibility(semantic, entry.type, entry.value ?? '')
        : true;
      const numericFallback = Number(entry.value);
      let value =
        entry.numeric !== undefined
          ? entry.numeric
          : Number.isFinite(numericFallback) && entry.value.trim() !== ''
            ? numericFallback
            : null;
      // ── TimeTicks (Bug 1 — normalização dupla) ────────────────────────────
      // Gateway novo já entrega segundos (kind 'duration'); gateway antigo
      // entrega ticks brutos → converte AQUI, uma única vez. Em ambos os
      // casos o valor final está em segundos → scale semântica (ex.: 0.01 do
      // deviceUpTime Dahua) NUNCA é reaplicada.
      const isTimeTicks = (entry.type ?? '').toLowerCase() === 'timeticks';
      if (isTimeTicks && value !== null && entry.kind !== 'duration') {
        value = value / 100;
      }
      const index =
        entry.index !== undefined
          ? entry.index
          : (() => {
              const last = entry.oid.slice(entry.oid.lastIndexOf('.') + 1);
              if (!/^\d+$/.test(last)) return null;
              return Number(last) === 0 ? null : Number(last);
            })();
      // ── Interfaces IF-MIB (Bug 3) ─────────────────────────────────────────
      // Loopback/down nunca viram recomendação; rótulo pelo ifDescr.
      const isIfTableEntry =
        entry.oid.startsWith(IF_TABLE_PREFIX) && index !== null;
      const iface = isIfTableEntry ? ifInfo.get(index) : undefined;
      const demoteInterface = isIfTableEntry && !isMonitorableWalkInterface(iface);
      out.push({
        oid: entry.oid,
        type: entry.type ?? 'Unknown',
        raw: entry.value ?? '',
        value,
        index,
        sectionRoot: section.root,
        known: semantic
          ? {
              name: iface?.descr ? `${semantic.name} — ${iface.descr}` : semantic.name,
              category: semantic.category,
              // Rótulo não confirmado NUNCA carrega métrica canônica — evita
              // aplicar OID errado num ponto de saúde por engano. Interface
              // loopback/down também nunca vira métrica recomendada.
              metricKey:
                confirmed && !demoteInterface ? (semantic.metricKey ?? null) : null,
              unit: semantic.unit ?? null,
              scale: isTimeTicks ? 1 : (semantic.scale ?? 1),
              valueKind: semantic.valueKind ?? 'number',
              importance: demoteInterface ? 'info' : (semantic.importance ?? 'secondary'),
              confirmed,
            }
          : null,
      });
    }
  }
  return out;
}
