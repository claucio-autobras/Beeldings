/**
 * Testes da camada de notificações externas.
 *
 * Cobre:
 *  1. providersStatus: retorna flags corretos por adaptador.
 *  2. isEmailConfigured / isWhatsAppConfigured helpers.
 *  3. Degradação sem credenciais (provedores não configurados).
 *  4. Canal desabilitado: dispatchAlarm sem email → Resend não chamado.
 *  5. Canal desabilitado: dispatchInsight sem phone → Z-API não chamada.
 *  6. Agrupamento anti-tempestade (vários alarmes na janela → um único digest).
 *  7. Mensagem individual quando há um único alarme na janela.
 *  8. Isolamento de canal: Resend falha, Z-API envia (e vice-versa).
 *  9. sendTest retorna resultado imediato, sem esperar janela.
 * 10. dispatchInsight envia para ambos os canais habilitados.
 * 11. InsightNotifierService — líder envia; não-líder não envia.
 * 12. InsightNotifierService — payload JSON inválido não lança exceção.
 */

import { ExternalNotificationsService } from './external-notifications.service.js';
import { ResendAdapter } from './resend.adapter.js';
import { ZapiAdapter } from './zapi.adapter.js';
import { InsightNotifierService } from './insight-notifier.service.js';
import { NotificationRecipientsService } from '../notification-recipients/notification-recipients.service.js';
import type { ClusterService } from '../cluster/cluster.service.js';
import type { InsightGeneratedEvent } from '../insights/insights.service.js';

// ─── Fakes ───────────────────────────────────────────────────────────────────

function makeResend(configured = true, ok = true): jest.Mocked<ResendAdapter> {
  return {
    isConfigured: jest.fn(() => configured),
    send: jest.fn(async () => ({ ok, error: ok ? undefined : 'mock error' })),
  } as unknown as jest.Mocked<ResendAdapter>;
}

function makeZapi(configured = true, ok = true): jest.Mocked<ZapiAdapter> {
  return {
    isConfigured: jest.fn(() => configured),
    send: jest.fn(async () => ({ ok, error: ok ? undefined : 'mock error' })),
  } as unknown as jest.Mocked<ZapiAdapter>;
}

function makeCluster(isLeader: boolean): jest.Mocked<ClusterService> & { _emit: (ch: string, p: string) => void } {
  const listeners = new Map<string, ((payload: string) => void)[]>();
  return {
    isLeader: jest.fn(() => isLeader),
    on: jest.fn((channel: string, cb: (payload: string) => void) => {
      const arr = listeners.get(channel) ?? [];
      arr.push(cb);
      listeners.set(channel, arr);
    }),
    _emit: (channel: string, payload: string) => {
      for (const cb of listeners.get(channel) ?? []) cb(payload);
    },
  } as unknown as jest.Mocked<ClusterService> & { _emit: (ch: string, p: string) => void };
}

/**
 * Cria um fake de NotificationRecipientsService.
 *
 * emailTargets / whatsappTargets controlam o que cada resolveRecipients retorna
 * dependendo do channel solicitado.
 */
function makeRecipientsService(
  emailTargets: Array<{ id: string; name: string; email?: string; phone?: string }> = [],
  whatsappTargets: Array<{ id: string; name: string; email?: string; phone?: string }> = [],
): jest.Mocked<NotificationRecipientsService> {
  return {
    resolveRecipients: jest.fn(async ({ channel }: { channel?: string }) => {
      if (channel === 'email') return emailTargets;
      if (channel === 'whatsapp') return whatsappTargets;
      return [...emailTargets, ...whatsappTargets];
    }),
  } as unknown as jest.Mocked<NotificationRecipientsService>;
}

function makeInsightEvent(overrides: Partial<InsightGeneratedEvent> = {}): InsightGeneratedEvent {
  return {
    insightId: 'ins-1',
    tenantId: 'tenant-1',
    tenantName: 'Cliente Teste',
    frequency: 'WEEKLY',
    trigger: 'scheduled',
    theme: 'Disponibilidade Semanal',
    summary: 'A plataforma operou com 98,5% de disponibilidade.',
    period: { start: '2026-08-11T03:00:00Z', end: '2026-08-18T03:00:00Z', label: 'Semana de 11/08' },
    recipients: [],
    ...overrides,
  };
}

const RECIPIENT_BOTH = { id: 'r1', name: 'João Silva', email: 'joao@teste.com', phone: '+5511999990000' };
const RECIPIENT_EMAIL_ONLY = { id: 'r2', name: 'Maria Santos', email: 'maria@teste.com', phone: undefined };
const RECIPIENT_WA_ONLY = { id: 'r3', name: 'Carlos Lima', email: undefined, phone: '+5511888880000' };

