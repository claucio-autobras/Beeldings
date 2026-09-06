import { useState } from "react";
import {
  Activity,
  ArrowRight,
  Bell,
  Bot,
  Check,
  ChevronDown,
  CircleAlert,
  Clock3,
  Cpu,
  Eye,
  FileText,
  Gauge,
  Layers3,
  Menu,
  Network,
  Play,
  ShieldCheck,
  Sparkles,
  X,
  Zap,
} from "lucide-react";

const nav = [
  ["Como funciona", "#fluxo"],
  ["O que conecta", "#conecta"],
  ["BlueBee", "#bluebee"],
  ["Resultados", "#resultados"],
];

const signals = [
  { label: "Chiller 02", value: "13,8 °C", note: "retorno subindo", color: "amber" },
  { label: "Bomba P-14", value: "62 Hz", note: "vibração estável", color: "cyan" },
  { label: "CFTV · Portaria", value: "online", note: "última imagem há 12s", color: "green" },
];

function Logo({ light = false }: { light?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="relative grid h-9 w-9 place-items-center text-[#20c4d7]">
        <svg viewBox="0 0 40 40" className="absolute inset-0 h-full w-full fill-none">
          <path d="M20 2.5 35.2 11v18L20 37.5 4.8 29V11L20 2.5Z" stroke="currentColor" strokeWidth="1.7" />
          <path d="m20 10 8.5 4.8v10.4L20 30l-8.5-4.8V14.8L20 10Z" fill="currentColor" fillOpacity=".16" stroke="currentColor" />
          <path d="M20 10v20M11.5 14.8 20 20l8.5-5.2" stroke="currentColor" strokeWidth="1.1" />
        </svg>
      </div>
      <span className={`text-[21px] font-semibold tracking-[-.06em] ${light ? "text-white" : "text-[#102d4a]"}`}>
        Beel<span className="text-[#11b4c9]">dings</span>
      </span>
    </div>
  );
}

