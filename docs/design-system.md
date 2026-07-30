# BlueBee IoT — Design System

> Gerado via skill `ui-ux-pro-max` (domínios: `style`, `color`, `typography`) com curadoria para sistema supervisório industrial BMS.
> Stack: Next.js 14 + TailwindCSS + shadcn/ui

---

## 1. Estilo Visual — Real-Time Monitoring Light

**Estilo escolhido:** `Real-Time Monitoring` em light mode — fundo limpo, dados prominentes, status colorido.

**Justificativa:**
- Light mode prioriza apresentação e clareza para clientes e equipe de vendas
- Fundo branco/cinza claro destaca os indicadores de status coloridos de forma mais limpa
- Dados numéricos têm maior contraste e legibilidade em fundo claro
- Benchmarks light: Grafana (light theme), ABB Ability, Honeywell Forge

**Regras de estilo:**
- `style-match` ✓ — Real-Time Monitoring, light variant
- `no-emoji-icons` ✓ — Lucide React exclusivamente
- `icon-style-consistent` ✓ — stroke 1.5px, tamanho 20px padrão
- `effects-match-style` ✓ — Sombra sutil (`shadow-sm`) para elevação de cards; sem glassmorphism
- `elevation-consistent` ✓ — `shadow-sm` → `shadow-md` → `shadow-lg` para cards → modais → popovers

---

## 2. Paleta de Cores

**Base:** Industrial Professional Light — slate neutro + cyan brand + status semânticos.

### 2.1 Tokens Base (shadcn/ui / CSS Variables)

```css
/* apps/frontend/src/app/globals.css */

:root {
  /* === Backgrounds === */
  --background:         210 40% 98%;    /* #F8FAFC — página principal */
  --card:               0 0% 100%;      /* #FFFFFF — cards e painéis */
  --popover:            0 0% 100%;      /* #FFFFFF — dropdowns, tooltips */
  --muted:              210 40% 96%;    /* #F1F5F9 — seções de baixo destaque */

  /* === Foregrounds === */
  --foreground:         222 84% 5%;     /* #0F172A — texto primário */
  --card-foreground:    222 84% 5%;     /* #0F172A */
  --popover-foreground: 222 84% 5%;     /* #0F172A */
  --muted-foreground:   215 16% 47%;    /* #64748B — texto secundário / labels */

  /* === Borders / Rings === */
  --border:             214 32% 91%;    /* #E2E8F0 — bordas de cards e inputs */
  --input:              214 32% 91%;    /* #E2E8F0 */
  --ring:               199 89% 35%;    /* #0E7490 — outline de foco */

  /* === Brand / Primary (cyan BlueBee) === */
  --primary:            199 89% 35%;    /* #0E7490 — cyan-700, WCAG AA 7:1 fundo branco */
  --primary-foreground: 0 0% 100%;      /* #FFFFFF — texto sobre primary */

  /* === Secondary === */
  --secondary:          210 40% 96%;    /* #F1F5F9 — botões secundários */
  --secondary-foreground: 222 84% 5%;   /* #0F172A */

  /* === Accent (hover / seleção) === */
  --accent:             210 40% 93%;    /* #E8EEF4 */
  --accent-foreground:  222 84% 5%;     /* #0F172A */

  /* === Destructive === */
  --destructive:        0 72% 51%;      /* #DC2626 */
  --destructive-foreground: 0 0% 100%; /* #FFFFFF */

  /* === Radius === */
  --radius: 0.5rem; /* 8px — padrão shadcn */
}
```

### 2.2 Tokens Semânticos BMS

```css
/* Estender globals.css — status de dispositivos e severidades de alarme */

:root {
  /* === Status de dispositivos === */
  --status-online:      142 76% 30%;    /* #166534 — verde-800 (contraste 7.6:1 no branco) */
  --status-offline:     215 16% 47%;    /* #64748B — cinza */
  --status-warning:     32 95% 34%;     /* #92400E — âmbar-800 (contraste 7.2:1) */
  --status-alarm:       0 72% 44%;      /* #B91C1C — vermelho-700 (contraste 6.4:1) */
  --status-unknown:     263 70% 50%;    /* #6D28D9 — violeta-700 (contraste 5.1:1) */

  /* === Severidade de alarmes (BMS) === */
  --alarm-critical:     0 72% 44%;      /* #B91C1C — CRÍTICO */
  --alarm-high:         24 90% 38%;     /* #C2410C — ALTO */
  --alarm-medium:       32 95% 34%;     /* #92400E — MÉDIO */
  --alarm-low:          221 83% 43%;    /* #1D4ED8 — BAIXO */
  --alarm-info:         263 70% 50%;    /* #6D28D9 — INFORMATIVO */

  /* === Valores de telemetria === */
  --value-normal:       142 76% 30%;    /* #166534 */
  --value-warning:      32 95% 34%;     /* #92400E */
  --value-critical:     0 72% 44%;      /* #B91C1C */
  --value-offline:      215 16% 47%;    /* #64748B */

  /* === Realtime indicators === */
  --live-dot:           142 69% 42%;    /* #16A34A — verde-600 (para o dot em si) */
  --update-blink:       199 89% 35%;    /* #0E7490 */
}
```

