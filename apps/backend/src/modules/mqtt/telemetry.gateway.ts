import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger, OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { resolveCorsOrigins } from '../../common/cors.util.js';
import { JwtPayload } from '../auth/domain/interfaces/auth.interface.js';
import { readSessionCookie } from '../auth/session-cookie.js';
import { ClusterService } from '../cluster/cluster.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Canal do barramento do cluster (LISTEN/NOTIFY) para avisos de automação.
 * Esses eventos nascem só no líder (scheduler leadership-gated); publicá-los aqui
 * faz TODAS as instâncias reemiti-los via Socket.IO, cobrindo clientes conectados
 * em qualquer instância. Alarmes de telemetria NÃO usam este canal (são avaliados
 * em cada instância e emitidos direto), evitando emissão duplicada.
 */
export const AUTOMATION_NOTICE_CHANNEL = 'automation_notice';

/**
 * Canal do barramento do cluster para mudanças de status do cliente (tenant
 * ativado/inativado). Sockets são por instância, então CADA instância precisa
 * reagir: invalida o cache de status e derruba os sockets do room `tenant:{id}`
 * quando o cliente é inativado. Payload: JSON `{ tenantId, active }`.
 */
export const TENANT_STATUS_CHANNEL = 'tenant_status';

/**
 * "Tenant" sentinela para avisos de SISTEMA (ex.: saúde do broker EMQX),
 * destinados aos papéis GLOBAIS (admin/CCO/supervisor). Não existe na tabela
 * de tenants — eventos com este tenantId são emitidos só no room `scope:all`
 * e aparecem apenas no sino dos papéis globais.
 */
export const SYSTEM_TENANT_ID = '__system__';

/** TTL do cache em memória de status ativo/inativo do tenant (por instância). */
const TENANT_ACTIVE_CACHE_TTL_MS = 30_000;

export interface BacnetTelemetryPoint {
  tag: string;
  /** Presentes em pontos BACnet/virtuais; ausentes em protocolos por tag (Modbus, SNMP). */
  objectType?: number;
  objectInstance?: number;
  /** Numérico/booleano na maioria dos pontos; string para CharacterString Value (BACnet tipo 40). */
  value: number | boolean | string;
  unit: string | null;
  /**
   * Estado do valor (câmeras CFTV): 'waiting_event' | 'unsupported' |
   * 'error' | 'estimated' — ausente = leitura real do hardware.
   */
  state?: string;
  /** Origem da leitura (câmeras CFTV): 'http' | 'mib2' | 'oid' | 'provider' | 'ping'. */
  source?: string;
  /** Valor sentinela do firmware (ex.: 0 fixo da Intelbras) — "dado não confiável". */
  unreliable?: boolean;
}

export interface BacnetTelemetryPayload {
  timestamp: string;
  deviceId: string;
  points: BacnetTelemetryPoint[];
}

export interface CommandResultPayload {
  command_id: string;
  success: boolean;
  error: string | null;
}

/**
 * Evento de uma sessão de visualização ao vivo de câmera (canal efêmero):
 * frame JPEG em base64, erro de captura ou encerramento da sessão.
 */
export interface CameraFramePayload {
  sessionId: string;
  deviceId: string;
  type: 'frame' | 'error' | 'ended';
  /** Timestamp do frame/evento (ISO). */
  ts: string;
  /** Sequencial do frame na sessão (type='frame'). */
  seq?: number;
  /** JPEG em base64 (type='frame'). */
  image?: string;
  /** Código/mensagem do erro de captura (type='error'). */
  errorCode?: string;
  error?: string;
  /** Motivo do encerramento (type='ended'). */
  reason?: string;
}

/**
 * Evento emitido em tempo real para as telas operacionais. Cobre tanto alarmes
 * de telemetria (`kind='ALARM'`) quanto avisos de automação (`kind='AUTOMATION_NOTICE'`).
 * Campos específicos de alarme (ponto/dispositivo/regra) são opcionais porque
 * avisos de automação não os possuem — o handler do frontend apenas invalida as
 * queries do sino, então não depende deles.
 */
