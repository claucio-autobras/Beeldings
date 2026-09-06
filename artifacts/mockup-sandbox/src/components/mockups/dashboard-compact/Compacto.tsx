import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import "./_group.css";
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Bell,
  BrainCircuit,
  BookOpen,
  Building2,
  Cctv,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  CircleDot,
  ClipboardList,
  Clock3,
  Download,
  Cpu,
  Droplets,
  FileBarChart,
  History,
  Lightbulb,
  LayoutDashboard,
  Menu,
  MapPin,
  MessageSquare,
  Monitor,
  Moon,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pause,
  Play,
  RefreshCw,
  Router,
  Server,
  Settings,
  Settings2,
  ShieldAlert,
  Sun,
  Sparkles,
  Timer,
  TrendingDown,
  TrendingUp,
  UserRound,
  Users,
  WifiOff,
  X,
  Zap,
} from "lucide-react";

type Status = "normal" | "atencao" | "falha" | "sem dados" | "carregando";
type Role = "admin" | "operador";
type Tone = "cyan" | "amber" | "red" | "green" | "slate";

const HIVE_HEX_CLIP = "polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%)";
const CENTER = { left: "50%", top: "50%" };
const SATELLITES = [
  { left: "31.86%", top: "16.95%" },
  { left: "68.14%", top: "16.95%" },
  { left: "86.27%", top: "50%" },
  { left: "68.14%", top: "83.05%" },
  { left: "31.86%", top: "83.05%" },
  { left: "13.73%", top: "50%" },
] as const;
const sandboxAsset = (name: string) => `${import.meta.env.BASE_URL}${name}`;

const toneStyles = {
  cyan: {
    edge: "bg-cyan-600 dark:bg-cyan-400",
    fill: "bg-cyan-50 dark:bg-cyan-950/40",
    text: "text-cyan-700 dark:text-cyan-300",
    dot: "bg-cyan-500",
  },
  amber: {
    edge: "bg-orange-500 dark:bg-orange-400",
    fill: "bg-orange-50 dark:bg-orange-950/40",
    text: "text-orange-700 dark:text-orange-300",
    dot: "bg-orange-500",
  },
  red: {
    edge: "bg-red-500 dark:bg-red-400",
    fill: "bg-red-50 dark:bg-red-950/40",
    text: "text-red-700 dark:text-red-300",
    dot: "bg-red-500",
  },
  green: {
    edge: "bg-emerald-600 dark:bg-emerald-400",
    fill: "bg-emerald-50 dark:bg-emerald-950/40",
    text: "text-emerald-700 dark:text-emerald-300",
    dot: "bg-emerald-500",
  },
  slate: {
    edge: "bg-slate-400 dark:bg-slate-500",
    fill: "bg-slate-50 dark:bg-slate-900",
    text: "text-slate-600 dark:text-slate-300",
    dot: "bg-slate-500",
  },
} satisfies Record<Tone, object>;

const gateways = [
  {
    name: "Gateway Principal",
    id: "GW-SP-01",
    site: "Shopping Vale Sul",
    status: "normal" as Status,
    cpu: 46,
    mem: 61,
    last: "agora",
  },
  {
    name: "Edge Rio Norte",
    id: "GW-RJ-02",
    site: "Hospital Santa Clara",
    status: "atencao" as Status,
    cpu: 84,
    mem: 91,
    last: "agora",
  },
  {
    name: "Gateway Legado",
    id: "GW-MG-01",
    site: "Condomínio Horizonte",
    status: "sem dados" as Status,
    cpu: 0,
    mem: 0,
    last: "há 5 min",
  },
  {
    name: "Edge Curitiba",
    id: "GW-PR-03",
    site: "Autobras S.A.",
    status: "falha" as Status,
    cpu: 0,
    mem: 0,
    last: "há 2 horas",
  },
];

const clients = [
  { name: "Shopping Vale Sul", alarms: 15, offline: 4, availability: "99,2%", status: "atencao" as Status },
  { name: "Hospital Santa Clara", alarms: 12, offline: 1, availability: "99,8%", status: "normal" as Status },
  { name: "Autobras S.A.", alarms: 8, offline: 5, availability: "96,4%", status: "falha" as Status },
];

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="relative block h-8 w-8 shrink-0 text-cyan-500">
        <svg viewBox="0 0 40 40" className="h-full w-full fill-none" aria-hidden="true">
          <path
            d="M20 2.8 35.3 11.4v17.2L20 37.2 4.7 28.6V11.4L20 2.8Z"
            fill="currentColor"
            fillOpacity=".1"
            stroke="currentColor"
            strokeWidth="1.4"
          />
          <path
            d="m20 10 8.3 4.8v9.6L20 29.2l-8.3-4.8v-9.6L20 10Z"
            fill="currentColor"
            fillOpacity=".2"
            stroke="currentColor"
            strokeWidth="1.2"
          />
        </svg>
      </span>
      <span className="text-xl font-semibold tracking-[-.06em] text-foreground">
        Beel<span className="text-cyan-600 dark:text-cyan-400">dings</span>
      </span>
    </div>
  );
}

function Panel({
  children,
  className = "",
  accent = false,
}: {
  children: ReactNode;
  className?: string;
  accent?: boolean;
}) {
  return (
    <section
      className={`relative overflow-hidden rounded-2xl border border-border bg-card shadow-sm dark:shadow-[inset_0_1px_0_rgba(157,218,231,.045),0_22px_48px_rgba(0,0,0,.22)] ${className}`}
    >
      {accent && <span className="absolute inset-x-0 top-0 h-0.5 bg-cyan-600 dark:bg-cyan-400" />}
      {children}
    </section>
  );
}

function SectionTitle({
  eyebrow,
  title,
  detail,
  action,
}: {
  eyebrow?: string;
  title: string;
  detail?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        {eyebrow && (
          <p className="font-mono text-[9px] font-bold uppercase tracking-[.18em] text-cyan-700 dark:text-cyan-300">
            {eyebrow}
          </p>
        )}
        <h2 className="mt-1 text-[15px] font-bold tracking-[-.025em] text-foreground">{title}</h2>
        {detail && <p className="mt-1 text-[11px] text-muted-foreground">{detail}</p>}
      </div>
      {action}
    </div>
  );
}