### 2.3 Mapeamento em Tailwind

```typescript
// tailwind.config.ts
import type { Config } from 'tailwindcss';

const config: Config = {
  theme: {
    extend: {
      colors: {
        status: {
          online:  'hsl(var(--status-online))',
          offline: 'hsl(var(--status-offline))',
          warning: 'hsl(var(--status-warning))',
          alarm:   'hsl(var(--status-alarm))',
          unknown: 'hsl(var(--status-unknown))',
        },
        alarm: {
          critical: 'hsl(var(--alarm-critical))',
          high:     'hsl(var(--alarm-high))',
          medium:   'hsl(var(--alarm-medium))',
          low:      'hsl(var(--alarm-low))',
          info:     'hsl(var(--alarm-info))',
        },
        value: {
          normal:   'hsl(var(--value-normal))',
          warning:  'hsl(var(--value-warning))',
          critical: 'hsl(var(--value-critical))',
          offline:  'hsl(var(--value-offline))',
        },
      },
      animation: {
        'pulse-live':   'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'blink-alarm':  'blink 1s step-start infinite',
      },
      keyframes: {
        blink: {
          '0%, 100%': { opacity: '1' },
          '50%':       { opacity: '0.25' },
        },
      },
    },
  },
};
```

### 2.4 Referência visual rápida

| Uso | Classe Tailwind | Hex |
|-----|----------------|-----|
| Página (fundo) | `bg-background` | `#F8FAFC` |
| Card / painel | `bg-card` (+ `shadow-sm`) | `#FFFFFF` |
| Área muted | `bg-muted` | `#F1F5F9` |
| Texto principal | `text-foreground` | `#0F172A` |
| Texto secundário | `text-muted-foreground` | `#64748B` |
| Borda | `border-border` | `#E2E8F0` |
| Primário (brand) | `text-primary` / `bg-primary` | `#0E7490` |
| Online | `text-status-online` | `#166534` |
| Offline | `text-status-offline` | `#64748B` |
| Warning | `text-status-warning` | `#92400E` |
| Alarme | `text-status-alarm` | `#B91C1C` |
| Alarme Crítico | `text-alarm-critical` | `#B91C1C` |
| Alarme Alto | `text-alarm-high` | `#C2410C` |
| Alarme Médio | `text-alarm-medium` | `#92400E` |
| Alarme Baixo | `text-alarm-low` | `#1D4ED8` |
| Alarme Info | `text-alarm-info` | `#6D28D9` |

> Todos os tokens de status/alarme têm contraste ≥ 4.5:1 sobre `#FFFFFF` e `#F8FAFC` (WCAG AA).

---

## 3. Tipografia

**Pairing escolhido:** `Modern Dark Cinema (Inter)` + `Dashboard Data (Fira Code)` — skill `typography` domain.

**Justificativa:**
- **Inter** — excelente legibilidade em tamanhos pequenos, pesos variados → ideal para labels, títulos, navegação
- **Fira Code** — monospaced, perfeita para valores numéricos de telemetria → previne layout shift quando valores mudam

### 3.1 Import (Next.js `layout.tsx`)

```typescript
// apps/frontend/src/app/layout.tsx
import { Inter, Fira_Code } from 'next/font/google';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const firaCode = Fira_Code({
  subsets: ['latin'],
  variable: '--font-fira-code',
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${inter.variable} ${firaCode.variable}`}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
```

### 3.2 Configuração Tailwind

```typescript
// tailwind.config.ts — adicionar ao extend
fontFamily: {
  sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
  mono: ['var(--font-fira-code)', 'ui-monospace', 'monospace'],
},
```

### 3.3 Escala tipográfica

| Nível | Tailwind | px | Font | Peso | Uso |
|-------|----------|----|------|------|-----|
| Display | `text-3xl` | 30 | Inter | `font-bold` (700) | Títulos de página |
| H1 | `text-2xl` | 24 | Inter | `font-semibold` (600) | Cabeçalhos de seção |
| H2 | `text-xl` | 20 | Inter | `font-semibold` (600) | Cabeçalhos de card |
| H3 | `text-lg` | 18 | Inter | `font-medium` (500) | Sub-seções |
| Body | `text-sm` | 14 | Inter | `font-normal` (400) | Conteúdo principal |
| Caption | `text-xs` | 12 | Inter | `font-normal` (400) | Labels, metadados |
| Data XL | `text-3xl font-mono` | 30 | Fira Code | `font-bold` (700) | KPIs principais |
| Data LG | `text-xl font-mono` | 20 | Fira Code | `font-semibold` (600) | Valores de card |
| Data SM | `text-sm font-mono` | 14 | Fira Code | `font-normal` (400) | Leituras de telemetria |

### 3.4 Regras críticas para dados numéricos

```tsx
{/* ✅ Sempre usar font-mono + tabular-nums para valores de telemetria */}
<span className="font-mono tabular-nums text-xl font-semibold text-foreground">
  {temperature.toFixed(1)}°C
