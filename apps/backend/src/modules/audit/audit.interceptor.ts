import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { AlarmSeverity } from '@prisma/client';
import { Observable, from } from 'rxjs';
import { switchMap, tap } from 'rxjs/operators';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthenticatedUser } from '../auth/domain/interfaces/auth.interface.js';
import { AuditService } from './audit.service.js';
import { getClientIp } from './audit.util.js';

type ActionCode = 'CREATE' | 'UPDATE' | 'DELETE' | 'COMMAND' | 'ACK' | 'LOGOUT';

interface AuditRoute {
  action: ActionCode;
  /** Rótulo legível da entidade afetada. */
  entity: string;
  /** Lê o estado anterior (apenas para diff de severidade de regra de alarme). */
  captureSeverity?: boolean;
  /** Lê nome/tenant do Device pelo :id (rotas de câmera CFTV — nome legível em PATCH/DELETE). */
  captureDevice?: boolean;
}

/**
 * Mapa explícito rota→auditoria. Apenas operações de ESCRITA reais entram aqui;
 * rotas de teste/descoberta/amostragem e o próprio login ficam de fora (login é
 * auditado explicitamente no AuthService, pois precisa registrar falhas).
 * A chave é `MÉTODO /caminho/registrado` (padrão do Express, com `:param`).
 */
const AUDIT_ROUTES: Record<string, AuditRoute> = {
  // Equipamentos
  'POST /devices/bacnet': { action: 'CREATE', entity: 'Equipamento' },
  'POST /devices/mqtt': { action: 'CREATE', entity: 'Equipamento' },
  'POST /devices/modbus': { action: 'CREATE', entity: 'Equipamento' },
  'POST /devices/:id/points': { action: 'CREATE', entity: 'Pontos do equipamento' },
  'PATCH /devices/:id': { action: 'UPDATE', entity: 'Equipamento' },
  'DELETE /devices/:id': { action: 'DELETE', entity: 'Equipamento' },
  'DELETE /devices/:id/points/:pointId': { action: 'DELETE', entity: 'Ponto do equipamento' },
  'POST /devices/:id/bacnet/sync': { action: 'UPDATE', entity: 'Pontos do equipamento' },
  'POST /devices/:id/bacnet/sync/replace': { action: 'UPDATE', entity: 'Pontos do equipamento' },
  'POST /devices/bacnet/write': { action: 'COMMAND', entity: 'Comando ao equipamento' },
  'POST /devices/mqtt/write': { action: 'COMMAND', entity: 'Comando ao equipamento' },
  'POST /devices/modbus/write': { action: 'COMMAND', entity: 'Comando ao equipamento' },

  // Alarmes
  'POST /alarm-rules': { action: 'CREATE', entity: 'Regra de alarme' },
  'PATCH /alarm-rules/:id': { action: 'UPDATE', entity: 'Regra de alarme', captureSeverity: true },
  'DELETE /alarm-rules/:id': { action: 'DELETE', entity: 'Regra de alarme' },
  'POST /alarm-events/:id/acknowledge': { action: 'ACK', entity: 'Alarme' },
  'POST /alarm-events/acknowledge': { action: 'ACK', entity: 'Alarme' },
  'POST /alarms/:id/acknowledge': { action: 'ACK', entity: 'Alarme' },

  // Usuários / Sessão
  'POST /auth/register': { action: 'CREATE', entity: 'Usuário' },
  'DELETE /auth/users/:id': { action: 'DELETE', entity: 'Usuário' },
  'POST /auth/logout': { action: 'LOGOUT', entity: 'Sessão' },
  'PATCH /account/profile': { action: 'UPDATE', entity: 'Perfil do usuário' },
  'PATCH /account/password': { action: 'UPDATE', entity: 'Senha do usuário' },

  // Trends
  'POST /trends': { action: 'CREATE', entity: 'Trend' },
  'PATCH /trends/:id': { action: 'UPDATE', entity: 'Trend' },
  'DELETE /trends/:id': { action: 'DELETE', entity: 'Trend' },

  // Clientes / Sites / Projetos / Gateways
  'POST /tenants': { action: 'CREATE', entity: 'Cliente' },
  'PATCH /tenants/:id/status': { action: 'UPDATE', entity: 'Cliente' },
  'DELETE /tenants/:id': { action: 'DELETE', entity: 'Cliente' },
  'POST /sites': { action: 'CREATE', entity: 'Site' },
  'DELETE /sites/:id': { action: 'DELETE', entity: 'Site' },
  'POST /projects': { action: 'CREATE', entity: 'Projeto' },
  'PATCH /projects/:id': { action: 'UPDATE', entity: 'Projeto' },
  'DELETE /projects/:id': { action: 'DELETE', entity: 'Projeto' },
  'DELETE /gateways/:id': { action: 'DELETE', entity: 'Gateway' },
  'POST /gateways/:id/reprovision': { action: 'UPDATE', entity: 'Gateway' },

  // SCADA
  'POST /scada/screens': { action: 'CREATE', entity: 'Tela SCADA' },
  'PATCH /scada/screens/:id': { action: 'UPDATE', entity: 'Tela SCADA' },
  'PATCH /scada/screens/:id/home': { action: 'UPDATE', entity: 'Tela SCADA' },
  'DELETE /scada/screens/:id': { action: 'DELETE', entity: 'Tela SCADA' },
  'POST /scada/projects': { action: 'CREATE', entity: 'Projeto SCADA' },
  'DELETE /scada/projects/:projectId': { action: 'DELETE', entity: 'Projeto SCADA' },

  // CFTV (câmeras). O interceptor nunca grava o corpo bruto da requisição,
  // então credenciais ONVIF/SNMP (onvifPassword, community) jamais vão à trilha.
  'POST /cftv/cameras': { action: 'CREATE', entity: 'Câmera CFTV' },
  'PATCH /cftv/cameras/:id': { action: 'UPDATE', entity: 'Câmera CFTV', captureDevice: true },
  'DELETE /cftv/cameras/:id': { action: 'DELETE', entity: 'Câmera CFTV', captureDevice: true },

  // Bancada de Testes (pontos virtuais)
  'POST /scada/simulator/:deviceId/points': { action: 'CREATE', entity: 'Ponto virtual (bancada)' },
  'PATCH /scada/simulator/:deviceId/points/:pointId/value': { action: 'UPDATE', entity: 'Ponto virtual (bancada)' },
  'DELETE /scada/simulator/:deviceId/points/:pointId': { action: 'DELETE', entity: 'Ponto virtual (bancada)' },
};

