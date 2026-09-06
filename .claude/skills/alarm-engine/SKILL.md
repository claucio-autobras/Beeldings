---
name: alarm-engine
description: Padrões do motor de alarmes do BlueBee/Autobras IoT para ciclo de vida, avaliação de regras, debounce, escalonamento por tempo, reconhecimento, resolução, persistência e integração com notificações. Use quando Codex precisar modelar, implementar, revisar ou testar funcionalidades de alarmes industriais em backend NestJS, frontend operacional, banco de dados, jobs BullMQ, telemetria MQTT, regras por threshold/range/binary/no-data/rate-of-change, estados TRIGGERED/ESCALATED/ACKNOWLEDGED/RESOLVED, severidades e fluxos de ACK.
---

# Alarm Engine

Use estes padrões ao implementar ou revisar o motor de alarmes do BlueBee/Autobras IoT. Preserve o ciclo de vida, a semântica de ACK e resolução, e a separação entre avaliação automática, ação do operador e notificação.

## Ciclo De Vida

Modele o alarme com estes estados:

```text
TRIGGERED -> ESCALATED -> ACKNOWLEDGED -> RESOLVED
              ^               |
              |               v
         sem ACK        operador anota
```

| Estado | Quando | Quem |
|--------|--------|------|
| `TRIGGERED` | Condição da regra avaliada como verdadeira | Motor automático |
| `ESCALATED` | Não reconhecido após `escalationTimeoutMinutes` | Timer automático |
| `ACKNOWLEDGED` | Operador reconhece e opcionalmente anota | CCO/SUPERVISOR/CLIENTE |
| `RESOLVED` | Condição volta ao normal | Motor automático |

Mantenha a regra principal: um alarme só vai para `RESOLVED` quando a condição for sanada. Se for reconhecido mas continuar ativo, permaneça em `ACKNOWLEDGED` até a condição normalizar.

## Tipos De Regra

Use estes tipos como contrato base:

```typescript
export enum AlarmRuleType {
  THRESHOLD_HIGH = 'threshold_high',
  THRESHOLD_LOW = 'threshold_low',
  THRESHOLD_RANGE = 'threshold_range',
  BINARY_STATE = 'binary_state',
  NO_DATA = 'no_data',
  RATE_OF_CHANGE = 'rate_of_change',
}
```

Interprete cada tipo assim:

| Tipo | Condição |
|------|----------|
| `threshold_high` | `value > threshold` |
| `threshold_low` | `value < threshold` |
| `threshold_range` | `value < thresholdMin || value > thresholdMax` |
| `binary_state` | `value === binaryExpectedValue` |
| `no_data` | sem telemetria por `noDataTimeoutMinutes` |
| `rate_of_change` | variação por minuto acima do limite configurado |

## Estrutura Da Regra

Use este formato como referência para entidades, DTOs e schemas:

```typescript
interface AlarmRule {
  id: string;
  tenantId: string;
  deviceId: string;
  variableTag: string;
  ruleType: AlarmRuleType;
  severity: AlarmSeverity;
  threshold?: number;
  thresholdMin?: number;
  thresholdMax?: number;
  binaryExpectedValue?: boolean;
  noDataTimeoutMinutes?: number;
  debounceSeconds: number;
  escalationTimeoutMinutes: number;
  notifyInternal: boolean;
  notifyClient: boolean;
  active: boolean;
}
```

Valide que apenas os campos compatíveis com `ruleType` sejam obrigatórios em cada regra. Não permita regras ativas sem `tenantId`, `deviceId`, `variableTag`, `severity`, `debounceSeconds` e `escalationTimeoutMinutes`.

## Avaliação De Telemetria

Ao receber telemetria via MQTT, busque regras ativas pelo trio `tenantId + deviceId + tag`, avalie cada regra e direcione para disparo ou resolução.

```typescript
async evaluate(telemetryPoint: TelemetryPoint): Promise<void> {
  const rules = await this.rulesRepo.findActive(
    telemetryPoint.tenantId,
    telemetryPoint.deviceId,
    telemetryPoint.tag,
  );

  for (const rule of rules) {
    const triggered = this.checkCondition(rule, telemetryPoint.value);

    if (triggered) {
      await this.handleTriggered(rule, telemetryPoint);
    } else {
      await this.handleResolved(rule, telemetryPoint);
    }
  }
}

private checkCondition(rule: AlarmRule, value: number | boolean): boolean {
  switch (rule.ruleType) {
    case 'threshold_high':
      return typeof value === 'number' && value > rule.threshold!;
    case 'threshold_low':
      return typeof value === 'number' && value < rule.threshold!;
    case 'threshold_range':
      return typeof value === 'number' && (value < rule.thresholdMin! || value > rule.thresholdMax!);
    case 'binary_state':
      return value === rule.binaryExpectedValue;
    default:
      return false;
  }
}
```

Trate `no_data` e `rate_of_change` como avaliações temporais, não como simples comparação do ponto atual. Para `no_data`, use job periódico ou watcher por último timestamp. Para `rate_of_change`, compare contra histórico recente com janela e unidade explícitas.

## Debounce

Antes de criar um alarme, exija que a condição persista por `debounceSeconds`. Isso evita flapping e alarmes transitórios.

