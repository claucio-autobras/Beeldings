/**
 * Roteador de mock para o modo demonstração (NEXT_PUBLIC_USE_MOCK=true).
 *
 * Na Fase 1 não há backend: o `api-client` delega aqui todas as chamadas HTTP.
 * Os GETs devolvem dados de `mocks/data` (ou listas vazias quando não há dados
 * cadastrados, que é o estado esperado da demonstração). Mutações são resolvidas
 * em memória ou ecoam o corpo enviado, mantendo a UI navegável sem servidor.
 *
 * Não é um fallback silencioso para um backend: caminhos sem tratamento explícito
 * registram um aviso no console para ficarem visíveis durante o desenvolvimento.
 */
import { mockTenants } from '@/mocks/data/tenants.mock';
import { mockSites, mockDevices, type Device } from '@/mocks/data/devices.mock';
import { mockScadaScreens } from '@/mocks/data/scada.mock';
import {
  mockAdminStats,
  mockPendingCommands,
  mockGateways,
} from '@/mocks/data/dashboard-admin.mock';
import { mockClientStats, mockSystemStatuses } from '@/mocks/data/dashboard-client.mock';
import { mockAlarms } from '@/mocks/data/alarms.mock';
import { alarmsHandler } from '@/mocks/handlers/alarms.handler';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

const nowIso = (): string => new Date().toISOString();
const genId = (): string => `mock-${Math.random().toString(36).slice(2, 10)}`;

// Perfil do usuário demo — espelha os perfis de `useCurrentUser` (por papel)
const MOCK_ROLE_KEY = 'bluebee_mock_role';

interface MockProfile {
  id: string;
  name: string;
  email: string;
  role: string;
  tenantId: string | null;
}

const MOCK_PROFILES: Record<string, MockProfile> = {
  ADMIN: { id: 'user-admin-001', name: 'Admin Autobras', email: 'admin@autobras.com.br', role: 'ADMIN', tenantId: null },
  CCO: { id: 'user-cco-001', name: 'Carlos CCO', email: 'cco@autobras.com.br', role: 'CCO', tenantId: null },
  SUPERVISOR: { id: 'user-supervisor-001', name: 'Sandra Supervisora', email: 'supervisora@autobras.com.br', role: 'SUPERVISOR', tenantId: null },
  CLIENTE: { id: 'user-cliente-001', name: 'Claucio Santos', email: 'claucio@empresademo.com.br', role: 'CLIENTE', tenantId: 'tenant-autobras' },
  VISUALIZADOR: { id: 'user-visualizador-001', name: 'Maria Visualizadora', email: 'maria@empresademo.com.br', role: 'VISUALIZADOR', tenantId: 'tenant-autobras' },
};

function mockProfile(): MockProfile {
  let role = 'ADMIN';
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem(MOCK_ROLE_KEY);
    if (stored && stored in MOCK_PROFILES) role = stored;
  }
  return MOCK_PROFILES[role];
}

function splitPath(path: string): { pathname: string; params: URLSearchParams } {
  const [pathname, qs] = path.split('?');
  return { pathname, params: new URLSearchParams(qs ?? '') };
}

function deviceTenant(d: Device): string | undefined {
  return (d as { tenantId?: string }).tenantId;
}

// ─── GET ────────────────────────────────────────────────────────────────────