export interface AlarmEventPayload {
  id: string;
  kind: 'ALARM' | 'AUTOMATION_NOTICE';
  tenantId: string;
  message: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  state: 'ACTIVE' | 'ACTIVE_ACK' | 'NORMALIZED_UNACK' | 'NORMALIZED_ACK';
  activatedAt: string;
  /** Nome da origem: automação (avisos). */
  sourceName?: string | null;
  /** Id da automação de origem (avisos) — deep-link p/ histórico. */
  sourceId?: string | null;
  alarmRuleId?: string | null;
  pointId?: string | null;
  deviceId?: string | null;
  tag?: string | null;
  name?: string | null;
  valueAtTrigger?: number | null;
  normalizedAt?: string | null;
  acknowledgedAt?: string | null;
  acknowledgedBy?: string | null;
  /** Nome resolvido de quem reconheceu (acknowledgedBy guarda o userId). */
  acknowledgedByName?: string | null;
}

/** Estado por socket, resolvido no handshake a partir do JWT. */
interface SocketScope {
  userId: string;
  /** Tenant do usuário (null = papel global: ADMIN/CCO/SUPERVISOR). */
  tenantId: string | null;
  /** Global vê todos os tenants (room `scope:all`); pode estreitar por escolha. */
  isGlobal: boolean;
}

/** Room que recebe TODOS os eventos — só papéis globais podem entrar nele. */
const SCOPE_ALL = 'scope:all';

/**
 * TelemetryGateway — realtime por escopo (rooms por tenant).
 *
 * Isolamento: no handshake o socket é autenticado por JWT. Usuários de um tenant
 * ficam TRAVADOS no room `tenant:{id}` do próprio tenant (não recebem dados de
 * outro). Papéis globais (tenantId null) entram em `scope:all` e podem estreitar
 * para um tenant específico via a mensagem `scope:subscribe`.
 *
 * Fan-out multi-instância: NÃO usa Redis. Telemetria e resultados de comando são
 * assinados do MQTT por CADA instância (fan-out no broker); alarmes são avaliados
 * em cada instância. Logo, cada instância já possui o evento localmente e só
 * precisa emiti-lo para os seus próprios clientes no room do escopo — qualquer
 * cliente, em qualquer instância, recebe. (Ver ClusterService para o racional.)
 */
