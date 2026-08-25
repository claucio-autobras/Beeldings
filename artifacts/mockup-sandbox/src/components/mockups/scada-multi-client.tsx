import { useMemo, useState } from "react";
import {
  Activity, AirVent, AlarmSmoke, ArrowDown, ArrowUp, BarChart3, Bell,
  Camera, CheckCircle2, ChevronDown, CircleGauge, DoorOpen, Flame,
  Gauge, Grid2X2, Lightbulb, LockKeyhole, Menu, Monitor, Moon,
  Play, Power, Radio, Settings2, ShieldCheck, Snowflake, Sun,
  Thermometer, TriangleAlert, Video, Wifi, WifiOff, Wind, X,
  Zap,
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
      { id: "access", label: "Controle de Acesso", icon: LockKeyhole, section: "Segurança" },
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
  return <div className={`rounded-lg border ${c.border} ${c.bg} p-3`}>
    <div className="flex items-center justify-between"><span className="text-[10px] text-slate-400">{label}</span><Icon size={14} className={c.text} /></div>
    <div className="mt-2 flex items-baseline gap-1"><strong className="font-mono text-xl font-semibold text-slate-100">{value}</strong><span className="text-[10px] text-slate-500">{unit}</span></div>
    {note && <p className={`mt-1 text-[10px] ${c.text}`}>{note}</p>}
  </div>;
}

function Chart({ bars = [42, 51, 48, 66, 58, 74, 68, 82, 71, 86, 78, 91], color = "bg-cyan-400" }: { bars?: number[]; color?: string }) {
  return <div className="flex h-28 items-end gap-1.5 border-b border-l border-white/[.08] px-3 pb-0 pt-4">
    {bars.map((v, i) => <div key={i} className="group relative flex h-full flex-1 items-end"><div className={`w-full rounded-t-sm ${color} opacity-70 transition-all group-hover:opacity-100`} style={{ height: `${v}%` }} /></div>)}
  </div>;
}

function DemoButton({ children, active = false, toneName = "cyan", onClick }: { children: React.ReactNode; active?: boolean; toneName?: Tone; onClick?: () => void }) {
  const c = tone[toneName];
  return <button onClick={onClick} className={`rounded-md border px-3 py-2 text-[11px] font-medium transition hover:brightness-125 ${active ? `${c.bg} ${c.border} ${c.text}` : "border-white/10 bg-white/[.03] text-slate-300"}`}>{children}</button>;
}

function Equipment({ icon: Icon, name, value, state = "Operando", status = "green" }: { icon: IconType; name: string; value: string; state?: string; status?: Tone }) {
  const c = tone[status];
  return <div className="flex items-center gap-3 rounded-lg border border-white/[.07] bg-[#0c1421] p-3"><div className={`rounded-lg p-2.5 ${c.bg}`}><Icon size={20} className={c.text} /></div><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-slate-200">{name}</p><p className="mt-1 font-mono text-xs text-slate-400">{value}</p></div><span className={`flex items-center gap-1 text-[10px] ${c.text}`}><i className={`h-1.5 w-1.5 rounded-full ${c.solid}`} />{state}</span></div>;
}

