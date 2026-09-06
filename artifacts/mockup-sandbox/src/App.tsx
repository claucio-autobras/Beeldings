import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Bell,
  Bot,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Clock3,
  Cloud,
  Command,
  Cpu,
  Eye,
  EyeOff,
  FileBarChart,
  Filter,
  Gauge,
  Headphones,
  HelpCircle,
  History,
  LayoutDashboard,
  Lightbulb,
  Loader2,
  LockKeyhole,
  LogOut,
  Menu,
  MessageSquareText,
  Moon,
  MoreHorizontal,
  Network,
  PanelLeft,
  PlugZap,
  RefreshCw,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  Sun,
  Thermometer,
  TrendingDown,
  TrendingUp,
  UserRound,
  Wifi,
  WifiOff,
  X,
  Zap,
} from "lucide-react";

import { modules as discoveredModules } from "./.generated/mockup-components";

type ModuleMap = Record<string, () => Promise<Record<string, unknown>>>;
type Screen = "login" | "admin" | "cliente" | "compact";
type IconType = typeof Activity;

function _resolveComponent(
  mod: Record<string, unknown>,
  name: string,
): ComponentType | undefined {
  const fns = Object.values(mod).filter(
    (v) => typeof v === "function",
  ) as ComponentType[];
  return (
    (mod.default as ComponentType) ||
    (mod.Preview as ComponentType) ||
    (mod[name] as ComponentType) ||
    fns[fns.length - 1]
  );
}