```typescript
private async handleTriggered(rule: AlarmRule, point: TelemetryPoint): Promise<void> {
  const existing = await this.alarmsRepo.findActive(rule.id);
  if (existing) return;

  const debounceOk = await this.checkDebounce(rule, point.timestamp);
  if (!debounceOk) return;

  const alarm = await this.alarmsRepo.create({
    ruleId: rule.id,
    tenantId: rule.tenantId,
    deviceId: rule.deviceId,
    tag: rule.variableTag,
    severity: rule.severity,
    value: point.value,
    status: 'TRIGGERED',
    triggeredAt: new Date(),
  });

  await this.scheduleEscalation(rule, alarm.id);
  await this.notificationService.notify(alarm, rule);
}
```

Considere "ativo" qualquer alarme em `TRIGGERED`, `ESCALATED` ou `ACKNOWLEDGED`. Não crie duplicatas enquanto existir alarme ativo para a mesma regra.

## Escalonamento

Agende escalonamento quando o alarme for criado. Escalone somente se o alarme ainda estiver `TRIGGERED` quando o job executar.

```typescript
private async scheduleEscalation(rule: AlarmRule, alarmId: string): Promise<void> {
  await this.escalationQueue.add(
    'escalate-alarm',
    { ruleId: rule.id, alarmId },
    {
      delay: rule.escalationTimeoutMinutes * 60 * 1000,
      jobId: `escalate-${alarmId}`,
    },
  );
}

async processEscalation(job: Job<{ alarmId: string }>): Promise<void> {
  const alarm = await this.alarmsRepo.findById(job.data.alarmId);
  if (!alarm || alarm.status !== 'TRIGGERED') return;

  await this.alarmsRepo.updateStatus(alarm.id, 'ESCALATED');
  await this.notificationService.notifyEscalation(alarm);
}
```

Use `jobId` estável para permitir cancelamento no ACK. Não escale alarmes já reconhecidos, resolvidos ou removidos.

## Reconhecimento E Resolução

Permita ACK apenas para `TRIGGERED` e `ESCALATED`.

```typescript
async acknowledge(alarmId: string, userId: string, note?: string): Promise<void> {
  const alarm = await this.alarmsRepo.findById(alarmId);

  if (!alarm || !['TRIGGERED', 'ESCALATED'].includes(alarm.status)) {
    throw new BadRequestException('Alarme não está em estado reconhecível');
  }

  await this.alarmsRepo.update(alarmId, {
    status: 'ACKNOWLEDGED',
    acknowledgedBy: userId,
    acknowledgedAt: new Date(),
    acknowledgeNote: note,
  });

  await this.escalationQueue.removeJobs(`escalate-${alarmId}`);
}
```

Resolva automaticamente quando a condição voltar ao normal. Ao resolver, registre `resolvedAt`, preserve histórico de ACK e não apague o alarme.

## Persistência

Use esta tabela como base quando o projeto usar SQL/Supabase/PostgreSQL:

```sql
CREATE TABLE alarms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  rule_id UUID REFERENCES alarm_rules(id),
  device_id TEXT NOT NULL,
  tag TEXT NOT NULL,
  severity TEXT NOT NULL,
  status TEXT NOT NULL,
  value DOUBLE PRECISION,
  triggered_at TIMESTAMPTZ NOT NULL,
  acknowledged_by UUID REFERENCES users(id),
  acknowledged_at TIMESTAMPTZ,
  acknowledge_note TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON alarms (tenant_id, status, triggered_at DESC);
CREATE INDEX ON alarms (rule_id, status);
```

Restrinja consultas por `tenant_id`. Em telas operacionais, ordene alarmes ativos por severidade e `triggered_at`.

## Severidade E UI

Mapeie severidades de forma consistente no backend, contratos de API e frontend:

| Severidade | Cor | Uso |
|------------|-----|-----|
| `CRITICAL` | `red-600` | Falha grave, risco imediato ao equipamento |
| `HIGH` | `orange-500` | Fora de limites, ação urgente necessária |
| `MEDIUM` | `yellow-500` | Desvio, monitorar com atenção |
| `LOW` | `blue-500` | Aviso preventivo |
| `INFO` | `gray-500` | Evento informativo, sem ação necessária |

Em UI operacional, destaque `CRITICAL` e `HIGH`, mantenha ACK como ação explícita do operador e mostre nota, horário de disparo, horário de ACK e horário de resolução quando disponíveis.

## Checklist De Implementação

- Criar contratos/DTOs para `AlarmRule`, `Alarm`, `AlarmSeverity` e `AlarmStatus`.
- Validar campos obrigatórios por `ruleType`.
- Avaliar regras por telemetria recebida e por processos temporais para `no_data`/`rate_of_change`.
- Aplicar debounce antes da criação do alarme.
- Evitar duplicidade de alarme ativo por regra.
- Criar job de escalonamento com `jobId` cancelável.
- Cancelar escalonamento no ACK.
- Resolver automaticamente somente quando a condição normalizar.
- Persistir histórico completo sem apagar alarmes resolvidos.
- Emitir notificações conforme `notifyInternal` e `notifyClient`.
- Proteger tudo por `tenantId`.