function Lighting() {
  const [scene, setScene] = useState("Automático");
  return <><div className="grid gap-3 md:grid-cols-4"><Metric label="Circuitos ligados" value="18" unit="/ 24" icon={Lightbulb} note="75% em operação" /><Metric label="Consumo instantâneo" value="42,8" unit="kW" icon={Zap} /><Metric label="Lux médio — térreo" value="386" unit="lux" icon={Sun} /><Metric label="Alarmes" value="01" icon={TriangleAlert} status="amber" note="Corredor L2" /></div>
    <div className="mt-3 grid gap-3 lg:grid-cols-[1.4fr_1fr]"><Panel title="Mapa de circuitos" eyebrow="Pavimento térreo" action={<StatusPill label="18 online" />}><div className="grid grid-cols-3 gap-2 sm:grid-cols-4">{["Recepção","Lobby","Elevadores","Corredor L1","Corredor L2","Copa","Auditório","Garagem"].map((x, i) => <button key={x} onClick={() => setScene(x)} className={`rounded-lg border p-3 text-left transition hover:border-cyan-400/40 ${scene === x ? "border-cyan-400/40 bg-cyan-400/10" : "border-white/[.07] bg-[#0c1421]"}`}><Lightbulb size={16} className={i === 4 ? "text-amber-300" : "text-cyan-300"} /><p className="mt-2 text-[10px] text-slate-300">{x}</p><p className="mt-1 font-mono text-[10px] text-slate-500">{i === 4 ? "falha parcial" : `${68 + i * 4}%`}</p></button>)}</div><div className="mt-3 flex gap-2"><DemoButton active={scene === "Automático"} onClick={() => setScene("Automático")}>Automático</DemoButton><DemoButton active={scene === "Manual"} onClick={() => setScene("Manual")} toneName="amber">Manual (demo)</DemoButton><span className="ml-auto self-center text-[10px] text-slate-500">Cena selecionada: <b className="text-slate-300">{scene}</b></span></div></Panel><Panel title="Carga de iluminação" eyebrow="Últimas 12 horas"><Chart /><div className="mt-2 flex justify-between text-[9px] text-slate-500"><span>06:00</span><span>12:00</span><span>18:00</span><span>Agora</span></div></Panel></div>
  </>;
}

function Garage() {
  return <><div className="grid gap-3 md:grid-cols-4"><Metric label="CO — garagem" value="18" unit="ppm" icon={Wind} note="Dentro do limite" /><Metric label="Exaustores" value="4 / 4" icon={Activity} /><Metric label="Fluxo de ar" value="72" unit="%" icon={Gauge} /><Metric label="Comunicação" value="01" icon={WifiOff} status="amber" note="Exaustor E-04" /></div><div className="mt-3 grid gap-3 lg:grid-cols-2"><Panel title="Ventilação por setor" eyebrow="Subsolo 02"><div className="space-y-2">{[["E-01 · Rampa norte","1.840 rpm","green"],["E-02 · Vagas Leste","1.720 rpm","green"],["E-03 · Vagas Oeste","1.680 rpm","green"],["E-04 · Rampa sul","—","amber"]].map(([n,v,s]) => <Equipment key={n} icon={Wind} name={n} value={v} state={s === "amber" ? "Sem comunicação" : "Operando"} status={s as Tone} />)}</div></Panel><Panel title="Qualidade do ar" eyebrow="Sensores distribuídos"><Chart bars={[24,28,22,30,35,32,28,39,34,26,24,20]} color="bg-emerald-400" /><div className="mt-3 grid grid-cols-3 gap-2 text-center"><div><p className="font-mono text-sm text-slate-100">18</p><p className="text-[9px] text-slate-500">CO ppm</p></div><div><p className="font-mono text-sm text-slate-100">20,4</p><p className="text-[9px] text-slate-500">°C</p></div><div><p className="font-mono text-sm text-slate-100">48%</p><p className="text-[9px] text-slate-500">umidade</p></div></div></Panel></div></>;
}

