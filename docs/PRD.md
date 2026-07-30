# BlueBee IoT — Product Requirements Document (PRD)

> **Versão:** 2.1  
> **Data:** Junho 2026  
> **Status:** Em definição  
> **Empresa:** Autobras BlueBee  

---

## 1. Visão Geral

O **BlueBee IoT** é uma plataforma supervisória SaaS multi-tenant para monitoramento remoto de sistemas BMS (Building Management System) instalados nos clientes da Autobras BlueBee.

A plataforma centraliza dados de equipamentos industriais e prediais comunicando via **Modbus** e **BACnet**, consolidando alarmes, históricos, relatórios e automações em um único ambiente web acessível pela equipe interna e pelos clientes finais.

### Proposta de Valor

- Centralizar o monitoramento de todos os clientes da integradora em uma única plataforma
- Reduzir tempo de resposta a falhas através de alarmes automáticos com escalonamento
- Oferecer ao cliente final visibilidade do seu sistema BMS sem software local
- Gerar inteligência sobre os dados com IA para diagnóstico e insights preventivos
- Automatizar abertura de ordens de serviço via integração com Infraspeak

---

## 2. Contexto e Modelo de Negócio

### 2.1 Hierarquia Multi-Tenant

A Autobras BlueBee atua como integradora de sistemas, instalando e mantendo sistemas BMS em seus clientes. O BlueBee IoT consolida o monitoramento de todos esses clientes com isolamento completo de dados por tenant.

```
Autobras BlueBee (Integradora)
└── Tenant (Cliente)
    └── Projeto (ex: Sede SP, Filial RJ)
        └── Site (ex: Bloco A, Pavimento 3)
            └── Dispositivos (equipamentos BMS)
                └── Variáveis / Pontos monitorados
```

Essa hierarquia permite que um mesmo cliente tenha múltiplos projetos e sites, refletindo a realidade de empresas com várias unidades.

### 2.2 Perfis de Usuário

| Perfil | Escopo | Permissões |
|--------|--------|------------|
| `ADMIN` | Todos os tenants | Configuração total da plataforma, gestão de clientes e usuários |
| `CCO` | Todos os tenants | Aprovação e execução de comandos, gestão de alarmes, visualização global |
| `SUPERVISOR` | Todos os tenants | Visualização e diagnóstico de todos os clientes, sem execução de comandos |
| `CLIENTE` | Somente seu tenant | Dashboard, alarmes e notificações — somente leitura |
| `VISUALIZADOR` | Somente seu tenant | Acesso restrito a telas específicas definidas pela integradora |

### 2.3 Fluxo de Dados

```
Equipamento BMS (CLP, controlador, sensor)
    ↕ Modbus TCP/RTU ou BACnet/IP
Gateway Local (instalado na rede do cliente)
    ↓ MQTT publish (JSON)
Broker MQTT na nuvem (EMQX)
    ↓ subscribe por tenant
NestJS Backend (API)
    ├── Detecta alarmes → alarm-engine
    ├── Persiste telemetria → TimescaleDB
    └── Persiste eventos/alarmes → Supabase (PostgreSQL)
         ↓ Realtime WebSocket / Socket.IO
Next.js Dashboard
    ├── Equipe interna — visão global (ADMIN, CCO, SUPERVISOR)
    └── Cliente final — visão do seu tenant (CLIENTE, VISUALIZADOR)
```

---

## 3. Funcionalidades

### 3.1 Telas Gráficas — SCADA / Synoptic Views

Telas interativas que representam graficamente os sistemas instalados no cliente, similar ao EBO da Johnson Controls. Configuradas pela integradora — cliente só visualiza.

- Representação visual dos equipamentos e fluxos do sistema (HVAC, elétrico, hidráulico etc.)
- Valores em tempo real sobrepostos na tela gráfica
- Animações de estado: equipamento ligado/desligado, válvula aberta/fechada
- Indicadores de status com cores: normal, alarme, falha, desconectado
- Widgets configuráveis: gauge, termômetro, indicador binário, valor numérico
- Navegação entre telas por sistemas e sites
- Suporte a comandos diretos na tela (somente perfis CCO/ADMIN)