</span>

{/* globals.css — classe utilitária global */}
{/* .data-value { font-variant-numeric: tabular-nums; } */}
```

---

## 4. Componentes — Padrões Visuais

### 4.1 Status Indicator (dot + label)

```tsx
// Nunca cor sozinha — sempre dot + texto (SKILL rule: color-not-only)
const statusConfig = {
  online:  { dot: 'bg-green-500 animate-pulse-live',  label: 'Online'  },
  offline: { dot: 'bg-slate-400',                     label: 'Offline' },
  warning: { dot: 'bg-amber-500 animate-pulse-live',  label: 'Atenção' },
  alarm:   { dot: 'bg-red-600   animate-blink-alarm', label: 'Alarme'  },
};
// Dot: rounded-full w-2 h-2 (8px) em modo compacto, w-3 h-3 (12px) em modo normal
```

### 4.2 Alarm Badge (severity)

```tsx
// Badges usam tint de fundo da cor de alarme — padrão shadcn/ui Badge variant
const alarmBadgeConfig = {
  critical: 'bg-red-50    text-red-700    border border-red-200',
  high:     'bg-orange-50 text-orange-700 border border-orange-200',
  medium:   'bg-amber-50  text-amber-800  border border-amber-200',
  low:      'bg-blue-50   text-blue-700   border border-blue-200',
  info:     'bg-violet-50 text-violet-700 border border-violet-200',
};
```

### 4.3 Cards de dados

```
- Fundo:   bg-card (#FFFFFF)
- Sombra:  shadow-sm (elevação sutil — preferir sobre borda em light mode)
- Borda:   border border-border (1px, #E2E8F0) — opcional com shadow-sm
- Padding: p-4 (16px) em cards compactos, p-6 (24px) em cards principais
- Radius:  rounded-xl (12px) para cards principais, rounded-lg (8px) para items de lista
- Hover:   hover:shadow-md transition-shadow duration-150
- Header:  border-b border-border pb-3 mb-4 text-sm font-semibold text-muted-foreground
```

### 4.4 Sidebar de navegação

```
- Fundo:        bg-white border-r border-border
- Largura:      w-64 (256px) expandida, w-16 (64px) colapsada
- Item ativo:   bg-primary/10 text-primary border-l-2 border-primary font-medium
- Item hover:   hover:bg-accent transition-colors duration-150
- Ícone:        Lucide, h-5 w-5 (20px), strokeWidth={1.5}
- Label:        text-sm font-medium
- Logo/header:  border-b border-border h-16 flex items-center px-4
```

### 4.5 Header / Top Bar

```
- Fundo:   bg-white border-b border-border
- Altura:  h-14 (56px)
- Sombra:  shadow-sm
- Conteúdo: TenantSelector (esquerda/centro) + UserMenu + NotificationBell (direita)
```

### 4.6 Gráficos (Recharts)

```
- Fundo do container: bg-card (#FFFFFF)
- Grid lines:  stroke="#E2E8F0" strokeDasharray="3 3"
- Linha normal:  #0E7490 (primary cyan)
- Linha warning: #D97706 (amber-600)
- Linha crítica: #DC2626 (red-600)
- Eixos (tick): fill="#64748B" fontSize={12}
- Tooltip:  bg-white border border-border shadow-md rounded-lg text-foreground
- Legenda:  fontSize={12} fill="#64748B"
```

---

## 5. Animações e Interatividade

Seguindo SKILL.md (§7):

| Tipo | Duração | Easing |
|------|---------|--------|
| Micro-interações (hover, clique) | 150ms | `ease-out` |
| Transições de estado | 200ms | `ease-out` |
| Modais (entrada) | 250ms | `cubic-bezier(0.16, 1, 0.3, 1)` |
| Modais (saída) | 150ms | `ease-in` |
| Alerta ativo (pulse dot) | 2000ms | `infinite` |
| Blink alarme crítico | 1000ms | `step-start infinite` |

**Regras obrigatórias:**
- `@media (prefers-reduced-motion: reduce)` → desabilitar pulse/blink
- Animações apenas em `transform` e `opacity`
- Máximo 2 elementos animados por view

---

## 6. Layout e Responsividade

### Breakpoints

| Nome | px | Tailwind | Comportamento |
|------|----|----------|---------------|
| Mobile | 375 | `base` | Sidebar oculta, botão menu hamburger |
| Tablet | 768 | `md:` | Sidebar como drawer (overlay) |
| Desktop | 1024 | `lg:` | Sidebar fixa (256px) |
| Wide | 1440 | `xl:` | `max-w-7xl` no conteúdo |

### Grid de layout

```
Desktop:  [sidebar 256px] [main flex-1 bg-background p-6]
Tablet:   [drawer overlay] [main 100% bg-background p-4]
Mobile:   [main 100% bg-background p-4] [bottom-nav fixo]
```

### Espaçamento

- Sistema 4px: `gap-1`=4px, `gap-2`=8px, `gap-4`=16px, `gap-6`=24px, `gap-8`=32px
- Padding de página: `p-6` (desktop), `p-4` (mobile)
- Gap entre cards: `gap-4` compacto, `gap-6` padrão

---

## 7. Ícones

**Biblioteca:** Lucide React (`lucide-react`)

```bash
npm install lucide-react --workspace=@bluebee/frontend
```

**Regras:**
- `strokeWidth={1.5}` em todos
- `className="h-5 w-5"` (20px) para ícones de UI e nav
- `className="h-6 w-6"` (24px) para KPIs e destaques
- Nunca emoji como ícone
- Ícones de ação sem texto visível → `aria-label` obrigatório

**Mapeamento BMS:**

| Conceito | Ícone Lucide |
|----------|-------------|
| Dashboard | `LayoutDashboard` |
| Alarmes (inativo) | `Bell` |
| Alarmes (ativo) | `BellRing` |
| Dispositivos | `Cpu` |
| Telemetria / Trends | `TrendingUp` |
| Relatórios | `FileBarChart` |
| Automações | `Zap` |
| SCADA / Telas | `Monitor` |
| Chat IA | `MessageSquare` |
| Gateway | `Router` |
| Usuários | `Users` |
| Configurações | `Settings` |
| Online | `Wifi` |
| Offline | `WifiOff` |
| Crítico | `AlertCircle` |
| Warning | `AlertTriangle` |
| Info | `Info` |
| Temperatura | `Thermometer` |
| Pressão | `Gauge` |
| Energia | `Zap` |
| Tenant / Cliente | `Building2` |

---

## 8. shadcn/ui — Configuração

```bash
# Inicializar no frontend
cd apps/frontend
npx shadcn@latest init
# style=default | baseColor=slate | cssVariables=yes | lightMode
```

**Componentes prioritários para Fase 0:**

```bash
npx shadcn@latest add badge button card dialog dropdown-menu
npx shadcn@latest add input label select separator sheet
npx shadcn@latest add table tabs tooltip skeleton
npx shadcn@latest add sidebar
```

---

## 9. Checklist de Implementação

### Acessibilidade (CRÍTICO)
- [ ] Contraste texto/fundo ≥ 4.5:1 (body sobre `#F8FAFC` e `#FFFFFF`)
- [ ] Contraste cores de alarme ≥ 4.5:1 sobre bg-card e bg-background
- [ ] Focus ring visível em todos os interativos (`--ring`)
- [ ] Ícones funcionais com `aria-label`
- [ ] Status nunca indicado só por cor (sempre + texto/ícone)
- [ ] `prefers-reduced-motion` respeitado
- [ ] Hierarquia de headings sequencial (h1→h6)

### Toque / Interação (CRÍTICO)
- [ ] Alvos de clique ≥ 44×44px
- [ ] `cursor-pointer` em todos os clicáveis
- [ ] Hover com `transition-*` 150ms
- [ ] Botões desabilitados com `disabled` + spinner durante async

### Performance (ALTO)
- [ ] Inter e Fira Code via `next/font/google`
- [ ] `tabular-nums` em todos os valores numéricos
- [ ] Skeleton screens para carregamentos > 300ms
- [ ] Listas 50+ items com virtualização

---

## 10. Referências

- skill `ui-ux-pro-max` — domínios `style`, `color`, `typography`
- shadcn/ui: CSS variables (light mode)
- Tailwind CSS: tokens customizados de status e alarme
- Lucide React: ícones
- Fira Code: telemetria e valores numéricos
- Inter: UI, labels, navegação
