import { useMemo, useState } from "react";
import {
  Activity, AirVent, AlarmSmoke, ArrowDown, ArrowRight, ArrowUp, BarChart3,
  Camera, CheckCircle2, ChevronDown, CircleGauge, Clock3, Flame,
  Gauge, Grid2X2, HardDrive, Lightbulb, Menu, Monitor, Power, Radio,
  Server, Settings2, ShieldCheck, Snowflake, Sun, Thermometer, TriangleAlert,
  Video, Wifi, WifiOff, Wind, X, Zap,
} from "lucide-react";

type Tone = "cyan" | "blue" | "amber" | "red" | "green" | "violet";
type IconType = typeof Activity;

const tone: Record<Tone, { text: string; bg: string; border: string; solid: string }> = {
  cyan: { text: "text-cyan-300", bg: "bg-cyan-400/10", border: "border-cyan-400/25", solid: "bg-cyan-400" },
  blue: { text: "text-blue-300", bg: "bg-blue-400/10", border: "border-blue-400/25", solid: "bg-blue-400" },
  amber: { text: "text-amber-300", bg: "bg-amber-400/10", border: "border-amber-400/25", solid: "bg-amber-400" },
  red: { text: "text-red-300", bg: "bg-red-400/10", border: "border-red-400/25", solid: "bg-red-400" },
  green: { text: "text-emerald-300", bg: "bg-emerald-400/10", border: "border-emerald-400/25", solid: "bg-emerald-400" },
  violet: { text: "text-violet-300", bg: "bg-violet-400/10", border: "border-violet-400/25", solid: "bg-violet-400" },
};

interface Screen { id: string; label: string; icon: IconType; section: string }
interface Client {
  id: string; name: string; site: string; subtitle: string; accent: Tone; screens: Screen[];
}

const CLIENTS: Client[] = [
  {
    id: "comercial", name: "Edifício Comercial", site: "Edifício Comercial",
    subtitle: "Torre Norte • Operação predial", accent: "cyan",
    screens: [
      { id: "lighting", label: "Controle de Iluminação", icon: Lightbulb, section: "Conforto" },
      { id: "garage", label: "Ventilação de Garagem", icon: Wind, section: "Conforto" },
      { id: "blinds", label: "Controle de Persianas", icon: Sun, section: "Conforto" },
      { id: "fire", label: "Central de Incêndio", icon: Flame, section: "Segurança" },
      { id: "access", label: "Saúde SCA", icon: Radio, section: "Segurança" },
      { id: "cctv", label: "CFTV", icon: Video, section: "Segurança" },
    ],
  },
  {
    id: "hospital", name: "Hospital Rede", site: "Hospital A",
    subtitle: "Bloco assistencial • Operação crítica", accent: "blue",
    screens: [
      { id: "cag", label: "CAG — Água Gelada", icon: Snowflake, section: "Climatização" },
      { id: "hospital-fire", label: "Incêndio", icon: Flame, section: "Segurança" },
    ],
  },
  {
    id: "shopping", name: "Shopping", site: "Shopping Vale Sul",
    subtitle: "Centro de operações • 214 lojas", accent: "violet",
    screens: [
      { id: "energy", label: "Medição de Energia", icon: Zap, section: "Energia" },
      { id: "fancoil", label: "Fan Coil", icon: AirVent, section: "Climatização" },
    ],
  },
];