### 3.2 Dashboard

Visão consolidada dos principais indicadores, acessível pelo cliente final.

- KPIs em tempo real: equipamentos ativos, alarmes abertos, consumo
- Gráficos de tendência das principais variáveis
- Status consolidado por sistema ou área
- Widgets configuráveis pela integradora por tenant

### 3.3 Alarmes e Notificações

Sistema de alarmes **binário**: um ponto monitorado está sempre em **ALARME** ou **NORMAL** — sem severidade.

- Configuração de regras por ponto: threshold (valor > limite) ou estado (status == valor)
- Duração mínima configurável antes de disparar (ex: condição mantida por 2 minutos)
- **Status do alarme:** Ativo → Reconhecido (ACK) → Normalizado
- Escalonamento: se não reconhecido em X minutos, re-notifica a equipe
- Destinatários configuráveis por regra: equipe interna, cliente ou ambos
- Canais: WhatsApp (API) e E-mail
- Reconhecimento (ACK) com anotação obrigatória pela equipe técnica
- Histórico completo com timeline de eventos
- Abertura automática de OS no Infraspeak se não reconhecido no prazo (configurável por regra)

### 3.4 Trends (Histórico de Variáveis)

- Gráfico de linha interativo com zoom e pan
- Seleção múltipla de variáveis para comparação
- Exportação em CSV ou PDF
- Resoluções: raw, médias de 5min, 15min, 1h, 1 dia

### 3.5 Relatórios

- Relatório de disponibilidade de equipamentos
- Relatório de alarmes por período
- Relatório de consumo e performance
- Agendamento: diário, semanal, mensal
- Formatos: PDF, Excel
- Envio automático por e-mail

### 3.6 Chat com IA (Insights Operacionais)

Interface de chat onde o usuário consulta o sistema em linguagem natural.

- Consultas como: "Por que o Chiller 03 desligou ontem?"
- Análise de padrões e anomalias históricas
- Diagnóstico assistido baseado em dados reais do tenant
- Telemetria e alarmes alimentam o contexto da IA
- Histórico de conversas salvo por usuário

### 3.7 Automação e Comandos

Sistema de rotinas configuráveis. Clientes não executam comandos diretamente — todas as ações passam pela CCO da integradora.

- Criação de rotinas com motor lógico: `SE condição → ENTÃO ação`
  - Exemplo: `SE temperatura > 25°C → ligar ar-condicionado`
  - Exemplo: `SE luminosidade < limite → ligar iluminação`
- Agendamento por horário ou calendário
- Execução de comandos manuais pela equipe da integradora (CCO)
- Fluxo de aprovação: `Cliente solicita → CCO avalia → CCO aprova → Sistema executa`
- Log completo de todos os comandos com usuário, timestamp e resultado

---

## 4. Integrações Externas

| Integração | Uso |
|------------|-----|
| **Infraspeak** | Abertura de OS quando o cliente solicar algo  |
| **WhatsApp Business API** | Notificações de alarme para técnicos e/ou clientes |
| **E-mail (SendGrid)** | Relatórios agendados e notificações de alarme |
| **MQTT Broker (EMQX)** | Transporte de dados do gateway para a nuvem |
| **Modbus TCP/RTU** | Comunicação com equipamentos industriais via gateway |
| **BACnet/IP** | Comunicação com sistemas BMS via gateway |

---

## 5. Arquitetura Técnica

### 5.1 Stack

