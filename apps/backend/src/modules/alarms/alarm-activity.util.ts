import type { Prisma } from '@prisma/client';

/**
 * Semântica de período pela ATIVIDADE MAIS RECENTE da ocorrência.
 *
 * O motor reaproveita a mesma ocorrência quando o alarme reativa antes do ACK
 * (reactivationCount/lastReactivatedAt), então filtrar só por `activatedAt`
 * esconde alarmes que acabaram de reativar (a primeira ativação pode estar
 * fora do período). A regra aqui é de SOBREPOSIÇÃO:
 *   - começou até o fim do período (activatedAt <= to), e
 *   - teve alguma atividade a partir do início (ativação, normalização ou
 *     última reativação >= from).
 */
export function alarmPeriodWhere(from?: Date, to?: Date): Prisma.AlarmEventWhereInput {
  const and: Prisma.AlarmEventWhereInput[] = [];
  if (to) and.push({ activatedAt: { lte: to } });
  if (from) {
    and.push({
      OR: [
        { activatedAt: { gte: from } },
        { normalizedAt: { gte: from } },
        { lastReactivatedAt: { gte: from } },
      ],
    });
  }
  return and.length > 0 ? { AND: and } : {};
}

export interface AlarmActivityTimestamps {
  activatedAt: Date;
  normalizedAt: Date | null;
  lastReactivatedAt: Date | null;
}

/** Timestamp (ms) da atividade mais recente da ocorrência. */
export function lastActivityAt(e: AlarmActivityTimestamps): number {
  return Math.max(
    e.activatedAt.getTime(),
    e.normalizedAt?.getTime() ?? 0,
    e.lastReactivatedAt?.getTime() ?? 0,
  );
}

const SEVERITY_RANK: Record<string, number> = { HIGH: 2, MEDIUM: 1, LOW: 0 };

/**
 * Ordena in-place: severidade mais alta primeiro e, dentro de cada severidade,
 * atividade mais recente primeiro (o Prisma não ordena por máximo de colunas).
 */
export function sortBySeverityThenActivity<T extends AlarmActivityTimestamps>(
  events: T[],
  severityOf: (e: T) => string,
): T[] {
  return events.sort(
    (a, b) =>
      (SEVERITY_RANK[severityOf(b)] ?? 0) - (SEVERITY_RANK[severityOf(a)] ?? 0) ||
      lastActivityAt(b) - lastActivityAt(a),
  );
}