function handleGet(pathname: string, params: URLSearchParams): unknown {
  const tenantId = params.get('tenantId') ?? undefined;
  const siteId = params.get('siteId') ?? undefined;
  const projectId = params.get('projectId') ?? undefined;

  // Clientes (tenants)
  if (pathname === '/tenants') {
    return mockTenants.map((t) => ({
      id: t.id,
      name: t.name,
      slug: t.slug,
      siteCount: mockSites.filter((s) => s.tenantId === t.id).length,
      deviceCount: mockDevices.filter((d) => deviceTenant(d) === t.id).length,
      createdAt: nowIso(),
    }));
  }

  // Sites
  if (pathname === '/sites') {
    return mockSites
      .filter((s) => !tenantId || s.tenantId === tenantId)
      .map((s) => ({
        id: s.id,
        name: s.name,
        tenantId: s.tenantId,
        createdAt: nowIso(),
        _count: { projects: 0 },
      }));
  }

  // Dispositivos
  if (pathname === '/devices') {
    return mockDevices.filter((d) => {
      const t = deviceTenant(d);
      return !tenantId || !t || t === tenantId;
    });
  }

  // Gateways (status em minúsculas, como os consumidores comparam)
  if (pathname === '/gateways') {
    return mockGateways.map((g) => ({
      id: g.id,
      tenantId: tenantId ?? 'tenant-autobras',
      status: g.status,
      lastSeen: nowIso(),
      createdAt: nowIso(),
    }));
  }

  // Telas SCADA (forma "crua" — o service aplica fromApi)
  if (pathname === '/scada/screens') {
    return mockScadaScreens.filter(
      (s) =>
        (!tenantId || s.tenantId === tenantId) &&
        (!siteId || s.siteId === siteId) &&
        (!projectId || s.projectId === projectId),
    );
  }
  if (pathname.startsWith('/scada/screens/')) {
    const id = pathname.split('/')[3];
    const found = mockScadaScreens.find((s) => s.id === id);
    if (!found) throw new Error(`Tela não encontrada: ${id}`);
    return found;
  }

  // Dashboard
  if (pathname === '/dashboard/admin-stats') return mockAdminStats;
  // Ativos críticos — sem mock dedicado: card mostra o estado vazio.
  if (pathname === '/dashboard/critical-assets') {
    return { from: nowIso(), to: nowIso(), generatedAt: nowIso(), assets: [] };
  }
  if (pathname === '/dashboard/client-stats') return mockClientStats;
  // Comandos: mapeia o mock (action) para o contrato do dashboard (command/status)
  if (pathname === '/commands') {
    return mockPendingCommands.map((c) => ({
      id: c.id,
      tenantName: c.tenantName,
      siteId: null,
      siteName: c.siteName,
      deviceName: c.deviceName,
      command: c.action,
      requestedAt: c.requestedAt,
      requestedBy: c.requestedBy,
      status: 'pending' as const,
    }));
  }
  if (pathname === '/systems/status') return mockSystemStatuses;

  // Perfil do usuário autenticado (modo mock)
  if (pathname === '/auth/profile') return mockProfile();

  // Chat IA — histórico de conversas (vazio na demonstração)
  if (pathname === '/ai/conversations') return [];
  if (pathname.startsWith('/ai/conversations/')) return { messages: [] };

  // Painel "Servidores" — estado do cluster e uso de armazenamento (demonstração)
  if (pathname === '/cluster/status') {
    return { isLeader: true, instanceId: 'mock-instance-1' };
  }
  if (pathname === '/health/storage') {
    return {
      usedBytes: 2_400_000_000,
      quotaBytes: 8_000_000_000,
      percent: 30,
      environment: 'homologacao',
    };
  }
  if (pathname === '/health/storage/tables') {
    return {
      tables: [
        { name: 'telemetry', bytes: 1_200_000_000 },
        { name: 'alarm_events', bytes: 640_000_000 },
        { name: 'trends', bytes: 410_000_000 },
        { name: 'devices', bytes: 90_000_000 },
      ],
    };
  }

  // Base de conhecimento (vazia na demonstração)
  if (pathname === '/knowledge') return [];

  // Bancada de pontos virtuais (SCADA) — sem dispositivos virtuais na demonstração
  if (pathname === '/scada/simulator/devices') return [];

  // Histórico de comandos (trilha de auditoria) — vazio na demonstração
  if (pathname === '/reports/command-history') return [];

  // Alarmes (contrato v1)
  if (pathname === '/alarms') {
    const status = params.get('status');
    let list = alarmsHandler.getAll(tenantId);
    if (status === 'open') list = list.filter((a) => a.status !== 'RECONHECIDO');
    return list;
  }
  if (pathname === '/alarms/stats') {
    return alarmsHandler.getStats(tenantId);
  }
  if (pathname === '/alarm-events/stats') {
    const s = alarmsHandler.getStats(tenantId);
    return {
      total: s.total,
      active: s.activeCount,
      pendingAck: s.pendingAck,
      acknowledged: s.acknowledgedCount,
    };
  }

  // Endpoint de objeto único sem dados na demonstração → erro explícito
  // (evita devolver shape inválido para quem espera um objeto).
  if (pathname.startsWith('/projects/')) {
    throw new Error('Projeto não encontrado no modo demonstração.');
  }

  // Sem dados cadastrados na demonstração → listas vazias (estado esperado)
  if (
    pathname === '/projects' ||
    pathname === '/scada/projects' ||
    pathname === '/alarm-events' ||
    pathname === '/alarm-rules' ||
    pathname === '/trends'
  ) {
    return [];
  }

  console.warn(`[mock] GET sem tratamento, retornando lista vazia: ${pathname}`);
  return [];
}

// ─── POST ───────────────────────────────────────────────────────────────────