| Camada | Tecnologia | Justificativa |
|--------|------------|---------------|
| Frontend | Next.js 14 + TypeScript | SSR, performance, ecossistema React |
| UI Components | shadcn/ui + TailwindCSS | Design system consistente e acessível |
| Estado / Cache | React Query (TanStack) | Cache de dados server-side, revalidação automática |
| Backend | NestJS + TypeScript | Módulos estruturados, mesma stack do frontend |
| ORM | Prisma | Type-safe, migrations, compatível com Supabase |
| Filas | BullMQ + Redis | Processamento assíncrono de notificações e relatórios |
| Realtime | Socket.IO | WebSocket para alarmes e telemetria em tempo real |
| Dados Relacionais | Supabase (PostgreSQL) | Auth, RLS multi-tenant, Realtime integrado |
| Telemetria | TimescaleDB | Séries temporais, 1000+ pontos, compressão automática |
| Mensageria IoT | MQTT — EMQX Cloud | Protocolo leve para IoT, QoS configurável |
| Gateway Local | NestJS Microservice | Polling Modbus/BACnet + publish MQTT |
| IA / Chat | Anthropic Claude API | LLM para análise e insights em linguagem natural |
| Notificações | WhatsApp API + SendGrid | Urgente via WhatsApp, relatórios via e-mail |
| OS | Infraspeak API | Abertura automática de ordens de serviço |

### 5.2 Convenção de Tópicos MQTT

```
bluebee/{tenant_id}/devices/{device_id}/telemetry   # dados de leitura
bluebee/{tenant_id}/devices/{device_id}/status      # saúde do dispositivo
bluebee/{tenant_id}/devices/{device_id}/commands    # comandos ao gateway
bluebee/{tenant_id}/gateway/{gateway_id}/heartbeat  # keepalive do gateway
bluebee/{tenant_id}/alarms/{device_id}/event        # eventos de alarme do gateway
bluebee/{tenant_id}/mqtt-logs                       # log de mensagens MQTT por tenant
```

### 5.3 Payload de Telemetria (padrão JSON)

```json
{
  "device_id": "chiller-01",
  "tenant_id": "cliente-abc",
  "timestamp": "2025-05-21T10:00:00Z",
  "protocol": "modbus",
  "points": [
    { "tag": "temp_saida",          "value": 7.2,  "unit": "°C"  },
    { "tag": "pressao_condensacao", "value": 18.5, "unit": "bar" },
    { "tag": "status_compressor",   "value": 1,    "unit": null  }
  ]
}
```

### 5.4 Multi-Tenancy e Segurança

- **Row-Level Security (RLS)** no Supabase: queries retornam somente dados do tenant autenticado
- **JWT** com claim `tenant_id` emitido pelo Supabase Auth
- Gateway autenticado no broker MQTT com certificado por tenant
- Tópicos MQTT segregados por `tenant_id`, impossibilitando acesso cross-tenant
- Audit log de todos os comandos e acessos administrativos
- Segurança implementada após validação funcional do MVP (não bloquear desenvolvimento inicial)

### 5.5 Módulos do Backend (NestJS)

```
src/
├── auth/             # autenticação, JWT, perfis
├── users/            # gestão de usuários
├── roles/            # controle de acesso por perfil
├── clients/          # gestão de tenants/clientes
├── projects/         # projetos por cliente
├── sites/            # sites por projeto
├── devices/          # equipamentos monitorados
├── variables/        # variáveis/pontos por dispositivo
├── assets/           # assets de telas gráficas
├── telemetry/        # leitura e escrita TimescaleDB
├── mqtt/             # subscribers, handlers, roteamento
├── mqtt-logs/        # log de mensagens MQTT
├── alarms/           # regras, motor, histórico
├── events/           # eventos do sistema
├── automation/       # motor de lógica, rotinas, comandos
├── logic-engine/     # avaliador de condições SE/ENTÃO
├── bacnet/           # integração BACnet via gateway
├── modbus/           # integração Modbus via gateway
├── gateway/          # gestão de gateways por tenant
├── notifications/    # WhatsApp, e-mail, escalonamento
├── reports/          # geração de relatórios PDF/Excel
├── ai-insights/      # Claude API, contexto, chat
└── scada/            # configuração de telas gráficas
```

### 5.6 Estrutura de Banco de Dados (visão geral)

**Supabase (PostgreSQL) — dados relacionais:**

