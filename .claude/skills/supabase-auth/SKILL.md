---
name: supabase-auth
description: Padrões de autenticação, autorização e segurança multi-tenant do BlueBee IoT usando Supabase Auth, JWT custom claims, NestJS guards, roles, users e RLS. Use quando Codex precisar implementar, revisar ou auditar login, sessão, JWT, permissões, políticas RLS, guards, decorators ou isolamento por tenant.
---

# Supabase Auth

## Stack de autenticação

| Camada | Tecnologia | Responsabilidade |
|--------|------------|-----------------|
| Auth Provider | Supabase Auth | Emissão e validação de JWT, login, sessão |
| JWT Payload | Custom claims | `tenant_id`, `role`, `user_id` embutidos no token |
| Backend Guard | NestJS `JwtAuthGuard` | Valida JWT em todas as rotas privadas |
| Multi-tenancy | Row-Level Security (RLS) | Isolamento de dados no PostgreSQL |
| Perfis | Tabela `users` + `roles` | Mapeamento de perfis para permissões |

---

## Estrutura do JWT

O Supabase emite JWT padrão. O BlueBee adiciona custom claims via **Supabase Database Functions** ou **Auth Hooks**:

```json
{
  "sub": "user-uuid",
  "email": "joao@empresa.com",
  "role": "authenticated",
  "app_metadata": {
    "tenant_id": "tenant-uuid",
    "bluebee_role": "CCO"
  },
  "iat": 1716300000,
  "exp": 1716386400
}
```

**Onde ficam os dados importantes:**
- `sub` → `user_id` (UUID do usuário no Supabase)
- `app_metadata.tenant_id` → tenant do usuário (imutável, definido pelo ADMIN)
- `app_metadata.bluebee_role` → perfil: `ADMIN | CCO | SUPERVISOR | CLIENTE | VISUALIZADOR`

---

## Guard NestJS — JwtAuthGuard

```typescript
// auth/guards/jwt-auth.guard.ts
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.get<boolean>('isPublic', context.getHandler());
    if (isPublic) return true;
    return super.canActivate(context);
  }
}
```

```typescript
// auth/strategies/jwt.strategy.ts
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: process.env.SUPABASE_JWT_SECRET,
    });
  }

  validate(payload: JwtPayload): AuthUser {
    return {
      userId:    payload.sub,
      email:     payload.email,
      tenantId:  payload.app_metadata.tenant_id,
      role:      payload.app_metadata.bluebee_role,
    };
  }
}
```

---

## Decorator @CurrentUser e @CurrentTenant

```typescript
// auth/decorators/current-user.decorator.ts
export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): AuthUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);

// auth/decorators/current-tenant.decorator.ts
export const CurrentTenant = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    return request.user.tenantId;
  },
);
```

**Uso nos controllers:**
```typescript
@Get()
@UseGuards(JwtAuthGuard)
findAll(@CurrentTenant() tenantId: string) {
  return this.service.findAll(tenantId); // tenantId vem sempre do JWT, nunca do body/query
}
```

---

## Guard de Perfil — RolesGuard

```typescript
// auth/guards/roles.guard.ts
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.get<BluebeeRole[]>('roles', context.getHandler());
    if (!requiredRoles) return true;

    const { user } = context.switchToHttp().getRequest();
    return requiredRoles.includes(user.role);
  }
}

// Uso:
@Roles('ADMIN', 'CCO')
@UseGuards(JwtAuthGuard, RolesGuard)
@Delete(':id')
remove(@Param('id') id: string) { ... }
```

---

## Row-Level Security (RLS) no Supabase

O RLS é a **última linha de defesa** — a aplicação também filtra por `tenant_id`, mas o RLS garante que nenhuma query vaze dados entre tenants mesmo com bugs no código.

```sql
-- Habilitar RLS em todas as tabelas de negócio
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE alarms  ENABLE ROW LEVEL SECURITY;
ALTER TABLE telemetry ENABLE ROW LEVEL SECURITY;

-- Policy padrão: usuário só vê dados do seu tenant
CREATE POLICY "tenant_isolation" ON devices
  FOR ALL
  USING (tenant_id = auth.jwt() -> 'app_metadata' ->> 'tenant_id');

-- Policy para ADMIN: vê tudo (tenant_id NULL no app_metadata)
CREATE POLICY "admin_access" ON devices
  FOR ALL
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'bluebee_role') IN ('ADMIN', 'CCO', 'SUPERVISOR')
    OR
    tenant_id = auth.jwt() -> 'app_metadata' ->> 'tenant_id'
  );
```

---

## Perfis e permissões

| Perfil | Pode ver todos tenants | Pode executar comandos | Pode configurar |
|--------|----------------------|----------------------|----------------|
| ADMIN | ✅ | ✅ | ✅ |
| CCO | ✅ | ✅ | ❌ |
| SUPERVISOR | ✅ | ❌ | ❌ |
| CLIENTE | ❌ (só o seu) | ❌ | ❌ |
| VISUALIZADOR | ❌ (só o seu) | ❌ | ❌ |

---

## Regras de segurança obrigatórias

1. **Nunca** aceitar `tenant_id` do body ou query param — sempre extrair do JWT via `@CurrentTenant()`
2. **Sempre** aplicar `WHERE tenant_id = $tenantId` em todos os queries, mesmo com RLS ativo
3. **Nunca** expor o `SUPABASE_SERVICE_ROLE_KEY` no frontend — apenas no backend
4. **Sempre** usar `JwtAuthGuard` globalmente e marcar rotas públicas com `@Public()`
5. **Sempre** validar que o recurso acessado pertence ao tenant do usuário antes de retornar

---

## Variáveis de ambiente

```bash
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=eyJ...          # frontend usa esta
SUPABASE_SERVICE_ROLE_KEY=eyJ...  # backend usa esta (nunca expor)
SUPABASE_JWT_SECRET=seu-jwt-secret
```

