# Plano — Evolução das Trends (BlueBee)

> Visão para transformar a Trend de "gráfico do histórico cru" em uma **ferramenta
> de análise operacional** (diagnóstico, eficiência energética, manutenção
> preditiva e compliance), alinhada a plataformas BMS profissionais.
> ⚠️ Algumas fases exigem **migração de banco** e habilitar **TimescaleDB** — só
> aplicar com autorização.

---

## 1. Conceito central

A Trend deixa de ser um gráfico e passa a ser um **histórico governado em 3
camadas**: como o dado é **gravado** → como é **agregado/consultado** → como é
**analisado**. Todas as funcionalidades pedidas (comparação de períodos, causa
raiz, eficiência, preditiva, compliance) são **consumidoras** dessas camadas.
Por isso a ordem de construção é **de baixo para cima**.

```
┌─ Camada 3 — Análise (UI / Relatórios) ───────────────────────┐
│ comparação de períodos · estatísticas · causa raiz ·          │
│ eficiência energética · manutenção preditiva · compliance     │
├─ Camada 2 — Consulta & Agregação ───────────────────────────┤
│ downsample adaptativo · rollups 1m/1h/1d · estatísticas no BD │
├─ Camada 1 — Armazenamento governado ────────────────────────┤
│ COV/deadband · amostragem por tipo · retenção em camadas      │
└──────────────────────────────────────────────────────────────┘
```

---

## 2. Estado atual (base já pronta)

| Recurso | Situação |
|---|---|
| Sobreposição de variáveis (multi-seleção, cores estáveis) | ✅ pronto |
| Seleção de intervalo (1h / 24h / 7d / 30d / custom) | ✅ pronto |
| Estatísticas básicas (mín / máx / média / nº registros) | ✅ pronto |
| Agregação por bucket (`minute` / `hour` / `day`) via `date_trunc` | ✅ pronto |
| Modos de gravação `ON_CHANGE` / `INTERVAL` | ✅ pronto |
| Retenção por-trend (`retentionDays`, purga em loop) | ✅ pronto |
| Exportação CSV/PDF | ✅ movida para o módulo **Relatórios** |

**Importante:** hoje `trend_records` é uma **tabela Postgres comum** (índice +
`date_trunc` nas queries + retenção via `deleteMany`). O TimescaleDB consta no
PRD/stack como **intenção**, mas ainda **não está ligado** nas trends. Habilitá-lo
é parte central deste plano.

---

## 3. Camada 1 — Armazenamento governado

O ponto que falta e que **destrava todo o resto**.

### 3.1 COV / deadband configurável por trend
- Novo campo `covThreshold` (Float): grava analógico apenas quando o valor variar
  **além do limite** (ex.: ±0,5 °C). Substitui o `ON_CHANGE` atual (que grava em
  qualquer mudança) por um *deadband* real.
- Reduz drasticamente o volume de dados sem perder o comportamento da variável.

### 3.2 Heartbeat (intervalo máximo)
- Novo campo `maxIntervalSeconds` (Int, opcional): mesmo sem variação relevante,
  gravar 1 ponto a cada X (ex.: 900 s). Evita "buracos" no gráfico e serve como
  **evidência de compliance** (prova de que o ponto estava sendo lido).

### 3.3 Digital = só na mudança de estado
- Comportamento natural com COV = 0 em pontos digitais (Desligado→Ligado etc.).

### 3.4 Retenção em camadas (em vez de apagar tudo)
- **Cru** (alta resolução) → retenção curta (ex.: 30–90 dias).
- **Rollups** 1m / 1h / 1d (agregados contínuos) → retenção longa (1–5 anos).
- É o que permite **comparar meses/anos** sem explodir o banco.

### 3.5 TimescaleDB
- `trend_records` vira **hypertable**.
- **Continuous aggregates** materializam os rollups 1m/1h/1d.
- Políticas de **compressão** e **retenção** nativas (substituem o purge manual).

