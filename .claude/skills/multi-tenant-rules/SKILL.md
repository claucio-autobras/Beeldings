---
name: multi-tenant-rules
description: Regras obrigatórias de isolamento multi-tenant no BlueBee IoT, incluindo tenant_id, escopo de dados, roles, filtros em queries, JWT, RLS e prevenção de vazamento entre clientes. Use quando Codex precisar implementar, revisar ou auditar qualquer acesso a dados, endpoint, service, repository, query, migration ou tela com escopo por tenant.
---

# Multi Tenant Rules

## Regra de ouro

> **Todo acesso a dados deve ser filtrado por `tenant_id`. Sem exceção.**

---

## Hierarquia de dados

```
tenants (cliente da integradora)
└── projects (projetos do cliente — ex: Sede SP, Filial RJ)
    └── sites (sites do projeto — ex: Bloco A, Pavimento 3)
        └── devices (equipamentos monitorados)
            └── device_points (variáveis/tags do dispositivo)
```

Todas as tabelas abaixo de `tenants` contém `tenant_id` para isolamento direto.

---

## Backend — sempre filtrar por tenant_id

```typescript
// ✅ CORRETO — sempre passar tenantId
async findAll(tenantId: string): Promise<Device[]> {
  return this.prisma.device.findMany({
    where: { tenantId },
  });
}

// ❌ ERRADO — nunca buscar sem filtro
async findAll(): Promise<Device[]> {
  return this.prisma.device.findMany(); // PROIBIDO
}
```

---

## Quem tem acesso a quê

| Perfil | tenant_id no JWT | Acesso |
|--------|-----------------|--------|
| ADMIN | null | Todos os tenants — passa tenantId como parâmetro na rota |
| CCO | null | Todos os tenants — igual ao ADMIN |
| SUPERVISOR | null | Todos os tenants — somente leitura |
| CLIENTE | uuid do tenant | Somente o próprio tenant |
| VISUALIZADOR | uuid do tenant | Somente telas permitidas do próprio tenant |

---

## Como extrair o tenantId no controller

```typescript
// Para CLIENTE/VISUALIZADOR: vem do JWT
@Get()
async findAll(@TenantId() tenantId: string) {
  return this.service.findAll(tenantId);
}

// Para ADMIN/CCO/SUPERVISOR: pode vir como query param
@Get()
@Roles('ADMIN', 'CCO', 'SUPERVISOR')
async findAllForTenant(@Query('tenantId') tenantId: string) {
  return this.service.findAll(tenantId);
}
```

---

## Frontend — nunca exibir dados sem tenantId

```typescript
// hooks/useTenant.ts
export function useTenant() {
  const user = useAuth();
  // Para ADMIN/CCO/SUPERVISOR: tenantId vem do seletor de tenant na UI
  // Para CLIENTE/VISUALIZADOR: tenantId vem do JWT
  const tenantId = user.role === 'CLIENTE' || user.role === 'VISUALIZADOR'
    ? user.tenantId
    : useSelectedTenant(); // estado global do seletor
  return { tenantId };
}

// Nunca fazer query sem tenantId definido
const { data } = useQuery({
  queryKey: ['devices', tenantId],
  queryFn: () => devicesService.getAll(tenantId),
  enabled: !!tenantId, // só executa quando tenantId estiver disponível
});
```

---

## MQTT — tópicos já garantem isolamento

Os tópicos seguem o padrão `bluebee/{tenant_id}/...`, então a segregação
é garantida na estrutura do tópico. O backend valida que o `tenant_id`
do tópico corresponde ao `tenant_id` do dispositivo cadastrado no banco.

```typescript
// Validar no handler MQTT
async handleTelemetry(topic: string, payload: TelemetryPayload) {
  const tenantIdFromTopic = topic.split('/')[1];

  // Garantir que o tenant_id do payload bate com o do tópico
  if (tenantIdFromTopic !== payload.tenant_id) {
    this.logger.warn('tenant_id mismatch', { topic, payload });
    return; // ignorar mensagem suspeita
  }
}
```