function handlePost(pathname: string, body: unknown): unknown {
  // Reconhecer alarme (v1) — mantém estado em memória
  const ackV1 = pathname.match(/^\/alarms\/([^/]+)\/acknowledge$/);
  if (ackV1) {
    const b = (body ?? {}) as { userId?: string; note?: string };
    return alarmsHandler.acknowledge(ackV1[1], b.userId ?? 'mock-user', b.note ?? '');
  }

  // Upload de asset SCADA → devolve a própria data URL para a imagem renderizar
  if (pathname === '/scada/assets') {
    const b = (body ?? {}) as { dataUrl?: string };
    return { url: b.dataUrl ?? '' };
  }

  // Chat IA — resposta de demonstração (sem backend/Anthropic na Fase 1)
  if (pathname === '/ai/chat') {
    const b = (body ?? {}) as { conversationId?: string | null; content?: string };
    return {
      reply:
        'Olá! Sou o Bluebee, assistente da plataforma Beeldings. No modo demonstração não há backend de IA ' +
        'conectado, então respondo com uma mensagem de exemplo. Na próxima fase, com o ' +
        'backend ativo, as respostas serão geradas por IA com base na sua operação.',
      conversationId: b.conversationId ?? genId(),
      title: (b.content ?? 'Nova conversa').slice(0, 40),
      sources: [],
    };
  }

  // Chat IA — sugestões por equipamento (demonstração)
  if (pathname === '/ai/suggest') {
    const b = (body ?? {}) as { deviceId?: string };
    const dev = mockDevices.find((d) => d.id === b.deviceId);
    return {
      deviceId: b.deviceId ?? '',
      deviceName: dev?.name ?? 'Equipamento',
      alarms: [],
      suggestion:
        'No modo demonstração não há análise de IA conectada. Com o backend ativo, aqui ' +
        'aparecem sugestões de diagnóstico e ações com base nos alarmes do equipamento.',
      sources: [],
    };
  }

  // Escrita BACnet — confirma sucesso na demonstração
  if (pathname === '/devices/bacnet/write') {
    return { success: true, command_id: genId() };
  }

  // Bancada de pontos virtuais (SCADA) — garante o dispositivo virtual do projeto
  if (pathname === '/scada/simulator/ensure') {
    const b = (body ?? {}) as { projectId?: string; tenantId?: string };
    return {
      id: genId(),
      name: 'Dispositivo Virtual',
      protocol: 'virtual',
      siteId: null,
      tenantId: b.tenantId ?? 'tenant-autobras',
      gatewayId: null,
      config: { virtual: true, projectId: b.projectId },
      points: [],
    };
  }

  // Echo genérico: cria um recurso com id gerado
  const b = (body ?? {}) as Record<string, unknown>;
  return { id: genId(), createdAt: nowIso(), ...b };
}

// ─── PATCH ──────────────────────────────────────────────────────────────────

function handlePatch(pathname: string, body: unknown): unknown {
  // Tela SCADA marcada como inicial — devolve a tela completa (shape p/ fromApi)
  const homeMatch = pathname.match(/^\/scada\/screens\/([^/]+)\/home$/);
  if (homeMatch) {
    const screen = mockScadaScreens.find((s) => s.id === homeMatch[1]);
    if (!screen) throw new Error(`Tela não encontrada: ${homeMatch[1]}`);
    return { ...screen, isHome: true };
  }

  // Atualização de tela SCADA — mescla sobre a tela existente (shape completo)
  const screenMatch = pathname.match(/^\/scada\/screens\/([^/]+)$/);
  if (screenMatch) {
    const screen = mockScadaScreens.find((s) => s.id === screenMatch[1]);
    const b = (body ?? {}) as Record<string, unknown>;
    return { ...(screen ?? { id: screenMatch[1] }), ...b, updatedAt: nowIso() };
  }

  // Conta — atualização de perfil/senha (modo mock)
  if (pathname === '/account/profile') {
    const b = (body ?? {}) as Record<string, unknown>;
    return { ...mockProfile(), ...b };
  }
  if (pathname === '/account/password') {
    return { success: true };
  }

  const id = pathname.split('/').filter(Boolean).pop() ?? genId();
  const b = (body ?? {}) as Record<string, unknown>;
  return { id, updatedAt: nowIso(), ...b };
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

export function mockRequest<T>(method: HttpMethod, path: string, body?: unknown): Promise<T> {
  const { pathname, params } = splitPath(path);
  switch (method) {
    case 'GET':
      return Promise.resolve(handleGet(pathname, params) as T);
    case 'POST':
      return Promise.resolve(handlePost(pathname, body) as T);
    case 'PUT':
    case 'PATCH':
      return Promise.resolve(handlePatch(pathname, body) as T);
    case 'DELETE':
      return Promise.resolve(undefined as T);
    default:
      throw new Error(`[mock] Método não suportado: ${method}`);
  }
}
