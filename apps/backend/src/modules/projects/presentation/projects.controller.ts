import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { ProjectsService } from '../application/projects.service.js';
import { buildMqttIntegrationGuidePdf } from '../application/mqtt-guide-pdf.helper.js';
import type { ProjectWithGateway } from '../application/projects.service.js';
import type { CreateProjectDto } from '../application/dtos/create-project.dto.js';
import type { UpdateProjectDto } from '../application/dtos/update-project.dto.js';
import { JwtAuthGuard } from '../../auth/presentation/guards/jwt-auth.guard.js';
import { SensitiveActionGuard } from '../../auth/presentation/guards/sensitive-action.guard.js';
import { CurrentUser } from '../../auth/presentation/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../auth/domain/interfaces/auth.interface.js';
import type { Project } from '@prisma/client';
import { isGlobalRole, resolveTenantScope } from '../../auth/presentation/tenant-scope.util.js';

@Controller('projects')
@UseGuards(JwtAuthGuard)
export class ProjectsController {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly config: ConfigService,
  ) {}

  @Post('/')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() body: CreateProjectDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ProjectWithGateway> {
    const effectiveTenantId = isGlobalRole(user)
      ? (body.tenantId ?? user.tenantId ?? '')
      : resolveTenantScope(user)!;

    return this.projectsService.create({
      ...body,
      tenantId: effectiveTenantId,
    });
  }

  @Get('/')
  async findAll(
    @Query('siteId') siteId: string | undefined,
    @Query('tenantId') queryTenantId: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Project[]> {
    const tenantId = resolveTenantScope(user, queryTenantId);
    return this.projectsService.findAll(siteId, tenantId);
  }

  @Get('/:id')
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Project> {
    const tenantId = resolveTenantScope(user);
    return this.projectsService.findOne(id, tenantId);
  }

  @Get('/:id/gateway-config')
  @Header('Content-Type', 'text/plain')
  async downloadGatewayConfig(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ): Promise<void> {
    const tenantId = resolveTenantScope(user);
    const config = await this.projectsService.getGatewayConfig(id, tenantId);

    // URL pública do broker MQTT que o gateway usará para se conectar.
    // Em dev local: mqtt://localhost:1883
    // Em produção: mqtts://mqtt.bluebee.com.br:8883
    const brokerUrl = this.config.get<string>(
      'MQTT_GATEWAY_BROKER_URL',
      this.config.get<string>('MQTT_BROKER_URL', 'mqtt://localhost:1883'),
    );

    const content = [
      `# BlueBee IoT — Gateway Configuration`,
      `# Gerado automaticamente pela plataforma. Não edite manualmente.`,
      ``,
      `GATEWAY_ID=${config.gatewayId}`,
      `TENANT_ID=${config.tenantId}`,
      `MQTT_BROKER_URL=${brokerUrl}`,
      `MQTT_USERNAME=${config.mqttUser}`,
      `MQTT_PASSWORD=${config.mqttPass}`,
      `HEARTBEAT_INTERVAL_MS=30000`,
      `SQLITE_DB_PATH=./data/buffer.db`,
    ].join('\n');

    res.setHeader('Content-Type', 'text/plain');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="gateway-config.env"`,
    );
    res.send(content);
  }

  /**
   * GET /projects/:id/mqtt-integration-guide
   * Gera o "Guia de Integração MQTT" (PDF) preenchido com os valores reais do
   * gateway deste projeto — broker, credencial de sensores (senha mascarada),
   * prefixo de tópicos e o contrato completo do modal "Adicionar ponto".
   * Mesmo escopo de tenant do gateway-config.env.
   */
  @Get('/:id/mqtt-integration-guide')
  async downloadMqttIntegrationGuide(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ): Promise<void> {
    const tenantId = resolveTenantScope(user);
    const data = await this.projectsService.getMqttGuideData(id, tenantId);

    // Mesma URL pública usada no gateway-config.env (mqtts://host:8883 em prod).
    const brokerUrl = this.config.get<string>(
      'MQTT_GATEWAY_BROKER_URL',
      this.config.get<string>('MQTT_BROKER_URL', 'mqtt://localhost:1883'),
    );
    let brokerHost = brokerUrl;
    let brokerPort = '1883';
    let brokerTls = false;
    try {
      const parsed = new URL(brokerUrl);
      brokerHost = parsed.hostname;
      brokerTls = parsed.protocol === 'mqtts:' || parsed.protocol === 'ssl:' || parsed.protocol === 'tls:';
      brokerPort = parsed.port || (brokerTls ? '8883' : '1883');
    } catch {
      // URL fora do padrão: imprime como veio.
    }

    const pdf = buildMqttIntegrationGuidePdf({
      projectName: data.projectName,
      siteName: data.siteName,
      tenantId: data.tenantId,
      gatewayId: data.gatewayId,
      brokerHost,
      brokerPort,
      brokerTls,
      mqttUsername: data.sensorMqttUser,
      credentialProvisioned: data.credentialProvisioned,
      generatedAt: new Date(),
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="guia-integracao-mqtt-${data.gatewayId}.pdf"`,
    );
    res.setHeader('Content-Length', pdf.length.toString());
    res.end(pdf);
  }

  @Patch('/:id')
  async update(
    @Param('id') id: string,
    @Body() body: UpdateProjectDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Project> {
    if (user.role !== 'ADMIN' && user.role !== 'CCO' && user.role !== 'SUPERVISOR') {
      throw new BadRequestException('Sem permissão para editar projetos');
    }
    const tenantId = resolveTenantScope(user);
    return this.projectsService.update(id, tenantId, body);
  }

  @Delete('/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(SensitiveActionGuard)
  async delete(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    if (user.role !== 'ADMIN' && user.role !== 'CCO') {
      throw new BadRequestException('Sem permissão para excluir projetos');
    }
    const tenantId = resolveTenantScope(user);
    return this.projectsService.delete(id, tenantId);
  }
}
