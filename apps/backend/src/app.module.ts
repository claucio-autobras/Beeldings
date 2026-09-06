import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { GlobalThrottlerGuard } from './common/global-throttler.guard';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { DevicesModule } from './modules/devices/devices.module';
import { AlarmsModule } from './modules/alarms/alarms.module';
import { TrendsModule } from './modules/trends/trends.module';
import { MqttModule } from './modules/mqtt/mqtt.module';
import { PrismaModule } from './modules/prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { ProjectsModule } from './modules/projects/presentation/projects.module';
import { SitesModule } from './modules/sites/presentation/sites.module';
import { GatewaysModule } from './modules/gateways/presentation/gateways.module';
import { ScadaModule } from './modules/scada/presentation/scada.module';
import { ReportsModule } from './modules/reports/reports.module';
import { InfraspeakModule } from './modules/infraspeak/infraspeak.module';
import { AuditModule } from './modules/audit/audit.module';
import { ClusterModule } from './modules/cluster/cluster.module';
import { HealthModule } from './modules/health/health.module';
import { AiModule } from './modules/ai/ai.module';
import { KnowledgeModule } from './modules/knowledge/knowledge.module';
import { AutomationModule } from './modules/automation/automation.module';
import { NotificationRecipientsModule } from './modules/notification-recipients/notification-recipients.module';
import { InsightsModule } from './modules/insights/insights.module';
import { ExternalNotificationsModule } from './modules/external-notifications/external-notifications.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    // Rate limiting global por IP: teto GENEROSO por padrão (o frontend faz
    // polling de dashboards/telemetria com dezenas de requests por tela), com
    // limites estritos aplicados por @Throttle nos endpoints sensíveis (login,
    // confirm-password). Configurável via RATE_LIMIT_MAX / RATE_LIMIT_TTL_MS.
    ThrottlerModule.forRoot({
      throttlers: [
        {
          name: 'default',
          ttl: Number(process.env.RATE_LIMIT_TTL_MS) || 60_000,
          limit: Number(process.env.RATE_LIMIT_MAX) || 600,
        },
      ],
    }),
    PrismaModule,
    AuthModule,
    MqttModule,
    DashboardModule,
    DevicesModule,
    AlarmsModule,
    TrendsModule,
    TenantsModule,
    ProjectsModule,
    SitesModule,
    GatewaysModule,
    ScadaModule,
    ReportsModule,
    InfraspeakModule,
    AuditModule,
    ClusterModule,
    HealthModule,
    KnowledgeModule,
    AiModule,
    AutomationModule,
    NotificationRecipientsModule,
    InsightsModule,
    ExternalNotificationsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: GlobalThrottlerGuard },
  ],
})
export class AppModule {}
