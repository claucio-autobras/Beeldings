---
name: database-schema
description: Schema completo do banco de dados do BlueBee IoT em Supabase/PostgreSQL, incluindo tenants, projetos, sites, gateways, dispositivos, variáveis, alarmes, telemetria, usuários e relações multi-tenant. Use quando claude code precisar criar, revisar ou alterar migrations, tabelas, índices, relacionamentos, políticas RLS, entidades, DTOs ou consultas alinhadas ao modelo de dados.
---

# Skill: database-schema

Schema completo do banco de dados do BlueBee IoT.

---

## Supabase (PostgreSQL) — dados relacionais

```sql
-- Tenants (clientes da integradora)
CREATE TABLE tenants (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  slug        TEXT UNIQUE NOT NULL,  -- usado em URLs
  active      BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Projetos por tenant
CREATE TABLE projects (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Sites por projeto
CREATE TABLE sites (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  address     TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Usuários
CREATE TABLE users (
  id          UUID PRIMARY KEY REFERENCES auth.users(id),  -- Supabase Auth
  tenant_id   UUID REFERENCES tenants(id),  -- NULL para ADMIN/CCO/SUPERVISOR
  role        TEXT NOT NULL CHECK (role IN ('ADMIN','CCO','SUPERVISOR','CLIENTE','VISUALIZADOR')),
  name        TEXT NOT NULL,
  email       TEXT NOT NULL,
  active      BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Gateways
CREATE TABLE gateways (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  site_id     UUID REFERENCES sites(id),
  name        TEXT NOT NULL,
  status      TEXT DEFAULT 'offline',  -- online | offline | error
  last_seen   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Dispositivos
CREATE TABLE devices (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  site_id     UUID NOT NULL REFERENCES sites(id),
  gateway_id  UUID REFERENCES gateways(id),
  name        TEXT NOT NULL,
  type        TEXT NOT NULL,   -- chiller | ahu | vav | pump | fan | sensor
  protocol    TEXT NOT NULL,   -- modbus | bacnet
  status      TEXT DEFAULT 'offline',
  config      JSONB,           -- configuração específica do protocolo
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Variáveis/Pontos por dispositivo
CREATE TABLE device_points (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  device_id   UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  tag         TEXT NOT NULL,
  name        TEXT NOT NULL,   -- nome amigável
  unit        TEXT,
  data_type   TEXT,            -- float | integer | boolean
  min_value   FLOAT,
  max_value   FLOAT,
  UNIQUE(device_id, tag)
);

-- Regras de alarme
-- Modelo BINÁRIO: sem severidade — todo alarme é tratado igualmente
CREATE TABLE alarm_rules (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id),
  device_id           UUID NOT NULL REFERENCES devices(id),
  tag                 TEXT NOT NULL,
  name                TEXT NOT NULL,
  condition           JSONB NOT NULL,    -- { type, operator, value, duration_minutes }
  message_template    TEXT NOT NULL,
  notify_internally   BOOLEAN DEFAULT true,   -- notifica equipe da integradora
  notify_client       BOOLEAN DEFAULT false,  -- notifica cliente final
  opens_work_order    BOOLEAN DEFAULT false,  -- abre OS no Infraspeak se sem ACK
  escalation_minutes  INTEGER DEFAULT 30,     -- tempo sem ACK para re-notificar
  active              BOOLEAN DEFAULT true,
  created_at          TIMESTAMPTZ DEFAULT now()
);

-- Alarmes (histórico)
-- Modelo BINÁRIO: um ponto está em ALARME ou NORMAL — sem severidade
CREATE TABLE alarms (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  rule_id           UUID REFERENCES alarm_rules(id),
  device_id         UUID NOT NULL REFERENCES devices(id),
  tag               TEXT NOT NULL,
  status            TEXT NOT NULL CHECK (status IN ('active','acknowledged','normalized')),
  message           TEXT NOT NULL,
  value_at_trigger  FLOAT,     -- valor do ponto no momento do disparo
  triggered_at      TIMESTAMPTZ DEFAULT now(),
  acknowledged_by   UUID REFERENCES users(id),
  acknowledged_at   TIMESTAMPTZ,
  note              TEXT,       -- anotação do técnico ao reconhecer
  normalized_at     TIMESTAMPTZ -- quando o ponto voltou ao estado normal
);

-- Regras de automação
CREATE TABLE automation_rules (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id),
  name             TEXT NOT NULL,
  enabled          BOOLEAN DEFAULT true,
  trigger          JSONB NOT NULL,  -- condição ou agendamento
  action           JSONB NOT NULL,  -- comando a executar
  requires_approval BOOLEAN DEFAULT false,
  cooldown_minutes INTEGER DEFAULT 0,
  last_executed_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT now()
);

-- Log de comandos (audit trail)
CREATE TABLE command_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  device_id     UUID NOT NULL REFERENCES devices(id),
  requested_by  UUID REFERENCES users(id),
  approved_by   UUID REFERENCES users(id),
  action        TEXT NOT NULL,
  parameters    JSONB,
  status        TEXT NOT NULL,  -- pending_approval | approved | rejected | sent | executed | failed
  error         TEXT,
  requested_at  TIMESTAMPTZ DEFAULT now(),
  executed_at   TIMESTAMPTZ
);

-- Histórico de chat com IA
CREATE TABLE ai_conversations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id),
  user_id    UUID NOT NULL REFERENCES users(id),
  messages   JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Log MQTT
CREATE TABLE mqtt_logs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id),
  topic      TEXT NOT NULL,
  payload    JSONB,
  status     TEXT DEFAULT 'received',  -- received | processed | error
  error      TEXT,
  received_at TIMESTAMPTZ DEFAULT now()
);
```

---

## TimescaleDB — telemetria

```sql
CREATE TABLE telemetry (
  time       TIMESTAMPTZ      NOT NULL,
  tenant_id  UUID             NOT NULL,
  device_id  TEXT             NOT NULL,
  tag        TEXT             NOT NULL,
  value      DOUBLE PRECISION,
  unit       TEXT,
  quality    TEXT DEFAULT 'good'
);

SELECT create_hypertable('telemetry', 'time');
CREATE INDEX ON telemetry (tenant_id, device_id, tag, time DESC);
SELECT add_compression_policy('telemetry', INTERVAL '7 days');
SELECT add_retention_policy('telemetry', INTERVAL '6 months');
```