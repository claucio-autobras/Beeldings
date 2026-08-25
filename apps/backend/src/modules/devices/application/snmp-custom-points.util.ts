/**
 * Aplicação de objetos descobertos no walk SNMP como pontos de monitoramento.
 *
 * Compartilhado entre SCA (controladoras) e CFTV (câmeras/NVRs): os OIDs
 * selecionados no diagnóstico — inclusive "OID desconhecido" — viram
 * DevicePoints com binding { metric, oid, scale, unsupported:false }, coletados
 * pelo polling genérico do gateway (qualquer ponto com OID concreto).
 *
 * Match/create é por `binding.oid` (nunca por metric — pontos 'custom'
 * colidiriam entre si). Pontos existentes com o mesmo OID são atualizados
 * (nome/unidade), preservando o ID — trends e alarmes sobrevivem.
 */

import { classifySnmpOid, resolveCanonicalMetric } from './snmp-oid-semantics.js';

export interface CustomDiscoveredPoint {
  oid: string;
  name: string;
  unit: string;
}

/** Formato mínimo dos DevicePoints carregados pelo controller. */
interface DevicePointLike {
  id: string;
  tag: string;
  instance: number;
  binding: unknown;
}

/** Client Prisma mínimo usado aqui (evita acoplar ao PrismaService inteiro). */
interface PrismaLike {
  devicePoint: {
    create: (args: {
      data: Record<string, unknown>;
    }) => Promise<{ id: string; tag: string; instance: number; binding: unknown }>;
    update: (args: {
      where: { id: string };
      data: Record<string, unknown>;
    }) => Promise<unknown>;
  };
}

const OID_PATTERN = /^\d+(\.\d+)+$/;
const MAX_CUSTOM_POINTS = 50;
const MAX_NAME_LEN = 120;
const MAX_UNIT_LEN = 16;

/** Valida/normaliza a seleção de OIDs livres vinda do frontend. */
export function sanitizeCustomPoints(
  raw: Array<{ oid?: string; name?: string; unit?: string }> | undefined,
): CustomDiscoveredPoint[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: CustomDiscoveredPoint[] = [];
  for (const item of raw) {
    const oid = typeof item?.oid === 'string' ? item.oid.trim() : '';
    if (!OID_PATTERN.test(oid) || seen.has(oid)) continue;
    seen.add(oid);
    const name =
      typeof item?.name === 'string' && item.name.trim()
        ? item.name.trim().slice(0, MAX_NAME_LEN)
        : `OID ${oid}`;
    const unit =
      typeof item?.unit === 'string' ? item.unit.trim().slice(0, MAX_UNIT_LEN) : '';
    out.push({ oid, name, unit });
    if (out.length >= MAX_CUSTOM_POINTS) break;
  }
  return out;
}

/** Tag estável e única por OID (telemetria do gateway é chaveada por tag). */
export function customPointTag(oid: string): string {
  return `OID_${oid.replace(/\./g, '_')}`;
}

/**
 * Cria/atualiza os pontos dos OIDs selecionados. Muta `points` (adiciona os
 * criados) para que chamadas subsequentes no mesmo request enxerguem o estado.
 */
export async function applyCustomDiscoveredPoints(
  prisma: PrismaLike,
  deviceId: string,
  points: DevicePointLike[],
  customPoints: CustomDiscoveredPoint[],
  /**
   * OIDs reprovados na validação de plausibilidade do último diagnóstico
   * (valor real incompatível com o esperado pela semântica — ex.: árvore
   * deslocada entre firmwares). Para esses, a ponte semântica→canônica é
   * DESLIGADA: o ponto entra como dado custom sem rótulo automático, nunca
   * como métrica canônica com rótulo potencialmente errado.
   */
  unconfirmedOids?: ReadonlySet<string>,
): Promise<void> {
  for (let cp of customPoints) {
    const existing = points.find((p) => {
      const b = (p.binding ?? {}) as { oid?: string | null };
      return typeof b.oid === 'string' && b.oid === cp.oid;
    });
    // Semântica conhecida → ponte p/ métrica canônica do card; senão a própria
    // chave semântica (métrica exibível); senão 'custom'. O scale da semântica
    // acompanha o OID (ex.: temperatura Control iD em mili-°C → ÷1000).
    // Plausibilidade reprovada no diagnóstico → semântica NÃO confiável.
    const unconfirmed = unconfirmedOids?.has(cp.oid) === true;
    const semantic = unconfirmed ? null : classifySnmpOid(cp.oid);
    const canonical = resolveCanonicalMetric(semantic?.metricKey);
    const semanticScale = semantic?.scale ?? 1;
    if (unconfirmed) {
      // Nunca gravar o rótulo semântico (potencialmente errado) num OID não
      // confirmado: se o nome enviado for o do catálogo semântico, rebaixa
      // para o nome neutro. Nome dado deliberadamente pelo operador é mantido.
      const semanticName = classifySnmpOid(cp.oid)?.name;
      if (semanticName && cp.name === semanticName) {
        cp = { ...cp, name: `OID ${cp.oid}` };
      }
    }
    if (existing) {
      const b = (existing.binding ?? {}) as Record<string, unknown>;
      await prisma.devicePoint.update({
        where: { id: existing.id },
        data: {
          objectName: cp.name,
          ...(cp.unit ? { unit: cp.unit } : {}),
          binding: { ...b, oid: cp.oid, scale: (b.scale as number) ?? semanticScale, unsupported: false },
        },
      });
      continue;
    }
    // Ponto canônico existente sem OID funcional → repontar (preserva ID,
    // trends e alarmes) em vez de criar um segundo ponto da mesma métrica.
    if (canonical) {
      const canonicalPoint = points.find((p) => {
        const b = (p.binding ?? {}) as { metric?: string; oid?: string | null; unsupported?: boolean };
        return b.metric === canonical && (b.unsupported === true || !b.oid);
      });
      if (canonicalPoint) {
        const b = (canonicalPoint.binding ?? {}) as Record<string, unknown>;
        await prisma.devicePoint.update({
          where: { id: canonicalPoint.id },
          data: {
            ...(cp.unit || semantic?.unit ? { unit: cp.unit || semantic?.unit } : {}),
            binding: { ...b, oid: cp.oid, scale: semanticScale, unsupported: false },
          },
        });
        (canonicalPoint as { binding: unknown }).binding = {
          ...b,
          oid: cp.oid,
          scale: semanticScale,
          unsupported: false,
        };
        continue;
      }
    }
    const hasCanonicalTwin =
      canonical !== null &&
      points.some((p) => ((p.binding ?? {}) as { metric?: string }).metric === canonical);
    const nextInstance = points.reduce((m, p) => Math.max(m, p.instance), -1) + 1;
    const created = await prisma.devicePoint.create({
      data: {
        deviceId,
        tag: customPointTag(cp.oid),
        objectName: cp.name,
        objectType: 'snmp',
        instance: nextInstance,
        unit: cp.unit || semantic?.unit || '',
        binding: {
          // Nunca duplicar métrica canônica em dois pontos (consumidores fazem
          // find por metric) — o gêmeo fica com a chave semântica exibível.
          metric: hasCanonicalTwin
            ? (semantic?.metricKey ?? 'custom')
            : (canonical ?? semantic?.metricKey ?? 'custom'),
          oid: cp.oid,
          scale: semanticScale,
          unsupported: false,
        },
      },
    });
    points.push(created as DevicePointLike);
  }
}
