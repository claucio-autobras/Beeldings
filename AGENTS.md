# AGENTS.md â€” BlueBee IoT Platform

> Leia este arquivo completamente antes de qualquer aÃ§Ã£o. Ele define como o desenvolvimento deste projeto funciona.

---

## O que Ã© este projeto

**BlueBee IoT** Ã© uma plataforma supervisÃ³ria SaaS multi-tenant para monitoramento de sistemas BMS (Building Management System). A Autobras BlueBee Ã© uma integradora que instala sistemas nos clientes â€” essa plataforma monitora todos esses clientes em um Ãºnico ambiente.

Consulte o PRD completo em `docs/PRD.md` para contexto de negÃ³cio, funcionalidades e decisÃµes arquiteturais.

---

## Stack

| Camada | Tecnologia |
|--------|------------|
| Frontend | Next.js 14 + TypeScript + TailwindCSS + shadcn/ui |
| Estado | React Query (TanStack) |
| Realtime | Socket.IO Client |
| Backend | NestJS + TypeScript |
| ORM | Prisma |
| Filas | BullMQ + Redis |
| Realtime Server | Socket.IO |
| Banco Relacional | Supabase (PostgreSQL) |
| Banco Temporal | TimescaleDB |
| Mensageria IoT | MQTT â€” EMQX |
| Gateway Local | NestJS Microservice |
| IA | Anthropic Codex API |

---

## Skills disponÃ­veis

### `ui-ux-pro-max` â€” Design e UX
Motor de busca de recomendaÃ§Ãµes de UI/UX. **ObrigatÃ³rio consultar antes de implementar qualquer tela.** Fornece estilos visuais, paletas de cores, tipografia, padrÃµes UX e recomendaÃ§Ãµes de componentes para Next.js e shadcn/ui.

```bash
# Exemplo â€” buscar estilo para dashboard industrial
python3 .claude/skills/ui-ux-pro-max/scripts/search.py "industrial monitoring dashboard" --domain style --stack nextjs
```

DomÃ­nios disponÃ­veis: `style`, `color`, `typography`, `product`, `landing`, `chart`, `ux`
Stack padrÃ£o do projeto: `--stack nextjs` ou `--stack shadcn`

---

## Skills de scaffolding disponÃ­veis

Este projeto usa duas skills de automaÃ§Ã£o que **devem ser usadas antes de criar qualquer arquivo manualmente**.

### `config-project-fullstack`
Cria a base do monorepo Turborepo com Next.js (frontend, porta 3000) e NestJS (backend, porta 4000), CORS, `@nestjs/config` e variÃ¡veis de ambiente jÃ¡ configuradas.

```bash
# Executar UMA VEZ na raiz do projeto para criar a base
node .claude/skills/config-project-fullstack/scripts/setup-fullstack-project.js --namespace '@bluebee'
```

### `config-new-module`
Cria um mÃ³dulo de negÃ³cio completo: workspace em `modules/`, mÃ³dulo NestJS em `apps/backend/src/modules/`, e estrutura de pÃ¡gina/componente em `apps/frontend/src/`. Registra automaticamente no AppModule e instala dependÃªncias.

```bash
# Executar para cada novo mÃ³dulo â€” sempre informar --module e --namespace
node .claude/skills/config-new-module/scripts/create-module.js --module alarms --namespace @bluebee
node .claude/skills/config-new-module/scripts/create-module.js --module devices --namespace @bluebee
node .claude/skills/config-new-module/scripts/create-module.js --module dashboard --namespace @bluebee
```

> **Regra:** Nunca criar mÃ³dulos manualmente. Sempre usar a skill `config-new-module`.

---

## Estrutura do Monorepo

Gerada pela skill `config-project-fullstack` + mÃ³dulos criados pela skill `config-new-module`:

```
BlueBee/
â”œâ”€â”€ apps/
â”‚   â”œâ”€â”€ frontend/               # Next.js â€” porta 3000
â”‚   â”‚   â””â”€â”€ src/
â”‚   â”‚       â”œâ”€â”€ app/
â”‚   â”‚       â”‚   â”œâ”€â”€ (public)/   # login, forgot-password
â”‚   â”‚       â”‚   â””â”€â”€ (private)/  # telas autenticadas (geradas pela skill)
â”‚   â”‚       â””â”€â”€ modules/        # lÃ³gica de cada mÃ³dulo (gerada pela skill)
â”‚   â”œâ”€â”€ backend/                # NestJS â€” porta 4000
â”‚   â”‚   â””â”€â”€ src/
â”‚   â”‚       â”œâ”€â”€ app.module.ts   # atualizado automaticamente pela skill
â”‚   â”‚       â””â”€â”€ modules/        # mÃ³dulos NestJS (gerados pela skill)
â”‚   â””â”€â”€ gateway/                # NestJS Microservice â€” gateway local (Fase 2)
â”œâ”€â”€ modules/                    # workspaces de negÃ³cio (gerados pela skill)
â”‚   â”œâ”€â”€ alarms/
â”‚   â”œâ”€â”€ devices/
â”‚   â”œâ”€â”€ auth/
â”‚   â””â”€â”€ ...
â”œâ”€â”€ packages/                   # pacotes compartilhados
â”‚   â”œâ”€â”€ shared-types/           # DTOs e tipos compartilhados
â”‚   â”œâ”€â”€ mqtt-contracts/         # schemas e tÃ³picos MQTT
â”‚   â””â”€â”€ ui/                     # design system compartilhado
â”œâ”€â”€ .agents/
â”‚   â””â”€â”€ skills/
â”‚       â”œâ”€â”€ config-project-fullstack/  # skill de criaÃ§Ã£o do projeto base
â”‚       â””â”€â”€ config-new-module/         # skill de criaÃ§Ã£o de mÃ³dulos
â”œâ”€â”€ .Codex/
â”‚   â”œâ”€â”€ agents/                 # agentes especializados
â”‚   â””â”€â”€ skills/                 # skills de padrÃµes tÃ©cnicos
â”œâ”€â”€ docs/
â”‚   â””â”€â”€ PRD.md
â””â”€â”€ AGENTS.md
```

