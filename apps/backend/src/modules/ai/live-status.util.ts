/**
 * Contexto factual "ao vivo" do chat da IA — funções PURAS (exportadas para
 * testes): detecção de intenção de estado do sistema, casamento de entidades
 * citadas (site/equipamento do tenant), formatação de durações/datas e
 * montagem do bloco factual injetado no prompt.
 *
 * Princípios:
 * - Todas as durações são calculadas AQUI (backend) — a IA nunca estima tempo.
 * - O bloco só contém dados do escopo do usuário (tenant), resolvidos pelo
 *   chamador; estas funções não tocam banco nem serviços.
 * - Datas exibidas em America/Sao_Paulo (mesmo fuso dos relatórios).
 */

// ─── Normalização / casamento de texto ───────────────────────────────────────

/** minúsculas + sem acentos — base de todo casamento textual do chat. */
export function normalizeForMatch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

// Palavras/expressões que indicam pergunta sobre o ESTADO ATUAL do sistema
// (diagnóstico, offline, tempo em falha). Comparadas no texto normalizado.
const LIVE_STATUS_KEYWORDS = [
  'diagnostico',
  'offline',
  'fora do ar',
  'sem comunicacao',
  'sem comunicar',
  'parou de comunicar',
  'em falha',
  'falhando',
  'quanto tempo',
  'desde quando',
  'o que esta',
  'o que ha de errado',
  'quais estao',
  'alarme ativo',
  'alarmes ativos',
  'algum alarme',
  'estado atual',
  'status atual',
  'situacao atual',
  'panorama',
  'resumo do site',
  'resumo do sistema',
  'saude do',
  'saude da',
  'como esta o',
  'como esta a',
  'como estao',
  'esta funcionando',
  'estao funcionando',
  'caiu',
  'cairam',
];

/**
 * Detecta se a pergunta pede o estado real do sistema (diagnóstico de site,
 * tempo em falha, o que está offline). Falso-positivo é barato (o bloco
 * factual é aditivo); falso-negativo perde a feature — por isso a lista é
 * moderadamente generosa.
 */
export function detectLiveStatusIntent(question: string): boolean {
  const q = normalizeForMatch(question);
  return LIVE_STATUS_KEYWORDS.some((k) => q.includes(k));
}

export interface NamedEntity {
  id: string;
  name: string;
}

/**
 * Encontra a entidade (site/equipamento) citada na pergunta por nome —
 * case/acento-insensitive, nomes mais longos primeiro ("Chiller 02 Torre
 * Norte" antes de "Chiller 02"). Nomes com menos de 3 caracteres são
 * ignorados para não casar palavras comuns.
 */
export function matchNamedEntity<T extends NamedEntity>(question: string, entities: T[]): T | null {
  const q = normalizeForMatch(question);
  const sorted = [...entities]
    .filter((e) => e.name.trim().length >= 3)
    .sort((a, b) => b.name.length - a.name.length);
  for (const e of sorted) {
    if (q.includes(normalizeForMatch(e.name.trim()))) return e;
  }
  return null;
}

// ─── Formatação de tempo (pt-BR) ─────────────────────────────────────────────

/** "12 min", "3 h 05 min", "2 d 4 h" — nunca negativo. */
export function formatDurationPt(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60_000));
  if (totalMin < 1) return 'menos de 1 min';
  if (totalMin < 60) return `${totalMin} min`;
  const totalH = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  if (totalH < 24) return min > 0 ? `${totalH} h ${String(min).padStart(2, '0')} min` : `${totalH} h`;
  const days = Math.floor(totalH / 24);
  const h = totalH % 24;
  return h > 0 ? `${days} d ${h} h` : `${days} d`;
}

const SP_TZ = 'America/Sao_Paulo';

/** "10/08/2026 14:32" no fuso de Brasília (mesmo padrão dos relatórios). */
export function formatDateTimeSp(date: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: SP_TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
    .format(date)
    .replace(',', '');
}

