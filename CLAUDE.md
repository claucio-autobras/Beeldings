# CLAUDE.md — BlueBee IoT Platform

> Leia este arquivo completamente antes de qualquer ação. Ele define como o desenvolvimento deste projeto funciona.

---

## O que é este projeto

**BlueBee IoT** é uma plataforma supervisória SaaS multi-tenant para monitoramento de sistemas BMS (Building Management System). A Autobras BlueBee é uma integradora que instala sistemas nos clientes — essa plataforma monitora todos esses clientes em um único ambiente.

Consulte o PRD completo em `docs/PRD.md` para contexto de negócio, funcionalidades e decisões arquiteturais.

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
| Mensageria IoT | MQTT — EMQX |
| Gateway Local | NestJS Microservice |
| IA | Anthropic Claude API |

---

## Skills disponíveis

### `ui-ux-pro-max` — Design e UX
Motor de busca de recomendações de UI/UX. **Obrigatório consultar antes de implementar qualquer tela.** Fornece estilos visuais, paletas de cores, tipografia, padrões UX e recomendações de componentes para Next.js e shadcn/ui.

```bash
# Exemplo — buscar estilo para dashboard industrial
python3 .agents/skills/ui-ux-pro-max/scripts/search.py "industrial monitoring dashboard" --domain style --stack nextjs
```

Domínios disponíveis: `style`, `color`, `typography`, `product`, `landing`, `chart`, `ux`
Stack padrão do projeto: `--stack nextjs` ou `--stack shadcn`

---

## Skills de scaffolding disponíveis

Este projeto usa duas skills de automação que **devem ser usadas antes de criar qualquer arquivo manualmente**.

### `config-project-fullstack`
Cria a base do monorepo Turborepo com Next.js (frontend, porta 3000) e NestJS (backend, porta 4000), CORS, `@nestjs/config` e variáveis de ambiente já configuradas.

```bash
# Executar UMA VEZ na raiz do projeto para criar a base
node .agents/skills/config-project-fullstack/scripts/setup-fullstack-project.js --namespace '@bluebee'
```

### `config-new-module`
Cria um módulo de negócio completo: workspace em `modules/`, módulo NestJS em `apps/backend/src/modules/`, e estrutura de página/componente em `apps/frontend/src/`. Registra automaticamente no AppModule e instala dependências.

```bash
# Executar para cada novo módulo — sempre informar --module e --namespace
node .agents/skills/config-new-module/scripts/create-module.js --module alarms --namespace @bluebee
node .agents/skills/config-new-module/scripts/create-module.js --module devices --namespace @bluebee
node .agents/skills/config-new-module/scripts/create-module.js --module dashboard --namespace @bluebee
```

> **Regra:** Nunca criar módulos manualmente. Sempre usar a skill `config-new-module`.

---

## Estrutura do Monorepo

Gerada pela skill `config-project-fullstack` + módulos criados pela skill `config-new-module`:

```
BlueBee/
├── apps/
│   ├── frontend/               # Next.js — porta 3000
│   │   └── src/
│   │       ├── app/
│   │       │   ├── (public)/   # login, forgot-password
│   │       │   └── (private)/  # telas autenticadas (geradas pela skill)
│   │       └── modules/        # lógica de cada módulo (gerada pela skill)
│   ├── backend/                # NestJS — porta 4000
│   │   └── src/
│   │       ├── app.module.ts   # atualizado automaticamente pela skill
│   │       └── modules/        # módulos NestJS (gerados pela skill)
│   └── gateway/                # NestJS Microservice — gateway local (Fase 2)
├── modules/                    # workspaces de negócio (gerados pela skill)
│   ├── alarms/
│   ├── devices/
│   ├── auth/
│   └── ...
├── packages/                   # pacotes compartilhados
│   ├── shared-types/           # DTOs e tipos compartilhados
│   ├── mqtt-contracts/         # schemas e tópicos MQTT
│   └── ui/                     # design system compartilhado
├── .agents/
│   └── skills/
│       ├── config-project-fullstack/  # skill de criação do projeto base
│       └── config-new-module/         # skill de criação de módulos
├── .claude/
│   ├── agents/                 # agentes especializados
│   └── skills/                 # skills de padrões técnicos
├── docs/
│   └── PRD.md
└── CLAUDE.md
```