```
tenants           → clientes da integradora
projects          → projetos por tenant (unidades, obras)
sites             → sites por projeto (blocos, pavimentos)
users             → usuários vinculados a tenant e perfil
gateways          → gateways registrados por site
devices           → equipamentos monitorados por site
device_points     → mapeamento de tags/registradores por dispositivo
variables         → variáveis com unidade, tipo e limites
alarm_rules       → regras de alarme configuradas
alarms            → histórico de alarmes com ACK e anotações
automation_rules  → rotinas SE/ENTÃO configuradas
command_log       → log de comandos com usuário e resultado
mqtt_logs         → log de mensagens MQTT por tenant
ai_conversations  → histórico de chat com IA por usuário
```

**TimescaleDB — telemetria:**

```
telemetry (hypertable)  → leituras de variáveis com timestamp, particionada por tempo
```

---

## 6. Frontend — Estratégia e Estrutura

### 6.1 Estrutura de Rotas (Next.js App Router)

```
app/
├── (public)/
│   ├── login/
│   └── forgot-password/
└── (private)/
    ├── layout.tsx              # layout autenticado com sidebar
    ├── dashboard/              # visão geral do tenant
    ├── scada/
    │   └── [screenId]/         # telas gráficas por ID
    ├── alarms/                 # lista e histórico de alarmes
    ├── trends/                 # gráficos históricos de variáveis
    ├── reports/                # relatórios e agendamentos
    ├── automation/             # gestão de rotinas
    ├── ai/                     # chat com IA
    ├── admin/
    │   ├── clients/            # gestão de tenants (ADMIN)
    │   ├── devices/            # gestão de dispositivos
    │   ├── users/              # gestão de usuários
    │   └── gateways/           # gestão de gateways
    └── cco/
        └── commands/           # aprovação e execução de comandos (CCO)
```

### 6.2 Estratégia de Mock para Desenvolvimento

> **Contexto:** Na fase inicial de desenvolvimento, o banco de dados em produção ainda não estará disponível. Todo o frontend será construído com dados mock realistas, permitindo validar 100% das telas e fluxos antes da integração com o backend real.

#### Princípios do Mock

- Todo dado consumido pelo frontend virá de um **Mock Service Layer** desacoplado da API real
- Os mocks devem ser **realistas**: valores de temperatura, pressão, status de equipamentos condizentes com sistemas BMS reais
- A troca de mock para API real deve ser feita **alterando apenas a camada de serviço**, sem tocar nos componentes
- Usar **React Query** em todos os fetches, mesmo com mock — facilita a substituição futura

#### Estrutura de Mock

```
apps/web/
└── src/
    ├── mocks/
    │   ├── data/
    │   │   ├── tenants.mock.ts       # clientes e projetos
    │   │   ├── devices.mock.ts       # equipamentos e status
    │   │   ├── telemetry.mock.ts     # histórico de variáveis (séries temporais simuladas)
    │   │   ├── alarms.mock.ts        # alarmes com severidade, ACK, histórico
    │   │   ├── trends.mock.ts        # dados de trend com variação realista
    │   │   └── scada.mock.ts         # configuração de telas gráficas
    │   └── handlers/
    │       ├── telemetry.handler.ts  # simula polling em tempo real (setInterval)
    │       └── alarms.handler.ts     # simula chegada de alarmes em tempo real
    ├── services/
    │   ├── telemetry.service.ts      # alterna entre mock e API real via env var
    │   ├── alarms.service.ts
    │   ├── devices.service.ts
    │   └── ...
    └── hooks/
        ├── useTelemetry.ts           # hook React Query sobre o service
        ├── useAlarms.ts
        └── useDevices.ts
```

#### Alternância Mock / API Real

```typescript
// services/telemetry.service.ts
const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK === 'true';

export async function getTelemetry(deviceId: string, range: DateRange) {
  if (USE_MOCK) {
    return mockTelemetryService.get(deviceId, range);
  }
  return apiClient.get(`/telemetry/${deviceId}`, { params: range });
}
```

```bash
# .env.development
NEXT_PUBLIC_USE_MOCK=true

# .env.production
NEXT_PUBLIC_USE_MOCK=false
```

#### Dados Mock Realistas — Exemplos

