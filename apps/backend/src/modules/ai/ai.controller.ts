import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/presentation/guards/jwt-auth.guard.js';
import { CurrentUser } from '../auth/presentation/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/domain/interfaces/auth.interface.js';
import { AiRateLimitGuard } from './ai-rate-limit.guard.js';
import { AiService } from './ai.service.js';
import type {
  ChatPollResult,
  ChatStartResult,
  ConversationDetail,
  ConversationSummary,
  FirstActionResult,
  SuggestionResult,
} from './ai.service.js';

interface ChatRequestBody {
  conversationId?: string;
  content?: string;
}

interface SuggestRequestBody {
  deviceId?: string;
  symptom?: string;
}

interface FirstActionRequestBody {
  deviceId?: string;
  pointId?: string;
  alarmEventId?: string;
  locale?: string;
}

const MAX_SYMPTOM = 1000;

const MAX_CONTENT = 8000;

// Papéis com acesso global (tenant nulo legítimo). Demais papéis precisam de
// tenant; um tenant nulo neles é inconsistência e não pode virar acesso global.
const GLOBAL_ROLES = new Set(['ADMIN', 'CCO', 'SUPERVISOR']);

@Controller('ai')
@UseGuards(JwtAuthGuard)
export class AiController {
  constructor(private readonly ai: AiService) {}

  // GET /ai/conversations — lista as conversas do próprio usuário.
  @Get('conversations')
  async listConversations(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ConversationSummary[]> {
    return this.ai.listConversations(user.id);
  }

  // GET /ai/conversations/:id — carrega o histórico de uma conversa do usuário.
  @Get('conversations/:id')
  async getConversation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<ConversationDetail> {
    return this.ai.getConversation(user.id, id);
  }

  // DELETE /ai/conversations/:id — remove uma conversa do próprio usuário.
  @Delete('conversations/:id')
  async deleteConversation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<{ success: true }> {
    await this.ai.deleteConversation(user.id, id);
    return { success: true };
  }

  // POST /ai/chat — envia um novo turno; cria a conversa se não houver id.
  // Responde na hora (o proxy de produção corta requests >30s) e a resposta é
  // gerada em segundo plano — o cliente busca via GET /ai/chat/result.
  // Rate limit por usuário: o endpoint chama a API paga a cada turno.
  @Post('chat')
  @UseGuards(AiRateLimitGuard)
  async chat(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ChatRequestBody,
  ): Promise<ChatStartResult> {
    const content = typeof body?.content === 'string' ? body.content.trim() : '';
    if (!content) {
      throw new BadRequestException('A mensagem não pode estar vazia.');
    }

    const conversationId =
      typeof body?.conversationId === 'string' && body.conversationId.length > 0
        ? body.conversationId
        : null;

    // Contexto factual ao vivo (diagnóstico/offline/tempo em falha) só com
    // escopo seguro: usuário com tenant OU papel global. Um cliente sem tenant
    // (inconsistência) nunca ganha visão global dos dados por acidente.
    const tenantId = user.tenantId ?? null;
    const liveData = tenantId !== null || GLOBAL_ROLES.has(user.role);

    return this.ai.startChat(user.id, tenantId, conversationId, content.slice(0, MAX_CONTENT), {
      liveData,
    });
  }

  // GET /ai/chat/result?conversationId=&after= — resultado de um turno
  // iniciado pelo POST /ai/chat (polling). Durável: lê do banco, então
  // funciona após restart e com múltiplas instâncias do backend.
  @Get('chat/result')
  async chatResult(
    @CurrentUser() user: AuthenticatedUser,
    @Query('conversationId') conversationId?: string,
    @Query('after') after?: string,
  ): Promise<ChatPollResult> {
    if (!conversationId || !after) {
      throw new BadRequestException('Informe conversationId e after.');
    }
    return this.ai.getChatResult(user.id, conversationId, after);
  }

  // POST /ai/suggest — sugere ações para um equipamento do próprio tenant.
  // Rate limit por usuário: também chama a API paga (busca + síntese).
  @Post('suggest')
  @UseGuards(AiRateLimitGuard)
  async suggest(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: SuggestRequestBody,
  ): Promise<SuggestionResult> {
    const deviceId = typeof body?.deviceId === 'string' ? body.deviceId.trim() : '';
    if (!deviceId) {
      throw new BadRequestException('Informe o equipamento (deviceId).');
    }

    const symptom =
      typeof body?.symptom === 'string' ? body.symptom.trim().slice(0, MAX_SYMPTOM) : undefined;

    // Tenant nulo só é aceito para papéis globais; senão recusa para não
    // permitir leitura cross-tenant de equipamento/alarmes via sondagem de ID.
    const tenantId = user.tenantId ?? null;
    if (tenantId === null && !GLOBAL_ROLES.has(user.role)) {
      throw new ForbiddenException('Usuário sem tenant associado.');
    }

    return this.ai.suggestForDevice(tenantId, deviceId, symptom || undefined);
  }

  // POST /ai/first-action — "primeira ação sugerida" para ativo crítico em
  // falha (painel do dashboard). Rate limit por usuário: chama a API paga.
  @Post('first-action')
  @UseGuards(AiRateLimitGuard)
  async firstAction(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: FirstActionRequestBody,
  ): Promise<FirstActionResult> {
    const deviceId = typeof body?.deviceId === 'string' ? body.deviceId.trim() : '';
    if (!deviceId) {
      throw new BadRequestException('Informe o equipamento (deviceId).');
    }

    // Mesma regra do /ai/suggest: tenant nulo só para papéis globais — evita
    // leitura cross-tenant de equipamento/alarmes via sondagem de ID.
    const tenantId = user.tenantId ?? null;
    if (tenantId === null && !GLOBAL_ROLES.has(user.role)) {
      throw new ForbiddenException('Usuário sem tenant associado.');
    }

    return this.ai.firstAction(user, tenantId, {
      deviceId,
      pointId: typeof body?.pointId === 'string' && body.pointId.trim() ? body.pointId.trim() : undefined,
      alarmEventId:
        typeof body?.alarmEventId === 'string' && body.alarmEventId.trim()
          ? body.alarmEventId.trim()
          : undefined,
      locale: body?.locale === 'en' ? 'en' : 'pt',
    });
  }
}
