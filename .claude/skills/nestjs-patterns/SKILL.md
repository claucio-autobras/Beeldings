---
name: nestjs-patterns
description: Padrões obrigatórios para backend NestJS do BlueBee IoT, incluindo estrutura DDD por módulo, controllers, services, repositories, guards, DTOs, validação, erros, testes e organização de código. Use quando Codex precisar criar, refatorar ou revisar módulos, APIs, serviços, entidades, testes e integrações backend NestJS.
---

# Nestjs Patterns

## Estrutura DDD de um módulo

```
src/alarms/
├── domain/
│   ├── entities/
│   │   └── alarm.entity.ts          # classe de domínio pura, sem decorators de ORM
│   ├── interfaces/
│   │   └── alarm-repository.interface.ts
│   └── enums/
│       └── alarm-severity.enum.ts
├── application/
│   ├── use-cases/                   # um arquivo por caso de uso
│   │   └── acknowledge-alarm.use-case.ts
│   ├── services/
│   │   └── alarm-engine.service.ts
│   └── dtos/
│       ├── create-alarm-rule.dto.ts
│       └── alarm-response.dto.ts
├── infrastructure/
│   └── alarm.repository.ts          # implementação com Prisma
└── presentation/
    ├── alarms.controller.ts
    └── alarms.module.ts
```

## Controller padrão

```typescript
// presentation/alarms.controller.ts
@Controller('alarms')
@UseGuards(JwtAuthGuard, TenantGuard)
export class AlarmsController {
  constructor(private readonly alarmEngine: AlarmEngineService) {}

  @Get()
  async findAll(@TenantId() tenantId: string): Promise<AlarmResponseDto[]> {
    return this.alarmEngine.findAll(tenantId);
  }

  @Patch(':id/acknowledge')
  async acknowledge(
    @Param('id') id: string,
    @Body() dto: AcknowledgeAlarmDto,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    return this.alarmEngine.acknowledge(id, dto, user);
  }
}
```

## Guard de tenant (obrigatório em todos os controllers)

```typescript
// auth/guards/tenant.guard.ts
@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // ADMIN, CCO, SUPERVISOR não precisam de tenant fixo
    if (['ADMIN', 'CCO', 'SUPERVISOR'].includes(user.role)) return true;

    // CLIENTE e VISUALIZADOR devem ter tenant_id no JWT
    return !!user.tenant_id;
  }
}
```

## Decorator para extrair tenant_id

```typescript
// auth/decorators/tenant-id.decorator.ts
export const TenantId = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    return request.user.tenant_id;
  },
);
```

## Repository com Prisma (padrão)

```typescript
// infrastructure/alarm.repository.ts
@Injectable()
export class AlarmRepository implements IAlarmRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantId: string): Promise<Alarm[]> {
    // SEMPRE filtrar por tenant_id
    return this.prisma.alarm.findMany({
      where: { tenantId },
      orderBy: { triggeredAt: 'desc' },
    });
  }
}
```

## Fila BullMQ (para jobs assíncronos)

```typescript
// Produtor — adicionar job
await this.notificationQueue.add('send-whatsapp', {
  alarmId,
  tenantId,
  recipients,
}, {
  attempts: 3,
  backoff: { type: 'exponential', delay: 1000 },
});

// Consumidor — processar job
@Processor('notifications')
export class NotificationsConsumer {
  @Process('send-whatsapp')
  async handleWhatsApp(job: Job<NotificationJobData>): Promise<void> {
    await this.whatsappService.send(job.data);
  }
}
```

## Tratamento de erro padrão

```typescript
// Nunca lançar erros genéricos — sempre usar as exceções do NestJS
throw new NotFoundException(`Alarme ${id} não encontrado`);
throw new ForbiddenException('Sem permissão para este recurso');
throw new BadRequestException('Dados inválidos');

// Erros de integração externa — logar e lançar com contexto
try {
  await this.infraspeak.createWorkOrder(payload);
} catch (error) {
  this.logger.error('Falha ao criar OS no Infraspeak', { error, payload });
  throw new ServiceUnavailableException('Falha na integração com Infraspeak');
}
```