---

## Agentes disponÃ­veis

Cada tarefa deve ser direcionada ao agente correto. **Nunca misture responsabilidades entre agentes.**

| Quando a tarefa envolver... | Use o agente |
|-----------------------------|--------------|
| Telas, componentes, hooks, mock, UI | `frontend-agent` |
| Auth, JWT, perfis, RLS, permissÃµes | `auth-agent` |
| MQTT, tÃ³picos, subscribers, handlers | `mqtt-agent` |
| Leitura Modbus, polling, registradores | `modbus-agent` |
| Leitura BACnet, objetos, COV, discovery | `bacnet-agent` |
| TimescaleDB, telemetria, sÃ©ries temporais | `telemetry-agent` |
| Alarmes, regras, escalonamento, notificaÃ§Ãµes | `alarm-agent` |
| Rotinas SE/ENTÃƒO, comandos, fluxo CCO | `automation-agent` |
| Infraspeak, WhatsApp, SendGrid, webhooks | `integration-agent` |

---

## Como solicitar tarefas

Sempre especifique o mÃ³dulo e a funcionalidade:

```
âœ… "No mÃ³dulo de auth, implementar recuperaÃ§Ã£o de senha"
âœ… "No mÃ³dulo de alarmes, adicionar escalonamento de 30 minutos"
âœ… "No frontend, criar componente AlarmTable com filtro por severidade"
âœ… "No gateway, implementar retry de conexÃ£o Modbus com backoff exponencial"

âŒ "Implementar autenticaÃ§Ã£o" (vago demais)
âŒ "Fazer o sistema de alarmes" (sem mÃ³dulo especificado)
```

---

## Regras globais de desenvolvimento

### CÃ³digo
- TypeScript estrito em todos os apps e packages â€” sem `any`
- Toda funÃ§Ã£o deve ter tipagem explÃ­cita de entrada e saÃ­da
- Erros devem ser tratados explicitamente â€” sem `try/catch` vazio
- VariÃ¡veis de ambiente nunca hardcoded â€” sempre via `process.env`

### Arquitetura
- Backend segue DDD: `domain/` `application/` `infrastructure/` `presentation/`
- Frontend segue a separaÃ§Ã£o: `services/` â†’ `hooks/` â†’ `components/`
- Nunca chamar banco de dados diretamente no controller â€” sempre via service
- Nunca lÃ³gica de negÃ³cio no frontend â€” apenas no backend

### Multi-tenancy
- **Todo query no banco deve filtrar por `tenant_id`** â€” sem exceÃ§Ã£o
- RLS no Supabase Ã© a Ãºltima linha de defesa â€” a aplicaÃ§Ã£o tambÃ©m filtra
- Nenhum dado de um tenant pode vazar para outro â€” verificar sempre

### Mock (Fase 0)
- Todo serviÃ§o do frontend deve suportar `NEXT_PUBLIC_USE_MOCK=true`
- Mocks ficam em `apps/web/src/mocks/`
- A troca mock â†’ API real nÃ£o deve exigir alteraÃ§Ã£o nos componentes

### Git
- Commits em portuguÃªs, descritivos e por mÃ³dulo
- Exemplo: `feat(auth): adicionar recuperaÃ§Ã£o de senha via e-mail`
- Branches: `feature/nome-da-feature`, `fix/nome-do-bug`

---

## Fases do projeto

| Fase | Foco | Status |
|------|------|--------|
| Fase 0 | Frontend completo com mock | ðŸ”„ Em andamento |
| Fase 1 | Auth + MQTT + backend core | â³ Pendente |
| Fase 2 | Gateway Modbus + telemetria real | â³ Pendente |
| Fase 3 | Motor de alarmes + notificaÃ§Ãµes | â³ Pendente |
| Fase 4 | BACnet + SCADA + relatÃ³rios | â³ Pendente |
| Fase 5 | AutomaÃ§Ãµes + Infraspeak | â³ Pendente |
| Fase 6 | Chat com IA | â³ Pendente |

---

## DÃºvidas sobre o projeto

Consulte nesta ordem:
1. `docs/PRD.md` â€” visÃ£o geral e decisÃµes de negÃ³cio
2. `.Codex/agents/` â€” escopo do agente responsÃ¡vel
3. `.Codex/skills/` â€” padrÃµes tÃ©cnicos do projeto