function PreviewRenderer({
  componentPath,
  modules,
}: {
  componentPath: string;
  modules: ModuleMap;
}) {
  const [Component, setComponent] = useState<ComponentType | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setComponent(null);
    setError(null);

    async function loadComponent(): Promise<void> {
      const key = `./components/mockups/${componentPath}.tsx`;
      const loader = modules[key];
      if (!loader) {
        setError(`No component found at ${componentPath}.tsx`);
        return;
      }
      try {
        const mod = await loader();
        if (cancelled) return;
        const name = componentPath.split("/").pop()!;
        const comp = _resolveComponent(mod, name);
        if (!comp) {
          setError(`No exported React component found in ${componentPath}.tsx`);
          return;
        }
        setComponent(() => comp);
      } catch (e) {
        if (!cancelled) {
          setError(`Failed to load preview.\n${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
    void loadComponent();
    return () => {
      cancelled = true;
    };
  }, [componentPath, modules]);

  if (error) {
    return <pre className="p-8 font-mono text-sm text-red-500">{error}</pre>;
  }
  if (!Component) return <div className="min-h-[100dvh] bg-background" />;
  return <Component />;
}

function getBasePath(): string {
  return import.meta.env.BASE_URL.replace(/\/$/, "");
}

function getPreviewPath(): string | null {
  const basePath = getBasePath();
  const { pathname } = window.location;
  const local =
    basePath && pathname.startsWith(basePath)
      ? pathname.slice(basePath.length) || "/"
      : pathname;
  const match = local.match(/^\/preview\/(.+)$/);
  return match ? match[1] : null;
}

function BrandMark({ compact = false, onDark = false }: { compact?: boolean; onDark?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className={`${compact ? "h-8 w-8" : "h-10 w-10"} relative block shrink-0 text-cyan-500`} aria-hidden>
        <svg viewBox="0 0 40 40" className="h-full w-full fill-none">
          <path d="M20 2.8 35.3 11.4v17.2L20 37.2 4.7 28.6V11.4L20 2.8Z" fill="currentColor" fillOpacity=".11" stroke="currentColor" strokeWidth="1.4" />
          <path d="m20 10 8.3 4.8v9.6L20 29.2l-8.3-4.8v-9.6L20 10Z" fill="currentColor" fillOpacity=".22" stroke="currentColor" strokeWidth="1.2" />
          <path d="M20 10v19.2M11.7 14.8 20 19.6l8.3-4.8" stroke="currentColor" strokeWidth="1.1" />
        </svg>
      </span>
      <span className={`${compact ? "text-xl" : "text-2xl"} font-semibold tracking-[-.05em]`}>
        <span className={onDark ? "text-white" : "text-foreground"}>Beel</span><span className="text-cyan-500">dings</span>
      </span>
    </div>
  );
}

function ThemeToggle({ dark, onToggle }: { dark: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={dark ? "Mudar para tema claro" : "Mudar para tema escuro"}
      className="group inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-2.5 text-xs font-medium text-muted-foreground transition hover:border-cyan-500/50 hover:text-foreground"
    >
      {dark ? <Moon className="h-3.5 w-3.5 text-cyan-400" /> : <Sun className="h-3.5 w-3.5 text-amber-500" />}
      <span className="hidden sm:inline">{dark ? "Modo escuro" : "Modo claro"}</span>
      <span className={`relative h-4 w-7 rounded-full transition ${dark ? "bg-cyan-500/40" : "bg-slate-200"}`}>
        <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-transform ${dark ? "translate-x-3.5" : "translate-x-0.5"}`} />
      </span>
    </button>
  );
}

function StatusBadge({
  status,
  children,
}: {
  status: "normal" | "atencao" | "falha" | "sem dados" | "carregando";
  children?: ReactNode;
}) {
  const config = {
    normal: { icon: CheckCircle2, className: "border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300", label: "Normal" },
    atencao: { icon: AlertTriangle, className: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300", label: "Atenção" },
    falha: { icon: AlertCircle, className: "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300", label: "Falha" },
    "sem dados": { icon: CircleDot, className: "border-slate-400/25 bg-slate-400/10 text-muted-foreground", label: "Sem dados" },
    carregando: { icon: Loader2, className: "border-cyan-500/25 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300", label: "Carregando" },
  }[status];
  const Icon = config.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-[.08em] ${config.className}`}>
      <Icon className={`h-3 w-3 ${status === "carregando" ? "animate-spin" : ""}`} />
      {children ?? config.label}
    </span>
  );
}

function MiniSparkline({ values, color = "#1e9bb7" }: { values: number[]; color?: string }) {
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * 68;
    const y = 25 - ((value - min) / range) * 21;
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg viewBox="0 0 68 28" className="h-7 w-[68px] overflow-visible" aria-hidden>
      <polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SectionHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        {eyebrow && <p className="mb-1 font-mono text-[10px] font-semibold uppercase tracking-[.18em] text-cyan-600 dark:text-cyan-400">{eyebrow}</p>}
        <h2 className="text-lg font-semibold tracking-[-.025em] text-foreground">{title}</h2>
        {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

function LoginScreen({
  dark,
  onToggleTheme,
  onEnter,
  onOpenCompact,
}: {
  dark: boolean;
  onToggleTheme: () => void;
  onEnter: (screen: "admin" | "cliente") => void;
  onOpenCompact: () => void;
}) {
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("operador@autobras.com.br");
  const [password, setPassword] = useState("senha-segura");
  const [remember, setRemember] = useState(true);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email || !password) {
      setMessage("Informe e-mail e senha para continuar.");
      return;
    }
    setMessage("Acesso validado. Escolha um ambiente para continuar.");
  }

  return (
    <main className="min-h-[100dvh] overflow-hidden bg-background text-foreground">
      <div className="grid min-h-[100dvh] lg:grid-cols-[1.04fr_.96fr]">
        <section className="relative hidden overflow-hidden bg-[#10253e] px-10 py-10 text-white lg:flex lg:flex-col lg:justify-between xl:px-16">
          <div className="absolute inset-0 beeldings-hex-grid opacity-70" />
          <div className="absolute -left-20 top-20 h-72 w-72 rounded-full bg-cyan-400/10 blur-3xl" />
          <div className="absolute bottom-0 right-0 h-96 w-96 rounded-full bg-amber-300/[.06] blur-3xl" />
          <div className="relative">
            <div className="flex items-center gap-3">
              <BrandMark compact onDark />
            </div>
            <div className="mt-24 max-w-xl">
              <div className="mb-5 inline-flex items-center gap-2 rounded-md border border-cyan-300/20 bg-cyan-300/[.08] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[.18em] text-cyan-200">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_12px_rgba(110,231,183,.9)]" />
                Sistema operacional · 06:42 BRT
              </div>
              <h1 className="text-5xl font-semibold leading-[.98] tracking-[-.06em] xl:text-7xl">
                O edifício
                <br />
                <span className="text-cyan-300">fala.</span> A operação
                <br />
                responde.
              </h1>
              <p className="mt-7 max-w-md text-sm leading-6 text-slate-300">
                Um centro de inteligência para transformar telemetria, alarmes e ativos em decisões claras.
              </p>
            </div>
          </div>
          <div className="relative grid max-w-lg grid-cols-3 gap-3">
            {[
              ["99,4%", "disponibilidade"],
              ["8,4 mil", "pontos online"],
              ["14 min", "tempo até ACK"],
            ].map(([value, label]) => (
              <div key={label} className="border-l border-cyan-200/20 pl-3">
                <p className="font-mono text-xl font-bold text-white">{value}</p>
                <p className="mt-1 text-[10px] uppercase tracking-[.14em] text-slate-400">{label}</p>
              </div>
            ))}
          </div>
          <p className="relative font-mono text-[10px] uppercase tracking-[.18em] text-slate-500">
            Malha de controle · versão 2.4.1
          </p>
        </section>

        <section className="relative flex items-center justify-center px-6 py-8 sm:px-10">
          <div className="absolute right-6 top-6"><ThemeToggle dark={dark} onToggle={onToggleTheme} /></div>
          <div className="w-full max-w-md">
            <div className="mb-10 lg:hidden"><BrandMark /></div>
            <div className="mb-8">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[.18em] text-cyan-600 dark:text-cyan-400">Acesso seguro</p>
              <h2 className="mt-3 text-3xl font-semibold tracking-[-.045em]">Bem-vindo de volta.</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">Entre para acompanhar a operação dos seus sites em um só lugar.</p>
            </div>

            <form onSubmit={submit} className="space-y-5">
              <label className="block">
                <span className="mb-2 block text-xs font-semibold text-foreground">E-mail corporativo</span>
                <span className="relative block">
                  <UserRound className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" className="h-12 w-full rounded-xl border border-input bg-card pl-10 pr-4 text-sm outline-none transition placeholder:text-muted-foreground focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/10" placeholder="voce@empresa.com.br" />
                </span>
              </label>
              <label className="block">
                <span className="mb-2 block text-xs font-semibold text-foreground">Senha</span>
                <span className="relative block">
                  <LockKeyhole className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                   <input value={password} onChange={(event) => setPassword(event.target.value)} type={showPassword ? "text" : "password"} autoComplete="current-password" className="h-12 w-full rounded-xl border border-input bg-card pl-10 pr-11 text-sm outline-none transition placeholder:text-muted-foreground focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/10" placeholder="••••••••" />
                  <button type="button" onClick={() => setShowPassword((current) => !current)} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground transition hover:text-foreground" aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}>
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </span>
              </label>
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} className="h-4 w-4 rounded border-input accent-cyan-600" />
                  Lembrar deste dispositivo
                </label>
                <button type="button" onClick={() => setMessage("Link de recuperação enviado para o e-mail informado.")} className="text-xs font-semibold text-cyan-600 transition hover:text-cyan-500">Esqueci a senha</button>
              </div>
              <div className="flex items-center gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/[.06] px-3.5 py-3">
                <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-300" />
                <p className="text-xs text-muted-foreground">Conexão protegida e verificação concluída</p>
                <span className="ml-auto font-mono text-[9px] uppercase text-muted-foreground">TLS 1.3</span>
              </div>
              <button type="submit" className="group flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#0e8099] px-4 text-sm font-bold text-white shadow-lg shadow-cyan-900/15 transition hover:bg-[#0c7086]">
                Entrar na plataforma
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </button>
              {message && <p className="rounded-lg border border-cyan-500/20 bg-cyan-500/[.07] px-3 py-2.5 text-xs leading-5 text-cyan-700 dark:text-cyan-300">{message}</p>}
            </form>

            <div className="mt-10 border-t border-border pt-7">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">Abrir uma prévia de ambiente</p>
                <span className="rounded bg-amber-500/10 px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-amber-700 dark:text-amber-300">demo local</span>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <button type="button" onClick={() => onEnter("admin")} className="rounded-lg border border-border bg-card px-3 py-2.5 text-left text-xs font-semibold transition hover:border-cyan-500/50 hover:bg-cyan-500/[.05]">
                  <span className="block text-foreground">Dashboard Admin</span><span className="mt-1 block text-[10px] font-normal text-muted-foreground">Visão global</span>
                </button>
                <button type="button" onClick={() => onEnter("cliente")} className="rounded-lg border border-border bg-card px-3 py-2.5 text-left text-xs font-semibold transition hover:border-cyan-500/50 hover:bg-cyan-500/[.05]">
                  <span className="block text-foreground">Dashboard Cliente</span><span className="mt-1 block text-[10px] font-normal text-muted-foreground">Site selecionado</span>
                </button>
                <button type="button" onClick={onOpenCompact} className="rounded-lg border border-cyan-500/30 bg-cyan-500/[.05] px-3 py-2.5 text-left text-xs font-semibold transition hover:border-cyan-500/60 hover:bg-cyan-500/[.1]">
                  <span className="block text-foreground">Dashboard compacto</span><span className="mt-1 block text-[10px] font-normal text-cyan-700 dark:text-cyan-300">Nova proposta</span>
                </button>
              </div>
              <p className="mt-6 text-center font-mono text-[9px] uppercase tracking-[.14em] text-muted-foreground">rede de operação · sinal estável</p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

const navItems: Array<{ id: "admin" | "cliente"; label: string; icon: IconType }> = [
  { id: "admin", label: "Visão global", icon: LayoutDashboard },
  { id: "cliente", label: "Minha operação", icon: Building2 },
];

function Sidebar({
  screen,
  onNavigate,
  onLogout,
}: {
  screen: "admin" | "cliente";
  onNavigate: (screen: "admin" | "cliente") => void;
  onLogout: () => void;
}) {
  return (
    <aside className="hidden w-[232px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex">
      <div className="px-5 py-6"><BrandMark compact onDark /></div>
      <div className="px-3">
        <p className="px-3 pb-2 font-mono text-[9px] uppercase tracking-[.18em] text-slate-500">Workspace</p>
        <nav className="space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const selected = screen === item.id;
            return (
              <button key={item.id} type="button" onClick={() => onNavigate(item.id)} className={`group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-xs font-semibold transition ${selected ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-slate-400 hover:bg-slate-800/70 hover:text-white"}`}>
                <Icon className={`h-4 w-4 ${selected ? "text-amber-300" : "text-slate-500 group-hover:text-cyan-300"}`} />
                {item.label}
                {item.id === "admin" && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-amber-300" />}
              </button>
            );
          })}
        </nav>
      </div>
      <div className="mt-8 px-3">
        <p className="px-3 pb-2 font-mono text-[9px] uppercase tracking-[.18em] text-slate-500">Módulos</p>
        {[
          { label: "Alarmes", icon: Bell, count: "47" },
          { label: "Dispositivos", icon: Cpu, count: "8,4k" },
          { label: "Relatórios", icon: FileBarChart, count: "" },
          { label: "Auditoria", icon: History, count: "" },
        ].map((item) => (
          <button key={item.label} type="button" onClick={() => undefined} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-xs text-slate-400 transition hover:bg-slate-800/70 hover:text-white">
            <item.icon className="h-4 w-4 text-slate-500" />{item.label}{item.count && <span className="ml-auto font-mono text-[10px] text-amber-300">{item.count}</span>}
          </button>
        ))}
      </div>
      <div className="mt-auto border-t border-sidebar-border p-4">
        <div className="flex items-center gap-3 rounded-lg bg-slate-800/50 px-3 py-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-cyan-400/15 text-xs font-bold text-cyan-200">AS</span>
          <div className="min-w-0"><p className="truncate text-xs font-semibold text-white">Ana Souza</p><p className="truncate text-[10px] text-slate-500">Administradora</p></div>
          <button type="button" onClick={onLogout} className="ml-auto text-slate-500 transition hover:text-white" aria-label="Sair"><LogOut className="h-3.5 w-3.5" /></button>
        </div>
      </div>
    </aside>
  );
}