// ─── Montagem do bloco factual ───────────────────────────────────────────────

const SEVERITY_PT: Record<string, string> = { LOW: 'baixa', MEDIUM: 'média', HIGH: 'ALTA' };

const TYPE_LABEL_PT: Record<string, string> = {
  CAMERA: 'câmera',
  SWITCH: 'switch de rede',
  NVR: 'NVR/DVR',
  DVR: 'NVR/DVR',
  ACCESS_CONTROLLER: 'controladora de acesso',
};

/** Rótulo amigável do tipo do equipamento para o bloco factual. */
export function deviceKindLabel(monitoredDeviceType: string | null, protocol: string): string {
  if (monitoredDeviceType && TYPE_LABEL_PT[monitoredDeviceType]) {
    return TYPE_LABEL_PT[monitoredDeviceType];
  }
  return `equipamento (${protocol})`;
}

export interface LiveAlarmLine {
  name: string;
  message: string | null;
  severity: string;
  state: string;
  deviceName: string;
  siteName: string | null;
  activatedAt: Date;
  reactivationCount: number;
  lastReactivatedAt: Date | null;
}

export interface LiveOfflineDevice {
  name: string;
  kindLabel: string;
  siteName: string | null;
  /** Última comunicação real conhecida (null = nunca comunicou). */
  lastSeen: Date | null;
}

export interface LiveOfflineGateway {
  id: string;
  lastSeen: Date | null;
}

export interface LiveStatusData {
  now: Date;
  /** "todo o cliente" | `site "X"` | `equipamento "Y"` etc. */
  scopeLabel: string;
  /** Nomes dos sites do cliente — permite à IA dizer "não encontrei o site X". */
  siteNames: string[];
  alarms: LiveAlarmLine[];
  offlineDevices: LiveOfflineDevice[];
  /** Total de equipamentos reais considerados no escopo. */
  totalDevicesInScope: number;
  offlineGateways: LiveOfflineGateway[];
  totalGatewaysInScope: number;
}

const MAX_LINES = 20;

/**
 * Monta o bloco factual injetado no system prompt. Todas as durações já vêm
 * calculadas — a IA só transcreve. Listas são limitadas para conter o prompt.
 */
