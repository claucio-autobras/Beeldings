// ─── Evaluator puro do motor de alarmes ─────────────────────────────────────────
// Peça SEM efeitos colaterais (sem banco/HTTP/timer): entra valor → sai decisão.
// Contém a lógica de condição + histerese + a transição da máquina de estados.
// Mantida portável para rodar no edge (gateway) no futuro sem reescrever.

export type AlarmTypeLite = 'STATE_CHANGE' | 'VALUE_RANGE';
export type AlarmConditionLite = 'GT' | 'LT' | 'GTE' | 'LTE' | 'BETWEEN' | 'OUTSIDE';

/** Subconjunto da AlarmRule necessário para avaliar a condição. */
export interface EvalRule {
  type: AlarmTypeLite;
  /** STATE_CHANGE: dispara quando o ponto (0/1) == este estado. */
  activationState?: boolean | null;
  /** VALUE_RANGE: condição analógica. */
  condition?: AlarmConditionLite | null;
  limitValue?: number | null; // GT/LT/GTE/LTE
  limitLow?: number | null; // BETWEEN/OUTSIDE
  limitHigh?: number | null; // BETWEEN/OUTSIDE
  /** Banda morta: só normaliza quando o valor recua além da histerese. */
  hysteresis?: number | null;
}

/**
 * Estado de runtime do alarme (espelha AlarmEventState + INACTIVE).
 * `INACTIVE` = sem ocorrência aberta (nenhum AlarmEvent ACTIVE/ACTIVE_ACK).
 */
export type EngineState =
  | 'INACTIVE'
  | 'ACTIVE'
  | 'ACTIVE_ACK'
  | 'NORMALIZED_UNACK'
  | 'NORMALIZED_ACK';

/**
 * Avalia se a condição do alarme está satisfeita para o valor atual.
 * Aplica histerese de forma assimétrica: quando já está ativo (`wasActive`),
 * a banda de manutenção é alargada para só normalizar após recuo claro.
 *
 * @param rule      configuração da regra (campos relevantes)
 * @param value     valor atual já normalizado (digital = 0.0/1.0)
 * @param wasActive havia ocorrência aberta para esta regra antes deste valor?
 */
export function isConditionMet(rule: EvalRule, value: number, wasActive: boolean): boolean {
  if (Number.isNaN(value)) return false;

  if (rule.type === 'STATE_CHANGE') {
    // Digital: sem histerese. Dispara quando o estado bate com activationState.
    const isOn = value >= 0.5;
    const target = rule.activationState ?? true;
    return isOn === target;
  }

  // VALUE_RANGE (analógico)
  const h = Math.max(0, rule.hysteresis ?? 0);
  const limit = rule.limitValue ?? 0;
  const low = rule.limitLow ?? 0;
  const high = rule.limitHigh ?? 0;

  switch (rule.condition) {
    case 'GT':
      return wasActive ? value > limit - h : value > limit;
    case 'GTE':
      return wasActive ? value >= limit - h : value >= limit;
    case 'LT':
      return wasActive ? value < limit + h : value < limit;
    case 'LTE':
      return wasActive ? value <= limit + h : value <= limit;
    case 'BETWEEN':
      // Dispara DENTRO de [low, high]; histerese alarga a banda de manutenção.
      return wasActive
        ? value >= low - h && value <= high + h
        : value >= low && value <= high;
    case 'OUTSIDE':
      // Dispara FORA de [low, high]; histerese estreita a banda "normal".
      return wasActive
        ? value < low + h || value > high - h
        : value < low || value > high;
    default:
      return false;
  }
}

/**
 * Transição automática (dirigida por telemetria) da máquina de estados.
 * ACK é tratado fora daqui (ação do operador). `INACTIVE`/`NORMALIZED_*` são
 * pontos de partida/fim de uma ocorrência — re-disparo gera NOVA ocorrência.
 *
 * - INACTIVE        + condição        → ACTIVE            (criar ocorrência; delay tratado no runtime)
 * - ACTIVE          + !condição       → NORMALIZED_UNACK  (fecha ocorrência não reconhecida)
 * - ACTIVE_ACK      + !condição       → NORMALIZED_ACK    (fecha ocorrência já reconhecida)
 * - demais combinações mantêm o estado.
 */
export function nextStateOnCondition(current: EngineState, conditionMet: boolean): EngineState {
  switch (current) {
    case 'INACTIVE':
      return conditionMet ? 'ACTIVE' : 'INACTIVE';
    case 'ACTIVE':
      return conditionMet ? 'ACTIVE' : 'NORMALIZED_UNACK';
    case 'ACTIVE_ACK':
      return conditionMet ? 'ACTIVE_ACK' : 'NORMALIZED_ACK';
    default:
      // NORMALIZED_* são terminais para a ocorrência atual.
      return current;
  }
}

/** Aplica o reconhecimento do operador. Apenas `NORMALIZED_UNACK` é reconhecível:
 *  um alarme ainda ativo só pode ser reconhecido depois de normalizar. */
export function nextStateOnAck(current: EngineState): EngineState {
  if (current === 'NORMALIZED_UNACK') return 'NORMALIZED_ACK';
  return current;
}