function MobileHeader({ screen, onMenu }: { screen: "admin" | "cliente"; onMenu: () => void }) {
  return (
    <div className="flex items-center justify-between border-b border-border bg-card px-4 py-3 lg:hidden">
      <button type="button" onClick={onMenu} className="rounded-md p-2 text-muted-foreground hover:bg-muted" aria-label="Abrir menu"><Menu className="h-5 w-5" /></button>
      <BrandMark compact />
      <span className="rounded bg-cyan-500/10 px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-cyan-700 dark:text-cyan-300">{screen === "admin" ? "admin" : "cliente"}</span>
    </div>
  );
}

function Topbar({
  screen,
  dark,
  period,
  onPeriod,
  onToggleTheme,
  onLogout,
  onFilters,
}: {
  screen: "admin" | "cliente";
  dark: boolean;
  period: string;
  onPeriod: (period: string) => void;
  onToggleTheme: () => void;
  onLogout: () => void;
  onFilters: () => void;
}) {
  return (
    <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-border bg-background/90 px-4 py-3 backdrop-blur-md sm:px-6 lg:px-8">
      <div className="flex items-center gap-3">
        <div className="hidden h-8 w-px bg-border sm:block" />
        <div><p className="font-mono text-[9px] uppercase tracking-[.18em] text-cyan-600 dark:text-cyan-400">Centro de controle / 06 jun 2024</p><p className="mt-0.5 text-xs font-semibold text-foreground">Ambiente de demonstração · dados fictícios</p></div>
      </div>
      <div className="flex items-center gap-2">
        <div className="hidden items-center rounded-lg border border-border bg-card p-0.5 sm:flex">
          {["24h", "7d", "30d"].map((item) => <button key={item} type="button" onClick={() => onPeriod(item)} className={`rounded-md px-2.5 py-1.5 font-mono text-[10px] transition ${period === item ? "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300" : "text-muted-foreground hover:text-foreground"}`}>{item}</button>)}
        </div>
        <button type="button" onClick={onFilters} className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-semibold text-muted-foreground transition hover:border-cyan-500/50 hover:text-foreground"><Filter className="h-3.5 w-3.5" /><span className="hidden sm:inline">Filtros</span></button>
        <ThemeToggle dark={dark} onToggle={onToggleTheme} />
        <button type="button" onClick={onLogout} className="hidden h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition hover:text-foreground sm:flex" aria-label="Sair"><LogOut className="h-3.5 w-3.5" /></button>
      </div>
    </header>
  );
}