// CORS do handshake segue a mesma política do HTTP: permissivo em dev, restrito
// às origens configuradas em produção (ver resolveCorsOrigins).
@WebSocketGateway({
  cors: { origin: resolveCorsOrigins() ?? true, credentials: true },
  namespace: '/telemetry',
})
export class TelemetryGateway
  implements
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleInit
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(TelemetryGateway.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly cluster: ClusterService,
    private readonly prisma: PrismaService,
  ) {}

  /** Cache local de status ativo do tenant (evita hit no banco por evento). */
  private readonly tenantActiveCache = new Map<
    string,
    { active: boolean; expiresAt: number }
  >();

  onModuleInit(): void {
    // Reemite avisos de automação vindos do barramento do cluster (publicados
    // pelo líder). Roda em TODAS as instâncias → clientes de qualquer instância
    // recebem o `alarm:event` no room do seu tenant.
    this.cluster.on(AUTOMATION_NOTICE_CHANNEL, (payload) => {
      try {
        const data = JSON.parse(payload) as AlarmEventPayload;
        this.emitAlarmEvent(data);
      } catch (err) {
        this.logger.warn(
          `Falha ao reemitir aviso de automação: ${(err as Error).message}`,
        );
      }
    });

    // Mudança de status do cliente: atualiza o cache local e, se inativado,
    // derruba os sockets do room do tenant NESTA instância (sockets são
    // por instância; o publisher notifica todas via barramento).
    this.cluster.on(TENANT_STATUS_CHANNEL, (payload) => {
      try {
        const { tenantId, active } = JSON.parse(payload) as {
          tenantId: string;
          active: boolean;
        };
        if (!tenantId) return;
        this.tenantActiveCache.set(tenantId, {
          active,
          expiresAt: Date.now() + TENANT_ACTIVE_CACHE_TTL_MS,
        });
        if (!active) {
          void this.disconnectTenantSockets(tenantId);
        }
      } catch (err) {
        this.logger.warn(
          `Falha ao processar mudança de status de tenant: ${(err as Error).message}`,
        );
      }
    });
  }

  /** Desconecta todos os sockets do room do tenant nesta instância. */
  private async disconnectTenantSockets(tenantId: string): Promise<void> {
    try {
      const sockets = await this.server.in(this.tenantRoom(tenantId)).fetchSockets();
      for (const socket of sockets) {
        socket.disconnect(true);
      }
      if (sockets.length > 0) {
        this.logger.log(
          `Cliente ${tenantId} inativado: ${sockets.length} socket(s) desconectado(s)`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Falha ao desconectar sockets do tenant ${tenantId}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Status ativo do tenant com cache curto por instância. Em erro de banco,
   * assume ativo (fail-open) para não silenciar alarmes de clientes válidos.
   */
  private async isTenantActive(tenantId: string): Promise<boolean> {
    const cached = this.tenantActiveCache.get(tenantId);
    if (cached && cached.expiresAt > Date.now()) return cached.active;
    try {
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { active: true },
      });
      const active = tenant?.active ?? true;
      this.tenantActiveCache.set(tenantId, {
        active,
        expiresAt: Date.now() + TENANT_ACTIVE_CACHE_TTL_MS,
      });
      return active;
    } catch (err) {
      this.logger.warn(
        `Falha ao consultar status do tenant ${tenantId}: ${(err as Error).message}`,
      );
      return true;
    }
  }

  /**
   * Autenticação PRÉ-conexão via middleware do Socket.IO: roda ANTES de o handshake
   * ser aceito, então um token ausente/inválido nunca chega a conectar (sem a corrida
   * do connect-e-depois-disconnect). Valida o JWT e anexa o escopo em `socket.data`.
   */
  afterInit(server: Server): void {
    server.use(async (socket, next) => {
      try {
        const token = this.extractToken(socket);
        if (!token) {
          throw new Error('token ausente');
        }
        const payload = await this.jwt.verifyAsync<JwtPayload>(token);
        // Usuário de cliente inativado não conecta (papéis globais, sem tenant,
        // seguem normalmente). Cobre reconexões após o drop dos sockets ativos.
        if (payload.tenantId && !(await this.isTenantActive(payload.tenantId))) {
          throw new Error('cliente inativo');
        }
        socket.data.scope = {
          userId: payload.sub,
          tenantId: payload.tenantId ?? null,
          isGlobal: payload.tenantId == null,
        } satisfies SocketScope;
        next();
      } catch (err) {
        this.logger.warn(
          `Conexão Socket.IO rejeitada (${socket.id}): ${(err as Error).message}`,
        );
        next(new Error('unauthorized'));
      }
    });
  }

  async handleConnection(client: Socket): Promise<void> {
    // O escopo já foi validado no middleware (afterInit). Aqui só entramos nos
    // rooms — o middleware garante que só chegam sockets autenticados.
    const scope = client.data.scope as SocketScope | undefined;
    if (!scope) {
      client.disconnect(true);
      return;
    }

    if (scope.isGlobal) {
      await client.join(SCOPE_ALL);
    } else {
      await client.join(this.tenantRoom(scope.tenantId as string));
    }

    this.logger.log(
      `Cliente conectado: ${client.id} (escopo=${scope.isGlobal ? 'GLOBAL' : scope.tenantId})`,
    );
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`Cliente desconectado: ${client.id}`);
  }

  /**
   * Permite a um papel GLOBAL estreitar o escopo para um tenant específico
   * (ou voltar a "todos" com tenantId null). Usuários de tenant são IGNORADOS
   * — ficam sempre travados no room do próprio tenant (isolamento).
   */
  @SubscribeMessage('scope:subscribe')
  async handleScopeSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { tenantId?: string | null },
  ): Promise<void> {
    const scope = client.data.scope as SocketScope | undefined;
    if (!scope || !scope.isGlobal) {
      return;
    }

    // Sai dos rooms de escopo atuais antes de entrar no novo.
    for (const room of client.rooms) {
      if (room === client.id) continue;
      if (room === SCOPE_ALL || room.startsWith('tenant:')) {
        await client.leave(room);
      }
    }

    const tenantId = body?.tenantId ?? null;
    if (tenantId) {
      await client.join(this.tenantRoom(tenantId));
    } else {
      await client.join(SCOPE_ALL);
    }
  }

  emitTelemetry(data: BacnetTelemetryPayload, tenantId: string): void {
    this.scopedEmit('bacnet:telemetry', data, tenantId);
  }

  emitCommandResult(data: CommandResultPayload, tenantId: string): void {
    this.scopedEmit('bacnet:command:result', data, tenantId);
  }

  /**
   * Frame (ou evento de erro/fim) de uma sessão de visualização ao vivo de
   * câmera. Canal EFÊMERO: nada é persistido — o evento só existe no socket.
   * Emissão direta em toda instância (como telemetria/alarme): cada instância
   * assina o tópico MQTT de frames e emite aos seus próprios clientes.
   */
  emitCameraFrame(data: CameraFramePayload, tenantId: string): void {
    this.scopedEmit('camera:frame', data, tenantId);
  }

  emitAlarmEvent(data: AlarmEventPayload): void {
    // Avisos de SISTEMA (broker EMQX etc.) não pertencem a nenhum cliente:
    // vão direto para o escopo global, sem consulta de status de tenant.
    if (data.tenantId === SYSTEM_TENANT_ID) {
      this.server.to(SCOPE_ALL).emit('alarm:event', data);
      return;
    }
    // Ponto único de silenciamento: eventos de cliente INATIVO não são emitidos
    // em tempo real (nem no room do tenant, nem no escopo global) — cobre tanto
    // alarmes de telemetria quanto avisos de automação reemitidos pelo cluster.
    // O evento continua registrado no banco (histórico preservado).
    void this.isTenantActive(data.tenantId).then((active) => {
      if (!active) return;
      this.doEmitAlarmEvent(data);
    });
  }

  private doEmitAlarmEvent(data: AlarmEventPayload): void {
    // Avisos de automação são destinados APENAS ao operador do cliente (tenant):
    // emitimos só no room do tenant, sem incluir `scope:all`, de modo que papéis
    // globais (admin/CCO/supervisor) NÃO recebam o pop-up/sino em tempo real.
    // Cobre também o caminho do barramento do cluster (o líder publica o aviso e
    // cada instância reemite por aqui). Alarmes de telemetria (kind='ALARM')
    // continuam indo para o escopo global via scopedEmit.
    if (data.kind === 'AUTOMATION_NOTICE') {
      this.server.to(this.tenantRoom(data.tenantId)).emit('alarm:event', data);
      return;
    }
    this.scopedEmit('alarm:event', data, data.tenantId);
  }

  /**
   * Emite um evento para o room do tenant + `scope:all` (papéis globais).
   * O Socket.IO deduplica entre rooms, então um socket em ambos recebe uma vez.
   * Sem tenantId (evento sem escopo definido) → só papéis globais recebem.
   */
  private scopedEmit(event: string, data: unknown, tenantId: string | null): void {
    const target = tenantId
      ? this.server.to(this.tenantRoom(tenantId)).to(SCOPE_ALL)
      : this.server.to(SCOPE_ALL);
    target.emit(event, data);
  }

  private tenantRoom(tenantId: string): string {
    return `tenant:${tenantId}`;
  }

  private extractToken(client: Socket): string | null {
    const fromAuth = client.handshake.auth?.token as unknown;
    if (typeof fromAuth === 'string' && fromAuth.length > 0) {
      return fromAuth.replace(/^Bearer\s+/i, '');
    }
    const header = client.handshake.headers?.authorization;
    if (typeof header === 'string' && header.length > 0) {
      return header.replace(/^Bearer\s+/i, '');
    }
    // Cookie de sessão HttpOnly (browser conecta com withCredentials).
    return readSessionCookie({ headers: client.handshake.headers });
  }
}
