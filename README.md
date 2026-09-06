# BlueBee IoT

Plataforma supervisória **SaaS multi-tenant** para monitoramento de sistemas **BMS (Building Management System)**.

A Autobras BlueBee é uma integradora que instala sistemas de automação predial nos seus clientes. Esta plataforma centraliza o monitoramento de todos esses clientes em um único ambiente: telemetria em tempo real, alarmes, trends, telas SCADA, relatórios e comandos remotos via gateways locais instalados em campo.

> Documentação de produto e decisões de negócio em [`docs/PRD.md`](docs/PRD.md).

---

## Arquitetura

Monorepo **Turborepo** com três aplicações e pacotes compartilhados:

```
bluebee-iot/
├── apps/
│   ├── frontend/   # Next.js 16 + TypeScript + Tailwind — porta 3000
│   ├── backend/    # NestJS 11 + Prisma + Socket.IO — porta 4000
│   └── gateway/    # NestJS Microservice — gateway local (Modbus/BACnet → MQTT)
├── modules/        # workspaces de negócio (alarms, devices, dashboard, reports, scada...)
├── packages/       # tipos e contratos compartilhados (shared-types, mqtt-contracts, ui)
└── docs/           # PRD e documentação técnica
```

| Camada | Tecnologia |
|--------|------------|
| Frontend | Next.js 16, React 19, TailwindCSS, React Query, Zustand |
| Realtime | Socket.IO |
| Backend | NestJS 11, Prisma ORM |
| Banco relacional | PostgreSQL (Docker) |
| Banco temporal | TimescaleDB (`time_bucket` para trends/relatórios) |
| Mensageria IoT | MQTT — EMQX |
| Auth | Supabase Auth + JWT |
| Gateway local | NestJS Microservice (Modbus TCP / BACnet IP) |

---

## Pré-requisitos

- **Node.js** >= 18 (recomendado 22)
- **npm** >= 11 (o repositório usa npm workspaces)
- **Docker** + Docker Compose (para subir Postgres e o broker MQTT localmente)

---

## Como rodar (desenvolvimento)

### 1. Clonar e instalar

```bash
git clone <url-do-repositorio>
cd bluebee-iot
npm install
```

O `npm install` na raiz instala as dependências de todos os workspaces.

### 2. Subir a infraestrutura local

Sobe PostgreSQL/TimescaleDB e o broker MQTT (EMQX) via Docker:

```bash
docker compose -f docker-compose.test.yml up -d
```

Acessos:

| Serviço | Endereço | Credenciais |
|---------|----------|-------------|
| PostgreSQL | `localhost:5432` | `postgres` / `bluebee123` (db: `bluebee`) |
| MQTT Broker | `localhost:1883` | — |
| EMQX Dashboard | http://localhost:18083 | `admin` / `bluebee123` |

### 3. Configurar variáveis de ambiente

Cada app tem um `.env.example`. Copie-os para `.env` e ajuste se necessário:

```bash
cp apps/backend/.env.example  apps/backend/.env
cp apps/frontend/.env.example apps/frontend/.env
cp apps/gateway/.env.example  apps/gateway/.env
```

Os valores padrão já apontam para a infraestrutura local do passo anterior. Gere um `JWT_SECRET` próprio para o backend:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

### 4. Preparar o banco (backend)

```bash
cd apps/backend
npx prisma migrate dev   # aplica as migrations
npm run seed             # popula dados iniciais
cd ../..
```

### 5. Rodar as aplicações

A partir da raiz, sobe todos os apps em modo watch:

```bash
npm run dev
```

Ou individualmente, via filtro do Turborepo:

```bash
npm run dev -- --filter=@bluebee/frontend   # http://localhost:3000
npm run dev -- --filter=@bluebee/backend    # http://localhost:4000
npm run dev -- --filter=@bluebee/gateway
```

Com tudo de pé, acesse o frontend em **http://localhost:3000**.

> Dica: para desenvolver o frontend sem backend, defina `NEXT_PUBLIC_USE_MOCK=true` em `apps/frontend/.env` para usar os mocks locais.

---

## Scripts úteis

Executados a partir da raiz (rodam em todos os workspaces via Turborepo):

| Comando | Descrição |
|---------|-----------|
| `npm run dev` | Sobe todos os apps em modo desenvolvimento |
| `npm run build` | Build de produção de todos os apps/pacotes |
| `npm run lint` | Lint em todo o monorepo |
| `npm run check-types` | Checagem de tipos TypeScript |
| `npm run format` | Formata o código com Prettier |

Testes do backend (a partir de `apps/backend`):

```bash
npm test            # unitários
npm run test:e2e    # end-to-end
```

---

## Gateway local

O gateway é distribuído como executável Windows único e roda direto no host em campo,
lendo dispositivos Modbus/BACnet e publicando telemetria via MQTT.

```bash
cd apps/gateway
npm run package:win   # gera o .exe em release/
```

---

## Estrutura de fases

O projeto evolui em fases — do frontend com mock até automações e IA. O detalhamento de cada fase está em [`CLAUDE.md`](CLAUDE.md) e [`docs/PRD.md`](docs/PRD.md).
