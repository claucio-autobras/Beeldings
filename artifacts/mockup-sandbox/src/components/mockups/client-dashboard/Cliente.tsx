import { useState } from 'react';
import {
  Bell, AlertTriangle, CheckCircle2,
  WifiOff, Activity, Clock,
  ChevronRight, TrendingUp, TrendingDown,
  Camera, Zap, X, Filter, Cpu, MapPin,
  Bell as BellIcon, LayoutDashboard, FileText, LineChart,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

// --- MOCK DATA (fictício — Shopping Vale Sul) ---
const KPI_DATA = {
  action: [
    { id: 'active-alarms', title: 'Alarmes Ativos', value: '15', trend: '+8%', isUp: true, status: 'critical', icon: Bell, spark: [4, 3, 6, 5, 8, 9, 11, 15] },
    { id: 'pending-ack', title: 'Aguard. ACK', value: '6', trend: '-3%', isUp: false, status: 'warning', icon: Clock, spark: [9, 8, 7, 8, 6, 7, 5, 6] },
    { id: 'offline-dev', title: 'Disp. Offline', value: '4', trend: '+1', isUp: true, status: 'warning', icon: WifiOff, spark: [1, 2, 2, 3, 2, 3, 4, 4] },
  ],
  informative: [
    { id: 'iot', title: 'IOT/BMS', value: '412', total: '420', trend: '+0,9%', isUp: true, icon: Activity },
    { id: 'cftv', title: 'Câmeras', value: '78', total: '84', trend: '-1,2%', isUp: false, icon: Camera },
    { id: 'autom', title: 'Automações', value: '12', total: '14', trend: '+2', isUp: true, icon: Zap },
    { id: 'sites', title: 'Sites/Áreas', value: '6', total: '6', trend: '0', isUp: true, icon: MapPin },
  ],
};

const CHART_DATA = [
  { time: '00:00', critical: 1, warning: 2, normal: 5 },
  { time: '04:00', critical: 0, warning: 1, normal: 3 },
  { time: '08:00', critical: 2, warning: 4, normal: 8 },
  { time: '12:00', critical: 4, warning: 6, normal: 14 },
  { time: '16:00', critical: 2, warning: 5, normal: 11 },
  { time: '20:00', critical: 1, warning: 3, normal: 7 },
];

const DEVICES_STATUS = [
  { area: 'Climatização (HVAC)', online: 118, offline: 2, alarm: 3, total: 123 },
  { area: 'Energia / QGBT', online: 64, offline: 0, alarm: 1, total: 65 },
  { area: 'Iluminação', online: 92, offline: 1, alarm: 0, total: 93 },
  { area: 'Elevadores', online: 22, offline: 1, alarm: 2, total: 25 },
  { area: 'Hidráulica / Bombas', online: 38, offline: 0, alarm: 0, total: 38 },
];

const CFTV_ISSUES = [
  { issue: 'Offline (Sem rede)', count: 3, pct: 50 },
  { issue: 'Stream indisponível', count: 2, pct: 33 },
  { issue: 'Erro de Autenticação', count: 1, pct: 17 },
];

const QUICK_ACCESS = [
  { id: 'alarms', label: 'Alarmes', icon: BellIcon, hint: '15 ativos' },
  { id: 'scada', label: 'SCADA', icon: LayoutDashboard, hint: '6 telas' },
  { id: 'reports', label: 'Relatórios', icon: FileText, hint: 'Gerar PDF' },
  { id: 'trends', label: 'Trends', icon: LineChart, hint: 'Histórico' },
];

// --- COMPONENTS ---
const Sparkline = ({ data, color }: { data: number[]; color: string }) => {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const height = 24;
  const width = 60;
  const points = data
    .map((d, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((d - min) / range) * height;
      return `${x},${y}`;
    })
    .join(' ');
  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};

export function Cliente() {
  const [period, setPeriod] = useState('24h');

  return (
    <div className="min-h-screen bg-[#09090b] text-slate-200 p-4 font-sans selection:bg-cyan-900 selection:text-cyan-50 dark">
      <div className="max-w-[1440px] mx-auto space-y-4">

        {/* HEADER */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-slate-800/60">
          <div>
            <h1 className="text-2xl font-semibold text-slate-100 tracking-tight flex items-center gap-2">
              <div className="w-2 h-6 bg-cyan-500 rounded-sm"></div>
              Minha Operação — Shopping Vale Sul
            </h1>
            <p className="text-sm text-slate-400 mt-1">Monitoramento em tempo real • Atualizado agora</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-slate-900/50 p-1 rounded-md border border-slate-800">
              <Button variant="ghost" size="sm" className={`h-7 px-3 text-xs ${period === '24h' ? 'bg-slate-800 text-cyan-400' : 'text-slate-400'}`} onClick={() => setPeriod('24h')}>24h</Button>
              <Button variant="ghost" size="sm" className={`h-7 px-3 text-xs ${period === '7d' ? 'bg-slate-800 text-cyan-400' : 'text-slate-400'}`} onClick={() => setPeriod('7d')}>7d</Button>
              <Button variant="ghost" size="sm" className={`h-7 px-3 text-xs ${period === '30d' ? 'bg-slate-800 text-cyan-400' : 'text-slate-400'}`} onClick={() => setPeriod('30d')}>30d</Button>
            </div>
            <Button size="sm" className="h-9 bg-cyan-600 hover:bg-cyan-500 text-white gap-2">
              <Filter className="w-4 h-4" /> Filtros
            </Button>
          </div>
        </header>

        {/* KPI ROW */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Action KPIs */}
          <div className="lg:col-span-6 grid grid-cols-3 gap-4">
            {KPI_DATA.action.map((kpi) => (
              <Card key={kpi.id} className="bg-slate-900 border-slate-800 overflow-hidden relative group">
                <div className={`absolute top-0 left-0 w-full h-1 ${kpi.status === 'critical' ? 'bg-red-500' : 'bg-orange-500'}`}></div>
                <CardContent className="p-4">
                  <div className="flex justify-between items-start mb-2">
                    <p className="text-sm font-medium text-slate-400">{kpi.title}</p>
                    <div className={`p-1.5 rounded-md ${kpi.status === 'critical' ? 'bg-red-500/10 text-red-400' : 'bg-orange-500/10 text-orange-400'}`}>
                      <kpi.icon className="w-4 h-4" />
                    </div>
                  </div>
                  <div className="flex items-end justify-between">
                    <h3 className="text-3xl font-bold text-slate-100">{kpi.value}</h3>
                    <div className="flex flex-col items-end">
                      <Sparkline data={kpi.spark} color={kpi.status === 'critical' ? '#ef4444' : '#f97316'} />
                      <span className={`text-xs mt-1 flex items-center gap-0.5 ${kpi.isUp ? 'text-red-400' : 'text-emerald-400'}`}>
                        {kpi.isUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                        {kpi.trend}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Informative KPIs */}
          <div className="lg:col-span-6 grid grid-cols-2 md:grid-cols-4 gap-3">
            {KPI_DATA.informative.map((kpi) => (
              <div key={kpi.id} className="bg-slate-900/40 border border-slate-800/60 rounded-xl p-3 flex flex-col justify-between hover:bg-slate-900/60 transition-colors">
                <div className="flex justify-between items-center mb-2">
                  <kpi.icon className="w-4 h-4 text-cyan-500/70" />
                  <span className={`text-[10px] font-semibold flex items-center gap-0.5 ${kpi.isUp ? 'text-emerald-400' : 'text-orange-400'}`}>
                    {kpi.isUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                    {kpi.trend}
                  </span>
                </div>
                <div>
                  <h4 className="text-lg font-semibold text-slate-200">{kpi.value} <span className="text-xs text-slate-500 font-normal">/ {kpi.total}</span></h4>
                  <p className="text-xs text-slate-400 mt-0.5">{kpi.title}</p>
                </div>
                <div className="h-1 mt-3 bg-slate-800 rounded-full overflow-hidden">
                  <div className="h-full bg-cyan-500" style={{ width: `${(parseFloat(kpi.value) / parseFloat(kpi.total)) * 100}%` }}></div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* MAIN GRID */}
        <div className="grid grid-cols-1 lg:grid-cols-3 xl:grid-cols-4 gap-4">

          {/* LEFT/MAIN COLUMN */}
          <div className="lg:col-span-2 xl:col-span-3 space-y-4">

            {/* Alarms Chart & ACK Time */}
            <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
              <Card className="bg-slate-900 border-slate-800 xl:col-span-3">
                <CardHeader className="p-4 pb-0 flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-base text-slate-200">Alarmes ao longo do tempo</CardTitle>
                    <CardDescription className="text-xs text-slate-400">Distribuição por severidade no período selecionado</CardDescription>
                  </div>
                  <Badge variant="outline" className="bg-slate-800/50 border-slate-700 text-slate-300 font-normal">
                    Densidade: Média
                  </Badge>
                </CardHeader>
                <CardContent className="p-4 h-[220px] flex flex-col justify-end relative">
                  <div className="absolute inset-4 top-2 bottom-8 border-b border-l border-slate-800 flex items-end">
                    <div className="absolute w-full h-px bg-slate-800/50 bottom-[33%]"></div>
                    <div className="absolute w-full h-px bg-slate-800/50 bottom-[66%]"></div>
                    <div className="absolute w-full h-px bg-slate-800/50 top-0"></div>

                    <div className="w-full flex justify-between items-end px-2 h-full gap-2">
                      {CHART_DATA.map((d, i) => (
                        <div key={i} className="flex-1 flex flex-col justify-end group relative h-full">
                          <div className="w-full bg-red-500/80 hover:bg-red-400 transition-colors rounded-t-sm" style={{ height: `${(d.critical / 24) * 100}%` }}></div>
                          <div className="w-full bg-orange-500/80 hover:bg-orange-400 transition-colors" style={{ height: `${(d.warning / 24) * 100}%` }}></div>
                          <div className="w-full bg-cyan-600/80 hover:bg-cyan-500 transition-colors rounded-b-sm" style={{ height: `${(d.normal / 24) * 100}%` }}></div>

                          <div className="absolute -top-12 left-1/2 -translate-x-1/2 bg-slate-800 text-xs p-1.5 rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-10 shadow-lg border border-slate-700 whitespace-nowrap">
                            <span className="text-red-400 font-bold">{d.critical}</span> | <span className="text-orange-400 font-bold">{d.warning}</span> | <span className="text-cyan-400 font-bold">{d.normal}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="w-full flex justify-between px-2 text-[10px] text-slate-500 mt-2 ml-4">
                    {CHART_DATA.map(d => <span key={d.time}>{d.time}</span>)}
                  </div>
                </CardContent>
              </Card>

              {/* Avg ACK Time */}
              <Card className="bg-slate-900 border-slate-800 flex flex-col justify-center relative overflow-hidden">
                <div className="absolute -right-6 -top-6 w-24 h-24 bg-cyan-500/10 rounded-full blur-2xl"></div>
                <CardContent className="p-6 text-center">
                  <Clock className="w-8 h-8 text-cyan-500 mx-auto mb-3 opacity-80" />
                  <h3 className="text-4xl font-bold text-slate-100 tracking-tight">9<span className="text-xl text-slate-500 font-medium">m</span> 48<span className="text-xl text-slate-500 font-medium">s</span></h3>
                  <p className="text-sm font-medium text-slate-300 mt-2">Tempo médio até ACK</p>
                  <p className="text-xs text-slate-500 mt-1">Ativação → Reconhecimento</p>
                  <div className="mt-4 inline-flex items-center gap-1.5 bg-emerald-500/10 text-emerald-400 text-xs px-2.5 py-1 rounded-full border border-emerald-500/20">
                    <TrendingDown className="w-3 h-3" /> 1m 12s melhoria
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Device Status */}
            <Card className="bg-slate-900 border-slate-800">
              <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base text-slate-200">Status dos Dispositivos</CardTitle>
                  <CardDescription className="text-xs text-slate-400">Distribuição por tipo/área em tempo real</CardDescription>
                </div>
                <Button variant="ghost" size="sm" className="text-cyan-400 hover:text-cyan-300 h-8 text-xs">
                  Ver todos <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="text-xs text-slate-500 bg-slate-900/50 uppercase border-y border-slate-800">
                      <tr>
                        <th className="px-4 py-3 font-medium">Tipo / Área</th>
                        <th className="px-4 py-3 font-medium w-[240px]">Distribuição</th>
                        <th className="px-4 py-3 font-medium text-center">Online</th>
                        <th className="px-4 py-3 font-medium text-center">Offline</th>
                        <th className="px-4 py-3 font-medium text-center">Alarme</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/50">
                      {DEVICES_STATUS.map((row) => (
                        <tr key={row.area} className="hover:bg-slate-800/30 transition-colors">
                          <td className="px-4 py-3 font-medium text-slate-200 flex items-center gap-2">
                            <Cpu className="w-4 h-4 text-slate-500" />
                            {row.area}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex h-2 w-full rounded-full overflow-hidden bg-slate-800">
                              <div className="h-full bg-emerald-500" style={{ width: `${(row.online / row.total) * 100}%` }}></div>
                              <div className="h-full bg-orange-500" style={{ width: `${(row.alarm / row.total) * 100}%` }}></div>
                              <div className="h-full bg-red-500" style={{ width: `${(row.offline / row.total) * 100}%` }}></div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className="text-xs font-mono text-emerald-400">{row.online}</span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            {row.offline > 0
                              ? <span className="text-xs font-mono text-red-400">{row.offline}</span>
                              : <span className="text-xs font-mono text-slate-600">0</span>}
                          </td>
                          <td className="px-4 py-3 text-center">
                            {row.alarm > 0
                              ? <span className="text-xs font-mono text-orange-400">{row.alarm}</span>
                              : <span className="text-xs font-mono text-slate-600">0</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* CFTV Card */}
              <Card className="bg-slate-900 border-slate-800">
                <CardHeader className="p-4 pb-2">
                  <CardTitle className="text-base text-slate-200 flex items-center justify-between">
                    <span className="flex items-center gap-2"><Camera className="w-4 h-4 text-cyan-500" /> CFTV Status</span>
                    <span className="flex items-center gap-2">
                      <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 font-normal">
                        78/84 online
                      </Badge>
                      <Badge variant="outline" className="bg-red-500/10 text-red-400 border-red-500/20 font-normal">
                        6 c/ problema
                      </Badge>
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  <div className="space-y-3">
                    {CFTV_ISSUES.map((issue, idx) => (
                      <div key={idx} className="flex items-center gap-3">
                        <div className="w-24 text-xs text-slate-400 truncate" title={issue.issue}>{issue.issue}</div>
                        <div className="flex-1 h-2 bg-slate-800 rounded-full overflow-hidden">
                          <div className="h-full bg-slate-500" style={{ width: `${issue.pct}%` }}></div>
                        </div>
                        <div className="w-8 text-right text-xs font-mono text-slate-300">{issue.count}</div>
                      </div>
                    ))}
                  </div>
                  <Button variant="outline" className="w-full mt-4 h-8 text-xs border-slate-700 bg-slate-800/30 hover:bg-slate-800 text-slate-300">
                    Ver Câmeras
                  </Button>
                </CardContent>
              </Card>

              {/* Automations Card */}
              <Card className="bg-slate-900 border-slate-800">
                <CardHeader className="p-4 pb-2">
                  <CardTitle className="text-base text-slate-200 flex items-center gap-2">
                    <Zap className="w-4 h-4 text-cyan-500" /> Automações & Comandos
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  <div className="flex items-center justify-between mb-4 bg-slate-800/30 p-3 rounded-lg border border-slate-800">
                    <div>
                      <p className="text-xs text-slate-400">Taxa de Sucesso (24h)</p>
                      <h4 className="text-2xl font-bold text-emerald-400">99.1%</h4>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-slate-400">Execuções</p>
                      <h4 className="text-xl font-semibold text-slate-200">214</h4>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs p-2 bg-slate-800/50 rounded">
                      <span className="text-slate-300 flex items-center gap-2"><CheckCircle2 className="w-3 h-3 text-emerald-500" /> Modo Noturno — Estacionamento</span>
                      <span className="text-slate-500 font-mono">22:00</span>
                    </div>
                    <div className="flex items-center justify-between text-xs p-2 bg-slate-800/50 rounded">
                      <span className="text-slate-300 flex items-center gap-2"><CheckCircle2 className="w-3 h-3 text-emerald-500" /> Setpoint HVAC — Praça</span>
                      <span className="text-slate-500 font-mono">18:30</span>
                    </div>
                    <div className="flex items-center justify-between text-xs p-2 bg-red-500/10 border border-red-500/20 rounded">
                      <span className="text-red-400 flex items-center gap-2"><X className="w-3 h-3" /> RESET Elevador 03</span>
                      <span className="text-slate-500 font-mono">16:12</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

          </div>

          {/* RIGHT COLUMN */}
          <div className="space-y-4">

            {/* Quick Access */}
            <Card className="bg-slate-900 border-slate-800">
              <CardHeader className="p-4 pb-2 border-b border-slate-800/50">
                <CardTitle className="text-base text-slate-200">Acesso Rápido</CardTitle>
                <CardDescription className="text-xs text-slate-400">Atalhos para as principais telas</CardDescription>
              </CardHeader>
              <CardContent className="p-4">
                <div className="grid grid-cols-2 gap-3">
                  {QUICK_ACCESS.map((item) => (
                    <button
                      key={item.id}
                      className="group flex flex-col items-start gap-3 p-4 rounded-xl bg-slate-800/30 border border-slate-800 hover:border-cyan-500/40 hover:bg-slate-800/60 transition-colors text-left"
                    >
                      <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400 group-hover:bg-cyan-500/20 transition-colors">
                        <item.icon className="w-5 h-5" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-200 group-hover:text-cyan-400 transition-colors">{item.label}</p>
                        <p className="text-[11px] text-slate-500 mt-0.5">{item.hint}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Resumo Operacional */}
            <Card className="bg-slate-900 border-slate-800">
              <CardHeader className="p-4 pb-2 border-b border-slate-800/50">
                <CardTitle className="text-base text-slate-200">Resumo Operacional</CardTitle>
                <CardDescription className="text-xs text-slate-400">Visão geral do período</CardDescription>
              </CardHeader>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between p-3 rounded-lg bg-slate-800/30 border border-slate-800">
                  <span className="text-xs text-slate-400 flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-red-400" /> Alarmes críticos</span>
                  <span className="text-sm font-mono text-slate-200">5</span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg bg-slate-800/30 border border-slate-800">
                  <span className="text-xs text-slate-400 flex items-center gap-2"><Clock className="w-4 h-4 text-orange-400" /> Aguardando ACK</span>
                  <span className="text-sm font-mono text-slate-200">6</span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg bg-slate-800/30 border border-slate-800">
                  <span className="text-xs text-slate-400 flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-400" /> Resolvidos (24h)</span>
                  <span className="text-sm font-mono text-slate-200">32</span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg bg-slate-800/30 border border-slate-800">
                  <span className="text-xs text-slate-400 flex items-center gap-2"><Activity className="w-4 h-4 text-cyan-400" /> Disponibilidade</span>
                  <span className="text-sm font-mono text-emerald-400">99.4%</span>
                </div>
              </CardContent>
            </Card>

          </div>
        </div>
      </div>
    </div>
  );
}