```typescript
// mocks/data/devices.mock.ts
export const mockDevices = [
  {
    id: "chiller-01",
    name: "Chiller 01 — Torre Norte",
    type: "chiller",
    status: "online",
    site: "Bloco A",
    points: [
      { tag: "temp_saida",          value: 7.2,  unit: "°C",  status: "normal"  },
      { tag: "pressao_condensacao", value: 18.5, unit: "bar", status: "normal"  },
      { tag: "status_compressor",   value: 1,    unit: null,  status: "normal"  },
      { tag: "corrente_motor",      value: 42.3, unit: "A",   status: "warning" },
    ]
  },
  {
    id: "ahu-03",
    name: "UTA 03 — Pavimento 5",
    type: "ahu",
    status: "alarm",
    site: "Bloco B",
    points: [
      { tag: "temp_ar_insuflamento", value: 22.1, unit: "°C", status: "normal" },
      { tag: "status_ventilador",    value: 0,    unit: null,  status: "alarm"  },
    ]
  }
];

// mocks/data/alarms.mock.ts
export const mockAlarms = [
  {
    id: "alm-001",
    deviceId: "ahu-03",
    tag: "status_ventilador",
    severity: "critical",
    message: "Falha no ventilador da UTA 03",
    triggeredAt: "2025-05-21T08:42:00Z",
    acknowledged: false,
    acknowledgedBy: null,
  },
  {
    id: "alm-002",
    deviceId: "chiller-01",
    tag: "corrente_motor",
    severity: "medium",
    message: "Corrente do motor acima do limite nominal",
    triggeredAt: "2025-05-21T09:15:00Z",
    acknowledged: true,
    acknowledgedBy: "joao.silva",
  }
];
```

#### Simulação de Tempo Real no Mock

```typescript
// mocks/handlers/telemetry.handler.ts
// Simula variação realista de temperatura ao longo do tempo
export function simulateRealtimeTelemetry(
  baseValue: number,
  variance: number,
  callback: (value: number) => void,
  intervalMs = 5000
) {
  return setInterval(() => {
    const noise = (Math.random() - 0.5) * variance;
    callback(parseFloat((baseValue + noise).toFixed(2)));
  }, intervalMs);
}
```

### 6.3 Componentes de UI Prioritários

Componentes que devem ser construídos e validados na fase de mock antes de qualquer integração:

| Componente | Descrição | Tela |
|------------|-----------|------|
| `<DeviceCard />` | Card com status, nome e principais variáveis do dispositivo | Dashboard |
| `<AlarmBadge />` | Badge de status do alarme (Ativo/Reconhecido/Normalizado) | Global |
| `<AlarmTable />` | Tabela de alarmes com ACK e filtros | Alarmes |
| `<TrendChart />` | Gráfico de linha interativo com múltiplas variáveis | Trends |
| `<KpiWidget />` | Widget numérico com valor, unidade e status | Dashboard |
| `<StatusIndicator />` | Indicador visual de status (online/offline/alarme) | SCADA |
| `<GaugeWidget />` | Gauge circular para temperatura e pressão | SCADA |
| `<SiteTree />` | Árvore navegável: Projeto → Site → Dispositivo | Sidebar |
| `<TenantSelector />` | Seletor de tenant para perfis ADMIN/CCO/SUPERVISOR | Header |
| `<CommandApproval />` | Modal de aprovação de comando pela CCO | CCO |

---

## 7. Agentes — Claude Code

O desenvolvimento é conduzido com Claude Code utilizando agentes especializados por domínio. Cada agente tem escopo exclusivo, evitando sobreposição.

| Agente | Domínio | Arquivos / Módulos |
|--------|---------|--------------------|
| `gateway-agent` | Gateway local | `apps/gateway/` — polling Modbus/BACnet, publish MQTT, reconexão, store-and-forward |
| `mqtt-agent` | Integração MQTT no backend | `apps/api/src/mqtt/` — subscribers, handlers, roteamento por tenant, mqtt-logs |
| `telemetry-agent` | Séries temporais | `apps/api/src/telemetry/` — TimescaleDB, hypertables, aggregations |
| `alarm-agent` | Motor de alarmes | `apps/api/src/alarms/` + `logic-engine/` — regras, escalonamento, notificações |
| `auth-agent` | Auth e segurança | `apps/api/src/auth/` + `users/` + `roles/` — Supabase Auth, RLS, JWT, perfis |
| `frontend-agent` | Interface web | `apps/web/` — todas as telas, mocks, componentes, hooks, services |
| `ai-agent` | Chat com IA | `apps/api/src/ai-insights/` — Claude API, contexto de dados, histórico de chat |
| `automation-agent` | Automação e comandos | `apps/api/src/automation/` + `command_log` — rotinas, fluxo CCO, audit log |
| `integration-agent` | APIs externas | `apps/api/src/integrations/` — Infraspeak, WhatsApp, SendGrid |