function StatusChip({ status, children }: { status: Status; children?: ReactNode }) {
  const config = {
    normal: {
      icon: CheckCircle2,
      label: "Normal",
      classes:
        "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300",
    },
    atencao: {
      icon: AlertTriangle,
      label: "Atenção",
      classes:
        "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-900/60 dark:bg-orange-950/40 dark:text-orange-300",
    },
    falha: {
      icon: AlertCircle,
      label: "Falha",
      classes: "border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300",
    },
    "sem dados": {
      icon: CircleDot,
      label: "Sem dados",
      classes: "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300",
    },
    carregando: {
      icon: RefreshCw,
      label: "Carregando",
      classes:
        "border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-900/60 dark:bg-cyan-950/40 dark:text-cyan-300",
    },
  }[status];
  const Icon = config.icon;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[9px] font-bold uppercase tracking-[.1em] ${config.classes}`}
    >
      <Icon className={`h-3 w-3 ${status === "carregando" ? "animate-spin" : ""}`} />
      {children ?? config.label}
    </span>
  );
}

function HexCell({
  style,
  tone,
  center = false,
  label,
  value,
  sub,
  icon,
}: {
  style: CSSProperties;
  tone: Tone;
  center?: boolean;
  label: string;
  value: string;
  sub?: string;
  icon?: ReactNode;
}) {
  const t = toneStyles[tone];
  return (
    <div
      style={style}
      className="absolute -translate-x-1/2 -translate-y-1/2 transition-transform duration-200 hover:scale-[1.035]"
    >
      <span className={`absolute inset-0 ${t.edge}`} style={{ clipPath: HIVE_HEX_CLIP }} />
      <span
        className={`absolute inset-[1.5px] flex flex-col items-center justify-center gap-0.5 px-[12%] text-center ${t.fill}`}
        style={{ clipPath: HIVE_HEX_CLIP }}
      >
        {icon && <span className={t.text}>{icon}</span>}
        <span className="font-mono text-[8px] uppercase leading-tight tracking-[.1em] text-muted-foreground">
          {label}
        </span>
        <span
          className={`${center ? "text-[clamp(31px,7vw,43px)]" : "text-[clamp(17px,4vw,23px)]"} font-mono font-bold leading-none tracking-[-.08em] ${t.text}`}
        >
          {value}
        </span>
        {sub && <span className="font-mono text-[8px] leading-tight text-muted-foreground">{sub}</span>}
      </span>
    </div>
  );
}

function Hive({ role }: { role: Role }) {
  const metrics =
    role === "admin"
      ? [
          { label: "Aguard. ACK", value: "18", sub: "5 críticos", tone: "amber" as Tone, icon: <Clock3 className="h-3.5 w-3.5" /> },
          { label: "Disp. offline", value: "12", sub: "de 8.964", tone: "slate" as Tone, icon: <WifiOff className="h-3.5 w-3.5" /> },
          { label: "Clientes ativos", value: "128", sub: "de 131", tone: "cyan" as Tone, icon: <Building2 className="h-3.5 w-3.5" /> },
          { label: "Gateways online", value: "29", sub: "de 31", tone: "cyan" as Tone, icon: <Server className="h-3.5 w-3.5" /> },
          { label: "Pontos críticos", value: "9", sub: "4 em falha", tone: "amber" as Tone, icon: <ShieldAlert className="h-3.5 w-3.5" /> },
          { label: "Disponibilidade", value: "99,4%", sub: "últimas 24h", tone: "green" as Tone, icon: <TrendingUp className="h-3.5 w-3.5" /> },
        ]
      : [
          { label: "Aguard. ACK", value: "6", sub: "1 crítico", tone: "amber" as Tone, icon: <Clock3 className="h-3.5 w-3.5" /> },
          { label: "Disp. offline", value: "4", sub: "de 412", tone: "slate" as Tone, icon: <WifiOff className="h-3.5 w-3.5" /> },
          { label: "Sites / áreas", value: "6", sub: "6 operando", tone: "cyan" as Tone, icon: <Building2 className="h-3.5 w-3.5" /> },
          { label: "Pontos críticos", value: "4", sub: "1 em falha", tone: "amber" as Tone, icon: <ShieldAlert className="h-3.5 w-3.5" /> },
          { label: "OS abertas", value: "4", sub: "2 em andamento", tone: "cyan" as Tone, icon: <Settings2 className="h-3.5 w-3.5" /> },
          { label: "Disponibilidade", value: "99,2%", sub: "últimas 24h", tone: "green" as Tone, icon: <TrendingUp className="h-3.5 w-3.5" /> },
        ];

  return (
    <div className="relative mx-auto aspect-[408/388] w-full max-w-[530px]">
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[88%] w-[84%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(14,116,144,.16),rgba(14,116,144,.04)_55%,transparent_72%)] dark:bg-[radial-gradient(circle,rgba(34,211,238,.16),rgba(34,211,238,.04)_55%,transparent_72%)]" />
      <HexCell
        style={{ ...CENTER, width: "41.18%", height: "50%" }}
        tone="red"
        center
        label="Alarmes ativos"
        value={role === "admin" ? "47" : "15"}
        sub={role === "admin" ? "12 alta severidade" : "3 alta severidade"}
        icon={<Bell className="h-4 w-4" />}
      />
      {metrics.map((item, index) => (
        <HexCell
          key={item.label}
          style={{ ...SATELLITES[index], width: "27.45%", height: "33.25%" }}
          {...item}
        />
      ))}
    </div>
  );
}

function AlarmRail({ role, onAction }: { role: Role; onAction: (message: string) => void }) {
  const [acknowledged, setAcknowledged] = useState<string[]>([]);
  const alarms =
    role === "admin"
      ? [
          { id: "a1", context: "Shopping Vale Sul · HVAC / Chiller 02", label: "Temperatura fora do setpoint", ago: "há 2 min", tone: "red" as Tone },
          { id: "a2", context: "Hospital Santa Clara · GW-RJ-02", label: "Gateway com CPU elevada", ago: "há 8 min", tone: "amber" as Tone },
          { id: "a3", context: "Autobras S.A. · Edge Curitiba", label: "Perda de comunicação", ago: "há 14 min", tone: "red" as Tone },
        ]
      : [
          { id: "a1", context: "Shopping Vale Sul · HVAC / Chiller 02", label: "Temperatura fora do setpoint", ago: "há 2 min", tone: "red" as Tone },
          { id: "a2", context: "Shopping Vale Sul · Bombas / B-04", label: "Pressão baixa no circuito", ago: "há 12 min", tone: "amber" as Tone },
          { id: "a3", context: "Shopping Vale Sul · Docas / CFTV 18", label: "Câmera sem sinal", ago: "há 23 min", tone: "amber" as Tone },
        ];

  return (
    <Panel className="p-5" accent>
      <SectionTitle
        eyebrow="Alarmes Recentes Ativos"
        title="O que precisa de atenção"
        detail="Ocorrências mais recentes e relevantes"
        action={<Bell className="h-4 w-4 text-red-500" />}
      />
      <div className="mt-4 space-y-2.5">
        {alarms.map((alarm) => {
          const done = acknowledged.includes(alarm.id);
          return (
            <article
              key={alarm.id}
              className={`rounded-xl border p-3 transition-colors ${
                done
                  ? "border-emerald-200 bg-emerald-50/60 opacity-60 dark:border-emerald-900/40 dark:bg-emerald-950/20"
                  : "border-border bg-muted/50 dark:bg-muted"
              }`}
            >
              <div className="flex items-start gap-2.5">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${done ? "bg-emerald-500" : toneStyles[alarm.tone].dot}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex gap-2">
                    <p className="flex-1 truncate text-[11px] font-bold text-foreground">{alarm.label}</p>
                    <span className="font-mono text-[9px] text-muted-foreground">{alarm.ago}</span>
                  </div>
                  <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{alarm.context}</p>
                  <div className="mt-2 flex items-center">
                    <StatusChip status={alarm.tone === "red" ? "falha" : "atencao"} />
                    <button
                      disabled={done}
                      onClick={() => {
                        setAcknowledged((items) => [...items, alarm.id]);
                        onAction("Alarme reconhecido nesta prévia.");
                      }}
                      className="ml-auto rounded-md border border-border px-2 py-1 font-mono text-[9px] font-bold uppercase text-muted-foreground transition-colors hover:bg-background hover:text-foreground disabled:opacity-50"
                    >
                      {done ? "reconhecido" : "reconhecer"}
                    </button>
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </div>
      <button
        onClick={() => onAction("Todos os alarmes abertos.")}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border py-2 font-mono text-[9px] font-bold uppercase text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        ver todos os alarmes <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </Panel>
  );
}

function InsightsPanel({ role, onAction }: { role: Role; onAction: (message: string) => void }) {
  const insights =
    role === "admin"
      ? [
          {
            id: "i1",
            category: "Operação",
            context: "Shopping Vale Sul · HVAC",
            label: "Bomba do Chiller 02 ficou ligada 1h24 a mais que ontem",
            evidence: "7h42 ligada hoje contra 6h18 ontem",
            delta: "+18%",
            ago: "até 10:40",
            signals: "12 sinais validados",
            action: "Revisão recomendada",
            tone: "amber" as Tone,
            icon: <Timer className="h-5 w-5" />,
          },
          {
            id: "i2",
            category: "Eficiência",
            context: "Hospital Santa Clara · Elétrica",
            label: "Hospital Santa Clara reduziu o consumo de energia nesta manhã",
            evidence: "−9,6% contra a média das últimas quatro quartas",
            delta: "−9,6%",
            ago: "até 10:40",
            signals: "9 sinais validados",
            action: "Tendência positiva",
            tone: "green" as Tone,
            icon: <Zap className="h-5 w-5" />,
          },
          {
            id: "i3",
            category: "Disponibilidade",
            context: "Autobras S.A. · Edge Curitiba",
            label: "Autobras S.A. teve 42 min sem leitura no gateway",
            evidence: "3 interrupções desde 06:00 · última há 8 min",
            delta: "42 min",
            ago: "há 8 min",
            signals: "7 sinais validados",
            action: "Atenção recomendada",
            tone: "red" as Tone,
            icon: <WifiOff className="h-5 w-5" />,
          },
        ]
      : [
          {
            id: "i1",
            category: "Operação",
            context: "Shopping Vale Sul · HVAC",
            label: "Bomba do Chiller 02 ficou ligada 1h24 a mais que ontem",
            evidence: "7h42 ligada hoje contra 6h18 ontem",
            delta: "+18%",
            ago: "até 10:40",
            signals: "12 sinais validados",
            action: "Revisão recomendada",
            tone: "amber" as Tone,
            icon: <Timer className="h-5 w-5" />,
          },
          {
            id: "i2",
            category: "Consumo",
            context: "Shopping Vale Sul · Medidor principal",
            label: "O consumo de energia está 12% acima do mesmo horário de ontem",
            evidence: "2,8 MWh hoje contra 2,5 MWh ontem",
            delta: "+12%",
            ago: "até 10:40",
            signals: "10 sinais validados",
            action: "Acompanhar tendência",
            tone: "amber" as Tone,
            icon: <Zap className="h-5 w-5" />,
          },
          {
            id: "i3",
            category: "Estabilidade",
            context: "Shopping Vale Sul · Hidráulica / B-04",
            label: "Pressão do circuito hidráulico oscilou quatro vezes nesta manhã",
            evidence: "pico de 4,8 bar · referência entre 3,2 e 4,1 bar",
            delta: "4 eventos",
            ago: "há 18 min",
            signals: "8 sinais validados",
            action: "Inspeção recomendada",
            tone: "red" as Tone,
            icon: <Droplets className="h-5 w-5" />,
          },
        ];
  const [activeIndex, setActiveIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const activeInsight = insights[activeIndex];
  const activeTone = toneStyles[activeInsight.tone];

  useEffect(() => {
    setActiveIndex(0);
    setProgress(0);
  }, [role]);

  useEffect(() => {
    if (paused) return;
    const timer = window.setInterval(() => {
      setProgress((current) => {
        if (current >= 100) {
          setActiveIndex((index) => (index + 1) % insights.length);
          return 0;
        }
        return current + 2.5;
      });
    }, 200);
    return () => window.clearInterval(timer);
  }, [insights.length, paused]);

  const selectInsight = (index: number) => {
    setActiveIndex(index);
    setProgress(0);
  };

  return (
    <Panel className="overflow-hidden p-0" accent>
      <div
        role="region"
        aria-label="Insights do dia"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        <div className="relative min-h-[265px] overflow-hidden bg-slate-50 px-5 pb-5 pt-5 text-slate-900 transition-colors dark:bg-slate-950 dark:text-slate-100">
          <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-cyan-500/10 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-28 left-1/3 h-52 w-52 rounded-full bg-blue-500/10 blur-3xl" />
          <div className="compact-ai-scan pointer-events-none absolute inset-x-0 top-16 h-px bg-cyan-600/15 dark:bg-cyan-300/20" />

          <div className="relative flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-cyan-100 text-cyan-700 dark:bg-cyan-400/15 dark:text-cyan-200">
                <BrainCircuit className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-mono text-[9px] font-bold uppercase tracking-[.12em] text-cyan-700 dark:text-cyan-200">Insight gerado pela BlueBee IA</span>
                  <span className="flex items-center gap-1 font-mono text-[8px] uppercase tracking-[.1em] text-emerald-700 dark:text-emerald-300">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500 dark:bg-emerald-300" />
                    ativo
                  </span>
                </div>
                <p className="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400">
                  {role === "admin" ? "Leitura inteligente da malha global" : "Leitura inteligente do site selecionado"}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span className="flex items-center gap-1.5 rounded-full border border-cyan-600/15 bg-white/60 px-1.5 py-1 dark:border-cyan-300/15 dark:bg-white/[.05] sm:px-2">
                <img src={sandboxAsset("bluebee-avatar.png")} alt="" className="h-5 w-5 object-contain" />
                <span className="hidden font-mono text-[9px] font-bold tracking-[.08em] text-slate-500 dark:text-slate-300 sm:inline">BlueBee</span>
              </span>
              <span className="font-mono text-[10px] font-bold tracking-[.12em] text-slate-400 dark:text-slate-500">
                {String(activeIndex + 1).padStart(2, "0")} / {String(insights.length).padStart(2, "0")}
              </span>
            </div>
          </div>

          <div className="relative mt-7 grid items-center gap-5 md:grid-cols-[minmax(0,1fr)_150px]">
            <div className="min-w-0">
              <div className={`inline-flex items-center gap-1.5 rounded-full border border-white/10 px-2 py-1 font-mono text-[9px] font-bold uppercase tracking-[.1em] ${activeTone.fill} ${activeTone.text}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${activeTone.dot}`} />
                {activeInsight.category}
              </div>
              <p className="mt-3 max-w-[470px] text-[17px] font-semibold leading-[1.25] tracking-[-.03em] text-slate-900 dark:text-white">
                {activeInsight.label}
              </p>
              <p className="mt-2.5 max-w-[520px] text-[13px] font-medium leading-[1.4] text-slate-600 dark:text-slate-300">{activeInsight.evidence}</p>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                <span className="rounded-md border border-slate-200/80 bg-white/50 px-1.5 py-0.5 font-mono text-[8px] text-slate-500 dark:border-white/10 dark:bg-white/[.04] dark:text-slate-400">
                  {activeInsight.signals}
                </span>
                <span className={`rounded-md border border-slate-200/80 bg-white/50 px-1.5 py-0.5 font-mono text-[8px] dark:border-white/10 dark:bg-white/[.04] ${activeTone.text}`}>
                  {activeInsight.delta}
                </span>
                <span className="rounded-md border border-slate-200/80 bg-white/50 px-1.5 py-0.5 font-mono text-[8px] text-slate-500 dark:border-white/10 dark:bg-white/[.04] dark:text-slate-400">
                  {activeInsight.ago}
                </span>
              </div>
            </div>

            <div className="hidden justify-center md:flex">
              <div className="compact-ai-orbit relative grid h-32 w-32 place-items-center">
                <span className="absolute inset-2 rounded-full border border-cyan-600/20 dark:border-cyan-300/20" />
                <span className="absolute inset-5 rounded-full border border-dashed border-cyan-600/25 dark:border-cyan-300/25" />
                <span className="absolute right-1 top-5 h-1.5 w-1.5 rounded-full bg-cyan-600 shadow-[0_0_12px_3px_rgba(8,145,178,.35)] dark:bg-cyan-200 dark:shadow-[0_0_12px_3px_rgba(103,232,249,.75)]" />
                <span className="absolute bottom-4 left-3 h-1.5 w-1.5 rounded-full bg-orange-300 shadow-[0_0_12px_3px_rgba(253,186,116,.65)]" />
                <div className="relative grid h-[84px] w-[84px] place-items-center rounded-[24px] border border-cyan-600/30 bg-cyan-500/10 shadow-[0_0_35px_rgba(8,145,178,.14)] dark:border-cyan-300/40 dark:bg-cyan-400/10 dark:shadow-[0_0_35px_rgba(34,211,238,.16)]">
                  <div className="text-center">
                    <Sparkles className="mx-auto h-5 w-5 text-cyan-700 dark:text-cyan-200" />
                    <p className="mt-1 font-mono text-xl font-bold text-slate-900 dark:text-white">12</p>
                    <p className="font-mono text-[8px] uppercase tracking-[.12em] text-cyan-700 dark:text-cyan-200">sinais</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-card px-5 pb-4 pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5 truncate text-[9px] text-muted-foreground">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
              <span className="truncate">{activeInsight.context}</span>
            </span>
            <span className="shrink-0 font-mono text-[8px] font-medium uppercase tracking-[.08em] text-muted-foreground">
              {activeInsight.action}
            </span>
          </div>
          <div className="mt-3 h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <div className="h-full rounded-full bg-cyan-500 transition-[width] duration-200" style={{ width: `${progress}%` }} />
          </div>
          <div className="mt-2.5 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              {insights.map((insight, index) => (
                <button
                  key={insight.id}
                  type="button"
                  aria-label={`Mostrar insight ${index + 1}`}
                  onClick={() => selectInsight(index)}
                  className={`h-1.5 rounded-full transition-all ${index === activeIndex ? "w-6 bg-cyan-500" : "w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/60"}`}
                />
              ))}
              <span className="ml-1 font-mono text-[9px] text-muted-foreground">{paused ? "pausado" : "alternando automaticamente"}</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label={paused ? "Continuar insights" : "Pausar insights"}
                onClick={() => setPaused((value) => !value)}
                className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
              </button>
              <button type="button" aria-label="Insight anterior" onClick={() => selectInsight((activeIndex - 1 + insights.length) % insights.length)} className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <button type="button" aria-label="Próximo insight" onClick={() => selectInsight((activeIndex + 1) % insights.length)} className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onAction(`${activeInsight.context} · análise completa aberta.`)}
                className="ml-1 hidden items-center gap-1 rounded-md border border-border px-2 py-1.5 font-mono text-[9px] font-bold uppercase tracking-[.06em] text-cyan-700 transition-colors hover:bg-muted dark:text-cyan-300 sm:flex"
              >
                analisar <ChevronRight className="h-3 w-3" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </Panel>
  );
}

function CriticalAssets({ role, onAction }: { role: Role; onAction: (message: string) => void }) {
  const assets =
    role === "admin"
      ? [
          ["Chiller 02", "Shopping Vale Sul · HVAC", "Em falha"],
          ["Edge Curitiba", "Autobras S.A. · Gateway", "Sem resposta"],
          ["CFTV 18", "Shopping Vale Sul · Docas", "Sem resposta"],
        ]
      : [
          ["Chiller 02", "Shopping Vale Sul · HVAC", "Em falha"],
          ["CFTV 18", "Shopping Vale Sul · Docas", "Sem resposta"],
          ["Bomba B-04", "Shopping Vale Sul · Hidráulica", "Ligado"],
        ];

  return (
    <Panel className="p-5" accent>
      <SectionTitle
        eyebrow="Vigilância prioritária"
        title="Pontos críticos"
        detail="Ativos marcados pelo operador"
        action={<ShieldAlert className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />}
      />
      <div className="mt-4 space-y-2.5">
        {assets.map(([name, context, state]) => (
          <button
            key={name}
            onClick={() => onAction(`${name} selecionado.`)}
            className="flex w-full items-center gap-3 rounded-xl border border-border bg-muted/50 p-3 text-left transition-colors hover:border-cyan-500/40 hover:bg-muted dark:bg-muted"
          >
            <span
              className={`h-9 w-1 shrink-0 rounded-full ${
                state === "Em falha" ? "bg-red-500" : state === "Ligado" ? "bg-emerald-500" : "bg-slate-400"
              }`}
            />
            <span className="min-w-0 flex-1">
              <b className="block truncate text-[11px] text-foreground">{name}</b>
              <small className="block truncate text-[9px] text-muted-foreground">{context}</small>
            </span>
            <span className="text-[9px] font-bold text-muted-foreground">{state}</span>
          </button>
        ))}
      </div>
    </Panel>
  );
}

function TenantRanking({ onAction }: { onAction: (message: string) => void }) {
  return (
    <Panel className="p-5" accent>
      <SectionTitle
        eyebrow="Priorização global"
        title="Atenção por cliente"
        detail="Clientes com maior volume de ocorrências"
        action={<Users className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />}
      />
      <div className="mt-4 grid gap-2.5">
        {clients.map((client, index) => (
          <button
            key={client.name}
            onClick={() => onAction(`${client.name} aberto.`)}
            className="group flex min-h-[62px] items-center gap-3 rounded-xl border border-border bg-muted/50 px-3.5 py-2.5 text-left transition-[background-color,border-color,box-shadow,transform] duration-200 hover:-translate-y-px hover:border-cyan-500/40 hover:bg-background hover:shadow-sm dark:bg-muted"
          >
            <span
              className={`h-9 w-1 shrink-0 rounded-full ${
                client.status === "falha" ? "bg-red-500" : client.status === "atencao" ? "bg-orange-500" : "bg-cyan-500"
              }`}
            />
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <span className="font-mono text-[9px] text-muted-foreground/70">0{index + 1}</span>
              <span className="truncate text-[11px] font-bold text-foreground">{client.name}</span>
            </span>
            <span className="shrink-0 text-right font-mono text-[9px]">
              <b className="block text-red-600 dark:text-red-400">{client.alarms} alarmes</b>
              <small className="text-muted-foreground">{client.offline} offline · {client.availability}</small>
            </span>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-cyan-500" />
          </button>
        ))}
      </div>
      <button
        onClick={() => onAction("Todos os clientes abertos.")}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border py-2 font-mono text-[9px] font-bold uppercase text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        explorar todos os clientes <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </Panel>
  );
}

function SiteOverview({ onAction }: { onAction: (message: string) => void }) {
  const readings = [
    {
      label: "Consumo de energia",
      value: "18,4 MWh",
      period: "últimas 24 horas",
      change: "−6,2% vs. período anterior",
      tone: "cyan",
      icon: <Zap className="h-4 w-4" />,
      bars: [44, 52, 48, 67, 58, 72, 62, 78, 70, 86, 74, 66],
    },
    {
      label: "Horas de funcionamento",
      value: "6.482 h",
      period: "motores, bombas e fancoils",
      change: "+128 h no período",
      tone: "amber",
      icon: <Timer className="h-4 w-4" />,
      bars: [38, 42, 54, 49, 62, 58, 68, 61, 73, 70, 78, 82],
    },
    {
      label: "Histórico de água",
      value: "1.248 m³",
      period: "medidor principal · 30 dias",
      change: "média diária 41,6 m³",
      tone: "blue",
      icon: <Droplets className="h-4 w-4" />,
      bars: [74, 62, 68, 57, 65, 52, 60, 48, 56, 44, 51, 46],
    },
  ] as const;

  return (
    <Panel className="p-5 sm:p-6" accent>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <SectionTitle
          eyebrow="Contexto da operação"
          title="Visão geral do seu site"
          detail="Shopping Vale Sul · leituras essenciais da operação"
        />
        <StatusChip status="normal">Site estável</StatusChip>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        {readings.map((reading) => (
          <button
            key={reading.label}
            onClick={() => onAction(`${reading.label} aberto.`)}
            className="group rounded-xl border border-border bg-muted/40 p-3.5 text-left transition-[background-color,border-color,box-shadow,transform] duration-200 hover:-translate-y-px hover:border-cyan-500/40 hover:bg-background hover:shadow-sm dark:bg-muted/70"
          >
            <div className="flex items-start justify-between gap-3">
              <span
                className={`grid h-8 w-8 place-items-center rounded-lg ${
                  reading.tone === "amber"
                    ? "bg-orange-500/10 text-orange-600 dark:text-orange-300"
                    : reading.tone === "blue"
                      ? "bg-sky-500/10 text-sky-600 dark:text-sky-300"
                      : "bg-cyan-500/10 text-cyan-600 dark:text-cyan-300"
                }`}
              >
                {reading.icon}
              </span>
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-cyan-500" />
            </div>
            <p className="mt-4 text-[10px] font-semibold text-muted-foreground">{reading.label}</p>
            <p className="mt-1 font-mono text-xl font-bold tracking-[-.06em] text-foreground">{reading.value}</p>
            <p className="mt-1 min-h-[25px] text-[9px] leading-3 text-muted-foreground">{reading.period}</p>
            <div className="mt-3 flex h-7 items-end gap-0.5">
              {reading.bars.map((height, index) => (
                <span
                  key={index}
                  className={`flex-1 rounded-t-sm ${
                    reading.tone === "amber"
                      ? "bg-orange-400/70 dark:bg-orange-300/70"
                      : reading.tone === "blue"
                        ? "bg-sky-400/70 dark:bg-sky-300/70"
                        : "bg-cyan-400/70 dark:bg-cyan-300/70"
                  }`}
                  style={{ height: `${Math.max(16, height * 0.32)}px` }}
                />
              ))}
            </div>
            <p className="mt-2 font-mono text-[8px] text-muted-foreground">{reading.change}</p>
          </button>
        ))}
      </div>

      <div className="mt-4 rounded-xl border border-cyan-500/20 bg-cyan-500/[.06] p-4 dark:bg-cyan-400/[.07]">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
              <p className="text-base font-bold tracking-[-.04em] text-foreground">Resumo operacional</p>
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">Shopping Vale Sul · São José dos Campos · 6 áreas monitoradas</p>
          </div>
          <div className="text-right">
            <p className="font-mono text-3xl font-bold tracking-[-.08em] text-emerald-600 dark:text-emerald-300">99,2%</p>
            <p className="font-mono text-[9px] uppercase tracking-[.12em] text-muted-foreground">disponibilidade</p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          {[
            ["412", "ativos"],
            ["405", "online"],
            ["4", "offline"],
          ].map(([value, label]) => (
            <div key={label} className="rounded-lg bg-background/70 p-3 dark:bg-slate-950/25">
              <strong className={`font-mono text-lg ${label === "offline" ? "text-slate-500" : "text-foreground"}`}>{value}</strong>
              <small className="mt-1 block text-[9px] text-muted-foreground">{label}</small>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="mr-1 font-mono text-[8px] font-bold uppercase tracking-[.14em] text-muted-foreground">Áreas</span>
        {["HVAC", "Hidráulica", "Elétrica", "CFTV", "Acesso", "Incêndio"].map((area, index) => (
          <button
            key={area}
            onClick={() => onAction(`${area} selecionada.`)}
            className={`rounded-full border px-2.5 py-1.5 text-[9px] font-semibold transition-colors hover:border-cyan-500/50 hover:text-cyan-600 dark:hover:text-cyan-300 ${
              index === 0
                ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300"
                : "border-border bg-muted/50 text-muted-foreground"
            }`}
          >
            {area}
          </button>
        ))}
      </div>
    </Panel>
  );
}

function AdminConsumptionOverview({
  period,
  onAction,
  onOpenRanking,
}: {
  period: string;
  onAction: (message: string) => void;
  onOpenRanking: () => void;
}) {
  const consumptionGroups = [
    {
      label: "Consumo de energia",
      description: "Top 3 clientes por volume",
      unit: "MWh",
      tone: "cyan" as const,
      icon: <Zap className="h-4 w-4" />,
      clients: [
        {
          name: "Shopping Vale Sul",
          value: "18,4 MWh",
          change: "−6,2% vs. período anterior",
          bars: [44, 52, 48, 67, 58, 72, 62, 78, 70, 86, 74, 66],
        },
        {
          name: "Hospital Santa Clara",
          value: "15,7 MWh",
          change: "+3,8% vs. período anterior",
          bars: [38, 46, 52, 44, 60, 55, 67, 61, 72, 69, 78, 74],
        },
        {
          name: "Autobras S.A.",
          value: "11,9 MWh",
          change: "−1,4% vs. período anterior",
          bars: [64, 58, 61, 54, 49, 57, 52, 45, 50, 43, 47, 41],
        },
      ],
    },
    {
      label: "Consumo de água",
      description: "Top 3 clientes por volume",
      unit: "m³",
      tone: "blue" as const,
      icon: <Droplets className="h-4 w-4" />,
      clients: [
        {
          name: "Shopping Vale Sul",
          value: "1.248 m³",
          change: "média diária 41,6 m³",
          bars: [74, 62, 68, 57, 65, 52, 60, 48, 56, 44, 51, 46],
        },
        {
          name: "Hospital Santa Clara",
          value: "984 m³",
          change: "média diária 32,8 m³",
          bars: [56, 61, 52, 65, 59, 68, 54, 62, 49, 58, 47, 53],
        },
        {
          name: "Autobras S.A.",
          value: "732 m³",
          change: "média diária 24,4 m³",
          bars: [48, 52, 44, 56, 47, 51, 42, 46, 39, 44, 36, 41],
        },
      ],
    },
  ];

  return (
    <Panel className="p-0" accent>
      <div className="relative overflow-hidden">
        <div className="surface-comb pointer-events-none absolute inset-0 opacity-45 dark:opacity-55" />
        <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-cyan-400/10 blur-3xl dark:bg-cyan-300/5" />
        <div className="relative p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="grid h-8 w-8 place-items-center rounded-xl border border-cyan-500/15 bg-cyan-500/10 text-cyan-700 dark:border-cyan-300/15 dark:bg-cyan-300/10 dark:text-cyan-300">
                  <TrendingUp className="h-4 w-4" />
                </span>
                <SectionTitle
                  eyebrow="Indicadores essenciais"
                  title="Consumo por cliente"
                  detail={`Top 3 clientes · período ${period} · atualização em tempo real`}
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="hidden rounded-full border border-border bg-background/70 px-2.5 py-1.5 font-mono text-[8px] font-bold uppercase tracking-[.1em] text-muted-foreground sm:inline-flex">
                2 leituras
              </span>
              <StatusChip status="normal">Leituras disponíveis</StatusChip>
            </div>
          </div>

          <div className="mt-5 space-y-4">
        {consumptionGroups.map((group) => (
          <div key={group.label} className="rounded-2xl border border-border/80 bg-background/35 p-3.5 dark:bg-slate-950/15 sm:p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span
                  className={`grid h-9 w-9 place-items-center rounded-xl border ${
                    group.tone === "blue"
                      ? "border-sky-500/15 bg-sky-500/10 text-sky-600 dark:border-sky-300/15 dark:text-sky-300"
                      : "border-cyan-500/15 bg-cyan-500/10 text-cyan-600 dark:border-cyan-300/15 dark:text-cyan-300"
                  }`}
                >
                  {group.icon}
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-[12px] font-bold text-foreground">{group.label}</p>
                    <span className="hidden rounded-full bg-muted px-1.5 py-0.5 font-mono text-[8px] font-bold uppercase tracking-[.08em] text-muted-foreground sm:inline-flex">
                      3 clientes
                    </span>
                  </div>
                  <p className="mt-0.5 text-[9px] text-muted-foreground">{group.description}</p>
                </div>
              </div>
              <span className="rounded-full border border-border bg-muted/50 px-2 py-1 font-mono text-[8px] font-bold uppercase tracking-[.12em] text-muted-foreground">
                {group.unit}
              </span>
            </div>

            <div className="grid gap-2.5 md:grid-cols-3">
              {group.clients.map((client, index) => (
                <button
                  key={`${group.label}-${client.name}`}
                  onClick={() => onAction(`${client.name} · ${group.label} aberto.`)}
                  className="group relative overflow-hidden rounded-xl border border-border bg-card/80 p-3.5 text-left shadow-[0_1px_0_rgba(15,23,42,.02)] transition-[background-color,border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-cyan-500/40 hover:bg-card hover:shadow-md dark:bg-muted/60 dark:shadow-none dark:hover:bg-muted"
                >
                  <span className={`pointer-events-none absolute inset-x-0 bottom-0 h-0.5 origin-left scale-x-0 transition-transform duration-300 group-hover:scale-x-100 ${group.tone === "blue" ? "bg-sky-400 dark:bg-sky-300" : "bg-cyan-400 dark:bg-cyan-300"}`} />
                  <div className="flex items-start justify-between gap-3">
                    <span className={`flex h-5 min-w-5 items-center justify-center rounded-md px-1 font-mono text-[8px] font-bold ${
                      index === 0
                        ? "bg-cyan-500/15 text-cyan-700 dark:bg-cyan-300/15 dark:text-cyan-300"
                        : "bg-muted text-muted-foreground"
                    }`}>
                      0{index + 1}
                    </span>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-cyan-500" />
                  </div>
                  <p className="mt-3 truncate text-[10px] font-semibold text-foreground">{client.name}</p>
                  <p className="mt-1 font-mono text-xl font-bold tracking-[-.06em] text-foreground">{client.value}</p>
                  <p className="mt-1 text-[9px] text-muted-foreground">{period === "24h" ? "últimas 24 horas" : `período selecionado · ${period}`}</p>
                  <div className="mt-3 flex h-8 items-end gap-0.5 rounded-md bg-muted/60 px-1 pt-1 dark:bg-background/50">
                    {client.bars.map((height, barIndex) => (
                      <span
                        key={barIndex}
                        className={`flex-1 rounded-t-[3px] transition-[height,opacity] duration-300 group-hover:opacity-90 ${
                          group.tone === "blue"
                            ? "bg-gradient-to-t from-sky-500/65 to-sky-300/85 dark:from-sky-400/70 dark:to-sky-200/90"
                            : "bg-gradient-to-t from-cyan-500/65 to-cyan-300/85 dark:from-cyan-400/70 dark:to-cyan-200/90"
                        }`}
                        style={{ height: `${Math.max(16, height * 0.32)}px` }}
                      />
                    ))}
                  </div>
                  <p className={`mt-2 flex items-center gap-1 truncate font-mono text-[8px] ${client.change.startsWith("+") ? "text-orange-600 dark:text-orange-300" : "text-emerald-600 dark:text-emerald-300"}`}>
                    {client.change.startsWith("+") ? <ArrowUpRight className="h-3 w-3 shrink-0" /> : <ArrowDownRight className="h-3 w-3 shrink-0" />}
                    <span className="truncate">{client.change}</span>
                  </p>
                </button>
              ))}
            </div>
          </div>
        ))}
          </div>

          <button
            onClick={onOpenRanking}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-cyan-500/35 bg-background/35 py-2.5 font-mono text-[9px] font-bold uppercase tracking-[.08em] text-cyan-700 transition-[background-color,border-color,transform] hover:-translate-y-px hover:border-cyan-500/60 hover:bg-cyan-500/[.06] hover:text-cyan-600 dark:bg-slate-950/15 dark:text-cyan-300"
          >
            ver ranking completo <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </Panel>
  );
}

function ConsumptionRankingModal({
  period,
  onAction,
  onClose,
}: {
  period: string;
  onAction: (message: string) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"energia" | "água">("energia");
  const [page, setPage] = useState(1);
  const ranking = {
    energia: {
      label: "Consumo de energia",
      unit: "MWh",
      icon: <Zap className="h-4 w-4" />,
      tone: "cyan" as const,
      rows: [
        { name: "Shopping Vale Sul", value: "18,4 MWh", change: "−6,2%", detail: "últimas 24 horas", share: 100 },
        { name: "Hospital Santa Clara", value: "15,7 MWh", change: "+3,8%", detail: "últimas 24 horas", share: 85 },
        { name: "Autobras S.A.", value: "11,9 MWh", change: "−1,4%", detail: "últimas 24 horas", share: 65 },
        { name: "Centro Logístico Norte", value: "9,6 MWh", change: "+2,1%", detail: "últimas 24 horas", share: 52 },
        { name: "Universidade Horizonte", value: "7,8 MWh", change: "−4,6%", detail: "últimas 24 horas", share: 42 },
        { name: "Edifício Paulista", value: "6,4 MWh", change: "+0,9%", detail: "últimas 24 horas", share: 35 },
        { name: "Centro Empresarial Paulista", value: "5,9 MWh", change: "−2,5%", detail: "últimas 24 horas", share: 32 },
        { name: "Hotel Atlântico", value: "5,1 MWh", change: "+1,2%", detail: "últimas 24 horas", share: 28 },
        { name: "Clínica Nova Vida", value: "4,6 MWh", change: "−0,8%", detail: "últimas 24 horas", share: 25 },
        { name: "Terminal Aeroporto Sul", value: "4,1 MWh", change: "+4,4%", detail: "últimas 24 horas", share: 22 },
        { name: "Parque Industrial Leste", value: "3,7 MWh", change: "−3,1%", detail: "últimas 24 horas", share: 20 },
        { name: "Condomínio Horizonte", value: "3,2 MWh", change: "+0,6%", detail: "últimas 24 horas", share: 17 },
      ],
    },
    água: {
      label: "Consumo de água",
      unit: "m³",
      icon: <Droplets className="h-4 w-4" />,
      tone: "blue" as const,
      rows: [
        { name: "Shopping Vale Sul", value: "1.248 m³", change: "média 41,6 m³/dia", detail: "últimas 24 horas", share: 100 },
        { name: "Hospital Santa Clara", value: "984 m³", change: "média 32,8 m³/dia", detail: "últimas 24 horas", share: 79 },
        { name: "Autobras S.A.", value: "732 m³", change: "média 24,4 m³/dia", detail: "últimas 24 horas", share: 59 },
        { name: "Centro Logístico Norte", value: "618 m³", change: "média 20,6 m³/dia", detail: "últimas 24 horas", share: 50 },
        { name: "Universidade Horizonte", value: "487 m³", change: "média 16,2 m³/dia", detail: "últimas 24 horas", share: 39 },
        { name: "Edifício Paulista", value: "302 m³", change: "média 10,1 m³/dia", detail: "últimas 24 horas", share: 24 },
        { name: "Centro Empresarial Paulista", value: "278 m³", change: "média 9,3 m³/dia", detail: "últimas 24 horas", share: 22 },
        { name: "Hotel Atlântico", value: "241 m³", change: "média 8,0 m³/dia", detail: "últimas 24 horas", share: 19 },
        { name: "Clínica Nova Vida", value: "216 m³", change: "média 7,2 m³/dia", detail: "últimas 24 horas", share: 17 },
        { name: "Terminal Aeroporto Sul", value: "188 m³", change: "média 6,3 m³/dia", detail: "últimas 24 horas", share: 15 },
        { name: "Parque Industrial Leste", value: "164 m³", change: "média 5,5 m³/dia", detail: "últimas 24 horas", share: 13 },
        { name: "Condomínio Horizonte", value: "139 m³", change: "média 4,6 m³/dia", detail: "últimas 24 horas", share: 11 },
      ],
    },
  } as const;
  const selected = ranking[mode];
  const pageSize = 6;
  const pageCount = Math.ceil(selected.rows.length / pageSize);
  const pageRows = selected.rows.slice((page - 1) * pageSize, page * pageSize);
  const firstVisibleRow = (page - 1) * pageSize + 1;
  const lastVisibleRow = Math.min(page * pageSize, selected.rows.length);

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-slate-950/45 p-3 backdrop-blur-[2px] sm:p-6 lg:p-10"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="consumption-ranking-title"
          className="flex h-[680px] max-h-[calc(100dvh-1.5rem)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl"
      >
        <div className="border-b border-border bg-card/95 px-4 py-4 sm:px-6 sm:py-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-mono text-[9px] font-bold uppercase tracking-[.18em] text-cyan-700 dark:text-cyan-300">
                Administração global · análise comparativa
              </p>
              <h3 id="consumption-ranking-title" className="mt-1 text-xl font-bold tracking-[-.05em] text-foreground sm:text-2xl">
                Ranking completo de consumo
              </h3>
              <p className="mt-1 text-[10px] text-muted-foreground sm:text-[11px]">
                Todos os clientes ordenados do maior para o menor consumo no período selecionado.
              </p>
            </div>
            <button
              onClick={onClose}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-border text-muted-foreground transition-colors hover:border-cyan-500/40 hover:text-foreground"
              aria-label="Fechar ranking completo"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex rounded-lg border border-border bg-muted p-0.5">
              {(["energia", "água"] as const).map((item) => (
                <button
                  key={item}
                  onClick={() => {
                    setMode(item);
                    setPage(1);
                  }}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-2 font-mono text-[9px] font-bold uppercase transition-colors ${
                    mode === item ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {ranking[item].icon}
                  {item}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[.1em] text-muted-foreground">
              <span className="rounded-full border border-border bg-muted/60 px-2.5 py-1.5">Período: {period}</span>
              <span className="rounded-full border border-border bg-muted/60 px-2.5 py-1.5">{selected.rows.length} clientes</span>
            </div>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background p-4 sm:p-6">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span
                className={`grid h-8 w-8 place-items-center rounded-lg ${
                  selected.tone === "blue"
                    ? "bg-sky-500/10 text-sky-600 dark:text-sky-300"
                    : "bg-cyan-500/10 text-cyan-600 dark:text-cyan-300"
                }`}
              >
                {selected.icon}
              </span>
              <div>
                <p className="text-[12px] font-bold text-foreground">{selected.label}</p>
                <p className="mt-0.5 text-[9px] text-muted-foreground">Atualização em tempo real · unidade {selected.unit}</p>
              </div>
            </div>
            <span className="hidden rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1.5 font-mono text-[8px] font-bold uppercase tracking-[.1em] text-emerald-700 dark:text-emerald-300 sm:inline-flex">
              Leituras disponíveis
            </span>
          </div>

          <div className="overflow-hidden rounded-xl border border-border">
            <div className="hidden grid-cols-[42px_minmax(180px,1.2fr)_minmax(120px,.8fr)_110px_150px] gap-4 bg-muted/50 px-4 py-2.5 font-mono text-[8px] font-bold uppercase tracking-[.12em] text-muted-foreground sm:grid">
              <span>#</span>
              <span>Cliente</span>
              <span>Consumo</span>
              <span>Variação</span>
              <span>Participação relativa</span>
            </div>
            <div className="divide-y divide-border">
              {pageRows.map((client, index) => (
                <button
                  key={client.name}
                  onClick={() => onAction(`${client.name} selecionado no ranking de ${selected.label.toLowerCase()}.`)}
                  className="group grid w-full gap-3 px-4 py-3.5 text-left transition-colors hover:bg-cyan-500/[.045] sm:grid-cols-[42px_minmax(180px,1.2fr)_minmax(120px,.8fr)_110px_150px] sm:items-center sm:gap-4"
                >
                  <span className="font-mono text-[10px] font-bold text-muted-foreground/70">0{firstVisibleRow + index}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-[11px] font-semibold text-foreground group-hover:text-cyan-700 dark:group-hover:text-cyan-300">{client.name}</span>
                    <span className="mt-0.5 block text-[9px] text-muted-foreground sm:hidden">{client.detail}</span>
                  </span>
                  <span className="font-mono text-base font-bold tracking-[-.05em] text-foreground">{client.value}</span>
                  <span className={`font-mono text-[9px] font-bold ${client.change.startsWith("+") ? "text-orange-600 dark:text-orange-300" : "text-emerald-600 dark:text-emerald-300"}`}>
                    {client.change}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <span
                        className={selected.tone === "blue" ? "block h-full rounded-full bg-sky-400 dark:bg-sky-300" : "block h-full rounded-full bg-cyan-400 dark:bg-cyan-300"}
                        style={{ width: `${client.share}%` }}
                      />
                    </span>
                    <span className="w-7 text-right font-mono text-[8px] text-muted-foreground">{client.share}%</span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-[9px] text-muted-foreground">
              Mostrando {firstVisibleRow}–{lastVisibleRow} de {selected.rows.length} clientes.
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={page === 1}
                className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-2 font-mono text-[9px] font-bold uppercase tracking-[.06em] text-muted-foreground transition-colors hover:border-cyan-500/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                anterior
              </button>
              <span className="min-w-[72px] text-center font-mono text-[9px] font-bold text-muted-foreground">
                Página {page} de {pageCount}
              </span>
              <button
                onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
                disabled={page === pageCount}
                className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-2 font-mono text-[9px] font-bold uppercase tracking-[.06em] text-muted-foreground transition-colors hover:border-cyan-500/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
              >
                próxima
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={onClose}
                className="rounded-lg border border-border px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-[.08em] text-muted-foreground transition-colors hover:border-cyan-500/40 hover:text-foreground"
              >
                voltar ao dashboard
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricBar({ label, value }: { label: string; value: number }) {
  return (
    <span className="flex items-center gap-1.5 font-mono text-[8px] text-muted-foreground">
      <span className="w-6">{label}</span>
      <span className="h-1.5 w-[88px] overflow-hidden rounded-full bg-muted">
        <span
          className={`block h-full rounded-full ${value > 80 ? "bg-orange-500 dark:bg-orange-400" : "bg-cyan-500 dark:bg-cyan-400"}`}
          style={{ width: `${value}%` }}
        />
      </span>
      <span>{value}%</span>
    </span>
  );
}

function GatewayHealth({
  filter,
  setFilter,
  onAction,
  role,
}: {
  filter: string;
  setFilter: (filter: string) => void;
  onAction: (message: string) => void;
  role: Role;
}) {
  const filtered = useMemo(
    () =>
      gateways.filter(
        (gateway) =>
          filter === "Todos" ||
          (filter === "Críticos" && gateway.status === "falha") ||
          (filter === "Atenção" && gateway.status === "atencao") ||
          (filter === "Sem dados" && gateway.status === "sem dados"),
      ),
    [filter],
  );
  const visible = role === "operador" ? filtered.filter((gateway) => gateway.site === "Shopping Vale Sul") : filtered;

  return (
    <Panel className="p-5" accent>
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4">
        <SectionTitle
          eyebrow="Infraestrutura"
          title="Saúde dos gateways"
          detail={role === "admin" ? "Conectividade da malha global" : "Conectividade do site selecionado"}
        />
        <div className="flex gap-1 rounded-lg border border-border bg-muted p-1">
          {["Todos", "Críticos", "Atenção", "Sem dados"].map((item) => (
            <button
              key={item}
              onClick={() => setFilter(item)}
              className={`rounded-md px-2 py-1.5 font-mono text-[9px] font-bold transition-colors ${
                filter === item ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {item}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3 space-y-1">
        {visible.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-[10px] text-muted-foreground">
            Nenhum gateway corresponde a este filtro.
          </div>
        ) : (
          visible.map((gateway) => (
            <button
              key={gateway.id}
              onClick={() => onAction(`${gateway.name} selecionado.`)}
              className="grid w-full grid-cols-[minmax(180px,1fr)_auto_minmax(130px,.7fr)_auto] items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-muted max-[760px]:grid-cols-[1fr_auto]"
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-50 text-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-300">
                  <Server className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0">
                  <b className="block truncate text-[11px] text-foreground">{gateway.name}</b>
                  <small className="block truncate font-mono text-[9px] text-muted-foreground">
                    {gateway.id} · {gateway.site}
                  </small>
                </span>
              </span>
              <StatusChip status={gateway.status}>{gateway.status === "normal" ? "Online" : undefined}</StatusChip>
              <span className="space-y-1 max-[760px]:col-span-2">
                {gateway.status === "normal" || gateway.status === "atencao" ? (
                  <>
                    <MetricBar label="CPU" value={gateway.cpu} />
                    <MetricBar label="MEM" value={gateway.mem} />
                  </>
                ) : (
                  <span className="font-mono text-[9px] text-muted-foreground">métricas indisponíveis</span>
                )}
              </span>
              <span className="font-mono text-[9px] text-muted-foreground">{gateway.last}</span>
            </button>
          ))
        )}
      </div>
    </Panel>
  );
}