function Blinds() {
  const [level, setLevel] = useState(62);
  return <><div className="grid gap-3 md:grid-cols-4"><Metric label="Persianas abertas" value="14" unit="/ 20" icon={Sun} /><Metric label="Incidência solar" value="62" unit="%" icon={Sun} /><Metric label="Modo" value="Auto" icon={Settings2} /><Metric label="Atenção" value="01" icon={TriangleAlert} status="amber" note="Sala 1204" /></div><div className="mt-3 grid gap-3 lg:grid-cols-[1fr_1.2fr]"><Panel title="Controle de fachadas" eyebrow="Torre Norte"><div className="space-y-4">{["Fachada leste","Fachada norte","Fachada oeste"].map((x, i) => <div key={x}><div className="mb-2 flex justify-between text-xs"><span className="text-slate-300">{x}</span><span className="font-mono text-cyan-300">{i === 1 ? 38 : level}%</span></div><div className="h-2 rounded-full bg-slate-800"><div className="h-2 rounded-full bg-cyan-400" style={{ width: `${i === 1 ? 38 : level}%` }} /></div></div>)}</div><div className="flex gap-2 pt-2"><DemoButton onClick={() => setLevel(Math.max(0, level - 10))}><ArrowDown size={13} className="mr-1 inline" /> Fechar 10%</DemoButton><DemoButton onClick={() => setLevel(Math.min(100, level + 10))}><ArrowUp size={13} className="mr-1 inline" /> Abrir 10%</DemoButton></div><p className="mt-3 text-[10px] text-slate-500">Controles em modo demonstração — nenhuma ação real será enviada.</p></Panel><Panel title="Iluminância x posição" eyebrow="Sala 1204 · último dia"><Chart bars={[80,76,64,48,34,28,30,42,60,74,82,88]} color="bg-amber-400" /><div className="mt-3 flex justify-between text-[9px] text-slate-500"><span>06:00</span><span>12:00</span><span>18:00</span></div></Panel></div></>;
}

function Fire({ hospital = false }: { hospital?: boolean }) {
  const zones = hospital ? ["UTI — bloco A","Centro cirúrgico","Pronto atendimento","Laboratório","Subsolo técnico","Internação"] : ["Térreo — recepção","Garagem S1","Torre Norte L2","Torre Norte L8","Casa de máquinas","Cobertura"];
  return <><div className="grid gap-3 md:grid-cols-4"><Metric label="Estado da central" value="Normal" icon={ShieldCheck} status="green" /><Metric label="Zonas supervisionadas" value={hospital ? "24" : "18"} icon={Radio} /><Metric label="Detectores ativos" value={hospital ? "286" : "142"} icon={AlarmSmoke} /><Metric label="Atenção" value="01" icon={TriangleAlert} status="amber" note="Detector térmico · L2" /></div><div className="mt-3 grid gap-3 lg:grid-cols-[1.3fr_1fr]"><Panel title="Mapa de zonas" eyebrow="Central endereçável · loop 01"><div className="grid gap-2 sm:grid-cols-2">{zones.map((z, i) => <div key={z} className={`flex items-center gap-3 rounded-lg border p-3 ${i === 2 ? "border-amber-400/30 bg-amber-400/10" : "border-white/[.07] bg-[#0c1421]"}`}><div className={`rounded-full p-2 ${i === 2 ? "bg-amber-400/15 text-amber-300" : "bg-emerald-400/10 text-emerald-300"}`}>{i === 2 ? <TriangleAlert size={16} /> : <CheckCircle2 size={16} />}</div><div><p className="text-xs text-slate-200">{z}</p><p className="mt-1 text-[10px] text-slate-500">{i === 2 ? "1 pré-alarme · requer inspeção" : `${18 + i * 7} pontos normais`}</p></div></div>)}</div></Panel><Panel title="Eventos recentes" eyebrow="Últimos 30 minutos"><div className="space-y-3">{[["14:32","Pré-alarme · detector térmico L2","amber"],["14:18","Supervisão restabelecida · loop 01","green"],["13:56","Teste de sirene concluído","cyan"]].map(([time, text, t]) => <div key={time} className="flex gap-3 text-xs"><span className="font-mono text-slate-500">{time}</span><span className={tone[t as Tone].text}>{text}</span></div>)}</div></Panel></div></>;
}

