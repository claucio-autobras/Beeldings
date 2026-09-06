import { useState } from "react";
import {
  Activity,
  ArrowRight,
  Bell,
  Bot,
  Check,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Cloud,
  Cpu,
  Eye,
  Gauge,
  Hexagon,
  Layers3,
  LineChart,
  Menu,
  Network,
  Play,
  RadioTower,
  ShieldCheck,
  Sparkles,
  X,
  Zap,
} from "lucide-react";

const signalCards = [
  { icon: RadioTower, label: "Telemetria", value: "8.412", detail: "pontos acompanhados", color: "cyan" },
  { icon: Bell, label: "Alarmes", value: "47", detail: "18 aguardam análise", color: "amber" },
  { icon: Eye, label: "CFTV", value: "128", detail: "câmeras conectadas", color: "blue" },
  { icon: Gauge, label: "Disponibilidade", value: "99,4%", detail: "nos últimos 30 dias", color: "emerald" },
];

const capabilities = [
  { icon: Activity, title: "Supervisão que enxerga o conjunto", body: "SCADA, gateways, BACnet, Modbus e MQTT em uma leitura contínua da operação.", tag: "CONTEXTO" },
  { icon: CircleAlert, title: "Menos ruído. Mais prioridade.", body: "Alarmes correlacionados por ativo, impacto e histórico — não apenas uma fila de eventos.", tag: "PRIORIZAÇÃO" },
  { icon: Layers3, title: "O histórico que explica", body: "Cada sinal ganha uma linha do tempo: o que mudou, quando começou e o que já foi tentado.", tag: "RASTREABILIDADE" },
  { icon: Zap, title: "Ação com segurança", body: "Playbooks, automações e comandos com aprovação, registro e limites operacionais.", tag: "CONTROLE" },
];

function Mark({ inverse = false }: { inverse?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className={`relative flex h-9 w-9 items-center justify-center ${inverse ? "text-cyan-300" : "text-[#078da8]"}`}>
        <Hexagon className="absolute h-9 w-9 stroke-[1.25]" />
        <Hexagon className="h-5 w-5 fill-current/10 stroke-[1.6]" />
        <span className="absolute h-1.5 w-1.5 rounded-full bg-amber-300" />
      </span>
      <span className={`text-[21px] font-bold tracking-[-.07em] ${inverse ? "text-white" : "text-[#102d4c]"}`}>
        Beel<span className="text-[#079bb4]">dings</span>
      </span>
    </div>
  );
}

function SectionLabel({ children }: { children: string }) {
  return <p className="mb-4 flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[.2em] text-[#078da8]"><span className="h-1.5 w-1.5 rounded-full bg-amber-400" />{children}</p>;
}

function SignalPanel() {
  return (
    <div className="relative overflow-hidden rounded-[22px] border border-[#28506e] bg-[#102b46] p-5 text-white shadow-[0_28px_80px_rgba(10,39,65,.2)] sm:p-7">
      <div className="absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(68,184,200,.12)_1px,transparent_1px),linear-gradient(90deg,rgba(68,184,200,.12)_1px,transparent_1px)] [background-size:28px_28px]" />
      <div className="relative flex items-center justify-between border-b border-white/10 pb-5">
        <div><p className="font-mono text-[9px] uppercase tracking-[.18em] text-cyan-300">Centro de operação</p><p className="mt-1 text-sm font-semibold">Torre Norte · São Paulo</p></div>
        <span className="flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-2.5 py-1 font-mono text-[9px] text-emerald-200"><span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />AO VIVO</span>
      </div>
      <div className="relative grid gap-3 py-6 sm:grid-cols-2">
        {signalCards.map(({ icon: Icon, label, value, detail, color }) => (
          <div key={label} className="rounded-xl border border-white/10 bg-white/[.045] p-4 transition hover:-translate-y-0.5 hover:bg-white/[.08]">
            <div className="flex items-center justify-between"><span className={`flex h-8 w-8 items-center justify-center rounded-lg ${color === "amber" ? "bg-amber-300/15 text-amber-300" : "bg-cyan-300/15 text-cyan-300"}`}><Icon className="h-4 w-4" /></span><span className="font-mono text-[9px] text-slate-400">agora</span></div>
            <p className="mt-4 font-mono text-2xl font-bold tracking-[-.06em]">{value}</p><p className="mt-1 text-xs font-semibold text-slate-200">{label}</p><p className="mt-1 text-[10px] text-slate-400">{detail}</p>
          </div>
        ))}
      </div>
      <div className="relative flex items-center gap-3 rounded-xl border border-amber-300/20 bg-amber-300/[.08] p-3.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-300/15 text-amber-300"><CircleAlert className="h-4 w-4" /></div>
        <div><p className="text-xs font-semibold text-amber-100">Atenção no chiller 02</p><p className="mt-0.5 text-[10px] leading-4 text-slate-400">Vibração subiu 18% em 42 min · BlueBee analisando</p></div><ArrowRight className="ml-auto h-4 w-4 text-amber-300" />
      </div>
    </div>
  );
}