function WorkOrders({ onAction }: { onAction: (message: string) => void }) {
  return (
    <Panel className="p-5" accent>
      <SectionTitle
        eyebrow="Manutenção"
        title="Ordens de serviço"
        detail="Próximas ações de campo"
        action={<ClipboardList className="h-4 w-4 text-orange-600 dark:text-orange-300" />}
      />
      <div className="mt-4 grid grid-cols-3 gap-2">
        {[
          ["4", "Abertas", "text-red-600 dark:text-red-400"],
          ["2", "Em andamento", "text-orange-600 dark:text-orange-400"],
          ["18", "Concluídas", "text-emerald-600 dark:text-emerald-400"],
        ].map(([value, label, tone]) => (
          <div key={label} className="rounded-xl border border-border bg-muted/50 p-3 text-center dark:bg-muted">
            <b className={`font-mono text-xl ${tone}`}>{value}</b>
            <small className="mt-1 block text-[8px] text-muted-foreground">{label}</small>
          </div>
        ))}
      </div>
      <div className="mt-3 space-y-2">
        {["OS-1042 · Inspecionar Chiller 02", "OS-1039 · Revisar Bomba B-04"].map((item) => (
          <button
            key={item}
            onClick={() => onAction(`${item} selecionada.`)}
            className="flex w-full items-center justify-between rounded-lg border border-border px-3 py-2.5 text-left text-[9px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {item}
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        ))}
      </div>
    </Panel>
  );
}

