---
name: api-contracts
description: Convenções REST do BlueBee IoT para autenticação, autorização, formato de resposta, paginação, erros, nomenclatura de endpoints e contratos entre frontend e backend. Use quando Codex precisar criar, revisar ou padronizar APIs HTTP, controllers NestJS, services frontend, DTOs, respostas paginadas, tratamento de erros ou integração REST multi-tenant.
---

# Api Contracts

## Autenticação

Todas as rotas privadas exigem header `Authorization`:

```http
Authorization: Bearer <jwt-token>
```

O `tenant_id` e `role` do usuário são extraídos do JWT — **nunca** aceitar esses valores do body ou query string.

```typescript
// ✅ CORRETO — tenant vem do JWT
@Get('/devices')
findAll(@CurrentTenant() tenantId: string) { ... }

// ❌ PROIBIDO — tenant vem do client
@Get('/devices')
findAll(@Query('tenantId') tenantId: string) { ... }
```

---

## Formato de resposta — sucesso

### Item único

```json
{
  "data": {
    "id": "device-uuid",
    "name": "Chiller 01",
    "status": "online"
  }
}
```

### Lista paginada

```json
{
  "data": [...],
  "meta": {
    "total":    150,
    "page":     1,
    "perPage":  20,
    "lastPage": 8
  }
}
```

### Criação (201)

```json
{
  "data": { "id": "novo-uuid", ... },
  "message": "Criado com sucesso"
}
```

### Sem conteúdo (204)

Retornar HTTP 204 sem body para DELETE bem-sucedido.

---

## Formato de resposta — erro

```json
{
  "error": {
    "code":    "DEVICE_NOT_FOUND",
    "message": "Dispositivo não encontrado",
    "details": null
  },
  "statusCode": 404,
  "timestamp": "2025-05-21T10:00:00Z",
  "path": "/devices/device-xyz"
}
```

### Erros de validação (400)

```json
{
  "error": {
    "code":    "VALIDATION_ERROR",
    "message": "Dados inválidos",
    "details": [
      { "field": "name",   "message": "name não pode ser vazio" },
      { "field": "siteId", "message": "siteId deve ser um UUID" }
    ]
  },
  "statusCode": 400
}
```

---

## Códigos de erro padronizados

| Código | HTTP | Situação |
|--------|------|----------|
| `UNAUTHORIZED` | 401 | JWT ausente ou inválido |
| `FORBIDDEN` | 403 | Perfil sem permissão |
| `NOT_FOUND` | 404 | Recurso não encontrado |
| `TENANT_MISMATCH` | 403 | Recurso pertence a outro tenant |
| `VALIDATION_ERROR` | 400 | DTO inválido |
| `CONFLICT` | 409 | Recurso já existe (ex: e-mail duplicado) |
| `INTERNAL_ERROR` | 500 | Erro inesperado no servidor |

---

## Nomenclatura de endpoints

Padrão REST + multi-tenant implícito (tenant_id vem do JWT):

```
GET    /devices               → listar dispositivos do tenant
GET    /devices/:id           → buscar dispositivo por ID
POST   /devices               → criar dispositivo
PATCH  /devices/:id           → atualizar dispositivo
DELETE /devices/:id           → remover dispositivo

GET    /devices/:id/variables → listar variáveis de um dispositivo
POST   /devices/:id/variables → adicionar variável ao dispositivo
```

Hierarquia de recursos:
```
/clients/:clientId/projects
/projects/:projectId/sites
/sites/:siteId/devices
/devices/:deviceId/variables
```

---

## Paginação

Query params padrão:

```
GET /alarms?page=1&perPage=20&sortBy=triggeredAt&sortOrder=desc
```

| Param | Tipo | Padrão | Descrição |
|-------|------|--------|-----------|
| `page` | number | 1 | Página atual |
| `perPage` | number | 20 | Itens por página (máx: 100) |
| `sortBy` | string | `createdAt` | Campo para ordenação |
| `sortOrder` | `asc\|desc` | `desc` | Direção da ordenação |

---

## Filtros comuns

```
GET /alarms?status=TRIGGERED&severity=CRITICAL
GET /devices?siteId=site-uuid&status=online
GET /telemetry?deviceId=dev-uuid&from=2025-05-01&to=2025-05-31
```

Datas sempre em ISO 8601: `YYYY-MM-DDTHH:mm:ssZ`

---

## Implementação do filtro paginado (NestJS)

```typescript
// shared/dto/pagination.dto.ts
export class PaginationDto {
  @IsOptional() @IsInt() @Min(1)
  @Type(() => Number)
  page: number = 1;

  @IsOptional() @IsInt() @Min(1) @Max(100)
  @Type(() => Number)
  perPage: number = 20;

  @IsOptional() @IsString()
  sortBy?: string;

  @IsOptional() @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';
}

// shared/utils/paginate.ts
export function paginate<T>(data: T[], total: number, dto: PaginationDto) {
  return {
    data,
    meta: {
      total,
      page:     dto.page,
      perPage:  dto.perPage,
      lastPage: Math.ceil(total / dto.perPage),
    },
  };
}
```

---

## Upload de arquivos

Para upload (ex: assets SCADA):

```http
POST /assets/upload
Content-Type: multipart/form-data

file: <binary>
type: "svg_background"
name: "Planta Bloco A"
```

Resposta:
```json
{
  "data": {
    "id":  "asset-uuid",
    "url": "https://storage.supabase.co/assets/tenant-abc/planta-bloco-a.svg",
    "name": "Planta Bloco A",
    "type": "svg_background"
  }
}
```

---

## Download de relatórios

```http
GET /reports/:id/download
Accept: application/pdf
Authorization: Bearer <token>
```

Resposta:
```http
HTTP/1.1 200 OK
Content-Type: application/pdf
Content-Disposition: attachment; filename="relatorio-alarmes-maio-2025.pdf"

<binary PDF>
```

---

## Versionamento

A API não usa versionamento de URL por ora (`/v1/`). Quando necessário, adicionar header:

```http
Accept: application/json; version=2
```

---

## CORS

O backend aceita requisições apenas de origens conhecidas:

```typescript
app.enableCors({
  origin: [process.env.FRONTEND_URL, 'http://localhost:3000'],
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  credentials: true,
});
```