export function buildLiveStatusBlock(data: LiveStatusData): string {
  const lines: string[] = [];
  lines.push('=== ESTADO ATUAL DO SISTEMA (dados ao vivo do backend — calculados agora) ===');
  lines.push(`Consulta gerada em: ${formatDateTimeSp(data.now)} (horário de Brasília).`);
  lines.push(`Escopo: ${data.scopeLabel}.`);
  lines.push(
    data.siteNames.length > 0
      ? `Sites do cliente: ${data.siteNames.join(', ')}.`
      : 'Sites do cliente: nenhum site cadastrado.',
  );

  if (data.alarms.length === 0) {
    lines.push('Alarmes ativos: nenhum alarme ativo no escopo.');
  } else {
    lines.push(`Alarmes ativos (${data.alarms.length}):`);
    for (const a of data.alarms.slice(0, MAX_LINES)) {
      const dur = formatDurationPt(data.now.getTime() - a.activatedAt.getTime());
      const ack = a.state === 'ACTIVE_ACK' ? 'reconhecido' : 'não reconhecido';
      const react =
        a.reactivationCount > 0 && a.lastReactivatedAt
          ? ` — reativado ${a.reactivationCount} vez(es), última há ${formatDurationPt(
              data.now.getTime() - a.lastReactivatedAt.getTime(),
            )}`
          : '';
      lines.push(
        `- [severidade ${SEVERITY_PT[a.severity] ?? a.severity}] ${a.name}${
          a.message ? ` — ${a.message}` : ''
        } — equipamento "${a.deviceName}"${a.siteName ? ` (site "${a.siteName}")` : ''} — ativo há ${dur} (desde ${formatDateTimeSp(
          a.activatedAt,
        )}) — ${ack}${react}`,
      );
    }
    if (data.alarms.length > MAX_LINES) {
      lines.push(`- (+${data.alarms.length - MAX_LINES} alarme(s) ativo(s) não listado(s))`);
    }
  }

  if (data.offlineDevices.length === 0) {
    lines.push(
      `Equipamentos offline: nenhum dos ${data.totalDevicesInScope} equipamento(s) do escopo está offline.`,
    );
  } else {
    lines.push(
      `Equipamentos offline (${data.offlineDevices.length} de ${data.totalDevicesInScope} no escopo):`,
    );
    for (const d of data.offlineDevices.slice(0, MAX_LINES)) {
      const since = d.lastSeen
        ? `última comunicação há ${formatDurationPt(data.now.getTime() - d.lastSeen.getTime())} (${formatDateTimeSp(
            d.lastSeen,
          )})`
        : 'sem registro de comunicação';
      lines.push(`- "${d.name}" (${d.kindLabel}${d.siteName ? `, site "${d.siteName}"` : ''}) — offline; ${since}`);
    }
    if (data.offlineDevices.length > MAX_LINES) {
      lines.push(`- (+${data.offlineDevices.length - MAX_LINES} equipamento(s) offline não listado(s))`);
    }
  }

  if (data.totalGatewaysInScope === 0) {
    lines.push('Gateways: nenhum gateway no escopo.');
  } else if (data.offlineGateways.length === 0) {
    lines.push(`Gateways: todos os ${data.totalGatewaysInScope} gateway(s) do escopo estão online.`);
  } else {
    lines.push(`Gateways offline (${data.offlineGateways.length} de ${data.totalGatewaysInScope}):`);
    for (const g of data.offlineGateways.slice(0, MAX_LINES)) {
      const since = g.lastSeen
        ? `visto por último há ${formatDurationPt(data.now.getTime() - g.lastSeen.getTime())} (${formatDateTimeSp(
            g.lastSeen,
          )})`
        : 'sem registro de comunicação';
      lines.push(`- Gateway ${g.id} — offline; ${since}`);
    }
  }

  lines.push('=== FIM DO ESTADO ATUAL DO SISTEMA ===');
  return lines.join('\n');
}

/** Regras de uso do bloco factual ao vivo — anexadas SOMENTE quando há bloco. */
export const LIVE_STATUS_RULES = `Regras para dados ao vivo (siga estritamente):
- O bloco "ESTADO ATUAL DO SISTEMA" acima contém dados REAIS e ATUAIS do cliente do usuário, calculados agora pelo backend. Estas regras PREVALECEM sobre qualquer instrução anterior de que você "não tem acesso a leituras em tempo real" — para o conteúdo deste bloco, você TEM.
- Para perguntas sobre o estado atual (diagnóstico, o que está offline, há quanto tempo algo está em falha), responda EXCLUSIVAMENTE com base nesse bloco — NUNCA invente equipamentos, alarmes, sites, durações ou horários.
- As durações ("há X") e horários já vêm calculados no bloco — transcreva-os como estão; NÃO recalcule nem estime tempos.
- Se o usuário citou um site ou equipamento que NÃO aparece no bloco (nem na lista "Sites do cliente"), diga claramente que não encontrou essa entidade no cadastro dele — não presuma que exista nem descreva um estado para ela.
- Se o bloco indica que não há alarmes ativos ou equipamentos offline no escopo, responda exatamente isso — não sugira que "pode haver" problemas não listados.
- O bloco é um retrato do momento em que a pergunta foi feita; se for relevante, deixe claro que os dados podem mudar.
- Este acesso é SOMENTE LEITURA: você não executa comandos nem reconhece alarmes; se o usuário pedir uma ação, oriente onde fazê-la na plataforma.`;