function ActivityFeed({ role, onAction }: { role: Role; onAction: (message: string) => void }) {
  const activity =
    role === "admin"
      ? ["João Silva reconheceu 5 alarmes", "Política de acesso revisada", "Regra Night Mode executada", "Novo cliente adicionado à malha"]
      : ["João Silva reconheceu 5 alarmes", "Reset solicitado no Chiller 02", "Bomba B-04 entrou em operação", "Câmera CFTV 18 sem sinal"];
  return (
    <Panel className="p-5" accent>
      <SectionTitle
        eyebrow="Trilha de auditoria"
        title="Atividade recente"
        detail="Últimas ações registradas"
        action={<History className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />}
      />
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {activity.map((item, index) => (
          <button
            key={item}
            onClick={() => onAction(`${item}.`)}
            className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/40 p-3 text-left transition-colors hover:bg-muted"
          >
            <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-cyan-500" />
            <span>
              <p className="text-[10px] font-semibold text-foreground">{item}</p>
              <p className="mt-1 font-mono text-[9px] text-muted-foreground">{["há 2 min", "há 15 min", "há 31 min", "há 45 min"][index]}</p>
            </span>
          </button>
        ))}
      </div>
    </Panel>
  );
}

function Sidebar({
  role,
  section,
  setSection,
  expanded,
}: {
  role: Role;
  section: string;
  setSection: (section: string) => void;
  expanded: boolean;
}) {
  const groups: Array<{
    label: string;
    items: Array<{ label: string; icon: typeof LayoutDashboard }>;
  }> =
    role === "admin"
      ? [
          {
            label: "Principal",
            items: [
              { label: "Dashboard", icon: LayoutDashboard },
              { label: "Alarmes", icon: Bell },
              { label: "Dispositivos / IOT / BMS", icon: Cpu },
              { label: "Dispositivos CFTV/SCA", icon: Cctv },
              { label: "Trends", icon: TrendingUp },
              { label: "Sites", icon: Monitor },
            ],
          },
          {
            label: "Monitoramento",
            items: [
              { label: "Relatórios", icon: FileBarChart },
              { label: "Automações", icon: Zap },
              { label: "Chamados (Infraspeak)", icon: ClipboardList },
              { label: "Bluebee", icon: MessageSquare },
            ],
          },
          {
            label: "Administração",
            items: [
              { label: "Clientes", icon: Building2 },
              { label: "Usuários", icon: Users },
              { label: "Gateways", icon: Router },
              { label: "Agente de Gateway", icon: Download },
              { label: "Servidores", icon: Server },
              { label: "Conhecimento", icon: BookOpen },
              { label: "Ajustes", icon: Settings },
            ],
          },
        ]
      : [
          {
            label: "Principal",
            items: [
              { label: "Telas", icon: Monitor },
              { label: "Dashboard", icon: LayoutDashboard },
              { label: "Alarmes", icon: Bell },
              { label: "Dispositivos / IOT / BMS", icon: Cpu },
              { label: "Dispositivos CFTV/SCA", icon: Cctv },
              { label: "Trends", icon: TrendingUp },
            ],
          },
          {
            label: "Monitoramento",
            items: [
              { label: "Relatórios", icon: FileBarChart },
              { label: "Bluebee", icon: MessageSquare },
            ],
          },
          {
            label: "Administração",
            items: [{ label: "Usuários", icon: Users }],
          },
        ];

  return (
    <aside
      className={`app-sidebar hidden h-full shrink-0 flex-col overflow-x-hidden bg-slate-900 transition-[width] duration-300 lg:flex ${
        expanded ? "w-64" : "w-16"
      }`}
    >
      <div
        className={`flex h-14 shrink-0 items-center border-b border-slate-700/60 transition-all duration-300 ${
          expanded ? "gap-2.5 px-4" : "justify-center px-0"
        }`}
      >
        <img
          src={sandboxAsset("beeldings-branco.png")}
          alt="Beeldings"
          className={`h-auto object-contain transition-all duration-300 ${
            expanded ? "w-44" : "w-10"
          }`}
        />
      </div>

      <nav className={`flex-1 overflow-y-auto py-4 transition-all duration-300 ${expanded ? "px-3" : "px-2"}`}>
        {groups.map((group, groupIndex) => (
          <div key={group.label} className="mb-4">
            <p
              className={`overflow-hidden whitespace-nowrap px-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500 transition-all duration-200 ${
                expanded ? "mb-1.5 max-h-5 opacity-100" : "mb-0 max-h-0 opacity-0"
              }`}
            >
              {group.label}
            </p>
            {!expanded && groupIndex > 0 && <div className="mx-1 mb-2 h-px bg-slate-700/50" />}
            <div className="space-y-0.5">
              {group.items.map(({ label, icon: Icon }) => {
                const active = section === label;
                return (
                  <button
                    key={label}
                    type="button"
                    title={expanded ? undefined : label}
                    onClick={() => setSection(label)}
                    className={`relative flex w-full items-center py-1 text-left text-sm font-medium transition-all duration-200 ${
                      expanded ? "gap-2.5 px-2" : "justify-center px-0"
                    } ${active ? "text-white" : "text-slate-300 hover:bg-slate-800/60 hover:text-white"}`}
                  >
                    {active && expanded && <span className="absolute -left-1 top-1.5 bottom-1.5 w-0.5 bg-cyan-400" />}
                    <span
                      className={`grid h-[30px] w-[26px] shrink-0 place-items-center transition-colors ${
                        active ? "bg-cyan-400 text-slate-900" : "bg-slate-800 text-slate-400"
                      }`}
                      style={{ clipPath: HIVE_HEX_CLIP }}
                    >
                      <Icon className="h-[15px] w-[15px]" strokeWidth={1.7} />
                    </span>
                    <span
                      className={`min-w-0 flex-1 overflow-hidden whitespace-nowrap transition-all duration-200 ${
                        expanded ? "max-w-full opacity-100" : "max-w-0 w-0 opacity-0"
                      }`}
                    >
                      <span className="block truncate">{label}</span>
                    </span>
                    {label === "Alarmes" && expanded && (
                      <span className="font-mono text-[10px] text-amber-300">
                        {role === "admin" ? "47" : "15"}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className={`border-t border-slate-700/60 transition-all duration-300 ${expanded ? "p-3" : "p-2"}`}>
        <div className={`flex items-center rounded-lg bg-slate-800/70 ${expanded ? "gap-2 px-2 py-2" : "justify-center p-1"}`}>
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-cyan-600 text-xs font-semibold text-white">
            AS
          </span>
          <span className={`min-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 ${expanded ? "max-w-full opacity-100" : "max-w-0 w-0 opacity-0"}`}>
            <b className="block truncate text-xs text-white">Ana Souza</b>
            <small className="block truncate text-[10px] text-slate-400">
              {role === "admin" ? "Administradora" : "Operadora"}
            </small>
          </span>
        </div>
      </div>
    </aside>
  );
}

export function Compacto() {
  const previewParams = typeof window === "undefined" ? null : new URLSearchParams(window.location.search);
  const [dark, setDark] = useState(() => previewParams?.get("theme") === "dark");
  const [role, setRole] = useState<Role>(() => (previewParams?.get("role") === "cliente" ? "operador" : "admin"));
  const [period, setPeriod] = useState("24h");
  const [filter, setFilter] = useState("Todos");
  const [section, setSection] = useState("Dashboard");
  const [sidebarExpanded, setSidebarExpanded] = useState(true);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [rankingOpen, setRankingOpen] = useState(false);
  const action = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2400);
  };
  const refresh = () => {
    setLoading(true);
    action("Sincronizando telemetria...");
    window.setTimeout(() => setLoading(false), 900);
  };

  return (
    <div className={dark ? "dark" : ""}>
      <div className="compact-dashboard min-h-[100dvh] overflow-x-hidden bg-background font-sans text-foreground">
        <div className="flex min-h-[100dvh] overflow-hidden">
          <Sidebar
            role={role}
            section={section}
            setSection={setSection}
            expanded={sidebarExpanded}
          />
          <main className="min-w-0 min-h-0 flex-1">
            <header className="relative flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-3 md:px-4">
              <div className="flex min-w-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => setMobileMenu(!mobileMenu)}
                  className="flex h-9 w-9 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-muted md:hidden"
                  aria-label="Abrir menu"
                >
                  <Menu className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onClick={() => setSidebarExpanded((value) => !value)}
                  className="hidden h-9 w-9 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-muted md:flex"
                  aria-label={sidebarExpanded ? "Recolher sidebar" : "Fixar sidebar aberta"}
                >
                  {sidebarExpanded ? <PanelLeftClose className="h-5 w-5" /> : <PanelLeftOpen className="h-5 w-5" />}
                </button>
                <button
                  type="button"
                  className="ml-1 hidden h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted sm:flex"
                >
                  {role === "admin" ? <Building2 className="h-3.5 w-3.5 text-slate-400" /> : <MapPin className="h-3.5 w-3.5 text-slate-400" />}
                  <span>{role === "admin" ? "Todos Clientes" : "Shopping Vale Sul"}</span>
                  <ChevronDown className="h-3 w-3" />
                </button>
                <div className="ml-2 hidden items-center gap-1 rounded-lg border border-border bg-muted p-0.5 sm:flex">
                  <span className="px-1.5 font-mono text-[8px] font-bold uppercase tracking-[.08em] text-muted-foreground">prévia</span>
                  {(["admin", "operador"] as Role[]).map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => setRole(item)}
                      className={`rounded-md px-2 py-1 font-mono text-[9px] font-bold uppercase transition-colors ${
                        role === item ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {item === "admin" ? "Admin" : "Cliente"}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <div className="hidden rounded-lg border border-border bg-muted p-0.5 lg:flex">
                  {["24h", "7d", "30d"].map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => setPeriod(item)}
                      className={`rounded-md px-2 py-1.5 font-mono text-[9px] font-bold transition-colors ${
                        period === item ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {item}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="relative grid h-9 w-9 place-items-center rounded-md text-slate-500 transition-colors hover:bg-muted"
                  aria-label="Notificações"
                >
                  <Bell className="h-[18px] w-[18px]" />
                  <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold leading-none text-white">
                    {role === "admin" ? "9+" : "5"}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={refresh}
                  className="grid h-9 w-9 place-items-center rounded-md text-slate-500 transition-colors hover:bg-muted"
                  aria-label="Atualizar"
                >
                  <RefreshCw className={`h-[18px] w-[18px] ${loading ? "animate-spin" : ""}`} />
                </button>
                <button
                  type="button"
                  onClick={() => setDark(!dark)}
                  className="grid h-9 w-9 place-items-center rounded-md text-slate-500 transition-colors hover:bg-muted"
                  aria-label="Alternar tema"
                >
                  {dark ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
                </button>
                <button type="button" className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-cyan-600 text-xs font-semibold text-white">AS</span>
                  <span className="hidden max-w-[100px] truncate text-sm font-medium text-foreground sm:block">Ana</span>
                  <ChevronDown className="hidden h-3.5 w-3.5 text-muted-foreground sm:block" />
                </button>
              </div>

              {mobileMenu && (
                <div className="absolute inset-x-3 top-[calc(100%+8px)] z-40 grid gap-1 rounded-xl border border-border bg-card p-2 shadow-xl md:hidden">
                  {["Telas", "Dashboard", "Alarmes", "Dispositivos / IOT / BMS", "Trends", "Relatórios"].map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => {
                        setSection(item);
                        setMobileMenu(false);
                      }}
                      className={`rounded-lg px-3 py-2 text-left text-[10px] font-bold ${
                        section === item ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              )}
            </header>

            <div className="surface-comb min-h-[calc(100dvh-3.5rem)] overflow-y-auto">
            <div className="space-y-6 p-4 sm:p-6 lg:p-8">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="font-mono text-[9px] font-bold uppercase tracking-[.2em] text-cyan-700 dark:text-cyan-300">
                    Dashboard compacto · {role === "admin" ? "administração global" : "cliente selecionado"}
                  </p>
                  <h2 className="mt-1 text-[24px] font-bold tracking-[-.06em]">Clareza para decidir.</h2>
                  <p className="mt-1 max-w-[620px] text-[11px] text-muted-foreground">
                    {role === "admin"
                      ? "Uma leitura coordenada da malha inteira para decidir onde agir primeiro."
                      : "Shopping Vale Sul · contexto do site, sinais atuais e próximos passos em um só lugar."}
                  </p>
                </div>
                <StatusChip status={loading ? "carregando" : "normal"}>{loading ? "Sincronizando" : "Sinal estável"}</StatusChip>
              </div>

              <div className="grid items-stretch gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(360px,.7fr)]">
                {role === "admin" ? (
                  <AdminConsumptionOverview
                    period={period}
                    onAction={action}
                    onOpenRanking={() => setRankingOpen(true)}
                  />
                ) : (
                  <Panel className="px-4 pb-4 pt-5 sm:px-7" accent>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-mono text-[9px] font-bold uppercase tracking-[.18em] text-cyan-700 dark:text-cyan-300">
                          Indicadores essenciais
                        </p>
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          Período: {period} · Shopping Vale Sul
                        </p>
                      </div>
                      <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <Hive role={role} />
                  </Panel>
                )}
                 <AlarmRail role={role} onAction={action} />
              </div>

              <div>
                <p className="font-mono text-[9px] font-bold uppercase tracking-[.2em] text-muted-foreground">Contexto e prioridade</p>
                <div className="mt-2 h-px bg-border" />
              </div>

              <div className="grid items-stretch gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,.85fr)]">
                {role === "admin" ? <TenantRanking onAction={action} /> : <SiteOverview onAction={action} />}
                <WorkOrders onAction={action} />
              </div>

              <div>
                <p className="font-mono text-[9px] font-bold uppercase tracking-[.2em] text-muted-foreground">Análise operacional</p>
                <div className="mt-2 h-px bg-border" />
              </div>

              <div className="grid items-stretch gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(330px,.8fr)]">
                 <InsightsPanel role={role} onAction={action} />
                <CriticalAssets role={role} onAction={action} />
              </div>

              <GatewayHealth filter={filter} setFilter={setFilter} onAction={action} role={role} />
              <ActivityFeed role={role} onAction={action} />

              <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4 font-mono text-[9px] uppercase tracking-[.14em] text-muted-foreground">
                <span>ambiente de demonstração · dados fictícios</span>
                <span>
                  <Settings2 className="mr-1 inline h-3 w-3" /> nova proposta · informações reais
                </span>
              </footer>
            </div>
            </div>
          </main>
        </div>
        {notice && (
          <button
            onClick={() => setNotice("")}
            className="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-xl border border-cyan-400/35 bg-slate-900 px-3.5 py-3 text-[11px] font-semibold text-slate-100 shadow-xl"
          >
            <CheckCircle2 className="h-4 w-4 text-cyan-300" />
            {notice}
            <X className="h-3.5 w-3.5" />
          </button>
        )}
        {role === "admin" && rankingOpen && (
          <ConsumptionRankingModal
            period={period}
            onAction={action}
            onClose={() => setRankingOpen(false)}
          />
        )}
      </div>
    </div>
  );
}