---

## 4. Camada 2 — Consulta & agregação

- **Downsample adaptativo**: a janela escolhida decide se a leitura vem do cru ou
  de um rollup. Hoje fazemos isso "na mão" com `date_trunc`; com Timescale fica
  nativo e rápido para janelas longas.
- **Estatísticas no banco**: além de mín/máx/média, calcular **desvio padrão**
  (`stddev_pop`), **p95**, **taxa de variação** e **contagem de ciclos** liga/
  desliga — insumos diretos da manutenção preditiva.

---

## 5. Camada 3 — Análise (as features do prompt)

| Feature | Como vira realidade |
|---|---|
| **Comparação de períodos** (hoje×ontem, semana×semana, mês×mês) | endpoint que aceita 2+ janelas da mesma trend; o gráfico sobrepõe num eixo de **tempo relativo** (offset) e mostra o delta (Δmédia, Δpico) |
| **Diagnóstico / causa raiz** | a partir de um **alarme**, abrir as trends dos pontos relacionados **na janela do evento** — amarra Alarmes ↔ Trends. Maior valor operacional |
| **Eficiência energética** | derivada dos rollups: horários de partida, consumo fora de programação, falta de modulação. Não exige dado novo, só leitura sobre os agregados |
| **Manutenção preditiva** | tendência de corrente/pressão, oscilações frequentes, ciclos excessivos de partida — calculados sobre as estatísticas da Camada 2 |
| **Conforto / compliance** | relatório de "% do tempo dentro da faixa especificada" — encaixa no módulo de **Relatórios** já existente |

> Diagnóstico, Eficiência, Preditiva e Compliance **não são features separadas de
> gravação** — são *leituras* sobre as Camadas 1 e 2. Por isso a base vem primeiro.

---

## 6. Mudanças de schema previstas

```prisma
model Trend {
  // ... campos atuais ...
  covThreshold        Float?   @map("cov_threshold")        // deadband analógico
  maxIntervalSeconds  Int?     @map("max_interval_seconds") // heartbeat
}
```

- O enum `TrendMode` (`ON_CHANGE` / `INTERVAL`) pode evoluir para combinar
  COV + heartbeat (ex.: `COV`, `INTERVAL`, `COV_PLUS_HEARTBEAT`), a decidir na
  implementação.
- Rollups: tabelas/continuous aggregates novos (Timescale), não-Prisma (SQL puro
  em migração).

---

## 7. Roadmap (ordem de dependência)

| Fase | Entrega | Depende de |
|---|---|---|
| 1 | COV/deadband + heartbeat por trend (migração + `TrendRecorderService`) | — |
| 2 | TimescaleDB: hypertable + continuous aggregates 1m/1h/1d + compressão/retenção | 1 |
| 3 | Estatísticas avançadas (desvio padrão, ciclos, taxa de variação) no `seriesFor` | 2 |
| 4 | Comparação de períodos (backend multi-janela + UI de sobreposição relativa) | 2 |
| 5 | Causa raiz: link Alarme → Trends na janela do evento | 2 |
| 6 | Eficiência / Preditiva / Compliance (painéis + relatórios) | 3–5 |

---

## 8. Decisões em aberto

- **COV padrão** por tipo de ponto (temperatura, pressão, energia) — definir
  valores sugeridos no cadastro da trend.
- **Retenção do cru vs rollup** — janelas exatas (30/90 dias cru; 1/5 anos rollup?).
- **Migração para edge**: a gravação COV poderia rodar no gateway no futuro
  (coerente com o evaluator de alarmes portável). Hoje fica no backend.
- **UI de comparação**: eixo de tempo relativo (offset) vs absoluto sobreposto.

---

> Relacionado: [alarmes-trends-design.md](alarmes-trends-design.md) (modelo
> por-ponto EBO) e o módulo de **Relatórios** (consome trends para compliance).
