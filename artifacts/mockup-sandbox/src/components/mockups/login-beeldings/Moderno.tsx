import { useState } from "react";
import {
  ArrowRight,
  BrainCircuit,
  Cog,
  Eye,
  EyeOff,
  Lock,
  Mail,
  ShieldCheck,
  Wifi,
} from "lucide-react";

/**
 * Tela de login "Prédio Vivo" — conceito: o edifício monitorado respira em
 * tempo real ao lado do formulário. Painel esquerdo escuro (sala de controle)
 * com malha de pontos conectados e sinais pulsando; formulário claro, limpo e
 * objetivo à direita. Identidade Beeldings: hexágono + ciano.
 */

function BrandMark({ dark = false, size = "md" }: { dark?: boolean; size?: "sm" | "md" | "lg" }) {
  const dims = { sm: "h-7 w-7", md: "h-9 w-9", lg: "h-11 w-11" }[size];
  const text = { sm: "text-lg", md: "text-2xl", lg: "text-3xl" }[size];
  return (
    <div className="flex items-center gap-2.5">
      <span className={`shrink-0 ${dims} ${dark ? "text-cyan-400" : "text-cyan-700"}`} aria-hidden>
        <svg viewBox="0 0 32 32" fill="none" className="h-full w-full">
          <path d="M16 2.5 27.5 9v14L16 29.5 4.5 23V9L16 2.5Z" fill="currentColor" fillOpacity="0.12" />
          <path d="M16 2.5 27.5 9v14L16 29.5 4.5 23V9L16 2.5Z" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
          <path d="M16 10.5 21 13.5v5L16 21.5 11 18.5v-5L16 10.5Z" fill="currentColor" />
        </svg>
      </span>
      <span className={`font-semibold tracking-tight ${text}`}>
        <span className={dark ? "text-white" : "text-slate-900"}>Beel</span>
        <span className={dark ? "text-cyan-400" : "text-cyan-700"}>dings</span>
      </span>
    </div>
  );
}

/** Malha de "prédio vivo": nós de telemetria conectados, alguns pulsando. */
function LivingGrid() {
  const nodes = [
    { x: 14, y: 18, live: true },
    { x: 34, y: 10, live: false },
    { x: 58, y: 16, live: true },
    { x: 80, y: 8, live: false },
    { x: 22, y: 38, live: false },
    { x: 46, y: 32, live: true },
    { x: 72, y: 36, live: false },
    { x: 90, y: 28, live: true },
    { x: 12, y: 60, live: true },
    { x: 38, y: 56, live: false },
    { x: 62, y: 62, live: false },
    { x: 86, y: 56, live: true },
    { x: 26, y: 82, live: false },
    { x: 52, y: 78, live: true },
    { x: 76, y: 84, live: false },
  ];
  const links: Array<[number, number]> = [
    [0, 1], [1, 2], [2, 3], [0, 4], [4, 5], [5, 2], [5, 6], [6, 7], [3, 7],
    [4, 8], [8, 9], [9, 10], [10, 11], [7, 11], [9, 12], [12, 13], [13, 14], [10, 14], [5, 9],
  ];
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full opacity-70" aria-hidden>
      {links.map(([a, b], i) => (
        <line
          key={i}
          x1={nodes[a].x} y1={nodes[a].y} x2={nodes[b].x} y2={nodes[b].y}
          stroke="rgb(34 211 238)" strokeOpacity="0.14" strokeWidth="0.25"
        />
      ))}
      {nodes.map((n, i) => (
        <g key={i}>
          {n.live && (
            <circle cx={n.x} cy={n.y} r="1.6" fill="rgb(34 211 238)" fillOpacity="0.25">
              <animate attributeName="r" values="1.2;2.6;1.2" dur="3.2s" begin={`${i * 0.4}s`} repeatCount="indefinite" />
              <animate attributeName="fill-opacity" values="0.3;0;0.3" dur="3.2s" begin={`${i * 0.4}s`} repeatCount="indefinite" />
            </circle>
          )}
          <circle cx={n.x} cy={n.y} r="0.55" fill={n.live ? "rgb(103 232 249)" : "rgb(148 163 184)"} fillOpacity={n.live ? 0.95 : 0.5} />
        </g>
      ))}
    </svg>
  );
}

const FEATURES = [
  { icon: BrainCircuit, title: "IA", description: "Inteligência artificial que aprende, analisa e gera valor." },
  { icon: Wifi, title: "IoT", description: "Dispositivos conectados em tempo real, em qualquer lugar." },
  { icon: Cog, title: "Automação", description: "Processos inteligentes e automáticos para mais eficiência." },
];

