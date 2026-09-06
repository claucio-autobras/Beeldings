/**
 * InsightNotifierService — consome o canal cluster `insight_generated` e
 * entrega notificações externas (e-mail/WhatsApp) para os destinatários
 * da categoria "insights" de cada tenant.
 *
 * IMPORTANTE — somente a instância líder realiza o envio.
 * O barramento ClusterService usa Postgres NOTIFY e entrega o evento a TODAS
 * as instâncias; sem o guard isLeader() cada réplica enviaria a mesma mensagem.
 *
 * Resolução de destinatários por canal:
 * O evento traz tenantId; este serviço resolve os destinatários separadamente
 * por canal (email e whatsapp) para respeitar os flags emailEnabled/whatsappEnabled
 * — igual ao padrão usado em AlarmNotifierService.
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ClusterService } from '../cluster/cluster.service.js';
import { ExternalNotificationsService } from './external-notifications.service.js';
import { NotificationRecipientsService } from '../notification-recipients/notification-recipients.service.js';
import { INSIGHT_GENERATED_CHANNEL, type InsightGeneratedEvent } from '../insights/insights.service.js';

@Injectable()
export class InsightNotifierService implements OnModuleInit {
  private readonly logger = new Logger(InsightNotifierService.name);

  constructor(
    private readonly cluster: ClusterService,
    private readonly notifier: ExternalNotificationsService,
    private readonly recipients: NotificationRecipientsService,
  ) {}

  onModuleInit(): void {
    this.cluster.on(INSIGHT_GENERATED_CHANNEL, (payload) => {
      void this.handleInsight(payload);
    });
    this.logger.log('Notificador de insights externo registrado');
  }

  private async handleInsight(payload: string): Promise<void> {
    // Somente a instância líder envia notificações.
    // O canal NOTIFY entrega a mensagem a TODAS as instâncias; sem este guard,
    // cada réplica ativa enviaria o mesmo e-mail/WhatsApp ao destinatário.
    if (!this.cluster.isLeader()) return;

    if (!this.notifier.isAnyProviderConfigured()) return;

    let event: InsightGeneratedEvent;
    try {
      event = JSON.parse(payload) as InsightGeneratedEvent;
    } catch {
      this.logger.warn('Payload do evento insight_generated inválido (JSON quebrado)');
      return;
    }

    const { tenantId, tenantName, theme, summary, period, frequency } = event;

    // Resolve destinatários SEPARADAMENTE por canal — respeita emailEnabled/whatsappEnabled.
    const [emailTargets, whatsappTargets] = await Promise.all([
      this.notifier.isEmailConfigured()
        ? this.recipients.resolveRecipients({
            tenantId,
            category: 'insights',
            channel: 'email',
          })
        : Promise.resolve([]),
      this.notifier.isWhatsAppConfigured()
        ? this.recipients.resolveRecipients({
            tenantId,
            category: 'insights',
            channel: 'whatsapp',
          })
        : Promise.resolve([]),
    ]);

    // Constrói mapa unificado com flags de canal por destinatário.
    const byId = new Map<
      string,
      { id: string; name: string; email?: string; phone?: string; sendEmail: boolean; sendWhatsApp: boolean }
    >();
    for (const r of emailTargets) {
      // Inclui phone desde já: se este destinatário também estiver na lista whatsapp,
      // o phone virá da resolução de whatsapp e substituirá; mas se o objeto já tem
      // phone (raro em resolução de email), preservamos.
      byId.set(r.id, { id: r.id, name: r.name, email: r.email, phone: undefined, sendEmail: true, sendWhatsApp: false });
    }
    for (const r of whatsappTargets) {
      const existing = byId.get(r.id);
      if (existing) {
        // Atualiza phone com o valor da resolução whatsapp (que é o contato autorizado
        // para este canal); ativa a flag.
        existing.phone = r.phone;
        existing.sendWhatsApp = true;
      } else {
        byId.set(r.id, { id: r.id, name: r.name, email: undefined, phone: r.phone, sendEmail: false, sendWhatsApp: true });
      }
    }

    if (byId.size === 0) return;

    const ctx = { tenantName, theme, summary, periodLabel: period.label, frequency };

    this.logger.log(
      `Enviando insight "${theme}" (${period.label}) para ${byId.size} destinatário(s) — tenant=${tenantName}`,
    );

    for (const r of byId.values()) {
      try {
        this.notifier.dispatchInsight(
          {
            id: r.id,
            name: r.name,
            email: r.sendEmail ? r.email : undefined,
            phone: r.sendWhatsApp ? r.phone : undefined,
          },
          ctx,
        );
      } catch (err) {
        // Nunca propaga — não pode afetar outros destinatários.
        this.logger.error(`Falha ao despachar insight para ${r.name}: ${(err as Error).message}`);
      }
    }
  }
}