function KpiCard({
  label,
  value,
  meta,
  trend,
  icon: Icon,
  status,
  spark,
}: {
  label: string;
  value: string;
  meta?: string;
  trend: string;
  icon: IconType;
  status: "normal" | "atencao" | "falha";
  spark: number[];
}) {
  const negative = status === "atencao" || status === "falha";
  return (
    <div className="beeldings-panel rounded-xl p-4 transition hover:-translate-y-0.5">
      <div className="flex items-start justify-between gap-2">
        <div><p className="text-xs font-medium text-muted-foreground">{label}</p><div className="mt-2 flex items-baseline gap-1.5"><p className="font-mono text-2xl font-bold tracking-[-.06em] text-foreground">{value}</p>{meta && <span className="text-[10px] text-muted-foreground">{meta}</span>}</div></div>
        <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${negative ? "bg-amber-500/10 text-amber-600 dark:text-amber-300" : "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300"}`}><Icon className="h-4 w-4" /></span>
      </div>
      <div className="mt-4 flex items-end justify-between"><span className={`inline-flex items-center gap-1 text-[10px] font-semibold ${negative ? "text-amber-700 dark:text-amber-300" : "text-emerald-600 dark:text-emerald-300"}`}>{negative ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}{trend}</span><MiniSparkline values={spark} color={negative ? "#d79b28" : "#1e9bb7"} /></div>
    </div>
  );
}

function HexCluster({ admin }: { admin: boolean }) {
  const values = admin ? [["128", "sites"], ["8,4k", "pontos"], ["99,4%", "dispon."]] : [["6", "áreas"], ["412", "ativos"], ["99,1%", "dispon."]];
  return (
    <div className="relative flex min-h-[122px] items-center justify-center overflow-hidden rounded-xl border border-cyan-500/20 bg-cyan-500/[.045] p-3">
      <div className="absolute inset-0 beeldings-hex-grid opacity-60" />
      <div className="relative flex items-center gap-[-8px]">
        {values.map(([value, label], index) => <div key={label} className={`beeldings-hex relative flex h-[86px] w-[92px] flex-col items-center justify-center border border-cyan-500/20 ${index === 1 ? "z-10 bg-cyan-600 text-white shadow-lg shadow-cyan-900/10" : "bg-card text-foreground"}`}><span className={`font-mono text-lg font-bold ${index === 1 ? "text-white" : "text-cyan-700 dark:text-cyan-300"}`}>{value}</span><span className={`mt-1 text-[9px] uppercase tracking-wider ${index === 1 ? "text-cyan-100" : "text-muted-foreground"}`}>{label}</span></div>)}
      </div>
    </div>
  );
}

function TrendChart({ client }: { client: boolean }) {
  const bars = client ? [28, 34, 20, 48, 39, 55, 44, 65, 53, 75, 61, 68] : [35, 42, 31, 63, 56, 71, 52, 82, 66, 76, 61, 88];
  return (
    <div className="relative h-[220px] overflow-hidden rounded-lg border border-border bg-card/60 p-4">
      <div className="absolute inset-x-4 top-8 space-y-10">{[0, 1, 2].map((line) => <div key={line} className="border-t border-dashed border-border/70" />)}</div>
      <div className="absolute inset-x-4 bottom-8 top-7 flex items-end justify-between gap-1.5">
        {bars.map((height, index) => <div key={index} className="group relative flex h-full flex-1 items-end"><div className={`w-full rounded-t-sm transition-opacity group-hover:opacity-80 ${index === 7 ? "bg-amber-400" : "bg-cyan-600/75 dark:bg-cyan-400/60"}`} style={{ height: `${height}%` }} /><span className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 rounded bg-foreground px-1.5 py-1 font-mono text-[9px] text-background opacity-0 transition group-hover:opacity-100">{Math.round(height * (client ? .8 : 1.15))}</span></div>)}
      </div>
      <div className="absolute bottom-2 left-4 right-4 flex justify-between font-mono text-[9px] text-muted-foreground"><span>00h</span><span>06h</span><span>12h</span><span>18h</span><span>agora</span></div>
    </div>
  );
}

function FilterTray({ active, onSelect }: { active: string; onSelect: (value: string) => void }) {
  return (
    <div className="beeldings-panel flex flex-wrap items-center gap-2 rounded-xl p-3">
      <span className="mr-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Filtrar por</span>
      {["Todos", "Críticos", "Atenção", "Sem dados"].map((item) => <button type="button" key={item} onClick={() => onSelect(item)} className={`rounded-md px-2.5 py-1.5 text-[10px] font-semibold transition ${active === item ? "bg-cyan-600 text-white" : "bg-muted text-muted-foreground hover:text-foreground"}`}>{item}</button>)}
      <span className="ml-auto hidden font-mono text-[10px] text-muted-foreground sm:block">filtros demonstrativos</span>
    </div>
  );
}

function AdminDashboard({ activeFilter }: { activeFilter: string }) {
  const gateways = [
    { name: "Gateway Principal SP", id: "GW-SP-01", status: "normal" as const, cpu: 45, memory: 60, contact: "agora" },
    { name: "Gateway Edge RJ", id: "GW-RJ-02", status: "atencao" as const, cpu: 85, memory: 92, contact: "agora" },
    { name: "Gateway Legado MG", id: "GW-MG-01", status: "sem dados" as const, cpu: 0, memory: 0, contact: "há 5 min" },
    { name: "Gateway Secundário PR", id: "GW-PR-03", status: "falha" as const, cpu: 0, memory: 0, contact: "há 2 horas" },
  ];
  const filtered = gateways.filter((gateway) => activeFilter === "Todos" || (activeFilter === "Críticos" && gateway.status === "falha") || (activeFilter === "Atenção" && gateway.status === "atencao") || (activeFilter === "Sem dados" && gateway.status === "sem dados"));
  return (
    <div className="space-y-6">
      <SectionHeader eyebrow="Visão global" title="Todos os sites" description="Leitura consolidada da operação conectada." action={<div className="hidden items-center gap-2 sm:flex"><StatusBadge status="normal">Sistema estável</StatusBadge><span className="font-mono text-[10px] text-muted-foreground">atualizado agora</span></div>} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Alarmes ativos" value="47" trend="+12% vs. ontem" icon={Bell} status="falha" spark={[25, 29, 26, 34, 31, 39, 42, 47]} />
        <KpiCard label="Aguardando ACK" value="18" trend="-5% vs. ontem" icon={Clock3} status="atencao" spark={[25, 23, 24, 21, 20, 19, 18, 18]} />
        <KpiCard label="Dispositivos offline" value="12" trend="+2 nas últimas 2h" icon={WifiOff} status="atencao" spark={[8, 7, 9, 8, 10, 10, 11, 12]} />
        <KpiCard label="Disponibilidade" value="99,4%" trend="+0,8% no período" icon={Gauge} status="normal" spark={[91, 92, 92, 94, 93, 96, 97, 99]} />
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.55fr_.8fr]">
        <div className="beeldings-panel rounded-xl p-4 sm:p-5">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-semibold">Pulso da operação</p><p className="mt-1 text-xs text-muted-foreground">Eventos registrados no período selecionado</p></div><div className="flex gap-3 font-mono text-[10px]"><span className="flex items-center gap-1.5 text-cyan-700 dark:text-cyan-300"><i className="h-2 w-2 rounded-full bg-cyan-500" /> eventos</span><span className="flex items-center gap-1.5 text-amber-700 dark:text-amber-300"><i className="h-2 w-2 rounded-full bg-amber-400" /> pico</span></div></div>
          <TrendChart client={false} />
        </div>
        <HexCluster admin />
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.45fr_.85fr]">
        <div className="beeldings-panel overflow-hidden rounded-xl">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-4"><div><p className="text-sm font-semibold">Saúde dos gateways</p><p className="mt-1 text-xs text-muted-foreground">CPU, memória e conectividade por site</p></div><button type="button" onClick={() => undefined} className="inline-flex items-center gap-1 text-xs font-semibold text-cyan-700 hover:text-cyan-500 dark:text-cyan-300">Ver inventário <ChevronRight className="h-3.5 w-3.5" /></button></div>
          {activeFilter !== "Todos" && <div className="border-b border-border bg-muted/40 px-4 py-2 font-mono text-[10px] text-muted-foreground">Exibindo: {activeFilter} · {filtered.length} registros</div>}
          <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left"><thead className="bg-muted/40 font-mono text-[9px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-4 py-3 font-medium">Gateway</th><th className="px-4 py-3 font-medium">Estado</th><th className="px-4 py-3 font-medium">Recursos</th><th className="px-4 py-3 text-right font-medium">Último contato</th></tr></thead><tbody className="divide-y divide-border">{filtered.map((gateway) => <tr key={gateway.id} className="transition hover:bg-muted/40"><td className="px-4 py-3"><div className="flex items-center gap-2.5"><span className="flex h-7 w-7 items-center justify-center rounded-md bg-cyan-500/10 text-cyan-700 dark:text-cyan-300"><Server className="h-3.5 w-3.5" /></span><div><p className="text-xs font-semibold">{gateway.name}</p><p className="mt-0.5 font-mono text-[9px] text-muted-foreground">{gateway.id}</p></div></div></td><td className="px-4 py-3"><StatusBadge status={gateway.status} /></td><td className="px-4 py-3">{gateway.status === "sem dados" || gateway.status === "falha" ? <span className="text-[10px] italic text-muted-foreground">Métricas indisponíveis</span> : <div className="w-36 space-y-1.5"><div className="flex items-center gap-2 font-mono text-[9px] text-muted-foreground"><span className="w-7">CPU</span><span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><span className={`block h-full ${gateway.cpu > 80 ? "bg-amber-400" : "bg-cyan-500"}`} style={{ width: `${gateway.cpu}%` }} /></span><b className="w-7 text-right font-normal">{gateway.cpu}%</b></div><div className="flex items-center gap-2 font-mono text-[9px] text-muted-foreground"><span className="w-7">MEM</span><span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><span className={`block h-full ${gateway.memory > 80 ? "bg-red-500" : "bg-cyan-500"}`} style={{ width: `${gateway.memory}%` }} /></span><b className="w-7 text-right font-normal">{gateway.memory}%</b></div></div>}</td><td className="px-4 py-3 text-right font-mono text-[10px] text-muted-foreground">{gateway.contact}</td></tr>)}</tbody></table></div>
        </div>
        <div className="space-y-4">
          <div className="beeldings-panel rounded-xl p-4"><div className="mb-4 flex items-center justify-between"><div><p className="text-sm font-semibold">Atenção por cliente</p><p className="mt-1 text-xs text-muted-foreground">Onde agir primeiro</p></div><MoreHorizontal className="h-4 w-4 text-muted-foreground" /></div><div className="space-y-3">{[["Shopping Vale Sul", "15", "4", "falha"], ["Hospital Santa Clara", "12", "1", "atencao"], ["Autobras S.A.", "8", "5", "atencao"]].map(([name, alarms, offline, status], index) => <div key={name} className="flex items-center gap-3"><span className={`flex h-7 w-7 items-center justify-center rounded-md font-mono text-[10px] font-bold ${index === 0 ? "bg-red-500/10 text-red-600 dark:text-red-300" : "bg-amber-500/10 text-amber-700 dark:text-amber-300"}`}>0{index + 1}</span><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{name}</p><p className="mt-1 text-[10px] text-muted-foreground"><span className={status === "falha" ? "text-red-600 dark:text-red-300" : "text-amber-700 dark:text-amber-300"}>{alarms} alarmes</span> · {offline} offline</p></div><ChevronRight className="h-3.5 w-3.5 text-muted-foreground" /></div>)}</div></div>
          <div className="beeldings-panel rounded-xl p-4"><div className="mb-3 flex items-center gap-2"><History className="h-4 w-4 text-cyan-600 dark:text-cyan-300" /><p className="text-sm font-semibold">Atividade recente</p></div><div className="space-y-3">{["João reconheceu 5 alarmes", "Sistema iniciou Night Mode", "Firmware do GW-SP-01 atualizado"].map((text, index) => <div key={text} className="flex gap-3 border-l border-cyan-500/30 pl-3"><span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-500" /><div><p className="text-[11px] leading-4 text-foreground">{text}</p><p className="mt-1 font-mono text-[9px] text-muted-foreground">{index * 18 + 2} min atrás · normal</p></div></div>)}</div></div>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <div className="beeldings-panel rounded-xl p-4"><div className="flex items-center justify-between"><p className="text-sm font-semibold">CFTV global</p><StatusBadge status="atencao">100 com atenção</StatusBadge></div><div className="mt-5 flex items-end gap-3"><p className="font-mono text-3xl font-bold">1.200</p><p className="mb-1 text-xs text-muted-foreground">/ 1.300 online</p></div><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full w-[92%] bg-cyan-500" /></div><button type="button" onClick={() => undefined} className="mt-4 text-xs font-semibold text-cyan-700 hover:text-cyan-500 dark:text-cyan-300">Abrir monitoramento <ArrowRight className="ml-1 inline h-3 w-3" /></button></div>
        <div className="beeldings-panel rounded-xl p-4"><div className="flex items-center gap-2"><Zap className="h-4 w-4 text-amber-500" /><p className="text-sm font-semibold">Automações</p></div><div className="mt-4 flex items-end justify-between"><div><p className="font-mono text-3xl font-bold text-emerald-600 dark:text-emerald-300">98,5%</p><p className="mt-1 text-xs text-muted-foreground">taxa de sucesso · 1.240 execuções</p></div><StatusBadge status="normal">Operando</StatusBadge></div><div className="mt-4 rounded-lg border border-red-500/20 bg-red-500/[.05] px-3 py-2 text-[10px] text-red-700 dark:text-red-300">1 comando falhou · START AHU-05</div></div>
        <div className="beeldings-panel rounded-xl p-4"><div className="flex items-center gap-2"><Cloud className="h-4 w-4 text-muted-foreground" /><p className="text-sm font-semibold">Consumo energético</p></div><div className="mt-4 flex items-center gap-3 rounded-lg border border-border bg-muted/40 px-3 py-3"><CircleDot className="h-4 w-4 text-muted-foreground" /><div><p className="text-xs font-semibold">Sem dados suficientes</p><p className="mt-1 text-[10px] text-muted-foreground">Aguardando leitura de 2 medidores</p></div></div><button type="button" onClick={() => undefined} className="mt-4 text-xs font-semibold text-cyan-700 dark:text-cyan-300">Ver fontes de dados <ArrowRight className="ml-1 inline h-3 w-3" /></button></div>
      </div>
    </div>
  );
}

function ClientDashboard({ activeFilter }: { activeFilter: string }) {
  const devices = [["Climatização (HVAC)", "118", "2", "3"], ["Energia / QGBT", "64", "0", "1"], ["Iluminação", "92", "1", "0"], ["Elevadores", "22", "1", "2"]];
  return (
    <div className="space-y-6">
      <SectionHeader eyebrow="Minha operação" title="Shopping Vale Sul" description="Site principal · São José dos Campos, SP" action={<div className="hidden items-center gap-2 sm:flex"><StatusBadge status="normal">99,1% disponível</StatusBadge><span className="font-mono text-[10px] text-muted-foreground">atualizado agora</span></div>} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Alarmes ativos" value="15" trend="+8% vs. ontem" icon={Bell} status="falha" spark={[6, 5, 8, 7, 10, 11, 13, 15]} />
        <KpiCard label="Aguardando ACK" value="6" trend="-3% vs. ontem" icon={Clock3} status="atencao" spark={[10, 9, 8, 8, 7, 6, 5, 6]} />
        <KpiCard label="Dispositivos offline" value="4" trend="+1 nas últimas 2h" icon={WifiOff} status="atencao" spark={[1, 2, 2, 1, 3, 3, 4, 4]} />
        <KpiCard label="Automação executada" value="214" trend="+2,4% no período" icon={PlugZap} status="normal" spark={[40, 42, 41, 45, 52, 49, 58, 64]} />
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.55fr_.8fr]">
        <div className="beeldings-panel rounded-xl p-4 sm:p-5"><div className="mb-4 flex items-start justify-between"><div><p className="text-sm font-semibold">Tendência de alarmes</p><p className="mt-1 text-xs text-muted-foreground">Eventos por severidade · dados fictícios</p></div><span className="rounded-md bg-muted px-2 py-1 font-mono text-[9px] text-muted-foreground">média</span></div><TrendChart client /></div>
        <HexCluster admin={false} />
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.45fr_.85fr]">
        <div className="beeldings-panel overflow-hidden rounded-xl"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-4"><div><p className="text-sm font-semibold">Saúde dos dispositivos</p><p className="mt-1 text-xs text-muted-foreground">Visão por tipo e área do site</p></div><button type="button" onClick={() => undefined} className="inline-flex items-center gap-1 text-xs font-semibold text-cyan-700 dark:text-cyan-300">Ver todos <ChevronRight className="h-3.5 w-3.5" /></button></div><div className="overflow-x-auto"><table className="w-full min-w-[610px] text-left"><thead className="bg-muted/40 font-mono text-[9px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-4 py-3 font-medium">Área</th><th className="px-4 py-3 font-medium">Distribuição</th><th className="px-4 py-3 text-center font-medium">Online</th><th className="px-4 py-3 text-center font-medium">Offline</th><th className="px-4 py-3 text-center font-medium">Alarme</th></tr></thead><tbody className="divide-y divide-border">{devices.map(([area, online, offline, alarm]) => <tr key={area} className="transition hover:bg-muted/40"><td className="px-4 py-3"><div className="flex items-center gap-2 text-xs font-semibold"><Cpu className="h-3.5 w-3.5 text-muted-foreground" />{area}</div></td><td className="px-4 py-3"><div className="flex h-2 w-36 overflow-hidden rounded-full bg-muted"><span className="bg-emerald-500" style={{ width: `${Number(online) / (Number(online) + Number(offline) + Number(alarm)) * 100}%` }} /><span className="bg-amber-400" style={{ width: `${Number(alarm) / (Number(online) + Number(offline) + Number(alarm)) * 100}%` }} /><span className="bg-red-500" style={{ width: `${Number(offline) / (Number(online) + Number(offline) + Number(alarm)) * 100}%` }} /></div></td><td className="px-4 py-3 text-center font-mono text-[10px] text-emerald-600 dark:text-emerald-300">{online}</td><td className="px-4 py-3 text-center font-mono text-[10px] text-red-600 dark:text-red-300">{offline}</td><td className="px-4 py-3 text-center font-mono text-[10px] text-amber-700 dark:text-amber-300">{alarm}</td></tr>)}</tbody></table></div></div>
        <div className="space-y-4">
          <div className="beeldings-panel rounded-xl p-4"><div className="mb-3 flex items-center justify-between"><div><p className="text-sm font-semibold">Acesso rápido</p><p className="mt-1 text-xs text-muted-foreground">Atalhos da sua operação</p></div><Command className="h-4 w-4 text-cyan-600 dark:text-cyan-300" /></div><div className="grid grid-cols-2 gap-2">{[["Alarmes", Bell], ["SCADA", Network], ["Relatórios", FileBarChart], ["Tendências", BarChart3]].map(([label, Icon]) => <button type="button" key={label as string} onClick={() => undefined} className="group rounded-lg border border-border bg-card px-3 py-3 text-left transition hover:border-cyan-500/50 hover:bg-cyan-500/[.04]"><span className="flex h-7 w-7 items-center justify-center rounded-md bg-cyan-500/10 text-cyan-700 dark:text-cyan-300"><Icon className="h-3.5 w-3.5" /></span><span className="mt-2 block text-[11px] font-semibold group-hover:text-cyan-700 dark:group-hover:text-cyan-300">{label as string}</span><span className="mt-1 block text-[9px] text-muted-foreground">abrir módulo</span></button>)}</div></div>
          <div className="beeldings-panel rounded-xl p-4"><div className="flex items-center gap-2"><Activity className="h-4 w-4 text-cyan-600 dark:text-cyan-300" /><p className="text-sm font-semibold">Resumo do período</p></div><div className="mt-3 space-y-2">{[["Críticos", "5", "falha"], ["Resolvidos", "32", "normal"], ["Disponibilidade", "99,1%", "normal"]].map(([label, value, status]) => <div key={label} className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2.5"><span className="text-[10px] text-muted-foreground">{label}</span><span className={`font-mono text-xs font-bold ${status === "falha" ? "text-red-600 dark:text-red-300" : "text-emerald-600 dark:text-emerald-300"}`}>{value}</span></div>)}</div></div>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <div className="beeldings-panel rounded-xl p-4"><div className="flex items-center justify-between"><p className="text-sm font-semibold">CFTV do site</p><StatusBadge status="atencao">6 com problema</StatusBadge></div><div className="mt-5 flex items-end gap-3"><p className="font-mono text-3xl font-bold">78</p><p className="mb-1 text-xs text-muted-foreground">/ 84 câmeras online</p></div><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full w-[93%] bg-cyan-500" /></div><button type="button" onClick={() => undefined} className="mt-4 text-xs font-semibold text-cyan-700 dark:text-cyan-300">Ver câmeras <ArrowRight className="ml-1 inline h-3 w-3" /></button></div>
        <div className="beeldings-panel rounded-xl p-4"><div className="flex items-center justify-between"><div className="flex items-center gap-2"><Thermometer className="h-4 w-4 text-amber-500" /><p className="text-sm font-semibold">Conforto térmico</p></div><StatusBadge status="carregando" /></div><div className="mt-5 flex items-center gap-3"><Loader2 className="h-6 w-6 animate-spin text-cyan-500" /><div><p className="text-xs font-semibold">Sincronizando leituras</p><p className="mt-1 text-[10px] text-muted-foreground">3 de 6 áreas recebidas</p></div></div><div className="mt-4 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full w-1/2 bg-cyan-500" /></div></div>
        <div className="beeldings-panel rounded-xl p-4"><div className="flex items-center gap-2"><WifiOff className="h-4 w-4 text-muted-foreground" /><p className="text-sm font-semibold">Qualidade da rede</p></div><div className="mt-4 rounded-lg border border-border bg-muted/40 px-3 py-3"><p className="text-xs font-semibold">Sem dados</p><p className="mt-1 text-[10px] leading-4 text-muted-foreground">O sensor de latência está em manutenção programada.</p></div><button type="button" onClick={() => undefined} className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-cyan-700 dark:text-cyan-300">Configurar sensor <Settings2 className="h-3.5 w-3.5" /></button></div>
      </div>
    </div>
  );
}

function ChatAssistant({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [input, setInput] = useState("");
  const [sent, setSent] = useState("");
  if (!open) return null;
  return (
    <aside className="fixed bottom-4 right-4 z-40 flex w-[min(370px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-cyan-400/25 bg-card shadow-2xl shadow-slate-950/20">
      <div className="flex items-center justify-between border-b border-border bg-[#12324a] px-4 py-3 text-white"><div className="flex items-center gap-2.5"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-300/15 text-cyan-200"><Bot className="h-4 w-4" /></span><div><p className="text-xs font-bold">BlueBee · Assistente IA</p><p className="mt-0.5 text-[10px] text-cyan-100/70">Contexto: operação atual</p></div></div><button type="button" onClick={onClose} className="rounded-md p-1 text-cyan-100/70 hover:bg-white/10 hover:text-white" aria-label="Fechar BlueBee"><X className="h-4 w-4" /></button></div>
      <div className="space-y-3 bg-background p-4"><div className="rounded-xl rounded-tl-sm bg-cyan-500/[.09] px-3 py-2.5 text-xs leading-5 text-foreground">Encontrei 5 alarmes críticos no Shopping Vale Sul. Posso organizar por impacto e sugerir a próxima ação.</div>{sent && <div className="ml-8 rounded-xl rounded-tr-sm bg-muted px-3 py-2.5 text-xs leading-5 text-foreground">{sent}</div>}<div className="flex flex-wrap gap-1.5"><button type="button" onClick={() => setSent("Quais alarmes devo priorizar?")} className="rounded-full border border-border px-2.5 py-1 text-[10px] text-muted-foreground hover:border-cyan-500/40 hover:text-foreground">Priorizar alarmes</button><button type="button" onClick={() => setSent("Mostre os gateways em atenção.")} className="rounded-full border border-border px-2.5 py-1 text-[10px] text-muted-foreground hover:border-cyan-500/40 hover:text-foreground">Ver gateways</button></div></div>
      <form onSubmit={(event) => { event.preventDefault(); if (input.trim()) { setSent(input.trim()); setInput(""); } }} className="flex gap-2 border-t border-border bg-card p-3"><input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Pergunte sobre a operação..." className="min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-2 text-xs outline-none focus:border-cyan-500" /><button type="submit" className="rounded-lg bg-cyan-600 px-3 text-white transition hover:bg-cyan-500" aria-label="Enviar mensagem"><ArrowRight className="h-4 w-4" /></button></form>
    </aside>
  );
}

function ProductShell({
  screen,
  dark,
  onToggleTheme,
  onNavigate,
  onLogout,
}: {
  screen: "admin" | "cliente";
  dark: boolean;
  onToggleTheme: () => void;
  onNavigate: (screen: "admin" | "cliente") => void;
  onLogout: () => void;
}) {
  const [period, setPeriod] = useState("24h");
  const [activeFilter, setActiveFilter] = useState("Todos");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const isAdmin = screen === "admin";
  return (
    <div className="flex min-h-[100dvh] bg-background text-foreground">
      <Sidebar screen={screen} onNavigate={onNavigate} onLogout={onLogout} />
      {mobileMenu && <div className="fixed inset-0 z-30 bg-slate-950/30 lg:hidden" onClick={() => setMobileMenu(false)}><div className="h-full w-64 bg-sidebar p-4 text-sidebar-foreground" onClick={(event) => event.stopPropagation()}><div className="mb-6 px-2"><BrandMark compact onDark /></div><nav className="space-y-1">{navItems.map((item) => <button key={item.id} type="button" onClick={() => { onNavigate(item.id); setMobileMenu(false); }} className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-xs font-semibold ${screen === item.id ? "bg-sidebar-accent text-white" : "text-slate-400"}`}><item.icon className="h-4 w-4" />{item.label}</button>)}</nav></div></div>}
      <div className="min-w-0 flex-1">
        <MobileHeader screen={screen} onMenu={() => setMobileMenu(true)} />
        <Topbar screen={screen} dark={dark} period={period} onPeriod={setPeriod} onToggleTheme={onToggleTheme} onLogout={onLogout} onFilters={() => setFiltersOpen((current) => !current)} />
        <main className="beeldings-grid min-h-[calc(100dvh-57px)] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <div className="mx-auto max-w-[1480px]">
            {filtersOpen && <div className="mb-5"><FilterTray active={activeFilter} onSelect={setActiveFilter} /></div>}
            {isAdmin ? <AdminDashboard activeFilter={activeFilter} /> : <ClientDashboard activeFilter={activeFilter} />}
          </div>
        </main>
      </div>
      <button type="button" onClick={() => setChatOpen((current) => !current)} className="fixed bottom-5 right-5 z-30 flex h-12 items-center gap-2 rounded-xl border border-cyan-400/25 bg-[#12324a] px-3.5 text-xs font-bold text-white shadow-xl shadow-slate-950/15 transition hover:-translate-y-0.5 hover:bg-[#17405c]"><MessageSquareText className="h-4 w-4 text-cyan-200" /><span className="hidden sm:inline">Falar com BlueBee</span></button>
      <ChatAssistant open={chatOpen} onClose={() => setChatOpen(false)} />
    </div>
  );
}