function Access() {
  return <><div className="grid gap-3 md:grid-cols-4"><Metric label="Acessos hoje" value="1.284" icon={DoorOpen} /><Metric label="Portas online" value="32 / 32" icon={LockKeyhole} /><Metric label="Negados" value="07" icon={TriangleAlert} status="amber" /><Metric label="Controladoras" value="04" icon={Radio} /></div><div className="mt-3 grid gap-3 lg:grid-cols-2"><Panel title="Acessos por área" eyebrow="Fluxo em tempo real"><div className="space-y-3">{[["Lobby principal","428","green"],["Garagem — visitantes","286","cyan"],["Torre Norte — catracas","392","green"],["Áreas restritas","178","amber"]].map(([x,v,t]) => <div key={x} className="flex items-center gap-3"><span className="w-44 text-xs text-slate-300">{x}</span><div className="h-2 flex-1 rounded bg-slate-800"><div className={`h-2 rounded ${tone[t as Tone].solid}`} style={{ width: `${Number(v) / 5}%` }} /></div><span className="w-10 text-right font-mono text-xs text-slate-400">{v}</span></div>)}</div></Panel><Panel title="Últimos eventos" eyebrow="Controladora AC-03"><div className="divide-y divide-white/[.06]">{["14:41  Acesso autorizado · Torre Norte L2","14:39  Acesso negado · porta técnica","14:37  Acesso autorizado · Garagem S1","14:32  Porta mantida aberta · Lobby"].map((x, i) => <div key={x} className={`py-2.5 text-[11px] ${i === 1 || i === 3 ? "text-amber-300" : "text-slate-300"}`}>{x}</div>)}</div></Panel></div></>;
}