export function Moderno() {
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);

  return (
    <div className="grid min-h-screen w-full bg-white font-sans lg:grid-cols-[1.05fr_1fr]">
      {/* ── Painel esquerdo: sala de controle ─────────────────────────── */}
      <aside className="relative hidden overflow-hidden bg-slate-950 lg:flex lg:flex-col lg:justify-between lg:px-14 lg:py-12">
        {/* fundo: malha viva + brilhos */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(8,145,178,0.22),transparent_55%),radial-gradient(ellipse_at_bottom_right,rgba(14,116,144,0.18),transparent_50%)]" />
        <LivingGrid />
        <div aria-hidden className="pointer-events-none absolute -left-20 top-1/4 h-80 w-80 rounded-full bg-cyan-500/10 blur-3xl" />

        <div className="relative space-y-10">
          <BrandMark dark size="lg" />

          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/25 bg-cyan-400/10 px-3.5 py-1.5 text-xs font-medium tracking-wide text-cyan-300">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-cyan-400" />
              </span>
              Plataforma de gestão predial inteligente
            </div>
            <h2 className="text-4xl font-semibold leading-tight tracking-tight text-white">
              Seu prédio,
              <br />
              vivo em tempo real.
              <br />
              <span className="bg-gradient-to-r from-cyan-300 to-cyan-500 bg-clip-text text-transparent">
                Inteligência que transforma.
              </span>
            </h2>
          </div>

          <div className="space-y-4 pt-1">
            {FEATURES.map((f) => (
              <div key={f.title} className="flex items-start gap-4 rounded-xl border border-white/5 bg-white/[0.04] px-4 py-3.5 backdrop-blur-sm">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cyan-400/10 text-cyan-300 ring-1 ring-inset ring-cyan-400/25">
                  <f.icon className="h-4.5 w-4.5" strokeWidth={1.75} />
                </span>
                <div>
                  <p className="text-sm font-semibold text-white">{f.title}</p>
                  <p className="mt-0.5 text-sm leading-snug text-slate-400">{f.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* rodapé: selo de confiança */}
        <div className="relative mt-10 flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.04] px-5 py-4 backdrop-blur-sm">
          <ShieldCheck className="h-5 w-5 shrink-0 text-cyan-300" />
          <p className="text-sm text-slate-400">Segurança e performance com tecnologia de ponta.</p>
        </div>
      </aside>

      {/* ── Painel direito: formulário ────────────────────────────────── */}
      <main className="flex items-center justify-center px-6 py-12 lg:px-16">
        <div className="w-full max-w-sm">
          <div className="mb-9">
            <p className="text-sm font-medium text-cyan-700">Bem-vindo de volta!</p>
            <h1 className="mt-1.5 text-3xl font-semibold tracking-tight text-slate-900">Acesse sua conta</h1>
            <p className="mt-2 text-sm text-slate-500">Monitore seus sites, alarmes e equipamentos em um só lugar.</p>
          </div>

          <form className="space-y-5" onSubmit={(e) => e.preventDefault()}>
            <div>
              <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-slate-700">E-mail</label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  id="email" type="email" placeholder="voce@empresa.com.br" defaultValue="operador@autobras.com.br"
                  className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50/60 pl-10 pr-3.5 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-cyan-600 focus:bg-white focus:ring-4 focus:ring-cyan-600/10"
                />
              </div>
            </div>

            <div>
              <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-slate-700">Senha</label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  id="password" type={showPassword ? "text" : "password"} placeholder="••••••••" defaultValue="senha-segura"
                  className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50/60 pl-10 pr-11 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-cyan-600 focus:bg-white focus:ring-4 focus:ring-cyan-600/10"
                />
                <button
                  type="button" onClick={() => setShowPassword((s) => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 transition hover:text-slate-600"
                  aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 accent-cyan-700"
                />
                Lembrar-me
              </label>
              <a href="#" className="text-sm font-medium text-cyan-700 transition hover:text-cyan-800">Esqueci minha senha</a>
            </div>

            {/* Anti-robô (Turnstile) — representação do widget em produção */}
            <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 ring-1 ring-inset ring-emerald-300">
                <svg viewBox="0 0 12 12" className="h-3 w-3 text-emerald-600" fill="none"><path d="M2.5 6.2 5 8.6l4.5-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </span>
              <p className="text-sm text-slate-600">Verificação anti-robô concluída</p>
              <span className="ml-auto text-[10px] font-medium uppercase tracking-wider text-slate-400">Cloudflare</span>
            </div>

            <button
              type="submit"
              className="group flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-700 to-cyan-600 px-4 text-sm font-semibold text-white shadow-lg shadow-cyan-700/20 transition hover:from-cyan-800 hover:to-cyan-700"
            >
              Entrar
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </button>
          </form>

          <p className="mt-7 text-center text-sm text-slate-500">
            Ainda não tem uma conta?{" "}
            <a href="#" className="font-medium text-cyan-700 hover:text-cyan-800">Fale com o suporte</a>
          </p>
        </div>
      </main>
    </div>
  );
}
