import { useState, type ReactNode } from "react";
import {
  Activity,
  ArrowRight,
  BarChart3,
  Bell,
  Bot,
  Building2,
  Check,
  ChevronDown,
  CircleDot,
  Cloud,
  Cpu,
  Eye,
  Gauge,
  Hexagon,
  Lock,
  Menu,
  Network,
  Play,
  Radio,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  X,
  Zap,
} from "lucide-react";

type IconType = typeof Activity;

const signalRows = [
  { label: "Chiller 02 · temperatura de retorno", value: "12,8 °C", state: "normal", color: "bg-cyan-400" },
  { label: "CFTV · acesso doca norte", value: "movimento detectado", state: "atenção", color: "bg-amber-400" },
  { label: "Gateway BACnet · bloco B", value: "online · 48 ms", state: "normal", color: "bg-emerald-400" },
  { label: "Bomba de recalque 03", value: "vibração acima da média", state: "analisando", color: "bg-amber-400" },
];

const modules: Array<{ icon: IconType; title: string; copy: string; mark: string }> = [
  { icon: Activity, title: "Supervisão SCADA", copy: "Uma visão operacional dos sistemas que mantêm o prédio vivo.", mark: "01" },
  { icon: Radio, title: "Telemetria sem ruído", copy: "Pontos, gateways e protocolos traduzidos para o contexto da equipe.", mark: "02" },
  { icon: Eye, title: "CFTV conectado", copy: "Eventos de vídeo próximos do alarme certo, no momento certo.", mark: "03" },
  { icon: BarChart3, title: "Relatórios que orientam", copy: "Disponibilidade, causas e recorrências prontos para a decisão.", mark: "04" },
];