---

## Agentes disponíveis

Cada tarefa deve ser direcionada ao agente correto. **Nunca misture responsabilidades entre agentes.**

| Quando a tarefa envolver... | Use o agente |
|-----------------------------|--------------|
| Telas, componentes, hooks, mock, UI | `frontend-agent` |
| Auth, JWT, perfis, RLS, permissões | `auth-agent` |
| MQTT, tópicos, subscribers, handlers | `mqtt-agent` |
| Leitura Modbus, polling, registradores | `modbus-agent` |
| Leitura BACnet, objetos, COV, discovery | `bacnet-agent` |
| TimescaleDB, telemetria, séries temporais | `telemetry-agent` |
| Alarmes, regras, escalonamento, notificações | `alarm-agent` |
| Rotinas SE/ENTÃO, comandos, fluxo CCO | `automation-agent` |
| Infraspeak, WhatsApp, SendGrid, webhooks | `integration-agent` |

---

## Como solicitar tarefas

Sempre especifique o módulo e a funcionalidade:

```
✅ "No módulo de auth, implementar recuperação de senha"
✅ "No módulo de alarmes, adicionar escalonamento de 30 minutos"
✅ "No frontend, criar componente AlarmTable com filtro por severidade"
✅ "No gateway, implementar retry de conexão Modbus com backoff exponencial"

❌ "Implementar autenticação" (vago demais)
❌ "Fazer o sistema de alarmes" (sem módulo especificado)
```

---

## Regras globais de desenvolvimento

### Código
- TypeScript estrito em todos os apps e packages — sem `any`
- Toda função deve ter tipagem explícita de entrada e saída
- Erros devem ser tratados explicitamente — sem `try/catch` vazio
- Variáveis de ambiente nunca hardcoded — sempre via `process.env`

### Arquitetura
- Backend segue DDD: `domain/` `application/` `infrastructure/` `presentation/`
- Frontend segue a separação: `services/` → `hooks/` → `components/`
- Nunca chamar banco de dados diretamente no controller — sempre via service
- Nunca lógica de negócio no frontend — apenas no backend

### Multi-tenancy
- **Todo query no banco deve filtrar por `tenant_id`** — sem exceção
- RLS no Supabase é a última linha de defesa — a aplicação também filtra
- Nenhum dado de um tenant pode vazar para outro — verificar sempre

### Mock (Fase 0)
- Todo serviço do frontend deve suportar `NEXT_PUBLIC_USE_MOCK=true`
- Mocks ficam em `apps/web/src/mocks/`
- A troca mock → API real não deve exigir alteração nos componentes

### Git
- Commits em português, descritivos e por módulo
- Exemplo: `feat(auth): adicionar recuperação de senha via e-mail`
- Branches: `feature/nome-da-feature`, `fix/nome-do-bug`

---

## Fases do projeto

| Fase | Foco | Status |
|------|------|--------|
| Fase 0 | Frontend completo com mock | ✅ Concluída |
| Fase 1 | Auth + MQTT + backend core | ✅ Concluída |
| Fase 2 | Gateway Modbus + telemetria real | 🔄 Em andamento (telemetria real e gateway OK; Modbus pendente — MCP46D via BACnet) |
| Fase 3 | Motor de alarmes + notificações | 🔄 Em andamento (motor de alarmes OK; notificações WhatsApp/SendGrid/Infraspeak pendentes) |
| Fase 4 | BACnet + SCADA + relatórios | ✅ Concluída |
| Fase 5 | Automações + Infraspeak | ⏳ Pendente |
| Fase 6 | Chat com IA | ⏳ Pendente |

---

## Dúvidas sobre o projeto

Consulte nesta ordem:
1. `docs/PRD.md` — visão geral e decisões de negócio
2. `.claude/agents/` — escopo do agente responsável
3. `.claude/skills/` — padrões técnicos do projeto
