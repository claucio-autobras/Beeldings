/**
 * AlarmNotifierService — gancho entre o motor de alarmes e a entrega externa.
 *
 * Registra-se no AlarmEngineService para receber callbacks de ativação/reativação,
 * resolve os destinatários SEPARADAMENTE por canal (email / whatsapp) — respeitando
 * os flags emailEnabled/whatsappEnabled de cada destinatário — e despacha via
 * ExternalNotificationsService (que aplica anti-tempestade + retry).
 *
 * É leader-only por natureza: o AlarmEngineService só roda na instância líder.
 */

import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AlarmEngineService } from '../alarms/alarm-engine.service.js';
import { NotificationRecipientsService } from '../notification-recipients/notification-recipients.service.js';
import { ExternalNotificationsService } from './external-notifications.service.js';
import type { AlarmContext } from './notification-templates.js';
import type { AlarmEvent } from '@prisma/client';

interface LoadedRuleMin {
  id: string;
  tenantId: string;
  pointId: string;
  deviceId: string;
  tag: string;
  name: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
}

@Injectable()
export class AlarmNotifierService implements OnModuleInit {
  private readonly logger = new Logger(AlarmNotifierService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly engine: AlarmEngineService,
    private readonly recipients: NotificationRecipientsService,
    private readonly notifier: ExternalNotificationsService,
  ) {}

  onModuleInit(): void {
    if (!this.engine) return;
    this.engine.setAlarmNotifier((event, rule, reactivated) => {
      void this.handleAlarm(event, rule, reactivated);
    });
    this.logger.log('Notificador de alarmes externo registrado');
  }

  private async handleAlarm(
    event: AlarmEvent,
    rule: LoadedRuleMin,
    reactivated: boolean,
  ): Promise<void> {
    if (!this.notifier.isAnyProviderConfigured()) return;

    try {
      // Verifica se o tenant está ativo (tenants inativos não recebem notificações).
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: rule.tenantId },
        select: { active: true },
      });
      if (!tenant?.active) return;

      // Carrega informações do equipamento e ponto para o contexto da mensagem.
      const device = await this.prisma.device.findUnique({
        where: { id: rule.deviceId },
        select: { name: true, siteId: true, site: { select: { id: true, name: true } } },
      });
      const point = await this.prisma.devicePoint.findUnique({
        where: { id: rule.pointId },
        select: { objectName: true, tag: true },
      });

      const ctx: AlarmContext = {
        alarmName: rule.name,
        severity: rule.severity,
        deviceName: device?.name ?? rule.deviceId,
        pointName: point?.objectName ?? point?.tag ?? rule.tag,
        siteName: device?.site?.name ?? null,
        valueAtTrigger: event.valueAtTrigger,
        activatedAt: event.activatedAt,
        reactivated,
      };

      const siteId = device?.siteId ?? undefined;

      // Resolve destinatários SEPARADAMENTE por canal — respeita emailEnabled/whatsappEnabled.
      const [emailTargets, whatsappTargets] = await Promise.all([
        this.notifier.isEmailConfigured()
          ? this.recipients.resolveRecipients({
              tenantId: rule.tenantId,
              category: 'alarms',
              channel: 'email',
              siteId,
            })
          : Promise.resolve([]),
        this.notifier.isWhatsAppConfigured()
          ? this.recipients.resolveRecipients({
              tenantId: rule.tenantId,
              category: 'alarms',
              channel: 'whatsapp',
              siteId,
            })
          : Promise.resolve([]),
      ]);

      // Constrói mapa unificado com flags de canal por destinatário.
      const byId = new Map<string, { id: string; name: string; email?: string; phone?: string; sendEmail: boolean; sendWhatsApp: boolean }>();
      for (const r of emailTargets) {
        byId.set(r.id, { id: r.id, name: r.name, email: r.email, phone: undefined, sendEmail: true, sendWhatsApp: false });
      }
      for (const r of whatsappTargets) {
        const existing = byId.get(r.id);
        if (existing) {
          // Atualiza phone com o valor da resolução whatsapp e ativa a flag.
          existing.phone = r.phone;
          existing.sendWhatsApp = true;
        } else {
          byId.set(r.id, { id: r.id, name: r.name, email: undefined, phone: r.phone, sendEmail: false, sendWhatsApp: true });
        }
      }

      if (byId.size === 0) return;

      this.logger.log(
        `Disparando notificação de alarme "${rule.name}" para ${byId.size} destinatário(s) (tenant=${rule.tenantId})`,
      );

      for (const r of byId.values()) {
        // Passa somente os contatos dos canais habilitados — dispatchAlarm ignora
        // canais sem contato, respeitando emailEnabled/whatsappEnabled do cadastro.
        this.notifier.dispatchAlarm(
          {
            id: r.id,
            name: r.name,
            email: r.sendEmail ? r.email : undefined,
            phone: r.sendWhatsApp ? r.phone : undefined,
          },
          ctx,
        );
      }
    } catch (err) {
      // Nunca propaga — não pode travar o motor de alarmes.
      this.logger.error(`Falha ao despachar notificação do alarme ${rule.name}: ${(err as Error).message}`);
    }
  }
}