function Brand({ inverse = false }: { inverse?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className={`relative flex h-9 w-9 items-center justify-center ${inverse ? "text-cyan-300" : "text-[#078ca6]"}`}>
        <Hexagon className="absolute h-9 w-9 stroke-[1.2]" />
        <Hexagon className="absolute h-5 w-5 fill-current/10 stroke-[1.4]" />
        <span className="relative h-1.5 w-1.5 rounded-full bg-amber-400" />
      </span>
      <span className={`text-[22px] font-semibold tracking-[-.06em] ${inverse ? "text-white" : "text-[#102b4a]"}`}>
        Beel<span className="text-[#078ca6]">dings</span>
      </span>
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="mb-5 flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[.2em] text-[#078ca6]"><span className="h-1.5 w-1.5 rounded-full bg-amber-400" />{children}</p>;
}

function BlueBeePanel() {
  const [active, setActive] = useState(0);
  const prompts = [
    "O que exige atenção agora?",
    "Por que a bomba está vibrando?",
    "Prepare um resumo para a gestão",
  ];
  const answers = [
    "O principal ponto é a bomba de recalque 03. A vibração subiu 18% em 40 minutos, mas ainda não há risco de parada. Recomendo validar o acoplamento na próxima ronda e acompanhar a tendência.",
    "A leitura combina vibração crescente e queda de vazão no circuito secundário. A hipótese mais provável é desalinhamento leve ou desgaste do rolamento. Já deixei a evidência organizada para manutenção.",
    "Nas últimas 24 horas, a operação manteve 99,4% de disponibilidade. Houve dois eventos de atenção: acesso na doca norte, resolvido em 6 minutos, e a tendência da bomba 03, ainda em acompanhamento.",
  ];
  return (
    <div className="relative overflow-hidden rounded-[26px] border border-[#287b9a]/35 bg-[#102b4a] shadow-[0_30px_80px_rgba(16,43,74,.22)]">
      <div className="absolute inset-0 opacity-40" style={{ backgroundImage: "linear-gradient(rgba(95,211,226,.11) 1px, transparent 1px), linear-gradient(90deg, rgba(95,211,226,.11) 1px, transparent 1px)", backgroundSize: "29px 29px" }} />
      <div className="relative grid lg:grid-cols-[.8fr_1.2fr]">
        <div className="border-b border-white/10 p-7 lg:border-b-0 lg:border-r lg:p-9">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-400/15 text-cyan-300"><Bot className="h-5 w-5" /></span><div><p className="text-sm font-semibold text-white">BlueBee</p><p className="font-mono text-[9px] uppercase tracking-[.14em] text-cyan-300/70">agente operacional</p></div></div>
            <span className="flex items-center gap-1.5 font-mono text-[9px] uppercase text-emerald-300"><span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />online</span>
          </div>
          <p className="mt-12 max-w-[250px] text-2xl font-medium leading-[1.08] tracking-[-.04em] text-white">Não é mais um painel. É contexto para agir.</p>
          <p className="mt-4 text-sm leading-6 text-slate-300">O BlueBee lê o comportamento do edifício, cruza sinais e entrega uma explicação que a equipe consegue usar.</p>
          <div className="mt-10 space-y-2">
            {prompts.map((prompt, index) => <button key={prompt} type="button" onClick={() => setActive(index)} className={`flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left text-xs transition ${active === index ? "border-cyan-300/40 bg-cyan-300/10 text-cyan-100" : "border-white/10 text-slate-400 hover:border-white/25 hover:text-white"}`}><span className="font-mono text-[9px] text-amber-300">0{index + 1}</span>{prompt}<ArrowRight className="ml-auto h-3.5 w-3.5" /></button>)}
          </div>
        </div>
        <div className="p-7 lg:p-9">
          <div className="flex items-center justify-between border-b border-white/10 pb-4"><span className="font-mono text-[10px] uppercase tracking-[.18em] text-slate-400">leitura de operação · agora</span><span className="rounded-md bg-amber-300/10 px-2 py-1 font-mono text-[9px] text-amber-200">evidência vinculada</span></div>
          <div className="mt-7 flex gap-4"><span className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-300/15 text-amber-300"><Sparkles className="h-4 w-4" /></span><div><p className="text-xs font-semibold text-cyan-200">BlueBee interpreta</p><p className="mt-2 text-[15px] leading-7 text-slate-100">{answers[active]}</p></div></div>
          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            {[["Sinais cruzados", "12", "telemetrias"], ["Confiança", "82%", "na hipótese"], ["Próximo passo", "01", "ação sugerida"]].map(([a, b, c]) => <div key={a} className="rounded-xl border border-white/10 bg-white/[.04] p-3"><p className="text-[10px] text-slate-400">{a}</p><p className="mt-2 font-mono text-xl font-bold text-white">{b}</p><p className="mt-1 text-[10px] text-cyan-200/70">{c}</p></div>)}
          </div>
          <button type="button" onClick={() => setActive((active + 1) % 3)} className="mt-5 flex items-center gap-2 text-xs font-semibold text-cyan-200 transition hover:text-white">Ver outra leitura <ArrowRight className="h-3.5 w-3.5" /></button>
        </div>
      </div>
    </div>
  );
}

function Institutional() {
  const [menu, setMenu] = useState(false);
  const [demo, setDemo] = useState(false);
  return (
    <main className="min-h-[100dvh] overflow-x-hidden bg-[#f3f7f8] font-sans text-[#102b4a]">
      <style>{`
        .institutional-hero { background: radial-gradient(circle at 75% 16%, rgba(41,190,210,.18), transparent 29%), radial-gradient(circle at 14% 82%, rgba(247,181,58,.13), transparent 25%), #102b4a; }
        .institutional-grid { background-image: linear-gradient(rgba(110,214,224,.09) 1px, transparent 1px), linear-gradient(90deg, rgba(110,214,224,.09) 1px, transparent 1px); background-size: 42px 42px; }
        .hex-cut { clip-path: polygon(25% 4%,75% 4%,100% 50%,75% 96%,25% 96%,0 50%); }
        .grain { background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 180 180' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.7' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.035'/%3E%3C/svg%3E"); }
      `}</style>
      <header className="absolute left-0 right-0 top-0 z-30">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8 lg:px-10">
          <Brand inverse />
          <nav className={`${menu ? "absolute left-4 right-4 top-20 flex" : "hidden"} flex-col gap-1 rounded-2xl border border-white/10 bg-[#102b4a] p-3 shadow-xl md:static md:flex md:flex-row md:items-center md:gap-8 md:border-0 md:bg-transparent md:p-0 md:shadow-none`}>
            {["O BlueBee", "Capacidades", "Para quem opera"].map((item, i) => <a key={item} href={["#bluebee", "#capacidades", "#perfis"][i]} onClick={() => setMenu(false)} className="rounded-lg px-3 py-2 text-sm text-slate-300 transition hover:text-cyan-200">{item}</a>)}
            <button type="button" onClick={() => setDemo(true)} className="mt-2 rounded-lg bg-amber-400 px-4 py-2.5 text-xs font-bold text-[#102b4a] transition hover:bg-amber-300 md:mt-0">Agendar conversa <ArrowRight className="ml-1 inline h-3.5 w-3.5" /></button>
          </nav>
          <button type="button" onClick={() => setMenu(!menu)} className="rounded-lg border border-white/15 p-2 text-white md:hidden" aria-label="Abrir menu">{menu ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}</button>
        </div>
      </header>

      <section className="institutional-hero relative min-h-[720px] overflow-hidden text-white">
        <div className="institutional-grid grain absolute inset-0" />
        <div className="absolute -right-32 top-40 h-[500px] w-[500px] rounded-full border border-cyan-300/15" /><div className="absolute -right-10 top-72 h-[290px] w-[290px] rounded-full border border-amber-300/20" />
        <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-5 pb-24 pt-36 sm:px-8 lg:grid-cols-[1.06fr_.94fr] lg:px-10 lg:pt-44">
          <div className="max-w-2xl"><div className="mb-7 inline-flex items-center gap-2 rounded-full border border-cyan-200/20 bg-cyan-200/[.08] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[.17em] text-cyan-200"><span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />inteligência para operações prediais</div><h1 className="text-[clamp(3.4rem,8vw,7rem)] font-medium leading-[.9] tracking-[-.075em]">O prédio<br /><span className="text-cyan-300">fala.</span> A equipe<br /><span className="text-amber-300">entende.</span></h1><p className="mt-8 max-w-lg text-base leading-7 text-slate-300 sm:text-lg">A Beeldings conecta sinais, sistemas e pessoas para que cada decisão operacional aconteça com mais contexto — e menos ruído.</p><div className="mt-9 flex flex-wrap items-center gap-3"><button type="button" onClick={() => setDemo(true)} className="group rounded-xl bg-amber-400 px-5 py-3.5 text-sm font-bold text-[#102b4a] transition hover:bg-amber-300">Conhecer o BlueBee <ArrowRight className="ml-2 inline h-4 w-4 transition group-hover:translate-x-1" /></button><a href="#capacidades" className="rounded-xl border border-white/20 px-5 py-3.5 text-sm font-semibold text-white transition hover:border-cyan-200/60 hover:bg-white/5">Explorar a plataforma</a></div></div>
          <div className="relative hidden min-h-[420px] lg:block"><div className="absolute left-10 top-10 h-[330px] w-[330px] rounded-full border border-cyan-300/20" /><div className="absolute left-28 top-28 h-[210px] w-[210px] rounded-full border border-cyan-300/20" /><div className="absolute left-[185px] top-[183px] flex h-24 w-24 items-center justify-center rounded-full border border-cyan-200/40 bg-cyan-300/15 shadow-[0_0_90px_rgba(90,224,231,.18)]"><Hexagon className="absolute h-24 w-24 text-cyan-200/60" /><Bot className="relative h-8 w-8 text-cyan-100" /></div>{signalRows.map((row, i) => <div key={row.label} className="absolute flex items-center gap-3 rounded-xl border border-white/10 bg-[#163654]/85 px-3 py-2.5 shadow-lg backdrop-blur" style={{ top: `${48 + i * 78}px`, left: i % 2 ? "45%" : "0" }}><span className={`h-2 w-2 rounded-full ${row.color}`} /><div><p className="text-[10px] text-slate-400">{row.label}</p><p className="mt-1 font-mono text-[10px] text-white">{row.value}</p></div></div>)}</div>
        </div>
        <div className="relative border-t border-white/10 bg-[#0d253f]/55 sm:absolute sm:bottom-0 sm:left-0 sm:right-0"><div className="mx-auto grid max-w-7xl grid-cols-2 gap-4 px-5 py-5 sm:grid-cols-4 sm:px-8 lg:px-10">{[["99,4%", "disponibilidade média"], ["8,4 mil", "pontos monitorados"], ["128", "sites conectados"], ["24/7", "contexto operacional"]].map(([a,b]) => <div key={b} className="border-l border-cyan-200/20 pl-4"><p className="font-mono text-lg font-bold text-cyan-100">{a}</p><p className="mt-1 text-[10px] uppercase tracking-[.12em] text-slate-400">{b}</p></div>)}</div></div>
      </section>

      <section id="bluebee" className="mx-auto max-w-7xl px-5 py-24 sm:px-8 lg:px-10 lg:py-32"><div className="grid items-end gap-8 lg:grid-cols-[.75fr_1.25fr]"><div><SectionLabel>O agente que conhece sua operação</SectionLabel><h2 className="max-w-xl text-4xl font-medium leading-[.98] tracking-[-.06em] sm:text-6xl">Menos alerta.<br /><span className="text-[#078ca6]">Mais entendimento.</span></h2></div><p className="max-w-md text-sm leading-7 text-[#4b6378]">BlueBee não responde com frases prontas. Ele acompanha o comportamento dos ativos, entende a rotina do site e ajuda a equipe a separar o urgente do importante.</p></div><div className="mt-12"><BlueBeePanel /></div></section>

      <section id="capacidades" className="border-y border-[#d9e6e8] bg-[#eaf2f3]"><div className="mx-auto max-w-7xl px-5 py-24 sm:px-8 lg:px-10 lg:py-32"><div className="flex flex-wrap items-end justify-between gap-8"><div><SectionLabel>Uma camada sobre a infraestrutura</SectionLabel><h2 className="max-w-2xl text-4xl font-medium leading-[1] tracking-[-.06em] sm:text-5xl">Tudo conectado ao que<br />já faz o prédio funcionar.</h2></div><p className="max-w-sm text-sm leading-7 text-[#4b6378]">Do gateway ao relatório executivo, cada módulo preserva a evidência e revela o próximo passo.</p></div><div className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-[#cbdde0] bg-[#cbdde0] sm:grid-cols-2 lg:grid-cols-4">{modules.map(({ icon: Icon, title, copy, mark }) => <article key={title} className="group bg-[#f3f7f8] p-7 transition hover:bg-[#102b4a] hover:text-white"><div className="flex items-start justify-between"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#d9eef0] text-[#078ca6] transition group-hover:bg-cyan-300/15 group-hover:text-cyan-200"><Icon className="h-5 w-5" /></span><span className="font-mono text-[10px] text-[#8aa3ad] group-hover:text-cyan-200/60">{mark}</span></div><h3 className="mt-16 text-lg font-semibold tracking-[-.03em]">{title}</h3><p className="mt-3 text-sm leading-6 text-[#5e7383] group-hover:text-slate-300">{copy}</p><ArrowRight className="mt-8 h-4 w-4 text-amber-500 transition group-hover:translate-x-1" /></article>)}</div></div></section>

      <section id="perfis" className="mx-auto max-w-7xl px-5 py-24 sm:px-8 lg:px-10 lg:py-32"><div className="grid gap-14 lg:grid-cols-[.8fr_1.2fr]"><div><SectionLabel>Uma mesma operação, três leituras</SectionLabel><h2 className="text-4xl font-medium leading-[.98] tracking-[-.06em] sm:text-5xl">Cada pessoa vê<br /><span className="text-[#078ca6]">o que precisa.</span></h2><p className="mt-6 max-w-sm text-sm leading-7 text-[#4b6378]">A Beeldings aproxima gestão, manutenção e segurança sem criar mais uma ilha de informação.</p></div><div className="space-y-3">{[["Gestão", "Acompanhe disponibilidade, tendência e impacto no negócio.", Gauge], ["Manutenção", "Receba causas prováveis, evidências e o próximo passo sugerido.", WrenchIcon], ["Segurança", "Cruze eventos de CFTV, acesso e alarmes em uma única linha do tempo.", ShieldCheck]].map(([title, copy, Icon]) => <div key={title as string} className="group flex items-center gap-5 rounded-2xl border border-[#d9e6e8] bg-white p-5 transition hover:-translate-y-0.5 hover:border-[#75cbd2] hover:shadow-lg sm:p-6"><span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#e7f4f5] text-[#078ca6]"><Icon className="h-5 w-5" /></span><div><h3 className="font-semibold">{title as string}</h3><p className="mt-1 text-sm leading-6 text-[#5e7383]">{copy as string}</p></div><ArrowRight className="ml-auto hidden h-4 w-4 text-amber-500 group-hover:block" /></div>)}</div></div></section>

      <section className="institutional-hero relative overflow-hidden"><div className="institutional-grid absolute inset-0 opacity-50" /><div className="relative mx-auto flex max-w-7xl flex-col items-start justify-between gap-10 px-5 py-20 sm:px-8 lg:flex-row lg:items-center lg:px-10 lg:py-24"><div><SectionLabel>Pronto para o próximo turno</SectionLabel><h2 className="max-w-2xl text-4xl font-medium leading-[.98] tracking-[-.06em] text-white sm:text-6xl">A operação não<br />precisa esperar.</h2></div><div><p className="max-w-sm text-sm leading-7 text-slate-300">Veja como a Beeldings organiza sinais e decisões para o seu portfólio de edifícios.</p><button type="button" onClick={() => setDemo(true)} className="mt-7 rounded-xl bg-amber-400 px-5 py-3.5 text-sm font-bold text-[#102b4a] transition hover:bg-amber-300">Falar com a Beeldings <ArrowRight className="ml-2 inline h-4 w-4" /></button></div></div></section>

      <footer className="bg-[#0d253f] text-white"><div className="mx-auto flex max-w-7xl flex-col gap-10 px-5 py-10 sm:px-8 lg:flex-row lg:items-center lg:justify-between lg:px-10"><Brand inverse /><div className="flex flex-wrap gap-x-7 gap-y-3 text-xs text-slate-400"><a href="#bluebee" className="transition hover:text-cyan-200">BlueBee</a><a href="#capacidades" className="transition hover:text-cyan-200">Capacidades</a><a href="#perfis" className="transition hover:text-cyan-200">Perfis</a><span className="font-mono text-[10px] text-slate-500">© 2024 Beeldings · sinais que viram decisão</span></div></div></footer>

      {demo && <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#071b2d]/75 p-5 backdrop-blur-sm"><div className="relative w-full max-w-md rounded-2xl border border-[#cbdde0] bg-[#f3f7f8] p-7 shadow-2xl"><button type="button" onClick={() => setDemo(false)} className="absolute right-4 top-4 rounded-lg p-2 text-[#5e7383] hover:bg-[#dfecee]" aria-label="Fechar"><X className="h-4 w-4" /></button><div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#d9eef0] text-[#078ca6]"><Check className="h-5 w-5" /></div><h3 className="mt-6 text-2xl font-medium tracking-[-.04em]">Vamos mostrar a operação por dentro.</h3><p className="mt-3 text-sm leading-6 text-[#5e7383]">Esta é uma demonstração visual. O próximo passo seria conectar seu portfólio de sites e escolher os sinais mais importantes.</p><button type="button" onClick={() => setDemo(false)} className="mt-7 w-full rounded-xl bg-[#078ca6] px-4 py-3 text-sm font-bold text-white transition hover:bg-[#06798f]">Entendi, continuar explorando</button></div></div>}
    </main>
  );
}

function WrenchIcon(props: { className?: string }) {
  return <TerminalSquare {...props} />;
}

export { Institutional };
export default Institutional;