function StatusPill({ label, status = "green", icon: Icon = CheckCircle2 }: { label: string; status?: Tone; icon?: IconType }) {
  const c = tone[status];
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-wider ${c.bg} ${c.border} ${c.text}`}><Icon size={12} />{label}</span>;
}

function Panel({ title, eyebrow, children, className = "", action }: { title: string; eyebrow?: string; children: React.ReactNode; className?: string; action?: React.ReactNode }) {
  return <section className={`rounded-xl border border-white/[.08] bg-[#111a29]/80 shadow-[0_12px_40px_rgba(0,0,0,.16)] ${className}`}>
    <div className="flex items-center justify-between border-b border-white/[.07] px-4 py-3">
      <div><p className="text-[9px] font-bold uppercase tracking-[.18em] text-slate-500">{eyebrow}</p><h2 className="mt-0.5 text-[13px] font-semibold text-slate-100">{title}</h2></div>{action}
    </div>
    <div className="p-4">{children}</div>
  </section>;
}

function Metric({ label, value, unit, icon: Icon = Activity, status = "cyan", note }: { label: string; value: string; unit?: string; icon?: IconType; status?: Tone; note?: string }) {
  const c = tone[status];
  return <div data-scada-widget="kpi-card" className={`rounded-lg border ${c.border} ${c.bg} p-3`}>
    <div className="flex items-center justify-between"><span className="text-[10px] text-slate-400">{label}</span><Icon size={14} className={c.text} /></div>
    <div className="mt-2 flex items-baseline gap-1"><strong className="font-mono text-xl font-semibold text-slate-100">{value}</strong><span className="text-[10px] text-slate-500">{unit}</span></div>
    {note && <p className={`mt-1 text-[10px] ${c.text}`}>{note}</p>}
  </div>;
}

function Chart({ bars = [42, 51, 48, 66, 58, 74, 68, 82, 71, 86, 78, 91], color = "bg-cyan-400" }: { bars?: number[]; color?: string }) {
  return <div data-scada-widget="dash-chart" className="flex h-28 items-end gap-1.5 border-b border-l border-white/[.08] px-3 pb-0 pt-4">
    {bars.map((v, i) => <div key={i} className="group relative flex h-full flex-1 items-end"><div className={`w-full rounded-t-sm ${color} opacity-70 transition-all group-hover:opacity-100`} style={{ height: `${v}%` }} /></div>)}
  </div>;
}

function DemoButton({ children, active = false, toneName = "cyan", onClick }: { children: React.ReactNode; active?: boolean; toneName?: Tone; onClick?: () => void }) {
  const c = tone[toneName];
  return <button onClick={onClick} className={`rounded-md border px-3 py-2 text-[11px] font-medium transition hover:brightness-125 ${active ? `${c.bg} ${c.border} ${c.text}` : "border-white/10 bg-white/[.03] text-slate-300"}`}>{children}</button>;
}

function Equipment({ icon: Icon, name, value, state = "Operando", status = "green" }: { icon: IconType; name: string; value: string; state?: string; status?: Tone }) {
  const c = tone[status];
  return <div data-scada-widget="equipment-card" className="flex items-center gap-3 rounded-lg border border-white/[.07] bg-[#0c1421] p-3"><div className={`rounded-lg p-2.5 ${c.bg}`}><Icon size={20} className={c.text} /></div><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-slate-200">{name}</p><p className="mt-1 font-mono text-xs text-slate-400">{value}</p></div><span className={`flex items-center gap-1 text-[10px] ${c.text}`}><i className={`h-1.5 w-1.5 rounded-full ${c.solid}`} />{state}</span></div>;
}

const asset = (name: string) => `${import.meta.env.BASE_URL}iso/${name}.png`;

function Asset({ name, alt, className = "" }: { name: string; alt: string; className?: string }) {
  return <img src={asset(name)} alt={alt} className={`object-contain drop-shadow-[0_8px_10px_rgba(0,0,0,.35)] ${className}`} />;
}

function TelemetryStamp({ children = "última leitura · 14:42:18" }: { children?: React.ReactNode }) {
  return <p className="mt-2 flex items-center gap-1.5 text-[9px] text-slate-500"><Activity size={11} className="text-cyan-400" />{children}</p>;
}

function PipeWidget({ label, color = "#22d3ee", reverse = false }: { label?: string; color?: string; reverse?: boolean }) {
  return <div data-scada-widget="pipe" className="relative flex min-w-[76px] flex-1 items-center gap-2" aria-label={label ? `Tubulação ${label}` : "Tubulação SCADA"}>
    <div className="h-2 flex-1 rounded-full opacity-80" style={{ background: `repeating-linear-gradient(${reverse ? "270deg" : "90deg"}, ${color} 0 14px, transparent 14px 23px)`, boxShadow: `0 0 14px ${color}55` }} />
    <ArrowRight size={13} className="shrink-0" style={{ color, transform: reverse ? "rotate(180deg)" : undefined }} />
    {label && <span className="absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap text-[9px] font-medium" style={{ color }}>{label}</span>}
  </div>;
}

function StateLegend() {
  return <div className="flex flex-wrap gap-x-4 gap-y-2 text-[10px] text-slate-400">
    <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-emerald-400" />Normal / operando</span>
    <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-amber-400" />Supervisão / atenção</span>
    <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-red-400" />Alarme / offline</span>
  </div>;
}

function Lighting() {
  const [scene, setScene] = useState("Automático");
  return <><div className="grid gap-3 md:grid-cols-4"><Metric label="Circuitos ligados" value="18" unit="/ 24" icon={Lightbulb} note="75% em operação" /><Metric label="Consumo instantâneo" value="42,8" unit="kW" icon={Zap} /><Metric label="Lux médio — térreo" value="386" unit="lux" icon={Sun} /><Metric label="Alarmes" value="01" icon={TriangleAlert} status="amber" note="Corredor L2" /></div>
    <div className="mt-3 grid gap-3 lg:grid-cols-[1.4fr_1fr]"><Panel title="Mapa de circuitos" eyebrow="Pavimento térreo" action={<StatusPill label="18 online" />}><div className="grid grid-cols-3 gap-2 sm:grid-cols-4">{["Recepção","Lobby","Elevadores","Corredor L1","Corredor L2","Copa","Auditório","Garagem"].map((x, i) => <button key={x} onClick={() => setScene(x)} className={`rounded-lg border p-3 text-left transition hover:border-cyan-400/40 ${scene === x ? "border-cyan-400/40 bg-cyan-400/10" : "border-white/[.07] bg-[#0c1421]"}`}><Lightbulb size={16} className={i === 4 ? "text-amber-300" : "text-cyan-300"} /><p className="mt-2 text-[10px] text-slate-300">{x}</p><p className="mt-1 font-mono text-[10px] text-slate-500">{i === 4 ? "falha parcial" : `${68 + i * 4}%`}</p></button>)}</div><div className="mt-3 flex gap-2"><DemoButton active={scene === "Automático"} onClick={() => setScene("Automático")}>Automático</DemoButton><DemoButton active={scene === "Manual"} onClick={() => setScene("Manual")} toneName="amber">Manual (demo)</DemoButton><span className="ml-auto self-center text-[10px] text-slate-500">Cena selecionada: <b className="text-slate-300">{scene}</b></span></div></Panel><Panel title="Carga de iluminação" eyebrow="Últimas 12 horas"><Chart /><div className="mt-2 flex justify-between text-[9px] text-slate-500"><span>06:00</span><span>12:00</span><span>18:00</span><span>Agora</span></div></Panel></div>
  </>;
}

function Garage() {
  return <><div className="grid gap-3 md:grid-cols-4"><Metric label="CO — garagem" value="18" unit="ppm" icon={Wind} status="green" note="Dentro do limite" /><Metric label="Exaustores" value="4 / 4" icon={Activity} status="green" /><Metric label="Fluxo de ar" value="72" unit="%" icon={Gauge} status="cyan" /><Metric label="Comunicação" value="01" icon={WifiOff} status="amber" note="Exaustor E-04" /></div><div className="mt-3 grid gap-3 lg:grid-cols-2"><Panel title="Ventilação por setor" eyebrow="Subsolo 02 · equipamentos fan"><div className="mb-6 flex items-center gap-3 rounded-lg border border-emerald-400/15 bg-emerald-400/5 p-3"><Wind size={18} className="text-emerald-300" /><div className="min-w-0 flex-1"><p className="text-[10px] font-semibold text-slate-200">Fluxo de exaustão</p><p className="text-[9px] text-slate-500">leitura do sensor · 72% nominal</p></div><PipeWidget label="72% · sentido de saída" color="#34d399" /></div><div className="space-y-2">{[["E-01 · Rampa norte","1.840 rpm","green"],["E-02 · Vagas Leste","1.720 rpm","green"],["E-03 · Vagas Oeste","1.680 rpm","green"],["E-04 · Rampa sul","—","amber"]].map(([n,v,s]) => <Equipment key={n} icon={Wind} name={n} value={v} state={s === "amber" ? "Sem comunicação" : "Operando"} status={s as Tone} />)}</div></Panel><Panel title="Qualidade do ar" eyebrow="Sensor card · leituras distribuídas"><Chart bars={[24,28,22,30,35,32,28,39,34,26,24,20]} color="bg-emerald-400" /><div className="mt-3 grid grid-cols-3 gap-2 text-center"><div data-scada-widget="sensor-card"><p className="font-mono text-sm text-slate-100">18</p><p className="text-[9px] text-slate-500">CO ppm</p></div><div data-scada-widget="sensor-card"><p className="font-mono text-sm text-slate-100">20,4</p><p className="text-[9px] text-slate-500">°C</p></div><div data-scada-widget="sensor-card"><p className="font-mono text-sm text-slate-100">48%</p><p className="text-[9px] text-slate-500">umidade</p></div></div></Panel></div></>;
}

function Blinds() {
  const [level, setLevel] = useState(62);
  return <><div className="grid gap-3 md:grid-cols-4"><Metric label="Persianas abertas" value="14" unit="/ 20" icon={Sun} /><Metric label="Incidência solar" value="62" unit="%" icon={Sun} /><Metric label="Modo" value="Auto" icon={Settings2} /><Metric label="Atenção" value="01" icon={TriangleAlert} status="amber" note="Sala 1204" /></div><div className="mt-3 grid gap-3 lg:grid-cols-[1fr_1.2fr]"><Panel title="Controle de fachadas" eyebrow="Torre Norte"><div className="space-y-4">{["Fachada leste","Fachada norte","Fachada oeste"].map((x, i) => <div key={x}><div className="mb-2 flex justify-between text-xs"><span className="text-slate-300">{x}</span><span className="font-mono text-cyan-300">{i === 1 ? 38 : level}%</span></div><div className="h-2 rounded-full bg-slate-800"><div className="h-2 rounded-full bg-cyan-400" style={{ width: `${i === 1 ? 38 : level}%` }} /></div></div>)}</div><div className="flex gap-2 pt-2"><DemoButton onClick={() => setLevel(Math.max(0, level - 10))}><ArrowDown size={13} className="mr-1 inline" /> Fechar 10%</DemoButton><DemoButton onClick={() => setLevel(Math.min(100, level + 10))}><ArrowUp size={13} className="mr-1 inline" /> Abrir 10%</DemoButton></div><p className="mt-3 text-[10px] text-slate-500">Controles em modo demonstração — nenhuma ação real será enviada.</p></Panel><Panel title="Iluminância x posição" eyebrow="Sala 1204 · último dia"><Chart bars={[80,76,64,48,34,28,30,42,60,74,82,88]} color="bg-amber-400" /><div className="mt-3 flex justify-between text-[9px] text-slate-500"><span>06:00</span><span>12:00</span><span>18:00</span></div></Panel></div></>;
}

function Fire({ hospital = false }: { hospital?: boolean }) {
  const zones = hospital
    ? ["UTI — bloco A", "Centro cirúrgico", "Pronto atendimento", "Laboratório"]
    : ["Térreo — recepção", "Garagem S1", "Torre Norte L2", "Cobertura"];
  const nodes = [
    ["smoke-detector", "DF-01", hospital ? "UTI · sala 03" : "Torre Norte · L2", "Normal", "green"],
    ["manual-call-point", "AM-01", hospital ? "Centro cirúrgico" : "Torre Norte · L2", "Supervisão", "amber"],
    ["smoke-detector", "DF-02", hospital ? "Laboratório" : "Garagem S1", "Normal", "green"],
    ["manual-call-point", "AM-02", hospital ? "Pronto atendimento" : "Térreo · recepção", "Normal", "green"],
    ["fire-siren", "SIR-01", hospital ? "Bloco assistencial" : "Torre Norte · L2", hospital ? "Normal" : "Alarme", hospital ? "green" : "red"],
  ] as const;
  const alarm = nodes.some((x) => x[4] === "red");
  return <><div className="grid gap-3 md:grid-cols-4"><Metric label="Estado da central" value={alarm ? "Alarme" : "Atenção"} icon={ShieldCheck} status={alarm ? "red" : "amber"} note={hospital ? "central FP-02" : "central FP-01"} /><Metric label="Laço endereçável" value="01" unit={hospital ? "· 32 pontos" : "· 24 pontos"} icon={Radio} status="cyan" /><Metric label="Dispositivos de campo" value="05" icon={AlarmSmoke} /><Metric label="Pontos em atenção" value={alarm ? "01" : "01"} icon={TriangleAlert} status={alarm ? "red" : "amber"} note={alarm ? "sirene em alarme" : "AM-01 em supervisão"} /></div><div className="mt-3 grid gap-3 xl:grid-cols-[1.35fr_.65fr]"><Panel title="Laço de incêndio" eyebrow={`${hospital ? "Hospital A" : "Edifício Comercial"} · central endereçável`}><div className="rounded-lg border border-red-400/15 bg-[#0b1522] p-4 sm:p-5"><div className="mb-5 flex items-center justify-between gap-3"><div><p className="text-[9px] font-bold uppercase tracking-[.18em] text-red-300">Loop 01 · circuito supervisionado</p><p className="mt-1 text-xs text-slate-400">Central → dispositivos → retorno</p></div><StatusPill label={alarm ? "Alarme ativo" : "Supervisão"} status={alarm ? "red" : "amber"} icon={alarm ? Flame : TriangleAlert} /></div><div className="grid gap-5"><div className="grid items-center gap-3 md:grid-cols-[1fr_.7fr_1fr_.7fr_1fr]"><div className="text-center"><Asset name="fire-panel" alt="Central de incêndio" className="mx-auto h-28 w-24" /><p className="mt-2 text-[11px] font-semibold text-slate-200">FP-{hospital ? "02" : "01"}</p><p className="text-[9px] text-emerald-300">comunicação normal</p></div><PipeWidget label="ida do laço" color="#ef4444" /><div className="rounded-lg border border-white/[.07] bg-[#111d2b] p-3 text-center"><Asset name={nodes[0][0]} alt={nodes[0][1]} className="mx-auto h-14 w-20" /><p className="mt-1 text-[10px] font-semibold text-slate-200">{nodes[0][1]}</p><p className={`text-[9px] ${tone[nodes[0][4]].text}`}>{nodes[0][3]}</p></div><PipeWidget color="#ef4444" /><div className="rounded-lg border border-white/[.07] bg-[#111d2b] p-3 text-center"><Asset name={nodes[1][0]} alt={nodes[1][1]} className="mx-auto h-14 w-20" /><p className="mt-1 text-[10px] font-semibold text-slate-200">{nodes[1][1]}</p><p className={`text-[9px] ${tone[nodes[1][4]].text}`}>{nodes[1][3]}</p></div></div><div className="grid items-center gap-3 md:grid-cols-[1fr_.7fr_1fr_.7fr_1fr]"><div className="rounded-lg border border-white/[.07] bg-[#111d2b] p-3 text-center"><Asset name={nodes[4][0]} alt={nodes[4][1]} className="mx-auto h-14 w-20" /><p className="mt-1 text-[10px] font-semibold text-slate-200">{nodes[4][1]}</p><p className={`text-[9px] ${tone[nodes[4][4]].text}`}>{nodes[4][3]}</p></div><PipeWidget color="#ef4444" reverse /><div className="rounded-lg border border-white/[.07] bg-[#111d2b] p-3 text-center"><Asset name={nodes[2][0]} alt={nodes[2][1]} className="mx-auto h-14 w-20" /><p className="mt-1 text-[10px] font-semibold text-slate-200">{nodes[2][1]}</p><p className={`text-[9px] ${tone[nodes[2][4]].text}`}>{nodes[2][3]}</p></div><PipeWidget color="#ef4444" reverse /><div className="rounded-lg border border-white/[.07] bg-[#111d2b] p-3 text-center"><Asset name={nodes[3][0]} alt={nodes[3][1]} className="mx-auto h-14 w-20" /><p className="mt-1 text-[10px] font-semibold text-slate-200">{nodes[3][1]}</p><p className={`text-[9px] ${tone[nodes[3][4]].text}`}>{nodes[3][3]}</p></div></div><PipeWidget label="retorno à central" color="#ef4444" reverse /></div></div><div className="mt-4 flex flex-wrap items-center justify-between gap-3"><StateLegend /><TelemetryStamp>estado do laço lido às 14:42:18</TelemetryStamp></div></Panel><Panel title="Zonas monitoradas" eyebrow="Distribuição por área"><div className="space-y-2">{zones.map((z, i) => <div key={z} className={`flex items-center gap-3 rounded-lg border p-3 ${i === 1 ? "border-amber-400/30 bg-amber-400/10" : "border-white/[.07] bg-[#0c1421]"}`}><div className={`rounded-full p-2 ${i === 1 ? "bg-amber-400/15 text-amber-300" : "bg-emerald-400/10 text-emerald-300"}`}>{i === 1 ? <TriangleAlert size={16} /> : <CheckCircle2 size={16} />}</div><div className="min-w-0"><p className="truncate text-xs text-slate-200">{z}</p><p className="mt-1 text-[10px] text-slate-500">{i === 1 ? "1 supervisão · inspeção recomendada" : `${hospital ? 8 : 6 + i} pontos normais`}</p></div></div>)}</div><TelemetryStamp>zonas atualizadas às 14:42:18</TelemetryStamp></Panel></div></>;
}

function Access() {
  const controllers = [
    ["AC-01", "Controladora principal", "22,4 °C", "38%", "green"],
    ["AC-02", "Controladora garagem", "23,1 °C", "42%", "green"],
    ["AC-03", "Controladora torre norte", "—", "—", "amber"],
    ["AC-04", "Controladora áreas críticas", "21,8 °C", "36%", "green"],
  ] as const;
  const readers = [
    ["LR-01", "Leitor lobby · latência 42 ms", "Uptime 18d 04h", "green"],
    ["LR-02", "Leitor garagem · latência 48 ms", "Uptime 18d 04h", "green"],
    ["LR-03", "Leitor torre norte · latência —", "Último contato · 14:08", "red"],
    ["LR-04", "Leitor área técnica · latência 51 ms", "Uptime 17d 22h", "green"],
  ] as const;
  return <><div className="grid gap-3 md:grid-cols-4"><Metric label="Controladoras online" value="03" unit="/ 04" icon={Server} status="amber" note="AC-03 sem comunicação" /><Metric label="Leitores monitorados" value="11" unit="/ 12" icon={Radio} /><Metric label="Latência média" value="47" unit="ms" icon={Activity} status="green" /><Metric label="Sem comunicação" value="01" icon={WifiOff} status="red" note="último contato 14:08" /></div><div className="mt-3 grid gap-3 xl:grid-cols-[1.35fr_.65fr]"><Panel title="Saúde das controladoras" eyebrow="SCA · hardware e telemetria"><div className="grid gap-2 sm:grid-cols-2">{controllers.map(([id, place, temp, memory, status]) => <div key={id} className={`rounded-lg border p-3 ${status === "amber" ? "border-amber-400/25 bg-amber-400/10" : "border-white/[.07] bg-[#0c1421]"}`}><div className="flex items-center gap-3"><Asset name="controller" alt={`Controladora ${id}`} className="h-14 w-16" /><div className="min-w-0 flex-1"><p className="text-xs font-semibold text-slate-200">{id}</p><p className="mt-1 truncate text-[10px] text-slate-400">{place}</p></div><StatusPill label={status === "amber" ? "Atenção" : "Online"} status={status} icon={status === "amber" ? TriangleAlert : Wifi} /></div><div className="mt-3 grid grid-cols-3 gap-2 border-t border-white/[.07] pt-2 text-center"><div><p className={`font-mono text-xs ${status === "amber" ? "text-slate-500" : "text-cyan-300"}`}>{temp}</p><p className="text-[9px] text-slate-500">temperatura</p></div><div><p className={`font-mono text-xs ${status === "amber" ? "text-slate-500" : "text-violet-300"}`}>{memory}</p><p className="text-[9px] text-slate-500">memória</p></div><div><p className="font-mono text-xs text-slate-200">{status === "amber" ? "—" : "14:42"}</p><p className="text-[9px] text-slate-500">último contato</p></div></div></div>)}</div><TelemetryStamp>telemetria de hardware lida às 14:42:18</TelemetryStamp></Panel><Panel title="Saúde dos leitores" eyebrow="Pontos de comunicação"><div className="space-y-2">{readers.map(([id, value, uptime, status]) => <div key={id} className={`flex items-center gap-3 rounded-lg border p-3 ${status === "red" ? "border-red-400/25 bg-red-400/10" : "border-white/[.07] bg-[#0c1421]"}`}><Radio size={17} className={tone[status].text} /><span className="min-w-0 flex-1 text-[11px] text-slate-300"><b className="font-semibold">{id}</b><small className="block truncate text-[9px] text-slate-500">{value} · {uptime}</small></span><StatusPill label={status === "red" ? "Offline" : "Online"} status={status} icon={status === "red" ? WifiOff : CheckCircle2} /></div>)}</div><TelemetryStamp>status e disponibilidade dos leitores · 14:42:18</TelemetryStamp></Panel></div><p className="mt-3 text-[10px] text-slate-500">Somente monitoramento de hardware SCA; nenhum cadastro, evento de acesso ou comando operacional é exibido.</p></>;
}

function Cctv() {
  const cameras = [
    ["CAM-01", "Lobby principal", "Online", "14:42:18", "Normal", "camera"],
    ["CAM-02", "Garagem S1 · rampa", "Online", "14:42:16", "Supervisão", "camera"],
    ["CAM-03", "Acesso carga", "Online", "14:42:18", "Normal", "camera"],
    ["CAM-04", "Elevadores", "Online", "14:42:17", "Normal", "camera"],
    ["CAM-05", "Praça de alimentação", "Online", "14:42:11", "Normal", "camera"],
    ["CAM-06", "Perímetro oeste", "Offline", "14:08:04", "Sem comunicação", "camera-dome"],
  ] as const;
  return <><div className="grid gap-3 md:grid-cols-4"><Metric label="Câmeras comunicando" value="78" unit="/ 84" icon={Camera} status="green" note="telemetria ONVIF/SNMP" /><Metric label="Disponibilidade 24h" value="99,1" unit="%" icon={Activity} /><Metric label="Última leitura média" value="14:42" icon={Clock3} status="cyan" /><Metric label="Sem comunicação" value="02" icon={WifiOff} status="red" note="CAM-06 · perímetro" /></div><div className="mt-3 grid gap-3 xl:grid-cols-[1.35fr_.65fr]"><Panel title="Saúde das câmeras" eyebrow="CFTV · hardware monitorado"><div className="grid grid-cols-2 gap-3 md:grid-cols-3">{cameras.map(([id, place, state, lastSeen, signal, model]) => <div key={id} className={`rounded-lg border p-3 ${state === "Offline" ? "border-red-400/30 bg-red-400/10" : signal !== "Normal" ? "border-amber-400/25 bg-amber-400/10" : "border-white/[.07] bg-[#0c1421]"}`}><div className="flex h-24 items-center justify-center rounded-md bg-[#111d2d]"><Asset name={model} alt={`Câmera ${id}`} className="h-full w-32" /></div><div className="mt-2 flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate text-[11px] font-semibold text-slate-200">{id} · {place}</p><p className="mt-1 text-[9px] text-slate-500">último contato · {lastSeen}</p></div><StatusPill label={state} status={state === "Offline" ? "red" : "green"} icon={state === "Offline" ? WifiOff : Wifi} /></div><div className="mt-2 flex items-center gap-2 border-t border-white/[.07] pt-2 text-[9px]"><span className={`h-1.5 w-1.5 rounded-full ${tone[state === "Offline" ? "red" : signal === "Normal" ? "green" : "amber"].solid}`} /><span className={tone[state === "Offline" ? "red" : signal === "Normal" ? "green" : "amber"].text}>{signal}</span><span className="ml-auto text-slate-500">STATUS</span></div></div>)}</div></Panel><Panel title="Equipamentos associados" eyebrow="Disponibilidade e comunicação"><div className="space-y-2"><Equipment icon={Server} name="NVR-01 · gravador" value="Disponibilidade 99,8% · contato 14:42" state="Online" status="green" /><Equipment icon={HardDrive} name="Armazenamento NVR-01" value="86% utilizado · leitura normal" state="Atenção" status="amber" /><Equipment icon={Wifi} name="Gateway CFTV-01" value="Uptime 12d · latência 38 ms" state="Online" status="green" /><TelemetryStamp>última telemetria consolidada · 14:42:18</TelemetryStamp></div></Panel></div><p className="mt-3 text-[10px] text-slate-500">Somente saúde, disponibilidade e comunicação do hardware CFTV; sem vídeo ao vivo, gravação operacional ou controles de câmera.</p></>;
}

function Cag() {
  const [pumpOn, setPumpOn] = useState(true);
  return <><div className="grid gap-3 md:grid-cols-4"><Metric label="Água de ida" value="6,8" unit="°C" icon={Snowflake} status="blue" note="CHW-SUPPLY" /><Metric label="Água de retorno" value="12,4" unit="°C" icon={Thermometer} status="amber" note="CHW-RETURN" /><Metric label="Fluxo total" value={pumpOn ? "184" : "0"} unit="m³/h" icon={Gauge} status={pumpOn ? "cyan" : "amber"} /><Metric label="Disponibilidade" value="98,6" unit="%" icon={Activity} status="green" /></div><div className="mt-3 grid gap-3 xl:grid-cols-[1.35fr_.65fr]"><Panel title="Circuito operacional · CAG" eyebrow="Hospital A · ida e retorno de água gelada"><div className="relative overflow-hidden rounded-lg border border-blue-400/15 bg-[#091522] p-3 sm:p-5"><div className="mb-2 flex items-center justify-between gap-2"><div><p className="text-[9px] font-bold uppercase tracking-[.18em] text-blue-300">CHW-01 · fluxo primário</p><p className="mt-1 text-[10px] text-slate-500">composição baseada em chiller, bomba e pipe</p></div><StatusPill label={pumpOn ? "Circuito em fluxo" : "Bomba parada"} status={pumpOn ? "blue" : "amber"} icon={pumpOn ? Activity : TriangleAlert} /></div><div className="grid gap-5 lg:grid-cols-[1fr_1.2fr_1fr] lg:items-center"><div className="space-y-2 text-center"><Asset name="chiller" alt="Chiller principal" className="mx-auto h-32 w-full max-w-[190px]" /><p className="text-[11px] font-semibold text-slate-200">Chiller CH-01</p><p className="font-mono text-[10px] text-blue-300">6,8 °C · 438 kW</p></div><div className="space-y-10 px-2 pt-4"><PipeWidget label={`ida · ${pumpOn ? "184 m³/h" : "0 m³/h"}`} color="#38bdf8" /><PipeWidget label="retorno · 12,4 °C" color="#fb923c" reverse /></div><div className="space-y-2 text-center"><Asset name="pump" alt="Bomba primária" className="mx-auto h-32 w-full max-w-[190px]" /><p className="text-[11px] font-semibold text-slate-200">Bomba P-01</p><p className={`font-mono text-[10px] ${pumpOn ? "text-emerald-300" : "text-amber-300"}`}>{pumpOn ? "46 Hz · operando" : "0 Hz · standby"}</p></div></div><div className="mt-5 grid gap-2 sm:grid-cols-3"><div data-scada-widget="sensor-card" className="rounded border border-blue-400/20 bg-blue-400/10 p-2 text-center"><p className="text-[9px] text-slate-400">Temperatura ida</p><b className="font-mono text-sm text-blue-300">6,8 °C</b></div><div data-scada-widget="sensor-card" className="rounded border border-orange-400/20 bg-orange-400/10 p-2 text-center"><p className="text-[9px] text-slate-400">Temperatura retorno</p><b className="font-mono text-sm text-orange-300">12,4 °C</b></div><div data-scada-widget="kpi-card" className="rounded border border-emerald-400/20 bg-emerald-400/10 p-2 text-center"><p className="text-[9px] text-slate-400">ΔT disponível</p><b className="font-mono text-sm text-emerald-300">5,6 °C</b></div></div></div><div className="mt-4 flex flex-wrap items-center justify-between gap-2"><StateLegend /><DemoButton active={pumpOn} toneName={pumpOn ? "green" : "amber"} onClick={() => setPumpOn((v) => !v)}>{pumpOn ? "Inspecionar: bomba operando" : "Inspecionar: bomba parada"}</DemoButton></div><p className="mt-2 text-[10px] text-slate-500">Interação demonstrativa: alterna somente o estado visual do circuito, sem enviar comando.</p></Panel><Panel title="Pontos e disponibilidade" eyebrow="Equipamentos e telemetria"><div className="space-y-2"><div data-scada-widget="equipment-card" className="flex items-center gap-3 rounded-lg border border-white/[.07] bg-[#0c1421] p-2"><Asset name="ahu" alt="AHU" className="h-12 w-16" /><span className="flex-1 text-[10px] text-slate-300">AHU-01 · vazão de ar<br /><b className="font-mono font-normal text-slate-500">72% · 22,1 °C</b></span><StatusPill label="Online" status="green" icon={Wifi} /></div><Equipment icon={Activity} name="Bomba secundária P-02" value="— · último valor 14:08" state="Sem comunicação" status="red" /><div data-scada-widget="progress-bar" className="rounded-lg border border-white/[.07] bg-[#0c1421] p-3"><div className="flex justify-between text-[10px] text-slate-400"><span>Disponibilidade 24h</span><b className="font-mono text-emerald-300">98,6%</b></div><div className="mt-2 h-2 rounded-full bg-slate-800"><div className="h-full w-[98.6%] rounded-full bg-emerald-400" /></div></div></div><TelemetryStamp>pontos lidos às 14:42:18 · dados fictícios</TelemetryStamp></Panel></div></>;
}

function Energy() {
  const outlets = [["Régua A · CPD","7,8 kW","normal"],["Régua B · Lojas âncora","12,4 kW","normal"],["Régua C · Praça","8,1 kW","attention"],["Régua D · Cozinha","0,0 kW","offline"]];
  return <><div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6"><Metric label="Energia acumulada" value="184,6" unit="MWh" icon={Zap} /><Metric label="Tensão" value="380,4" unit="V" icon={Power} /><Metric label="Potência ativa" value="42,8" unit="kW" icon={Activity} /><Metric label="Potência reativa" value="8,2" unit="kvar" icon={BarChart3} /><Metric label="Corrente" value="68,4" unit="A" icon={Radio} /><Metric label="Frequência" value="59,98" unit="Hz" icon={CircleGauge} /></div><div className="mt-3 grid gap-3 lg:grid-cols-[1.15fr_1fr]"><Panel title="Tendência de demanda" eyebrow="Entrada geral · QGBT"><Chart bars={[40,44,39,53,61,56,68,73,62,78,72,82]} color="bg-violet-400" /><div className="mt-3 flex justify-between text-[9px] text-slate-500"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>Agora</span></div></Panel><Panel title="Régua inteligente" eyebrow="Estado por tomada" action={<StatusPill label="3 normais" />}><div className="space-y-2">{outlets.map(([n,v,s]) => <div key={n} className={`flex items-center gap-3 rounded-lg border p-2.5 ${s === "offline" ? "border-red-400/25 bg-red-400/5" : s === "attention" ? "border-amber-400/25 bg-amber-400/5" : "border-white/[.07] bg-[#0c1421]"}`}><div className={`h-2 w-2 rounded-full ${s === "offline" ? "bg-red-400" : s === "attention" ? "bg-amber-400" : "bg-emerald-400"}`} /><span className="flex-1 text-[11px] text-slate-300">{n}</span><span className="font-mono text-[11px] text-slate-200">{v}</span><span className={`text-[9px] uppercase ${s === "offline" ? "text-red-300" : s === "attention" ? "text-amber-300" : "text-emerald-300"}`}>{s === "attention" ? "atenção" : s === "offline" ? "sem dados" : "normal"}</span></div>)}</div><p className="mt-3 text-[10px] text-slate-500">Régua ilustrativa composta por cards de ponto + estados de comunicação.</p></Panel></div></>;
}

function FanCoil() {
  const [setpoint, setSetpoint] = useState(22);
  const units = [
    ["FC-01 · Praça norte", "22,4 °C · 58% UR", "Alta · válvula 42%", "green"],
    ["FC-04 · Praça sul", "21,8 °C · 54% UR", "Média · válvula 36%", "green"],
    ["FC-07 · Corredor", "— · último valor 24,1 °C", "Sem comunicação", "amber"],
    ["FC-11 · Acesso leste", "22,1 °C · 56% UR", "Baixa · válvula 18%", "green"],
  ] as const;
  return <><div className="grid gap-3 md:grid-cols-4"><Metric label="Temperatura ambiente" value="22,4" unit="°C" icon={Thermometer} status="green" /><Metric label="Setpoint" value={`${setpoint},0`} unit="°C" icon={CircleGauge} status="violet" /><Metric label="Umidade relativa" value="48" unit="%" icon={Wind} /><Metric label="Fan coils ativos" value="11 / 12" icon={AirVent} status="amber" note="FC-07 em atenção" /></div><div className="mt-3 grid gap-3 xl:grid-cols-[1.25fr_.75fr]"><Panel title="Zona 02 · conforto térmico" eyebrow="Fan Coil · componentes de clima SCADA"><div className="grid gap-4 lg:grid-cols-[.75fr_1.25fr]"><div data-scada-widget="fan-coil" className="rounded-lg border border-cyan-400/15 bg-[#0b1522] p-4"><div className="flex items-center justify-between"><span className="text-[9px] font-bold uppercase tracking-[.18em] text-cyan-300">unidade FC-01</span><StatusPill label="Operando" status="green" icon={Wifi} /></div><div className="flex items-center gap-4 py-5"><div className="rounded-xl border border-cyan-400/20 bg-cyan-400/10 p-4"><AirVent size={42} className="text-cyan-300" /></div><div><p className="text-lg font-semibold text-slate-100">Fan Coil</p><p className="mt-1 text-[10px] text-slate-500">insuflamento · retorno · ambiente</p><p className="mt-3 font-mono text-xs text-cyan-300">22,4 °C ambiente</p></div></div><div className="grid grid-cols-2 gap-2"><div data-scada-widget="sensor-card" className="rounded border border-white/[.07] bg-white/[.03] p-2"><p className="text-[9px] text-slate-500">Insuflamento</p><b className="font-mono text-sm text-blue-300">16,8 °C</b></div><div data-scada-widget="sensor-card" className="rounded border border-white/[.07] bg-white/[.03] p-2"><p className="text-[9px] text-slate-500">Retorno</p><b className="font-mono text-sm text-orange-300">22,9 °C</b></div></div></div><div className="space-y-3"><div data-scada-widget="setpoint-ring" className="flex items-center gap-4 rounded-lg border border-violet-400/20 bg-violet-400/10 p-3"><div className="relative flex h-24 w-24 shrink-0 items-center justify-center rounded-full border-[7px] border-violet-400/20"><div className="absolute inset-0 rounded-full border-[7px] border-transparent border-t-violet-400 border-r-violet-400 -rotate-45" /><div className="text-center"><b className="font-mono text-xl text-slate-100">{setpoint},0°</b><p className="text-[9px] text-slate-500">setpoint</p></div></div><div><p className="text-xs font-semibold text-slate-200">Consigna da zona</p><p className="mt-1 text-[10px] text-slate-500">faixa permitida · 18 a 26 °C</p></div></div><div data-scada-widget="value-stepper" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/[.07] bg-[#0c1421] p-3"><div><p className="text-[10px] text-slate-500">Ajuste demonstrativo</p><p className="font-mono text-sm text-slate-100">{setpoint},0 °C</p></div><div className="flex gap-2"><DemoButton onClick={() => setSetpoint(Math.max(18, setpoint - 0.5))}>− 0,5°</DemoButton><DemoButton onClick={() => setSetpoint(Math.min(26, setpoint + 0.5))}>+ 0,5°</DemoButton></div></div><div data-scada-widget="climate-card" className="grid grid-cols-3 gap-2 rounded-lg border border-white/[.07] bg-[#0c1421] p-3 text-center"><div><p className="text-[9px] text-slate-500">Válvula</p><b className="font-mono text-xs text-cyan-300">42%</b></div><div><p className="text-[9px] text-slate-500">Ventilador</p><b className="font-mono text-xs text-emerald-300">Alta</b></div><div><p className="text-[9px] text-slate-500">Modo</p><b className="font-mono text-xs text-violet-300">Auto</b></div></div></div></div><TelemetryStamp>clima e estado lidos às 14:42:18 · dados fictícios</TelemetryStamp></Panel><Panel title="Unidades da zona" eyebrow="Equipment card · estado por unidade"><div className="space-y-2">{units.map(([name, value, detail, status]) => <div key={name} data-scada-widget="equipment-card"><Equipment icon={AirVent} name={name} value={`${value} · ${detail}`} state={status === "amber" ? "Atenção" : "Operando"} status={status} /></div>)}</div></Panel></div><p className="mt-3 text-[10px] text-slate-500">Controles em modo demonstração: o ajuste visual não envia comandos ao equipamento.</p></>;
}

function ScreenContent({ client, screen }: { client: Client; screen: Screen }) {
  if (screen.id === "lighting") return <Lighting />;
  if (screen.id === "garage") return <Garage />;
  if (screen.id === "blinds") return <Blinds />;
  if (screen.id === "fire") return <Fire />;
  if (screen.id === "hospital-fire") return <Fire hospital />;
  if (screen.id === "access") return <Access />;
  if (screen.id === "cctv") return <Cctv />;
  if (screen.id === "cag") return <Cag />;
  if (screen.id === "energy") return <Energy />;
  if (screen.id === "fancoil") return <FanCoil />;
  return <div className="text-slate-400">Tela {client.name}</div>;
}

export default function ScadaMultiClient() {
  const [clientId, setClientId] = useState("comercial");
  const [screenId, setScreenId] = useState("lighting");
  const [showMap, setShowMap] = useState(false);
  const client = CLIENTS.find((x) => x.id === clientId)!;
  const screen = client.screens.find((x) => x.id === screenId) ?? client.screens[0];
  const accent = tone[client.accent];
  const grouped = useMemo(() => [...new Set(client.screens.map((x) => x.section))], [client]);

  function selectClient(id: string) {
    const next = CLIENTS.find((x) => x.id === id)!;
    setClientId(id); setScreenId(next.screens[0].id);
  }

  return <div className="scada-demo min-h-screen bg-[#080d16] font-sans text-slate-200 selection:bg-cyan-400/20">
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-white/[.08] bg-[#0b1220]/95 px-4 backdrop-blur-xl sm:px-6">
      <div className="flex min-w-0 items-center gap-3"><div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${accent.bg} ${accent.text}`}><Grid2X2 size={19} /></div><div className="min-w-0"><div className="flex items-center gap-2"><span className="text-sm font-bold tracking-tight text-white">BLUEBEE</span><span className="hidden text-[9px] uppercase tracking-[.2em] text-slate-500 sm:inline">SCADA / OPERAÇÃO</span></div><p className="truncate text-[11px] text-slate-400">{client.name} <span className="text-slate-600">·</span> {client.site}</p></div></div>
      <div className="flex items-center gap-2 sm:gap-4"><div className="hidden items-center gap-2 text-[10px] text-emerald-300 sm:flex"><Wifi size={13} /> Sistema online</div><div className="hidden h-5 w-px bg-white/10 sm:block" /><button onClick={() => setShowMap(!showMap)} className="flex items-center gap-2 rounded-md border border-white/10 bg-white/[.03] px-3 py-2 text-[11px] text-slate-300 hover:bg-white/[.08]"><Monitor size={14} /> <span className="hidden sm:inline">Referência SCADA</span></button><div className="flex h-8 w-8 items-center justify-center rounded-full bg-cyan-400/15 text-xs font-bold text-cyan-200">OP</div></div>
    </header>
    <div className="flex min-h-[calc(100vh-4rem)]">
      <aside className="hidden w-64 shrink-0 border-r border-white/[.08] bg-[#0b1321] md:block">
        <div className="border-b border-white/[.07] p-4"><p className="mb-2 text-[9px] font-bold uppercase tracking-[.2em] text-slate-500">Projetos demonstrativos</p><div className="space-y-1">{CLIENTS.map((c) => <button key={c.id} onClick={() => selectClient(c.id)} className={`flex w-full items-center gap-3 rounded-lg p-2.5 text-left transition ${c.id === clientId ? `${tone[c.accent].bg} ${tone[c.accent].text}` : "text-slate-400 hover:bg-white/[.04]"}`}><div className={`h-2 w-2 rounded-full ${tone[c.accent].solid}`} /><span className="text-xs font-medium">{c.name}</span>{c.id === clientId && <ChevronDown size={14} className="ml-auto rotate-[-90deg]" />}</button>)}</div></div>
        <nav className="p-4">{grouped.map((section) => <div key={section} className="mb-5"><p className="mb-2 px-2 text-[9px] font-bold uppercase tracking-[.18em] text-slate-600">{section}</p>{client.screens.filter((x) => x.section === section).map((s) => { const Icon = s.icon; return <button key={s.id} onClick={() => setScreenId(s.id)} className={`mb-1 flex w-full items-center gap-3 rounded-lg border-l-2 px-3 py-2.5 text-left text-[11px] transition ${screen.id === s.id ? `${accent.bg} ${accent.text} border-current` : "border-transparent text-slate-400 hover:bg-white/[.04] hover:text-slate-200"}`}><Icon size={15} />{s.label}</button>; })}</div>)}</nav>
        <div className="absolute bottom-0 w-64 border-t border-white/[.07] p-4"><div className="flex items-center gap-2 text-[10px] text-slate-500"><Activity size={13} className="text-emerald-400" /> Última sincronização <span className="ml-auto font-mono text-slate-400">agora</span></div></div>
      </aside>
      <main className="min-w-0 flex-1 p-4 sm:p-6">
        <div className="mx-auto max-w-[1500px]"><div className="mb-5 flex flex-col justify-between gap-3 lg:flex-row lg:items-end"><div><div className="mb-2 flex items-center gap-2 text-[10px] text-slate-500"><span>SCADA</span><span>/</span><span>{client.name}</span><span>/</span><span className={accent.text}>{screen.section}</span></div><h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">{screen.label}</h1><p className="mt-1 text-xs text-slate-500">{client.site} · {client.subtitle}</p></div><div className="flex items-center gap-2"><button onClick={() => setShowMap(!showMap)} className="flex items-center gap-2 rounded-md border border-white/10 bg-white/[.03] px-3 py-2 text-[11px] text-slate-300 md:hidden"><Menu size={14} /> Telas</button><StatusPill label="Ao vivo · fictício" icon={Radio} /></div></div>
          <div className="mb-4 flex gap-2 overflow-x-auto border-b border-white/[.08] pb-3 md:hidden">{CLIENTS.map((c) => <button key={c.id} onClick={() => selectClient(c.id)} className={`shrink-0 rounded-md px-3 py-2 text-[11px] ${c.id === clientId ? `${tone[c.accent].bg} ${tone[c.accent].text}` : "bg-white/[.03] text-slate-400"}`}>{c.name}</button>)}</div>
          <ScreenContent client={client} screen={screen} />
          <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-white/[.07] pt-4 text-[10px] text-slate-600"><span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />Normal</span><span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-amber-400" />Atenção</span><span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-red-400" />Alarme / sem comunicação</span><span className="ml-auto">Dados fictícios · controles não operacionais</span></div>
        </div>
      </main>
    </div>
    {showMap && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"><div className="max-h-[85vh] w-full max-w-2xl overflow-auto rounded-2xl border border-cyan-400/20 bg-[#101a2a] shadow-2xl"><div className="flex items-start justify-between border-b border-white/[.08] p-5"><div><p className="text-[9px] font-bold uppercase tracking-[.2em] text-cyan-300">Ponte com o SCADA existente</p><h2 className="mt-1 text-lg font-semibold text-white">Vocabulário de replicação</h2><p className="mt-1 text-xs text-slate-400">Cada composição abaixo é formada por tipos já disponíveis na paleta do editor/viewer.</p></div><button onClick={() => setShowMap(false)} className="rounded-md p-2 text-slate-400 hover:bg-white/10" aria-label="Fechar referência"><X size={18} /></button></div><div className="grid gap-2 p-5 sm:grid-cols-2">{[["Navegação","nav-sidebar · nav-toolbar","Sidebar persistente, clientes e rota ativa"],["Equipamentos","chiller · pump · fan-coil · controller · camera","Assets isométricos e estado de comunicação"],["Métricas","kpi-card · numeric-display · gauge","Valores, unidades e limites explícitos"],["Tendências","dash-chart · sensor-card","Leituras históricas e disponibilidade"],["Incêndio","fire-panel · smoke-detector · manual-call-point · fire-siren","Central + laço pipe + dispositivos essenciais"],["Conexões","pipe · line · separator","Fluxos operacionais de água e circuito de incêndio"],["Clima","climate-card · equipment-card · setpoint-ring · value-stepper","Zona, conforto e ajuste demonstrativo"],["Estados","led-status · alarm-indicator · event-feed","Normal, atenção, alarme e sem comunicação"]].map(([a,b,c]) => <div key={a} className="rounded-lg border border-white/[.07] bg-[#0b1321] p-3"><p className="text-xs font-semibold text-slate-200">{a}</p><p className="mt-1 font-mono text-[10px] text-cyan-300">{b}</p><p className="mt-1 text-[10px] text-slate-500">{c}</p></div>)}</div></div></div>}
  </div>;
}