export function Narrative() {
  const [menu, setMenu] = useState(false);
  const [demo, setDemo] = useState(false);
  const tabContent = {
    interpretar: { title: "“O que está acontecendo?”", text: "O chiller 02 apresenta aumento de vibração desde 05:18. O padrão coincide com queda gradual de eficiência térmica e não aparece nos demais chillers.", icon: Activity },
    explicar: { title: "“Por que isso importa?”", text: "Se a vibração continuar neste ritmo, a eficiência pode cair mais 11% nas próximas 3 horas. O histórico mostra dois eventos semelhantes antes de uma parada.", icon: LineChart },
    agir: { title: "“Qual é o próximo passo?”", text: "Recomendo inspeção do conjunto de ventilação antes do pico de demanda. A janela de menor impacto é entre 07:10 e 07:35.", icon: Check },
  };
  const [activeTab, setActiveTab] = useState<keyof typeof tabContent>("interpretar");
  const tabs = tabContent[activeTab];
  const ActiveIcon = tabs.icon;

  return (
    <main className="min-h-[100dvh] overflow-x-hidden bg-[#f5f8f8] text-[#17344f] selection:bg-cyan-200/60">
      <nav className="sticky top-0 z-40 border-b border-[#d9e5e6]/80 bg-[#f5f8f8]/90 backdrop-blur-xl">
        <div className="mx-auto flex h-[72px] max-w-7xl items-center justify-between px-5 sm:px-8">
          <a href="#inicio" aria-label="Beeldings início"><Mark /></a>
          <div className="hidden items-center gap-8 md:flex"><a href="#bluebee" className="text-xs font-semibold text-[#527084] transition hover:text-[#078da8]">BlueBee</a><a href="#plataforma" className="text-xs font-semibold text-[#527084] transition hover:text-[#078da8]">Plataforma</a><a href="#resultado" className="text-xs font-semibold text-[#527084] transition hover:text-[#078da8]">Resultados</a><a href="#contato" className="text-xs font-semibold text-[#527084] transition hover:text-[#078da8]">Fale com a gente</a></div>
          <button type="button" onClick={() => setDemo(true)} className="hidden rounded-lg bg-[#0a8299] px-4 py-2.5 text-xs font-bold text-white transition hover:bg-[#096d83] md:block">Ver demonstração <ArrowRight className="ml-1 inline h-3.5 w-3.5" /></button>
          <button type="button" onClick={() => setMenu(!menu)} className="rounded-lg p-2 text-[#17344f] md:hidden" aria-label="Abrir menu">{menu ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}</button>
        </div>
        {menu && <div className="border-t border-[#d9e5e6] bg-[#f5f8f8] px-5 py-4 md:hidden"><div className="grid gap-4 text-sm font-semibold"><a href="#bluebee" onClick={() => setMenu(false)}>BlueBee</a><a href="#plataforma" onClick={() => setMenu(false)}>Plataforma</a><a href="#resultado" onClick={() => setMenu(false)}>Resultados</a></div></div>}
      </nav>

      <section id="inicio" className="relative mx-auto max-w-7xl px-5 pb-20 pt-16 sm:px-8 sm:pt-24 lg:pb-28 lg:pt-28">
        <div className="absolute right-[-12%] top-0 -z-0 h-[560px] w-[560px] rounded-full bg-cyan-200/20 blur-3xl" />
        <div className="relative z-10 grid items-center gap-14 lg:grid-cols-[.92fr_1.08fr]">
          <div><SectionLabel>INTELIGÊNCIA PARA OPERAÇÕES PREDIAIS</SectionLabel><h1 className="max-w-xl text-[clamp(3.15rem,7vw,6.5rem)] font-bold leading-[.91] tracking-[-.075em] text-[#102d4c]">A operação<br /><span className="text-[#078da8]">ganha clareza.</span></h1><p className="mt-7 max-w-lg text-[15px] leading-7 text-[#527084]">A Beeldings conecta os sinais do seu edifício e coloca o <strong className="text-[#17344f]">BlueBee</strong> ao lado da equipe — entendendo o contexto antes de sugerir qualquer ação.</p><div className="mt-8 flex flex-wrap items-center gap-4"><button type="button" onClick={() => setDemo(true)} className="group rounded-lg bg-[#e8a92c] px-5 py-3.5 text-sm font-bold text-[#17344f] shadow-[0_10px_22px_rgba(232,169,44,.2)] transition hover:-translate-y-0.5 hover:bg-[#f0b43b]">Conhecer o BlueBee <ArrowRight className="ml-2 inline h-4 w-4 transition-transform group-hover:translate-x-1" /></button><a href="#plataforma" className="flex items-center gap-2 text-sm font-bold text-[#078da8]">Explorar a plataforma <ChevronDown className="h-4 w-4" /></a></div><div className="mt-10 flex items-center gap-5 border-t border-[#d9e5e6] pt-5"><div className="flex -space-x-2">{["AS", "ML", "RC"].map((x, i) => <span key={x} className={`flex h-8 w-8 items-center justify-center rounded-full border-2 border-[#f5f8f8] text-[9px] font-bold text-white ${i === 1 ? "bg-[#078da8]" : "bg-[#41657a]"}`}>{x}</span>)}</div><p className="text-[11px] leading-4 text-[#527084]">Feito para quem responde<br /><strong className="text-[#17344f]">quando o prédio fala.</strong></p></div></div>
          <SignalPanel />
        </div>
      </section>

      <section id="bluebee" className="border-y border-[#d9e5e6] bg-[#eaf3f3] px-5 py-20 sm:px-8 lg:py-28">
        <div className="mx-auto grid max-w-7xl items-center gap-14 lg:grid-cols-[.8fr_1.2fr]">
          <div><SectionLabel>CONHEÇA O BLUEBEE</SectionLabel><h2 className="max-w-md text-4xl font-bold leading-[.98] tracking-[-.06em] text-[#102d4c] sm:text-6xl">Não é mais um painel.<br /><span className="text-[#078da8]">É um parceiro</span> de decisão.</h2><p className="mt-6 max-w-md text-sm leading-7 text-[#527084]">O BlueBee lê a operação como um especialista experiente: conecta sinais, compara comportamentos e traduz complexidade em uma conversa objetiva.</p><div className="mt-8 grid gap-3 text-xs font-semibold text-[#31536b]"><p className="flex items-center gap-3"><span className="rounded-full bg-white p-1.5 text-[#078da8] shadow-sm"><Check className="h-3.5 w-3.5" /></span>Interpreta sinais no contexto do ativo</p><p className="flex items-center gap-3"><span className="rounded-full bg-white p-1.5 text-[#078da8] shadow-sm"><Check className="h-3.5 w-3.5" /></span>Explica causas com base no histórico</p><p className="flex items-center gap-3"><span className="rounded-full bg-white p-1.5 text-[#078da8] shadow-sm"><Check className="h-3.5 w-3.5" /></span>Sugere próximos passos verificáveis</p></div></div>
          <div className="rounded-[22px] border border-[#c8dfe0] bg-[#fbfdfc] p-4 shadow-[0_24px_60px_rgba(20,68,87,.08)] sm:p-7"><div className="flex items-center gap-3 border-b border-[#e1eded] pb-5"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#d9f2f2] text-[#078da8]"><Bot className="h-5 w-5" /></span><div><p className="text-sm font-bold text-[#17344f]">BlueBee · análise operacional</p><p className="font-mono text-[9px] uppercase tracking-[.15em] text-[#7b98a2]">contexto conectado · 06:42 BRT</p></div><span className="ml-auto h-2 w-2 rounded-full bg-emerald-400" /></div><div className="mt-5 flex flex-wrap gap-2">{(["interpretar", "explicar", "agir"] as const).map((tab) => <button key={tab} type="button" onClick={() => setActiveTab(tab)} className={`rounded-full px-3 py-1.5 text-[10px] font-bold capitalize transition ${activeTab === tab ? "bg-[#173f5f] text-white" : "bg-[#edf5f5] text-[#668391] hover:text-[#17344f]"}`}>{tab}</button>)}</div><div className="mt-5 rounded-xl bg-[#f1f7f7] p-5"><div className="flex items-start gap-3"><span className="mt-0.5 text-[#078da8]"><ActiveIcon className="h-5 w-5" /></span><div><h3 className="text-base font-bold tracking-[-.02em] text-[#17344f]">{tabs.title}</h3><p className="mt-3 text-sm leading-6 text-[#527084]">{tabs.text}</p></div></div></div><div className="mt-4 flex items-center justify-between border-t border-[#e1eded] pt-4"><span className="font-mono text-[9px] uppercase tracking-[.14em] text-[#849ca3]">Confiança da análise · 91%</span><button type="button" onClick={() => setDemo(true)} className="text-xs font-bold text-[#078da8] hover:underline">Ver evidências <ArrowRight className="ml-1 inline h-3 w-3" /></button></div></div>
        </div>
      </section>

      <section id="plataforma" className="mx-auto max-w-7xl px-5 py-20 sm:px-8 lg:py-28"><div className="max-w-2xl"><SectionLabel>UMA MALHA, TODA A OPERAÇÃO</SectionLabel><h2 className="text-4xl font-bold leading-[1] tracking-[-.06em] text-[#102d4c] sm:text-6xl">Do ponto de dados<br />ao próximo passo.</h2></div><div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{capabilities.map(({ icon: Icon, title, body, tag }, index) => <article key={title} className={`group border-t-2 pt-5 ${index === 1 ? "border-amber-400" : "border-[#b8d9dc]"}`}><Icon className={`h-6 w-6 ${index === 1 ? "text-amber-500" : "text-[#078da8]"}`} /><p className="mt-7 font-mono text-[9px] font-bold tracking-[.17em] text-[#7b98a2]">{tag}</p><h3 className="mt-3 text-lg font-bold leading-tight tracking-[-.03em] text-[#17344f]">{title}</h3><p className="mt-3 text-sm leading-6 text-[#668391]">{body}</p></article>)}</div></section>

      <section id="resultado" className="bg-[#123754] px-5 py-20 text-white sm:px-8 lg:py-28"><div className="mx-auto max-w-7xl"><div className="grid gap-14 lg:grid-cols-[.8fr_1.2fr]"><div><SectionLabel>O QUE MUDA NO TURNO</SectionLabel><h2 className="max-w-md text-4xl font-bold leading-[.98] tracking-[-.06em] sm:text-6xl">Mais tempo para decidir.<br /><span className="text-cyan-300">Menos tempo procurando.</span></h2><p className="mt-6 max-w-sm text-sm leading-7 text-slate-300">A plataforma transforma a rotina de resposta em uma operação previsível, auditável e preparada para o que vem depois.</p></div><div className="grid gap-4 sm:grid-cols-2"><div className="border-l border-cyan-300/40 pl-5"><p className="font-mono text-5xl font-bold tracking-[-.08em] text-cyan-300">14 min</p><p className="mt-3 text-sm font-semibold">até o reconhecimento</p><p className="mt-1 text-xs text-slate-400">em incidentes de alta prioridade</p></div><div className="border-l border-amber-300/40 pl-5"><p className="font-mono text-5xl font-bold tracking-[-.08em] text-amber-300">32%</p><p className="mt-3 text-sm font-semibold">menos alarmes repetidos</p><p className="mt-1 text-xs text-slate-400">com correlação por contexto</p></div><div className="border-l border-cyan-300/40 pl-5"><p className="font-mono text-5xl font-bold tracking-[-.08em] text-cyan-300">99,4%</p><p className="mt-3 text-sm font-semibold">de disponibilidade média</p><p className="mt-1 text-xs text-slate-400">em ambientes monitorados</p></div><div className="border-l border-amber-300/40 pl-5"><p className="font-mono text-5xl font-bold tracking-[-.08em] text-amber-300">1 visão</p><p className="mt-3 text-sm font-semibold">para cada decisão</p><p className="mt-1 text-xs text-slate-400">do gateway ao relatório</p></div></div></div><div className="mt-20 flex flex-col justify-between gap-6 border-t border-white/15 pt-6 sm:flex-row sm:items-center"><p className="max-w-xl text-sm leading-6 text-slate-300">“O BlueBee não substitui o conhecimento da equipe. Ele garante que esse conhecimento chegue na hora certa, com a evidência certa.”</p><span className="font-mono text-[10px] uppercase tracking-[.16em] text-cyan-300">Ana Souza · Coordenação de Operações</span></div></div></section>

      <section id="contato" className="relative overflow-hidden px-5 py-20 sm:px-8 lg:py-28"><div className="absolute right-[-4%] top-8 h-64 w-64 rounded-full border border-cyan-400/20" /><div className="absolute right-[4%] top-16 h-48 w-48 rounded-full border border-cyan-400/15" /><div className="relative mx-auto flex max-w-7xl flex-col items-start justify-between gap-8 md:flex-row md:items-end"><div><SectionLabel>PRÓXIMO TURNO</SectionLabel><h2 className="max-w-2xl text-4xl font-bold leading-[.98] tracking-[-.06em] text-[#102d4c] sm:text-6xl">Quando o prédio<br /><span className="text-[#078da8]">falar, você vai entender.</span></h2></div><button type="button" onClick={() => setDemo(true)} className="group rounded-lg bg-[#e8a92c] px-5 py-3.5 text-sm font-bold text-[#17344f] transition hover:-translate-y-0.5 hover:bg-[#f0b43b]">Agendar uma conversa <ArrowRight className="ml-2 inline h-4 w-4 transition-transform group-hover:translate-x-1" /></button></div></section>
      <footer className="border-t border-[#d9e5e6] px-5 py-8 sm:px-8"><div className="mx-auto flex max-w-7xl flex-col justify-between gap-5 sm:flex-row sm:items-center"><Mark /><div className="flex flex-wrap gap-5 text-[10px] font-semibold text-[#668391]"><span>© 2024 Beeldings</span><span>Operação com clareza</span><span className="flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5 text-[#078da8]" />Dados sob controle</span></div></div></footer>

      {demo && <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0c2940]/70 p-5 backdrop-blur-sm" role="dialog" aria-modal="true"><div className="w-full max-w-md rounded-2xl border border-[#c8dfe0] bg-[#f7fbfb] p-7 shadow-2xl"><div className="flex items-start justify-between"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#d9f2f2] text-[#078da8]"><Sparkles className="h-5 w-5" /></span><button type="button" onClick={() => setDemo(false)} className="rounded-lg p-2 text-[#668391] hover:bg-[#eaf3f3]" aria-label="Fechar"><X className="h-4 w-4" /></button></div><h3 className="mt-6 text-2xl font-bold tracking-[-.04em] text-[#17344f]">Vamos colocar contexto na sua operação.</h3><p className="mt-3 text-sm leading-6 text-[#668391]">Esta é uma demonstração visual. Em uma conversa real, mostramos como o BlueBee se conecta aos seus sinais e à rotina da sua equipe.</p><label className="mt-6 block text-xs font-bold text-[#31536b]">Seu e-mail corporativo<input className="mt-2 h-11 w-full rounded-lg border border-[#c8dfe0] bg-white px-3 text-sm outline-none focus:border-[#078da8]" placeholder="nome@empresa.com.br" /></label><button type="button" onClick={() => setDemo(false)} className="mt-5 h-11 w-full rounded-lg bg-[#0a8299] text-sm font-bold text-white transition hover:bg-[#096d83]">Continuar a conversa <ArrowRight className="ml-1 inline h-4 w-4" /></button><p className="mt-4 text-center font-mono text-[9px] uppercase tracking-[.14em] text-[#8aa1a8]">sem compromisso · resposta humana</p></div></div>}
    </main>
  );
}