function SignalCard({ item }: { item: typeof signals[number] }) {
  const tone = item.color === "amber" ? "text-[#d89419] bg-[#fff5df]" : item.color === "green" ? "text-[#16896c] bg-[#e4f8f0]" : "text-[#0b9eb3] bg-[#e3f8fb]";
  return (
    <div className="flex items-center gap-3 border-b border-[#d8e6eb] py-3 last:border-0">
      <span className={`grid h-8 w-8 place-items-center rounded-lg ${tone}`}>
        {item.color === "amber" ? <CircleAlert className="h-4 w-4" /> : item.color === "green" ? <Eye className="h-4 w-4" /> : <Activity className="h-4 w-4" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold text-[#173b55]">{item.label}</p>
        <p className="text-[10px] text-[#718896]">{item.note}</p>
      </div>
      <span className="font-mono text-[11px] font-semibold text-[#173b55]">{item.value}</span>
    </div>
  );
}

export function Proof() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("Interpretar");
  const [sent, setSent] = useState(false);

  const runDemo = () => {
    setDemoOpen(true);
    setSent(false);
  };

  return (
    <main className="min-h-[100dvh] overflow-x-hidden bg-[#f4f8f8] text-[#173b55]" style={{ fontFamily: "var(--font-sans)" }}>
      <style>{`
        .proof-grid { background-image: linear-gradient(rgba(29,104,124,.055) 1px, transparent 1px), linear-gradient(90deg, rgba(29,104,124,.055) 1px, transparent 1px); background-size: 32px 32px; }
        .proof-hex { background-image: linear-gradient(30deg, rgba(17,180,201,.08) 12%, transparent 12.5%, transparent 87%, rgba(17,180,201,.08) 87.5%), linear-gradient(150deg, rgba(17,180,201,.08) 12%, transparent 12.5%, transparent 87%, rgba(17,180,201,.08) 87.5%); background-size: 42px 72px; }
        .proof-reveal { animation: proofReveal .7s ease both; } @keyframes proofReveal { from { opacity:0; transform:translateY(12px) } to { opacity:1; transform:translateY(0) } }
        .proof-pulse { animation: proofPulse 2.6s ease-in-out infinite } @keyframes proofPulse { 0%,100% { opacity:.5 } 50% { opacity:1 } }
      `}</style>

      <header className="relative z-30 border-b border-[#d9e8eb] bg-[#f4f8f8]/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1180px] items-center justify-between px-5 py-4 lg:px-8">
          <a href="#top" aria-label="Beeldings início"><Logo /></a>
          <nav className="hidden items-center gap-7 md:flex">
            {nav.map(([label, href]) => <a key={href} href={href} className="text-[12px] font-semibold text-[#557180] transition hover:text-[#0b9eb3]">{label}</a>)}
          </nav>
          <div className="hidden items-center gap-3 md:flex">
            <span className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[.16em] text-[#16896c]"><span className="proof-pulse h-1.5 w-1.5 rounded-full bg-[#1ab887]" /> operação online</span>
            <button onClick={runDemo} className="rounded-lg bg-[#123b59] px-4 py-2.5 text-[11px] font-bold text-white transition hover:-translate-y-0.5 hover:bg-[#0c607a]">Ver a operação</button>
          </div>
          <button type="button" onClick={() => setMenuOpen((v) => !v)} className="rounded-lg border border-[#d9e8eb] p-2 md:hidden" aria-label="Abrir menu">{menuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}</button>
        </div>
        {menuOpen && <div className="border-t border-[#d9e8eb] px-5 py-4 md:hidden">{nav.map(([label, href]) => <a onClick={() => setMenuOpen(false)} key={href} href={href} className="block border-b border-[#e2edef] py-3 text-sm font-semibold">{label}</a>)}<button onClick={runDemo} className="mt-4 w-full rounded-lg bg-[#123b59] py-3 text-sm font-bold text-white">Ver a operação</button></div>}
      </header>

      <section id="top" className="proof-grid relative overflow-hidden">
        <div className="absolute -right-36 top-20 h-[500px] w-[500px] rounded-full bg-[#a9e6e8]/25 blur-3xl" />
        <div className="mx-auto grid max-w-[1180px] gap-12 px-5 pb-20 pt-16 lg:grid-cols-[.94fr_1.06fr] lg:items-center lg:px-8 lg:pb-28 lg:pt-24">
          <div className="proof-reveal relative">
            <p className="mb-5 flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[.2em] text-[#0b9eb3]"><span className="h-px w-7 bg-[#0b9eb3]" /> inteligência operacional para edifícios</p>
            <h1 className="max-w-[600px] text-[clamp(2.8rem,6vw,5.6rem)] font-semibold leading-[.94] tracking-[-.075em] text-[#123b59]">Menos ruído.<br /><span className="text-[#0babbf]">Mais resposta.</span></h1>
            <p className="mt-7 max-w-[480px] text-[15px] leading-7 text-[#597483]">A Beeldings reúne sinais de campo, alarmes e ativos críticos. O BlueBee interpreta o que está acontecendo e coloca a próxima decisão na sua frente.</p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <button onClick={runDemo} className="group flex items-center gap-2 rounded-lg bg-[#f0a928] px-5 py-3.5 text-[12px] font-bold text-[#173b55] shadow-[0_10px_24px_rgba(208,145,24,.2)] transition hover:-translate-y-0.5 hover:bg-[#ffc052]">Explorar uma situação real <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" /></button>
              <a href="#fluxo" className="flex items-center gap-2 rounded-lg border border-[#c7dce1] bg-[#f4f8f8]/70 px-5 py-3.5 text-[12px] font-bold text-[#315a6d] transition hover:border-[#0babbf]"><Play className="h-3.5 w-3.5 fill-current" /> Como funciona</a>
            </div>
            <div className="mt-10 flex flex-wrap gap-x-7 gap-y-3 border-t border-[#d5e5e8] pt-5">
              {["SCADA + telemetria", "CFTV conectado", "Automação segura"].map((item) => <span key={item} className="flex items-center gap-2 text-[10px] font-semibold text-[#6a828d]"><Check className="h-3.5 w-3.5 text-[#12a886]" />{item}</span>)}
            </div>
          </div>

          <div className="proof-reveal relative delay-150 lg:pl-6">
            <div className="absolute -right-4 -top-8 hidden h-28 w-28 proof-hex opacity-50 lg:block" />
            <div className="relative rounded-2xl border border-[#c5dce1] bg-[#eaf3f3] p-2 shadow-[0_24px_60px_rgba(25,76,98,.12)]">
              <div className="rounded-xl bg-[#103651] p-4 text-white sm:p-5">
                <div className="mb-5 flex items-center justify-between border-b border-white/10 pb-4"><div><p className="font-mono text-[9px] uppercase tracking-[.16em] text-[#73dce2]">Sala de operação</p><p className="mt-1 text-sm font-semibold">Complexo Pátio Norte</p></div><span className="rounded bg-[#1bb88b]/15 px-2 py-1 font-mono text-[9px] text-[#7de3c3]">ao vivo · 06:42</span></div>
                <div className="grid gap-3 sm:grid-cols-[1fr_1.12fr]">
                  <div className="rounded-xl border border-white/10 bg-[#0b2c47] p-4"><div className="flex items-start justify-between"><span className="text-[10px] text-[#96afbb]">Saúde da operação</span><Gauge className="h-4 w-4 text-[#73dce2]" /></div><p className="mt-3 font-mono text-4xl font-bold tracking-[-.08em]">98,7<span className="text-xl">%</span></p><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full w-[88%] rounded-full bg-[#1bb88b]" /></div><p className="mt-2 text-[9px] text-[#7f9ca9]">+1,2% nas últimas 24h</p></div>
                  <div className="rounded-xl border border-white/10 bg-[#0b2c47] p-4"><div className="mb-1 flex items-center gap-2"><Bot className="h-4 w-4 text-[#f0b83d]" /><span className="text-[10px] font-bold text-[#f6cc70]">BlueBee encontrou um padrão</span></div><p className="mt-3 text-[13px] font-semibold leading-5">Queda de vazão no circuito de água gelada.</p><p className="mt-2 text-[10px] leading-4 text-[#99b5c0]">Chiller 02 + bomba P-14 + temperatura de retorno</p><button onClick={runDemo} className="mt-4 flex items-center gap-1 text-[10px] font-bold text-[#73dce2]">Ver análise <ArrowRight className="h-3 w-3" /></button></div>
                </div>
                <div className="mt-3 rounded-xl border border-white/10 bg-[#0b2c47] px-4 py-2.5">{signals.map((item) => <SignalCard key={item.label} item={item} />)}</div>
              </div>
            </div>
            <div className="absolute -bottom-5 -left-4 hidden rounded-xl border border-[#bdd9df] bg-[#f6fbfa] px-4 py-3 shadow-lg sm:flex sm:items-center sm:gap-3"><span className="grid h-8 w-8 place-items-center rounded-lg bg-[#e3f8f1] text-[#16896c]"><ShieldCheck className="h-4 w-4" /></span><div><p className="text-[10px] font-bold text-[#315a6d]">Contexto antes do alarme</p><p className="font-mono text-[9px] text-[#78919b]">3 sinais correlacionados</p></div></div>
          </div>
        </div>
      </section>

      <section id="fluxo" className="mx-auto max-w-[1180px] px-5 py-20 lg:px-8 lg:py-28">
        <div className="max-w-2xl"><p className="font-mono text-[10px] font-bold uppercase tracking-[.2em] text-[#0b9eb3]">Da ocorrência à ação</p><h2 className="mt-4 text-3xl font-semibold tracking-[-.055em] text-[#123b59] sm:text-4xl">Uma operação que explica<br className="hidden sm:block" /> antes de pedir resposta.</h2></div>
        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {[{ n: "01", icon: Network, title: "O sinal chega", text: "Gateways, sensores, câmeras e controladoras enviam a leitura do campo em tempo real." }, { n: "02", icon: Bot, title: "O BlueBee interpreta", text: "Ele cruza histórico, criticidade e sinais próximos para separar evento de causa." }, { n: "03", icon: Zap, title: "A equipe responde", text: "O operador recebe contexto, prioridade e próximo passo — no ritmo da ocorrência." }].map((item, i) => <div key={item.n} className={`relative rounded-xl border border-[#d5e5e8] bg-[#f8fbfb] p-6 ${i === 1 ? "md:-translate-y-4 border-[#8dd9df] shadow-[0_16px_32px_rgba(19,130,148,.1)]" : ""}`}><span className="font-mono text-[10px] text-[#0babbf]">{item.n}</span><item.icon className="mt-8 h-6 w-6 text-[#0b9eb3]" /><h3 className="mt-5 text-lg font-semibold text-[#173b55]">{item.title}</h3><p className="mt-2 text-[12px] leading-6 text-[#69818d]">{item.text}</p>{i === 1 && <span className="absolute right-5 top-5 rounded bg-[#fff3d8] px-2 py-1 font-mono text-[8px] uppercase tracking-wider text-[#b47716]">ponto de virada</span>}</div>)}
        </div>
      </section>

      <section id="bluebee" className="relative overflow-hidden bg-[#123b59] text-white">
        <div className="absolute inset-0 proof-hex opacity-50" />
        <div className="relative mx-auto grid max-w-[1180px] gap-12 px-5 py-20 lg:grid-cols-[.82fr_1.18fr] lg:items-center lg:px-8 lg:py-28">
          <div><div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[.2em] text-[#72dce2]"><Sparkles className="h-3.5 w-3.5" /> o agente da operação</div><h2 className="mt-5 text-4xl font-semibold leading-[.98] tracking-[-.06em] sm:text-5xl">BlueBee não<br />adivinha. <span className="text-[#71dae1]">Investiga.</span></h2><p className="mt-6 max-w-md text-[14px] leading-7 text-[#b0c8d0]">A inteligência da Beeldings foi treinada para conversar com o seu edifício: reconhece padrões, mostra evidências e sugere ações que fazem sentido no contexto.</p><button onClick={runDemo} className="mt-8 flex items-center gap-2 text-[12px] font-bold text-[#f5c65d] transition hover:text-white">Ver BlueBee em ação <ArrowRight className="h-4 w-4" /></button></div>
          <div className="rounded-2xl border border-white/15 bg-[#0c2d48]/80 p-3 shadow-2xl"><div className="rounded-xl bg-[#f4f8f8] p-4 text-[#173b55] sm:p-6"><div className="flex flex-wrap gap-2 border-b border-[#d9e7e9] pb-4">{["Interpretar", "Explicar", "Agir"].map((tab) => <button key={tab} onClick={() => setActiveTab(tab)} className={`rounded-md px-3 py-2 text-[10px] font-bold transition ${activeTab === tab ? "bg-[#123b59] text-white" : "text-[#718896] hover:bg-[#eaf3f3]"}`}>{tab}</button>)}</div><div className="mt-6 flex gap-4"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#e3f8fb] text-[#0b9eb3]"><Bot className="h-5 w-5" /></span><div><p className="text-[11px] font-bold text-[#0b9eb3]">BlueBee · análise concluída</p><h3 className="mt-2 text-base font-semibold">{activeTab === "Interpretar" ? "Há uma causa provável por trás de três alarmes." : activeTab === "Explicar" ? "A temperatura subiu depois da queda de vazão." : "Recomendo verificar a válvula V-14 antes de resetar o chiller."}</h3><p className="mt-3 text-[12px] leading-6 text-[#627d89]">{activeTab === "Interpretar" ? "O sistema correlacionou Chiller 02, bomba P-14 e o retorno do circuito nos últimos 18 minutos." : activeTab === "Explicar" ? "O histórico mostra o mesmo comportamento em 4 ocorrências. O padrão não indica falha do sensor." : "Prioridade alta · impacto potencial em conforto do 2º pavimento · operador pode assumir a ação."}</p><div className="mt-5 flex flex-wrap gap-2"><span className="rounded-md bg-[#e6f5f0] px-2 py-1 font-mono text-[9px] text-[#16896c]">confiança 87%</span><span className="rounded-md bg-[#fff3d8] px-2 py-1 font-mono text-[9px] text-[#b47716]">impacto moderado</span></div></div></div></div></div>
        </div>
      </section>

      <section id="conecta" className="mx-auto max-w-[1180px] px-5 py-20 lg:px-8 lg:py-28"><div className="grid gap-12 lg:grid-cols-[.8fr_1.2fr]"><div><p className="font-mono text-[10px] font-bold uppercase tracking-[.2em] text-[#0b9eb3]">Uma camada sobre o campo</p><h2 className="mt-4 text-3xl font-semibold tracking-[-.05em] text-[#123b59]">Tudo o que a operação já sabe.<br />Finalmente no mesmo lugar.</h2><p className="mt-5 max-w-sm text-[13px] leading-6 text-[#69818d]">A Beeldings conecta a infraestrutura existente sem transformar sua rotina em mais uma tela para acompanhar.</p></div><div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{[{ icon: Activity, t: "SCADA & telemetria" }, { icon: Bell, t: "Alarmes e eventos" }, { icon: Cpu, t: "Ativos críticos" }, { icon: Eye, t: "CFTV e vídeo" }, { icon: FileText, t: "Relatórios vivos" }, { icon: Layers3, t: "Automações" }].map((item) => <div key={item.t} className="group rounded-xl border border-[#d5e5e8] bg-[#f8fbfb] p-5 transition hover:-translate-y-1 hover:border-[#8dd9df] hover:bg-white"><item.icon className="h-5 w-5 text-[#0babbf] transition group-hover:scale-110" /><p className="mt-8 text-[12px] font-bold text-[#315a6d]">{item.t}</p><ChevronDown className="mt-4 h-3.5 w-3.5 text-[#a5bac1]" /></div>)}</div></div></section>

      <section id="resultados" className="border-y border-[#d9e8eb] bg-[#e9f4f3]"><div className="mx-auto max-w-[1180px] px-5 py-20 lg:px-8 lg:py-24"><div className="flex flex-wrap items-end justify-between gap-6"><div><p className="font-mono text-[10px] font-bold uppercase tracking-[.2em] text-[#0b9eb3]">O que muda na prática</p><h2 className="mt-4 text-3xl font-semibold tracking-[-.055em] text-[#123b59]">Controle que aparece<br />na rotina.</h2></div><p className="max-w-xs text-[12px] leading-6 text-[#69818d]">Indicadores de uma operação conectada, com decisões registradas e menos tempo gasto procurando o sinal certo.</p></div><div className="mt-12 grid gap-4 sm:grid-cols-3"><div className="rounded-xl bg-[#123b59] p-6 text-white"><Clock3 className="h-5 w-5 text-[#71dae1]" /><p className="mt-8 font-mono text-4xl font-bold tracking-[-.08em]">14<span className="text-xl"> min</span></p><p className="mt-2 text-[11px] text-[#adc5cd]">tempo médio até reconhecimento</p></div><div className="rounded-xl border border-[#c7dfe2] bg-[#f8fbfb] p-6"><Gauge className="h-5 w-5 text-[#0b9eb3]" /><p className="mt-8 font-mono text-4xl font-bold tracking-[-.08em] text-[#123b59]">99,4<span className="text-xl">%</span></p><p className="mt-2 text-[11px] text-[#69818d]">disponibilidade acompanhada</p></div><div className="rounded-xl border border-[#c7dfe2] bg-[#f8fbfb] p-6"><ShieldCheck className="h-5 w-5 text-[#16896c]" /><p className="mt-8 font-mono text-4xl font-bold tracking-[-.08em] text-[#123b59]">3,2<span className="text-xl">x</span></p><p className="mt-2 text-[11px] text-[#69818d]">mais contexto por ocorrência</p></div></div></div></section>

      <section className="mx-auto max-w-[1180px] px-5 py-20 text-center lg:px-8 lg:py-28"><div className="mx-auto max-w-2xl"><div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[#dff6f5] text-[#0b9eb3]"><Bot className="h-6 w-6" /></div><h2 className="mt-6 text-4xl font-semibold tracking-[-.06em] text-[#123b59] sm:text-5xl">O próximo sinal pode<br /><span className="text-[#0babbf]">ser uma decisão.</span></h2><p className="mx-auto mt-5 max-w-lg text-[14px] leading-7 text-[#69818d]">Veja como a Beeldings e o BlueBee podem dar clareza para a sua operação predial.</p><button onClick={runDemo} className="mt-8 rounded-lg bg-[#123b59] px-6 py-3.5 text-[12px] font-bold text-white transition hover:-translate-y-0.5 hover:bg-[#0c607a]">Agendar uma conversa <ArrowRight className="ml-2 inline h-4 w-4" /></button></div></section>

      <footer className="border-t border-[#d9e8eb] bg-[#eef6f5]"><div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-5 px-5 py-7 lg:px-8"><Logo /><p className="font-mono text-[9px] uppercase tracking-[.15em] text-[#78919b]">inteligência que mantém o edifício em movimento · 2024</p></div></footer>

      {demoOpen && <div className="fixed inset-0 z-50 grid place-items-center bg-[#082337]/70 p-5 backdrop-blur-sm"><div className="w-full max-w-md rounded-2xl border border-[#b8dce0] bg-[#f4f8f8] p-6 shadow-2xl"><div className="flex items-start justify-between"><div><p className="font-mono text-[10px] uppercase tracking-[.18em] text-[#0b9eb3]">prévia demonstrativa</p><h2 className="mt-2 text-2xl font-semibold tracking-[-.04em] text-[#123b59]">Coloque o BlueBee na sua operação.</h2></div><button onClick={() => setDemoOpen(false)} className="rounded-lg p-2 text-[#69818d] hover:bg-[#e3eff0]" aria-label="Fechar"><X className="h-4 w-4" /></button></div>{sent ? <div className="mt-6 rounded-xl border border-[#9bd9c7] bg-[#e4f8f0] p-5 text-center"><Check className="mx-auto h-7 w-7 text-[#16896c]" /><p className="mt-3 text-sm font-bold text-[#176a58]">Solicitação registrada para demonstração.</p><p className="mt-1 text-xs text-[#578276]">Este é um protótipo visual — nenhum dado foi enviado.</p></div> : <form onSubmit={(e) => { e.preventDefault(); setSent(true); }} className="mt-6 space-y-3"><label className="block text-[11px] font-bold text-[#315a6d]">Seu e-mail corporativo<input required type="email" placeholder="voce@empresa.com.br" className="mt-2 h-11 w-full rounded-lg border border-[#c7dfe2] bg-white px-3 text-sm outline-none focus:border-[#0babbf]" /></label><label className="block text-[11px] font-bold text-[#315a6d]">O que você quer enxergar primeiro?<select className="mt-2 h-11 w-full rounded-lg border border-[#c7dfe2] bg-white px-3 text-sm outline-none focus:border-[#0babbf]"><option>Alarmes e ativos críticos</option><option>Telemetria e disponibilidade</option><option>CFTV e segurança</option><option>Relatórios e automações</option></select></label><button className="mt-2 w-full rounded-lg bg-[#f0a928] py-3 text-[12px] font-bold text-[#173b55] transition hover:bg-[#ffc052]">Quero ver a demonstração <ArrowRight className="ml-1 inline h-3.5 w-3.5" /></button></form>}</div></div>}
    </main>
  );
}
