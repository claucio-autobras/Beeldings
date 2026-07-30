# Plano — Trilha de Auditoria (BlueBee)

> Design da **trilha de auditoria** (audit log) para rastreabilidade completa das
> ações na plataforma. **Adiado** — o sistema ainda não tem usuários reais, então
> a implementação fica para depois. Este documento existe para **não se perder o
> desenho** quando formos atacar.
> ⚠️ Exige **migração de banco** (nova tabela) — só aplicar com autorização.

---

## 1. Objetivo

Registrar **quem fez o quê, quando e de onde**, de forma **imutável** (append-only),
para suporte, segurança, compliance e investigação de incidentes. Hoje o módulo de
**Relatórios** já tem a UI do "Relatório de Auditoria" marcada como
`available: false` — este plano descreve a fonte de dados que falta para ligá-la.

---

## 2. Ações a capturar (do prompt)

| Categoria | Ações |
|---|---|
| Sessão | login, logout, falha de login |
| Alarmes | reconhecimento (ACK) de alarme |
| Usuários | criação, exclusão, alteração de permissões/role |
| Equipamentos | criação, exclusão de dispositivos/pontos |
| Operação | alteração de setpoints, comandos enviados |
| Sistema | alteração de configurações da plataforma |

> A lista é incremental: começa pelas ações sensíveis (sessão, ACK, usuários,
> setpoints) e cresce conforme a necessidade.

---

## 3. Modelo de dados (proposto)

```prisma
model AuditLog {
  id          String   @id @default(uuid())
  tenantId    String?  @map("tenant_id")     // null = ação global (admin Autobras)
  actorUserId String?  @map("actor_user_id") // null em falha de login
  actorEmail  String   @map("actor_email")   // snapshot (sobrevive à exclusão do user)
  actorRole   String?  @map("actor_role")
  action      String                          // ex.: "alarm.ack", "user.delete"
  entityType  String?  @map("entity_type")    // ex.: "AlarmEvent", "User"
  entityId    String?  @map("entity_id")
  before      Json?                           // estado anterior (em updates/deletes)
  after       Json?                           // estado novo (em creates/updates)
  ip          String?
  userAgent   String?  @map("user_agent")
  createdAt   DateTime @default(now()) @map("created_at")

  @@index([tenantId, createdAt(sort: Desc)])
  @@index([actorUserId])
  @@index([action])
  @@map("audit_logs")
}
```

**Princípios**
- **Append-only**: nunca `update`/`delete` em `AuditLog` pela aplicação.
- **Snapshot do ator**: guardar `actorEmail`/`actorRole` no log para sobreviver à
  exclusão do usuário.
- **Multi-tenant**: `tenantId` escopado igual ao resto; admin global = `null`
  (coerente com o modelo da Autobras como integradora, ver memória do projeto).
- **`action`** com convenção `recurso.verbo` (`alarm.ack`, `user.create`,
  `setpoint.update`, `auth.login`, `auth.login_failed`).

---

## 4. Como capturar

Três estratégias, combináveis:

| Abordagem | Uso | Trade-off |
|---|---|---|
| **Chamada explícita no service** (`audit.record({...})`) | ações sensíveis (ACK, setpoint, CRUD usuário) | mais verboso, porém **preciso** (sabe o before/after) |
| **Interceptor NestJS + decorator `@Audit('user.delete')`** | padronizar rotas mutantes | menos código, mas captura genérica (sem before/after rico) |
| **Hook no AuthService** | login/logout/falha | centralizado no fluxo de auth |

**Recomendação:** `AuditService` central + chamadas explícitas nas ações
sensíveis (controle do before/after), com decorator/interceptor como
complemento para cobertura ampla. O `AuditService` recebe o `AuthenticatedUser`
(via `@CurrentUser`) e o request (ip/userAgent).

### Esboço do serviço
```ts
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: {
    actor: AuthenticatedUser | null;
    action: string;
    entityType?: string;
    entityId?: string;
    before?: unknown;
    after?: unknown;
    tenantId?: string | null;
    ip?: string;
    userAgent?: string;
  }): Promise<void> {
    // fire-and-forget; nunca derruba a ação principal se o log falhar
  }
}
```

---

## 5. Relatório de Auditoria (ligação com o módulo Relatórios)

- A UI já existe em `apps/frontend/src/modules/reports/pages/reports.page.tsx`
  (tipo `audit`, hoje desabilitado).
- Quando a tabela existir, o backend ganha `generateAuditReport(input)` em
  `ReportsService` e o endpoint `GET /reports/audit` (CSV/PDF), no mesmo padrão
  de Alarmes/Trends (JwtAuthGuard + escopo por tenant + filtros de período/ação/
  ator). Trocar `available: false → true` em `listTypes()`.
- **Acesso restrito**: só roles globais (ADMIN/CCO/SUPERVISOR) e/ou admin do
  tenant devem poder ler a auditoria do próprio escopo.

---

## 6. Retenção & integridade

- Retenção **longa** (ex.: 1–5 anos) — auditoria raramente é volumosa.
- **Imutabilidade** garantida na aplicação (sem update/delete) e, idealmente,
  reforçada por permissão de banco (RLS/grants somente-insert).
- Considerar **hash encadeado** (cada log referencia o hash do anterior) se for
  exigida prova anti-adulteração para certificação — opcional, fase futura.

---

## 7. Roadmap (quando retomar)

| Fase | Entrega |
|---|---|
| 1 | Modelo `AuditLog` + migração + `AuditService` (fire-and-forget) |
| 2 | Instrumentar ações sensíveis: `auth.login/logout`, `alarm.ack`, `user.*`, `setpoint.update` |
| 3 | `GET /reports/audit` + ligar a UI (CSV/PDF) e habilitar o tipo no catálogo |
| 4 | Cobertura ampla via decorator/interceptor + filtros avançados |
| 5 | (Opcional) hash encadeado / RLS somente-insert para anti-adulteração |

---

## 8. Por que está adiado

O sistema ainda **não tem usuários reais** — sem atividade para auditar, o valor
imediato é baixo e o custo (instrumentar todos os módulos) é alto. A prioridade
fica para quando houver operação real. A UI e o contrato já estão prontos para
plugar a fonte de dados sem retrabalho.

---

> Relacionado: módulo de **Relatórios** (UI já preparada) e as regras
> multi-tenant do projeto (escopo por `tenantId`, admin global = `null`).