function Cctv() {
  return <><div className="grid gap-3 md:grid-cols-4"><Metric label="Câmeras online" value="78" unit="/ 84" icon={Camera} /><Metric label="Gravação" value="99,8" unit="%" icon={Video} /><Metric label="Movimento" value="03" icon={Activity} status="amber" /><Metric label="Sem comunicação" value="02" icon={WifiOff} status="red" /></div><div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-3">{["Lobby principal","Garagem S1","Acesso carga","Elevadores","Praça de alimentação","Perímetro oeste"].map((x, i) => <div key={x} className="relative aspect-video overflow-hidden rounded-lg border border-white/[.08] bg-gradient-to-br from-slate-800 via-slate-900 to-[#0a101b] p-3"><div className="absolute inset-0 opacity-20" style={{ backgroundImage: "linear-gradient(115deg, transparent 45%, #38bdf8 46%, transparent 47%), linear-gradient(25deg, transparent 60%, #64748b 61%, transparent 62%)" }} /><div className="relative flex items-center justify-between"><span className="text-[10px] text-slate-300">{x}</span><span className={`h-1.5 w-1.5 rounded-full ${i === 5 ? "bg-red-400" : "bg-emerald-400"}`} /></div><span className="absolute bottom-3 left-3 font-mono text-[9px] text-slate-500">CAM-{String(i + 1).padStart(2, "0")} · {i === 5 ? "OFFLINE" : "LIVE"}</span></div>)}</div></>;
}

function Cag() {
  return <><div className="grid gap-3 md:grid-cols-4"><Metric label="Água de saída" value="6,8" unit="°C" icon={Snowflake} status="blue" /><Metric label="Água de retorno" value="12,4" unit="°C" icon={Thermometer} /><Metric label="Fluxo total" value="184" unit="m³/h" icon={Gauge} /><Metric label="Disponibilidade" value="98,6" unit="%" icon={Activity} status="green" /></div><div className="mt-3 grid gap-3 lg:grid-cols-[1.2fr_1fr]"><Panel title="Central de água gelada" eyebrow="CAG · Hospital A"><div className="grid gap-2 sm:grid-cols-2">{[["Chiller 01","438 kW · 6,7°C","Operando","green"],["Chiller 02","— · —","Standby","blue"],["Bomba primária 01","46 Hz · 82 m³/h","Operando","green"],["Bomba secundária 02","— · —","Sem comunicação","red"]].map(([n,v,s,t]) => <Equipment key={n} icon={n.includes("Chiller") ? Snowflake : Activity} name={n} value={v} state={s} status={t as Tone} />)}</div><div className="mt-4 rounded-lg border border-blue-400/20 bg-blue-400/5 p-3"><div className="flex justify-between text-[10px] text-slate-400"><span>ΔT do sistema</span><b className="font-mono text-blue-300">5,6 °C</b></div><div className="mt-2 h-1.5 rounded bg-slate-800"><div className="h-full w-[68%] rounded bg-blue-400" /></div></div></Panel><Panel title="Tendência térmica" eyebrow="Últimas 12 horas"><Chart bars={[61,58,60,57,55,52,49,51,48,47,45,46]} color="bg-blue-400" /><div className="mt-3 flex justify-between text-[9px] text-slate-500"><span>06:00</span><span>12:00</span><span>18:00</span><span>Agora</span></div></Panel></div></>;
}

function Energy() {
  const outlets = [["Régua A · CPD","7,8 kW","normal"],["Régua B · Lojas âncora","12,4 kW","normal"],["Régua C · Praça","8,1 kW","attention"],["Régua D · Cozinha","0,0 kW","offline"]];
  return <><div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6"><Metric label="Energia acumulada" value="184,6" unit="MWh" icon={Zap} /><Metric label="Tensão" value="380,4" unit="V" icon={Power} /><Metric label="Potência ativa" value="42,8" unit="kW" icon={Activity} /><Metric label="Potência reativa" value="8,2" unit="kvar" icon={BarChart3} /><Metric label="Corrente" value="68,4" unit="A" icon={Radio} /><Metric label="Frequência" value="59,98" unit="Hz" icon={CircleGauge} /></div><div className="mt-3 grid gap-3 lg:grid-cols-[1.15fr_1fr]"><Panel title="Tendência de demanda" eyebrow="Entrada geral · QGBT"><Chart bars={[40,44,39,53,61,56,68,73,62,78,72,82]} color="bg-violet-400" /><div className="mt-3 flex justify-between text-[9px] text-slate-500"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>Agora</span></div></Panel><Panel title="Régua inteligente" eyebrow="Estado por tomada" action={<StatusPill label="3 normais" />}><div className="space-y-2">{outlets.map(([n,v,s]) => <div key={n} className={`flex items-center gap-3 rounded-lg border p-2.5 ${s === "offline" ? "border-red-400/25 bg-red-400/5" : s === "attention" ? "border-amber-400/25 bg-amber-400/5" : "border-white/[.07] bg-[#0c1421]"}`}><div className={`h-2 w-2 rounded-full ${s === "offline" ? "bg-red-400" : s === "attention" ? "bg-amber-400" : "bg-emerald-400"}`} /><span className="flex-1 text-[11px] text-slate-300">{n}</span><span className="font-mono text-[11px] text-slate-200">{v}</span><span className={`text-[9px] uppercase ${s === "offline" ? "text-red-300" : s === "attention" ? "text-amber-300" : "text-emerald-300"}`}>{s === "attention" ? "atenção" : s === "offline" ? "sem dados" : "normal"}</span></div>)}</div><p className="mt-3 text-[10px] text-slate-500">Régua ilustrativa composta por cards de ponto + estados de comunicação.</p></Panel></div></>;
}

function FanCoil() {
  const [setpoint, setSetpoint] = useState(22);
  return <><div className="grid gap-3 md:grid-cols-4"><Metric label="Temperatura ambiente" value="22,4" unit="°C" icon={Thermometer} status="green" /><Metric label="Setpoint" value={`${setpoint},0`} unit="°C" icon={CircleGauge} /><Metric label="Umidade relativa" value="48" unit="%" icon={Wind} /><Metric label="Fan coils ativos" value="11 / 12" icon={AirVent} status="amber" note="FC-07 em atenção" /></div><div className="mt-3 grid gap-3 lg:grid-cols-[1fr_1.15fr]"><Panel title="Controle de conforto" eyebrow="Praça de alimentação · zona 02"><div className="flex items-center gap-6"><div className="relative flex h-40 w-40 items-center justify-center rounded-full border-[10px] border-violet-400/20"><div className="absolute inset-0 rounded-full border-[10px] border-transparent border-t-violet-400 border-r-violet-400 -rotate-45" /><div className="text-center"><b className="font-mono text-3xl text-slate-100">{setpoint},0°</b><p className="text-[10px] text-slate-500">setpoint</p></div></div><div className="space-y-2"><p className="text-xs text-slate-300">Modo de operação</p><div className="flex gap-2"><DemoButton active>Auto</DemoButton><DemoButton>Manual</DemoButton></div><div className="flex gap-2 pt-2"><DemoButton onClick={() => setSetpoint(Math.max(18, setpoint - 0.5))}>− 0,5°</DemoButton><DemoButton onClick={() => setSetpoint(Math.min(26, setpoint + 0.5))}>+ 0,5°</DemoButton></div><p className="pt-1 text-[10px] text-slate-500">Ajuste demonstrativo sem comando real.</p></div></div></Panel><Panel title="Unidades da zona" eyebrow="Status operacional"><div className="space-y-2">{["FC-01 · Praça norte","FC-04 · Praça sul","FC-07 · Corredor","FC-11 · Acesso leste"].map((x, i) => <Equipment key={x} icon={AirVent} name={x} value={i === 2 ? "— · último valor 24,1°C" : `${setpoint + (i === 0 ? .4 : -.2)}°C · 58%` } state={i === 2 ? "Atenção" : "Operando"} status={i === 2 ? "amber" : "green"} />)}</div></Panel></div></>;
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

  return <div className="min-h-screen bg-[#080d16] font-sans text-slate-200 selection:bg-cyan-400/20">
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
    {showMap && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"><div className="max-h-[85vh] w-full max-w-2xl overflow-auto rounded-2xl border border-cyan-400/20 bg-[#101a2a] shadow-2xl"><div className="flex items-start justify-between border-b border-white/[.08] p-5"><div><p className="text-[9px] font-bold uppercase tracking-[.2em] text-cyan-300">Ponte com o SCADA existente</p><h2 className="mt-1 text-lg font-semibold text-white">Referência de replicação</h2><p className="mt-1 text-xs text-slate-400">Elementos desta apresentação usam padrões já disponíveis no editor/viewer.</p></div><button onClick={() => setShowMap(false)} className="rounded-md p-2 text-slate-400 hover:bg-white/10"><X size={18} /></button></div><div className="grid gap-2 p-5 sm:grid-cols-2">{[["Navegação","nav-sidebar · nav-toolbar","Sidebar persistente e rota ativa"],["Equipamentos","chiller · pump · fan-coil · lighting","Representação operacional com estado"],["Métricas","kpi-card · numeric-display · gauge","Valores, unidades e limites"],["Tendências","dash-chart · sensor-card","Séries temporais demonstrativas"],["Alarmes","alarm-indicator · event-feed","Severidade, atenção e histórico"],["Tabela / régua","point-table · bar-list · cards","Estado por ponto e comunicação"],["Comandos","command-button · slider · toggle","Controles locais, sem envio real"],["Ilustrativo","Mapa de câmeras e planta","Composição visual; sem asset/telemetria real"]].map(([a,b,c]) => <div key={a} className="rounded-lg border border-white/[.07] bg-[#0b1321] p-3"><p className="text-xs font-semibold text-slate-200">{a}</p><p className="mt-1 font-mono text-[10px] text-cyan-300">{b}</p><p className="mt-1 text-[10px] text-slate-500">{c}</p></div>)}</div></div></div>}
  </div>;
}