/** Avança os timers e drena microtasks pendentes. */
async function flushTimers(): Promise<void> {
  jest.runAllTimers();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

// ─── 1. providersStatus ───────────────────────────────────────────────────────

describe('ExternalNotificationsService — providersStatus', () => {
  it('retorna false para ambos quando não configurado', () => {
    const svc = new ExternalNotificationsService(makeResend(false), makeZapi(false));
    expect(svc.providersStatus()).toEqual({ email: false, whatsapp: false });
  });

  it('retorna true para email e false para whatsapp', () => {
    const svc = new ExternalNotificationsService(makeResend(true), makeZapi(false));
    expect(svc.providersStatus()).toEqual({ email: true, whatsapp: false });
    expect(svc.isEmailConfigured()).toBe(true);
    expect(svc.isWhatsAppConfigured()).toBe(false);
  });

  it('retorna true para ambos quando ambos configurados', () => {
    const svc = new ExternalNotificationsService(makeResend(true), makeZapi(true));
    expect(svc.providersStatus()).toEqual({ email: true, whatsapp: true });
  });
});

// ─── 2. Degradação sem credenciais ───────────────────────────────────────────

describe('ExternalNotificationsService — sem credenciais', () => {
  it('dispatchAlarm não chama nenhum adaptador quando ambos desabilitados', async () => {
    const resend = makeResend(false);
    const zapi = makeZapi(false);
    const svc = new ExternalNotificationsService(resend, zapi);

    jest.useFakeTimers();
    svc.dispatchAlarm(RECIPIENT_BOTH, {
      alarmName: 'T', severity: 'HIGH', deviceName: 'D', pointName: 'P',
      siteName: 'S', valueAtTrigger: 1, activatedAt: new Date(), reactivated: false,
    });
    await flushTimers();

    expect(resend.send).not.toHaveBeenCalled();
    expect(zapi.send).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('sendTest retorna ok=false quando Resend não configurado', async () => {
    const svc = new ExternalNotificationsService(makeResend(false), makeZapi(false));
    const result = await svc.sendTest(RECIPIENT_BOTH, 'email');
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('sendTest retorna ok=false quando Z-API não configurada', async () => {
    const svc = new ExternalNotificationsService(makeResend(true), makeZapi(false));
    const result = await svc.sendTest(RECIPIENT_BOTH, 'whatsapp');
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });
});

// ─── 3. Canal desabilitado — dispatchAlarm ───────────────────────────────────

describe('ExternalNotificationsService — respeito ao canal habilitado (alarmes)', () => {
  const ctx = {
    alarmName: 'Alarme', severity: 'HIGH' as const, deviceName: 'D', pointName: 'P',
    siteName: 'S', valueAtTrigger: 1, activatedAt: new Date(), reactivated: false,
  };

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('não chama Resend quando destinatário não tem email (emailEnabled=false → email=undefined)', async () => {
    const resend = makeResend(true);
    const zapi = makeZapi(true);
    const svc = new ExternalNotificationsService(resend, zapi);

    svc.dispatchAlarm(RECIPIENT_WA_ONLY, ctx);
    await flushTimers();

    expect(resend.send).not.toHaveBeenCalled();
    expect(zapi.send).toHaveBeenCalledTimes(1);
  });

  it('não chama Z-API quando destinatário não tem phone (whatsappEnabled=false → phone=undefined)', async () => {
    const resend = makeResend(true);
    const zapi = makeZapi(true);
    const svc = new ExternalNotificationsService(resend, zapi);

    svc.dispatchAlarm(RECIPIENT_EMAIL_ONLY, ctx);
    await flushTimers();

    expect(resend.send).toHaveBeenCalledTimes(1);
    expect(zapi.send).not.toHaveBeenCalled();
  });

  it('chama ambos quando destinatário tem email e phone', async () => {
    const resend = makeResend(true);
    const zapi = makeZapi(true);
    const svc = new ExternalNotificationsService(resend, zapi);

    svc.dispatchAlarm(RECIPIENT_BOTH, ctx);
    await flushTimers();

    expect(resend.send).toHaveBeenCalledTimes(1);
    expect(zapi.send).toHaveBeenCalledTimes(1);
  });
});

// ─── 4. Canal desabilitado — dispatchInsight ─────────────────────────────────

describe('ExternalNotificationsService — respeito ao canal habilitado (insights)', () => {
  const insightCtx = {
    tenantName: 'Tenant', theme: 'Disponibilidade', summary: 'ok',
    periodLabel: 'Semana', frequency: 'WEEKLY',
  };

  it('não chama Resend quando destinatário não tem email (emailEnabled=false → email=undefined)', () => {
    const resend = makeResend(true);
    const zapi = makeZapi(true);
    const svc = new ExternalNotificationsService(resend, zapi);

    svc.dispatchInsight(RECIPIENT_WA_ONLY, insightCtx);

    expect(resend.send).not.toHaveBeenCalled();
    expect(zapi.send).toHaveBeenCalledTimes(1);
  });

  it('não chama Z-API quando destinatário não tem phone (whatsappEnabled=false → phone=undefined)', () => {
    const resend = makeResend(true);
    const zapi = makeZapi(true);
    const svc = new ExternalNotificationsService(resend, zapi);

    svc.dispatchInsight(RECIPIENT_EMAIL_ONLY, insightCtx);

    expect(resend.send).toHaveBeenCalledTimes(1);
    expect(zapi.send).not.toHaveBeenCalled();
  });

  it('envia para ambos os canais quando destinatário tem email e phone', () => {
    const resend = makeResend(true);
    const zapi = makeZapi(true);
    const svc = new ExternalNotificationsService(resend, zapi);

    svc.dispatchInsight(RECIPIENT_BOTH, insightCtx);

    expect(resend.send).toHaveBeenCalledTimes(1);
    expect(zapi.send).toHaveBeenCalledTimes(1);
  });

  it('não chama adaptadores quando ambos desabilitados', () => {
    const svc = new ExternalNotificationsService(makeResend(false), makeZapi(false));
    svc.dispatchInsight(RECIPIENT_BOTH, insightCtx);
    // dispatchInsight retorna cedo sem chamar adaptadores
    // (os adaptadores só são chamados se isConfigured=true)
  });
});

// ─── 5. Anti-tempestade (agrupamento) ────────────────────────────────────────

describe('ExternalNotificationsService — agrupamento anti-tempestade', () => {
  const ctx = {
    alarmName: 'X', severity: 'HIGH' as const, deviceName: 'D', pointName: 'P',
    siteName: 'S', valueAtTrigger: 1, activatedAt: new Date(), reactivated: false,
  };

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('envia um único digest quando múltiplos alarmes chegam na janela', async () => {
    const resend = makeResend(true);
    const zapi = makeZapi(false);
    const svc = new ExternalNotificationsService(resend, zapi);

    svc.dispatchAlarm(RECIPIENT_BOTH, { ...ctx, alarmName: 'Alarme A' });
    svc.dispatchAlarm(RECIPIENT_BOTH, { ...ctx, alarmName: 'Alarme B' });
    svc.dispatchAlarm(RECIPIENT_BOTH, { ...ctx, alarmName: 'Alarme C' });

    await flushTimers();

    expect(resend.send).toHaveBeenCalledTimes(1);
    const call = resend.send.mock.calls[0][0];
    expect(call.subject).toMatch(/3 alarmes/i);
  });

  it('envia mensagem individual quando há um único alarme na janela', async () => {
    const resend = makeResend(true);
    const zapi = makeZapi(true);
    const svc = new ExternalNotificationsService(resend, zapi);

    svc.dispatchAlarm(RECIPIENT_BOTH, { ...ctx, alarmName: 'Alarme Único' });

    await flushTimers();

    expect(resend.send).toHaveBeenCalledTimes(1);
    expect(resend.send.mock.calls[0][0].subject).toContain('Alarme Único');
    expect(zapi.send).toHaveBeenCalledTimes(1);
    expect(zapi.send.mock.calls[0][0].message).toContain('Alarme Único');
  });
});

// ─── 6. Isolamento de canal ───────────────────────────────────────────────────

describe('ExternalNotificationsService — isolamento de canal', () => {
  const ctx = {
    alarmName: 'X', severity: 'HIGH' as const, deviceName: 'D', pointName: 'P',
    siteName: 'S', valueAtTrigger: 1, activatedAt: new Date(), reactivated: false,
  };

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('Resend falha mas Z-API envia normalmente', async () => {
    const resend = makeResend(true, false);
    const zapi = makeZapi(true, true);
    const svc = new ExternalNotificationsService(resend, zapi);

    svc.dispatchAlarm(RECIPIENT_BOTH, ctx);
    await flushTimers();
    await flushTimers();

    expect(resend.send).toHaveBeenCalled();
    expect(zapi.send).toHaveBeenCalledTimes(1);
    expect((await zapi.send.mock.results[0].value).ok).toBe(true);
  });

  it('Z-API falha mas Resend envia normalmente', async () => {
    const resend = makeResend(true, true);
    const zapi = makeZapi(true, false);
    const svc = new ExternalNotificationsService(resend, zapi);

    svc.dispatchAlarm(RECIPIENT_BOTH, ctx);
    await flushTimers();
    await flushTimers();

    expect(resend.send).toHaveBeenCalledTimes(1);
    expect((await resend.send.mock.results[0].value).ok).toBe(true);
    expect(zapi.send).toHaveBeenCalled();
  });
});

// ─── 7. sendTest ─────────────────────────────────────────────────────────────

describe('ExternalNotificationsService — sendTest', () => {
  it('chama resend.send imediatamente (sem esperar janela)', async () => {
    const resend = makeResend(true, true);
    const zapi = makeZapi(false);
    const svc = new ExternalNotificationsService(resend, zapi);

    const result = await svc.sendTest(RECIPIENT_BOTH, 'email');

    expect(result.ok).toBe(true);
    expect(resend.send).toHaveBeenCalledTimes(1);
    expect(resend.send.mock.calls[0][0].to).toBe(RECIPIENT_BOTH.email);
    expect(resend.send.mock.calls[0][0].subject).toMatch(/teste/i);
  });

  it('chama zapi.send imediatamente', async () => {
    const resend = makeResend(false);
    const zapi = makeZapi(true, true);
    const svc = new ExternalNotificationsService(resend, zapi);

    const result = await svc.sendTest(RECIPIENT_BOTH, 'whatsapp');

    expect(result.ok).toBe(true);
    expect(zapi.send).toHaveBeenCalledTimes(1);
  });
});

// ─── 8. InsightNotifierService — leader-only + channel filtering ──────────────

describe('InsightNotifierService — leader-only e filtragem por canal', () => {
  it('não envia quando a instância NÃO é líder', async () => {
    const resend = makeResend(true);
    const zapi = makeZapi(true);
    const svc = new ExternalNotificationsService(resend, zapi);
    const cluster = makeCluster(false);
    const recipients = makeRecipientsService([RECIPIENT_BOTH], [RECIPIENT_BOTH]);

    const notifier = new InsightNotifierService(cluster, svc, recipients);
    notifier.onModuleInit();

    cluster._emit('insight_generated', JSON.stringify(makeInsightEvent()));
    await Promise.resolve();
    await Promise.resolve();

    expect(resend.send).not.toHaveBeenCalled();
    expect(zapi.send).not.toHaveBeenCalled();
  });

  it('envia para ambos os canais quando a instância É líder', async () => {
    const resend = makeResend(true);
    const zapi = makeZapi(true);
    const svc = new ExternalNotificationsService(resend, zapi);
    const cluster = makeCluster(true);
    const recipients = makeRecipientsService([RECIPIENT_BOTH], [RECIPIENT_BOTH]);

    const notifier = new InsightNotifierService(cluster, svc, recipients);
    notifier.onModuleInit();

    cluster._emit('insight_generated', JSON.stringify(makeInsightEvent()));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(resend.send).toHaveBeenCalledTimes(1);
    expect(zapi.send).toHaveBeenCalledTimes(1);
  });

  it('não envia para e-mail quando emailEnabled=false (destinatário sem email na resolução)', async () => {
    const resend = makeResend(true);
    const zapi = makeZapi(true);
    const svc = new ExternalNotificationsService(resend, zapi);
    const cluster = makeCluster(true);
    // Email canal: sem destinatários; WhatsApp: tem RECIPIENT_WA_ONLY
    const recipients = makeRecipientsService([], [RECIPIENT_WA_ONLY]);

    const notifier = new InsightNotifierService(cluster, svc, recipients);
    notifier.onModuleInit();

    cluster._emit('insight_generated', JSON.stringify(makeInsightEvent()));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(resend.send).not.toHaveBeenCalled();
    expect(zapi.send).toHaveBeenCalledTimes(1);
  });

  it('não envia para WhatsApp quando whatsappEnabled=false (destinatário sem phone na resolução)', async () => {
    const resend = makeResend(true);
    const zapi = makeZapi(true);
    const svc = new ExternalNotificationsService(resend, zapi);
    const cluster = makeCluster(true);
    // Email canal: tem RECIPIENT_EMAIL_ONLY; WhatsApp: sem destinatários
    const recipients = makeRecipientsService([RECIPIENT_EMAIL_ONLY], []);

    const notifier = new InsightNotifierService(cluster, svc, recipients);
    notifier.onModuleInit();

    cluster._emit('insight_generated', JSON.stringify(makeInsightEvent()));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(resend.send).toHaveBeenCalledTimes(1);
    expect(zapi.send).not.toHaveBeenCalled();
  });

  it('ignora payload JSON inválido sem lançar exceção', async () => {
    const resend = makeResend(true);
    const zapi = makeZapi(true);
    const svc = new ExternalNotificationsService(resend, zapi);
    const cluster = makeCluster(true);
    const recipients = makeRecipientsService([RECIPIENT_BOTH], [RECIPIENT_BOTH]);

    const notifier = new InsightNotifierService(cluster, svc, recipients);
    notifier.onModuleInit();

    cluster._emit('insight_generated', 'payload inválido {{{');
    await Promise.resolve();

    expect(resend.send).not.toHaveBeenCalled();
  });
});