---

## 8. Estrutura do Monorepo

```
bluebee-iot/
├── apps/
│   ├── web/                    # Next.js — frontend
│   │   └── src/
│   │       ├── mocks/          # dados e handlers de mock
│   │       ├── services/       # camada de serviço (mock ↔ API)
│   │       ├── hooks/          # React Query hooks
│   │       └── components/     # componentes de UI
│   ├── api/                    # NestJS — backend principal
│   └── gateway/                # NestJS Microservice — gateway local
├── packages/
│   ├── shared-types/           # tipos TypeScript compartilhados (DTOs, payloads)
│   ├── mqtt-contracts/         # contratos e schemas dos tópicos MQTT
│   ├── ui/                     # design system / componentes compartilhados
│   └── config/                 # ESLint, Prettier, tsconfig base
├── docs/
│   ├── PRD.md                  # este documento
│   ├── agents/                 # documentação de cada agente Claude Code
│   └── mqtt/                   # documentação dos tópicos e payloads MQTT
├── CLAUDE.md                   # instruções mestre para o Claude Code
└── docker-compose.yml          # Supabase, TimescaleDB, EMQX, Redis local
```

---

## 9. Fases de Entrega

| Fase | Escopo | Critério de Conclusão |
|------|--------|-----------------------|
| **Fase 0 — Frontend Mock** | Todas as telas do sistema com dados mock realistas, navegação completa, componentes validados | 100% das telas navegáveis com mock antes de qualquer backend |
| **Fase 1 — Core** | Auth multi-tenant + MQTT + telemetria + dashboard integrado com API real | Dados fluindo do equipamento ao dashboard em tempo real |
| **Fase 2 — Alarmes** | Motor de alarmes + notificações WhatsApp/e-mail + histórico | Alarme detectado, notificado e registrado end-to-end |
| **Fase 3 — Visualização** | Telas gráficas SCADA + trends + relatórios PDF/Excel | Cliente visualiza seu sistema completo com histórico |
| **Fase 4 — Integrações** | Infraspeak + automações + comandos via CCO | OS aberta automaticamente, rotinas executando |
| **Fase 5 — IA** | Chat com IA + insights + análise de padrões | Usuário faz pergunta em PT-BR e recebe análise dos dados |

---

## 10. Questões em Aberto

> Itens que precisam de definição antes ou durante o desenvolvimento.

- [ ] **Hardware do gateway:** Raspberry Pi, mini PC ou container? Modelo padrão para instalação nos clientes?
- [ ] **Broker MQTT:** self-hosted (EMQX) ou managed cloud (EMQX Cloud, HiveMQ)?
- [ ] **Mapa de pontos:** quais fabricantes/modelos Modbus e BACnet a integradora atende? Quais os registradores principais?
- [ ] **SLA de alarme:** qual o tempo máximo aceitável para detectar e notificar um alarme crítico?
- [ ] **Retenção de dados:** por quantos meses manter telemetria raw no TimescaleDB?
- [ ] **WhatsApp API:** conta própria da Autobras ou via parceiro (Twilio, Z-API, Evolution API)?
- [ ] **Infraspeak:** conta e API key disponíveis para testes?
- [ ] **Modelo de licenciamento:** por cliente, por dispositivo ou flat fee?
- [ ] **Redis:** self-hosted ou managed (Redis Cloud, Upstash)?

---

*BlueBee IoT — PRD v2.0 — Autobras BlueBee — Confidencial*