function Gallery() {
  const [screen, setScreen] = useState<Screen>(() => {
    const requested = new URLSearchParams(window.location.search).get("screen");
    return requested === "admin" || requested === "cliente" || requested === "compact" ? requested : "login";
  });
  const [dark, setDark] = useState(() => new URLSearchParams(window.location.search).get("theme") === "dark");
  const [previewMounted, setPreviewMounted] = useState(false);

  useEffect(() => {
    setPreviewMounted(true);
  }, []);

  const app = useMemo(() => {
    if (screen === "login") return <LoginScreen dark={dark} onToggleTheme={() => setDark((value) => !value)} onEnter={setScreen} onOpenCompact={() => setScreen("compact")} />;
    if (screen === "compact") return <PreviewRenderer componentPath="dashboard-compact/Compacto" modules={discoveredModules} />;
    return <ProductShell screen={screen} dark={dark} onToggleTheme={() => setDark((value) => !value)} onNavigate={setScreen} onLogout={() => setScreen("login")} />;
  }, [dark, screen]);

  if (!previewMounted) return <div className="min-h-[100dvh] bg-background" />;
  return <div className={dark ? "dark" : ""}>{app}</div>;
}

function App() {
  const previewPath = getPreviewPath();
  return <PreviewRenderer componentPath={previewPath ?? "dashboard-compact/Compacto"} modules={discoveredModules} />;
}

export default App;