const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

const SEVERITY_LABEL: Record<AlarmSeverity, string> = {
  LOW: 'Baixa',
  MEDIUM: 'Média',
  HIGH: 'Alta',
};

interface RequestWithUser {
  method: string;
  route?: { path?: string };
  originalUrl?: string;
  params?: Record<string, string>;
  body?: Record<string, unknown>;
  headers?: Record<string, unknown>;
  user?: AuthenticatedUser;
  /** Setado pelo SensitiveActionGuard quando a exclusão foi confirmada por senha. */
  sensitiveActionVerified?: boolean;
  ip?: string;
  ips?: string[];
  socket?: { remoteAddress?: string };
}

/** Contexto capturado antes do handler (estado anterior p/ diff de severidade). */
interface BeforeContext {
  severity?: AlarmSeverity;
  name?: string;
  tenantId?: string | null;
}

/**
 * Interceptor global que grava automaticamente eventos de auditoria para as
 * operações de escrita mapeadas, capturando IP de origem, resultado
 * (sucesso/exceção) e — no caso comum de edição de regra de alarme — um resumo
 * before→after da severidade. Nunca grava o corpo bruto da requisição (evita
 * vazar segredos como senha em `/auth/register`).
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const req = context.switchToHttp().getRequest<RequestWithUser>();
    const method = (req.method || '').toUpperCase();
    if (!MUTATING.has(method)) return next.handle();

    const routePath = this.normalizePath(req.route?.path);
    if (!routePath) return next.handle();

    const mapping = AUDIT_ROUTES[`${method} ${routePath}`];
    if (!mapping) return next.handle();

    return from(this.captureBefore(mapping, req)).pipe(
      switchMap((before) =>
        next.handle().pipe(
          tap({
            next: (response) => {
              void this.write(mapping, req, before, 'SUCCESS', response);
            },
            error: () => {
              void this.write(mapping, req, before, 'FAILURE', undefined);
            },
          }),
        ),
      ),
    );
  }

  /** Normaliza o caminho registrado removendo barra final redundante. */
  private normalizePath(path: string | undefined): string | undefined {
    if (!path) return undefined;
    if (path.length > 1 && path.endsWith('/')) return path.slice(0, -1);
    return path;
  }

  private async captureBefore(mapping: AuditRoute, req: RequestWithUser): Promise<BeforeContext> {
    const id = req.params?.id;
    if (!id) return {};
    if (mapping.captureDevice) {
      try {
        const device = await this.prisma.device.findUnique({
          where: { id },
          select: { name: true, tenantId: true },
        });
        if (!device) return {};
        return { name: device.name, tenantId: device.tenantId };
      } catch {
        return {};
      }
    }
    if (!mapping.captureSeverity) return {};
    try {
      const rule = await this.prisma.alarmRule.findUnique({
        where: { id },
        select: { severity: true, name: true, tenantId: true },
      });
      if (!rule) return {};
      return { severity: rule.severity, name: rule.name, tenantId: rule.tenantId };
    } catch {
      return {};
    }
  }

  private async write(
    mapping: AuditRoute,
    req: RequestWithUser,
    before: BeforeContext,
    result: 'SUCCESS' | 'FAILURE',
    response: unknown,
  ): Promise<void> {
    const user = req.user;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const res = (response ?? {}) as Record<string, unknown>;

    // Comandos a equipamento (bacnet/write) respondem HTTP 200 mesmo quando o
    // gateway recusa/expira — o resultado real vem em `success`. Sem isso a
    // trilha (e a taxa de sucesso do dashboard) registraria falso SUCCESS.
    if (mapping.action === 'COMMAND' && result === 'SUCCESS' && res.success === false) {
      result = 'FAILURE';
    }

    const entityId =
      req.params?.pointId ??
      req.params?.projectId ??
      req.params?.id ??
      (typeof res.id === 'string' ? res.id : undefined) ??
      (typeof body.deviceId === 'string' ? body.deviceId : undefined);

    const entityName =
      (typeof res.name === 'string' ? res.name : undefined) ??
      (typeof body.name === 'string' ? body.name : undefined) ??
      before.name ??
      (mapping.action === 'COMMAND' ? this.commandEntityName(body) : undefined);

    let { change, beforeJson, afterJson } = this.buildChange(mapping, before, body, result);
    if (mapping.action === 'COMMAND' && !change) {
      change = this.commandChange(body, result, res);
    }
    const tenantId = this.resolveTenantId(user, body, before);

    // Exclusões críticas confirmadas por senha: registra a confirmação na trilha.
    const confirmadoPorSenha = req.sensitiveActionVerified === true;
    const changeFinal = confirmadoPorSenha
      ? (change ? `${change} · Confirmado com senha do operador` : 'Confirmado com senha do operador')
      : change;

    await this.audit.record({
      actor: user
        ? { id: user.id, name: user.name, email: user.email, role: user.role }
        : null,
      action: mapping.action,
      entityType: mapping.entity,
      entityName: entityName ?? null,
      entityId: entityId ?? null,
      change: changeFinal,
      before: beforeJson,
      after: afterJson,
      tenantId,
      ip: getClientIp(req),
      userAgent: typeof req.headers?.['user-agent'] === 'string' ? (req.headers['user-agent'] as string) : null,
      result,
    });
  }

  /** Constrói o resumo before→after (apenas severidade de regra de alarme). */
  private buildChange(
    mapping: AuditRoute,
    before: BeforeContext,
    body: Record<string, unknown>,
    result: 'SUCCESS' | 'FAILURE',
  ): { change: string | null; beforeJson: { severity: AlarmSeverity } | null; afterJson: { severity: AlarmSeverity } | null } {
    if (
      result === 'SUCCESS' &&
      mapping.captureSeverity &&
      before.severity &&
      typeof body.severity === 'string' &&
      body.severity !== before.severity &&
      this.isSeverity(body.severity)
    ) {
      const after = body.severity;
      return {
        change: `Severidade: ${SEVERITY_LABEL[before.severity]} → ${SEVERITY_LABEL[after]}`,
        beforeJson: { severity: before.severity },
        afterJson: { severity: after },
      };
    }
    return { change: null, beforeJson: null, afterJson: null };
  }

  /**
   * Nome legível do alvo de um comando de escrita (bacnet/write). Usa o rótulo
   * enviado pelo frontend quando presente; senão, identifica pelo objeto BACnet.
   */
  private commandEntityName(body: Record<string, unknown>): string | undefined {
    if (typeof body.pointLabel === 'string' && body.pointLabel.trim()) {
      return body.pointLabel.trim();
    }
    if (body.objectType !== undefined && body.objectInstance !== undefined) {
      const ip = typeof body.ip === 'string' ? ` @ ${body.ip}` : '';
      return `Objeto ${String(body.objectType)}:${String(body.objectInstance)}${ip}`;
    }
    return undefined;
  }

  /** Resumo legível do comando de escrita (valor forçado ou liberação). */
  private commandChange(
    body: Record<string, unknown>,
    result: 'SUCCESS' | 'FAILURE',
    res: Record<string, unknown>,
  ): string | null {
    if (body.value === undefined) return null;
    const prio = typeof body.priority === 'number' ? ` (prioridade ${body.priority})` : '';
    const base =
      body.value === null
        ? `Liberar valor${prio}`
        : `Forçar valor → ${String(body.value)}${prio}`;
    if (result === 'FAILURE' && typeof res.error === 'string' && res.error.trim()) {
      return `${base} · Falha: ${res.error}`;
    }
    return base;
  }

  private isSeverity(v: string): v is AlarmSeverity {
    return v === 'LOW' || v === 'MEDIUM' || v === 'HIGH';
  }

  /**
   * Cliente afetado: usuário de tenant usa o próprio; perfil global usa o tenant
   * informado no corpo ou o do estado anterior (regra de alarme); senão global.
   */
  private resolveTenantId(
    user: AuthenticatedUser | undefined,
    body: Record<string, unknown>,
    before: BeforeContext,
  ): string | null {
    if (user?.tenantId) return user.tenantId;
    if (typeof body.tenantId === 'string' && body.tenantId.trim()) return body.tenantId;
    if (before.tenantId) return before.tenantId;
    return null;
  }
}
