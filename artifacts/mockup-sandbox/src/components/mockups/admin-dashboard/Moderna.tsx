import React, { useState } from 'react';
import { 
  Bell, AlertTriangle, AlertCircle, CheckCircle2, 
  WifiOff, Activity, Clock, ShieldAlert, 
  Server, Cpu, HardDrive, Download, ChevronRight,
  TrendingUp, TrendingDown, Eye, History, FileText,
  Camera, PlayCircle, Settings2, BarChart3,
  UserCircle, Zap, Shield, Search, Filter, 
  MoreHorizontal, ChevronDown, Check, X
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";

// --- MOCK DATA ---
const KPI_DATA = {
  action: [
    { id: 'active-alarms', title: 'Alarmes Ativos', value: '47', trend: '+12%', isUp: true, status: 'critical', icon: Bell },
    { id: 'pending-ack', title: 'Aguard. ACK', value: '18', trend: '-5%', isUp: false, status: 'warning', icon: Clock },
    { id: 'offline-dev', title: 'Disp. Offline', value: '12', trend: '+2', isUp: true, status: 'warning', icon: WifiOff },
  ],
  informative: [
    { id: 'clients', title: 'Clientes', value: '124', total: '128', trend: '+3', isUp: true, icon: BuildingIcon },
    { id: 'iot', title: 'IOT/BMS', value: '8.4k', total: '8.5k', trend: '+1,2%', isUp: true, icon: Activity },
    { id: 'cftv', title: 'Câmeras', value: '1.2k', total: '1.3k', trend: '-0,8%', isUp: false, icon: Camera },
    { id: 'gateways', title: 'Gateways', value: '142', total: '145', trend: '+2', isUp: true, icon: Server },
  ]
};

function BuildingIcon(props: any) {
  return <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><rect x="4" y="2" width="16" height="20" rx="2" ry="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M12 6h.01"/><path d="M12 10h.01"/><path d="M12 14h.01"/><path d="M16 10h.01"/><path d="M16 14h.01"/><path d="M8 10h.01"/><path d="M8 14h.01"/></svg>;
}

const CHART_DATA = [
  { time: '00:00', critical: 2, warning: 4, normal: 10 },
  { time: '04:00', critical: 1, warning: 3, normal: 8 },
  { time: '08:00', critical: 5, warning: 8, normal: 15 },
  { time: '12:00', critical: 8, warning: 12, normal: 25 },
  { time: '16:00', critical: 4, warning: 9, normal: 20 },
  { time: '20:00', critical: 3, warning: 5, normal: 12 },
];

const GATEWAYS_DATA = [
  { id: 'GW-SP-01', name: 'Gateway Principal SP', status: 'online', cpu: 45, mem: 60, disk: 30, update: 'updated', lastSeen: 'agora' },
  { id: 'GW-RJ-02', name: 'Gateway Edge RJ', status: 'online', cpu: 85, mem: 92, disk: 75, update: 'pending', lastSeen: 'agora' },
  { id: 'GW-MG-01', name: 'Gateway Legado MG', status: 'nodata', cpu: 0, mem: 0, disk: 0, update: 'unknown', lastSeen: 'há 5 min' },
  { id: 'GW-PR-03', name: 'Gateway Secundário PR', status: 'offline', cpu: 0, mem: 0, disk: 0, update: 'unknown', lastSeen: 'há 2 horas' },
];

const CLIENTS_RANKING = [
  { id: 'c1', name: 'Shopping Vale Sul', activeAlarms: 15, offlineDevs: 4, trend: 'up' },
  { id: 'c2', name: 'Hospital Santa Clara', activeAlarms: 12, offlineDevs: 1, trend: 'stable' },
  { id: 'c3', name: 'Autobras S.A.', activeAlarms: 8, offlineDevs: 5, trend: 'down' },
  { id: 'c4', name: 'Condomínio Horizonte', activeAlarms: 5, offlineDevs: 2, trend: 'up' },
];

const CFTV_ISSUES = [
  { issue: 'Offline (Sem rede)', count: 45, pct: 45 },
  { issue: 'Stream indisponível', count: 32, pct: 32 },
  { issue: 'Erro de Autenticação', count: 18, pct: 18 },
  { issue: 'Falha de hardware', count: 5, pct: 5 },
];

const RECENT_ACTIVITY = [
  { id: 1, user: 'João Silva', action: 'Reconheceu 5 alarmes', target: 'Hospital Santa Clara', time: 'Há 2 min' },
  { id: 2, user: 'Maria Costa', action: 'Forçou comando (RESET)', target: 'Chiller 02 - Autobras', time: 'Há 15 min' },
  { id: 3, user: 'Sistema', action: 'Automação disparada: Night Mode', target: 'Shopping Vale Sul', time: 'Há 45 min' },
  { id: 4, user: 'Admin', action: 'Atualizou firmware do Gateway', target: 'GW-SP-01', time: 'Há 1 hora' },
];

// --- COMPONENTS ---

const Sparkline = ({ data, color }: { data: number[], color: string }) => {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const height = 24;
  const width = 60;
  
  const points = data.map((d, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((d - min) / range) * height;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};

export function Moderna() {
  const [period, setPeriod] = useState('24h');

  return (
    <div className="min-h-screen bg-[#09090b] text-slate-200 p-4 font-sans selection:bg-cyan-900 selection:text-cyan-50 dark">
      <div className="max-w-[1440px] mx-auto space-y-4">
        
        {/* HEADER */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-slate-800/60">
          <div>
            <h1 className="text-2xl font-semibold text-slate-100 tracking-tight flex items-center gap-2">
              <div className="w-2 h-6 bg-cyan-500 rounded-sm"></div>
              Visão global — Todos os Sites
            </h1>
            <p className="text-sm text-slate-400 mt-1">Centro de Operações BlueBee (NOC) • Atualizado agora</p>
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
              <Card key={kpi.id} className={`bg-slate-900 border-slate-800 overflow-hidden relative group`}>
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
                      <Sparkline data={[4,3,5,8,6,7,9,kpi.value === '47' ? 12 : 8]} color={kpi.status === 'critical' ? '#ef4444' : '#f97316'} />
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
                  <div className="h-full bg-cyan-500" style={{ width: `${(parseFloat(kpi.value.replace('k',''))/parseFloat(kpi.total.replace('k','')))*100}%` }}></div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* MAIN GRID */}
        <div className="grid grid-cols-1 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          
          {/* LEFT/MAIN COLUMN (Charts & Gateways) */}
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
                    Densidade: Alta
                  </Badge>
                </CardHeader>
                <CardContent className="p-4 h-[220px] flex flex-col justify-end relative">
                  {/* Mock Chart Area */}
                  <div className="absolute inset-4 top-2 bottom-8 border-b border-l border-slate-800 flex items-end">
                    {/* Grid lines */}
                    <div className="absolute w-full h-px bg-slate-800/50 bottom-[33%]"></div>
                    <div className="absolute w-full h-px bg-slate-800/50 bottom-[66%]"></div>
                    <div className="absolute w-full h-px bg-slate-800/50 top-0"></div>
                    
                    {/* Bars */}
                    <div className="w-full flex justify-between items-end px-2 h-full gap-2">
                      {CHART_DATA.map((d, i) => (
                        <div key={i} className="flex-1 flex flex-col justify-end group relative h-full">
                          <div className="w-full bg-red-500/80 hover:bg-red-400 transition-colors rounded-t-sm" style={{ height: `${(d.critical/25)*100}%` }}></div>
                          <div className="w-full bg-orange-500/80 hover:bg-orange-400 transition-colors" style={{ height: `${(d.warning/25)*100}%` }}></div>
                          <div className="w-full bg-cyan-600/80 hover:bg-cyan-500 transition-colors rounded-b-sm" style={{ height: `${(d.normal/25)*100}%` }}></div>
                          
                          {/* Tooltip mockup */}
                          <div className="absolute -top-12 left-1/2 -translate-x-1/2 bg-slate-800 text-xs p-1.5 rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-10 shadow-lg border border-slate-700 whitespace-nowrap">
                            <span className="text-red-400 font-bold">{d.critical}</span> | <span className="text-orange-400 font-bold">{d.warning}</span> | <span className="text-cyan-400 font-bold">{d.normal}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  {/* X Axis labels */}
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
                  <h3 className="text-4xl font-bold text-slate-100 tracking-tight">14<span className="text-xl text-slate-500 font-medium">m</span> 32<span className="text-xl text-slate-500 font-medium">s</span></h3>
                  <p className="text-sm font-medium text-slate-300 mt-2">Tempo médio até ACK</p>
                  <p className="text-xs text-slate-500 mt-1">Ativação → Reconhecimento</p>
                  <div className="mt-4 inline-flex items-center gap-1.5 bg-emerald-500/10 text-emerald-400 text-xs px-2.5 py-1 rounded-full border border-emerald-500/20">
                    <TrendingDown className="w-3 h-3" /> 2m 15s melhoria
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Gateways Health */}
            <Card className="bg-slate-900 border-slate-800">
              <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base text-slate-200">Saúde dos Gateways</CardTitle>
                  <CardDescription className="text-xs text-slate-400">Recursos e status de conectividade em tempo real</CardDescription>
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
                        <th className="px-4 py-3 font-medium">Gateway</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                        <th className="px-4 py-3 font-medium w-[200px]">CPU / Memória / Disco</th>
                        <th className="px-4 py-3 font-medium">Versão</th>
                        <th className="px-4 py-3 font-medium text-right">Último contato</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/50">
                      {GATEWAYS_DATA.map((gw) => (
                        <tr key={gw.id} className="hover:bg-slate-800/30 transition-colors">
                          <td className="px-4 py-3 font-medium text-slate-200 flex items-center gap-2">
                            <Server className="w-4 h-4 text-slate-500" />
                            {gw.name}
                          </td>
                          <td className="px-4 py-3">
                            {gw.status === 'online' && <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20 shadow-none"><CheckCircle2 className="w-3 h-3 mr-1"/> Online</Badge>}
                            {gw.status === 'offline' && <Badge className="bg-red-500/10 text-red-400 border-red-500/20 hover:bg-red-500/20 shadow-none"><AlertTriangle className="w-3 h-3 mr-1"/> Offline</Badge>}
                            {gw.status === 'nodata' && <Badge className="bg-slate-700/50 text-slate-400 border-slate-600/50 hover:bg-slate-700 shadow-none"><Clock className="w-3 h-3 mr-1"/> Sem Dados</Badge>}
                          </td>
                          <td className="px-4 py-3">
                            {gw.status === 'online' ? (
                              <div className="flex flex-col gap-1.5 w-full">
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] w-8 text-slate-500 font-mono">CPU</span>
                                  <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                                    <div className={`h-full ${gw.cpu > 80 ? 'bg-orange-500' : 'bg-cyan-500'}`} style={{ width: `${gw.cpu}%` }}></div>
                                  </div>
                                  <span className="text-[10px] w-6 text-right text-slate-400">{gw.cpu}%</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] w-8 text-slate-500 font-mono">MEM</span>
                                  <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                                    <div className={`h-full ${gw.mem > 85 ? 'bg-red-500' : 'bg-cyan-500'}`} style={{ width: `${gw.mem}%` }}></div>
                                  </div>
                                  <span className="text-[10px] w-6 text-right text-slate-400">{gw.mem}%</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] w-8 text-slate-500 font-mono">DISCO</span>
                                  <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                                    <div className={`h-full ${gw.disk > 85 ? 'bg-red-500' : 'bg-cyan-500'}`} style={{ width: `${gw.disk}%` }}></div>
                                  </div>
                                  <span className="text-[10px] w-6 text-right text-slate-400">{gw.disk}%</span>
                                </div>
                              </div>
                            ) : (
                              <span className="text-xs text-slate-600 italic">Métricas indisponíveis</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {gw.update === 'updated' && <span className="text-xs text-slate-400 flex items-center gap-1"><Check className="w-3 h-3 text-emerald-500"/> Atualizado</span>}
                            {gw.update === 'pending' && <span className="text-xs text-orange-400 flex items-center gap-1 cursor-pointer hover:underline"><Download className="w-3 h-3"/> V2.4 Disp.</span>}
                            {gw.update === 'unknown' && <span className="text-xs text-slate-600">-</span>}
                          </td>
                          <td className="px-4 py-3 text-right text-xs text-slate-400">{gw.lastSeen}</td>
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
                    <span className="flex items-center gap-2"><Camera className="w-4 h-4 text-cyan-500"/> CFTV Status</span>
                    <span className="flex items-center gap-2">
                      <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 font-normal">
                        1.200/1.300 online
                      </Badge>
                      <Badge variant="outline" className="bg-red-500/10 text-red-400 border-red-500/20 font-normal">
                        100 c/ problema
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
                    Gerenciar Câmeras
                  </Button>
                </CardContent>
              </Card>

              {/* Automations Card */}
              <Card className="bg-slate-900 border-slate-800">
                <CardHeader className="p-4 pb-2">
                  <CardTitle className="text-base text-slate-200 flex items-center gap-2">
                    <Zap className="w-4 h-4 text-cyan-500"/> Automações & Comandos
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  <div className="flex items-center justify-between mb-4 bg-slate-800/30 p-3 rounded-lg border border-slate-800">
                    <div>
                      <p className="text-xs text-slate-400">Taxa de Sucesso (24h)</p>
                      <h4 className="text-2xl font-bold text-emerald-400">98.5%</h4>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-slate-400">Execuções</p>
                      <h4 className="text-xl font-semibold text-slate-200">1,240</h4>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs p-2 bg-slate-800/50 rounded">
                      <span className="text-slate-300 flex items-center gap-2"><CheckCircle2 className="w-3 h-3 text-emerald-500"/> RESET Chiller 01</span>
                      <span className="text-slate-500 font-mono">14:02</span>
                    </div>
                    <div className="flex items-center justify-between text-xs p-2 bg-red-500/10 border border-red-500/20 rounded">
                      <span className="text-red-400 flex items-center gap-2"><X className="w-3 h-3"/> START AHU-05</span>
                      <span className="text-slate-500 font-mono">13:45</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
            
          </div>

          {/* RIGHT COLUMN (Ranking & Activity) */}
          <div className="space-y-4">
            
            {/* Client Ranking */}
            <Card className="bg-slate-900 border-slate-800 flex flex-col h-[400px]">
              <CardHeader className="p-4 pb-2 border-b border-slate-800/50">
                <CardTitle className="text-base text-slate-200">Atenção por Cliente</CardTitle>
                <CardDescription className="text-xs text-slate-400">Locais com mais anomalias ativas</CardDescription>
              </CardHeader>
              <CardContent className="p-0 flex-1 overflow-auto">
                <div className="divide-y divide-slate-800/50">
                  {CLIENTS_RANKING.map(client => (
                    <div key={client.id} className="p-3 hover:bg-slate-800/40 transition-colors group cursor-pointer">
                      <div className="flex justify-between items-start mb-2">
                        <h4 className="text-sm font-medium text-slate-200 group-hover:text-cyan-400 transition-colors flex items-center gap-1.5">
                          {client.name}
                        </h4>
                        <ChevronRight className="w-4 h-4 text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                      <div className="flex gap-4">
                        <div className="flex items-center gap-1.5 text-xs">
                          <div className="w-1.5 h-1.5 rounded-full bg-red-500"></div>
                          <span className="text-slate-300 font-mono">{client.activeAlarms}</span>
                          <span className="text-slate-500">alarmes</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-xs">
                          <div className="w-1.5 h-1.5 rounded-full bg-orange-500"></div>
                          <span className="text-slate-300 font-mono">{client.offlineDevs}</span>
                          <span className="text-slate-500">offline</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
              <div className="p-3 border-t border-slate-800/50">
                 <Button variant="outline" className="w-full text-xs h-8 bg-transparent border-slate-700 text-slate-400 hover:text-slate-200">
                    Explorar todos clientes
                 </Button>
              </div>
            </Card>

            {/* Audit Feed */}
            <Card className="bg-slate-900 border-slate-800 flex flex-col flex-1 min-h-[300px]">
              <CardHeader className="p-4 pb-2 border-b border-slate-800/50">
                <CardTitle className="text-base text-slate-200 flex items-center gap-2">
                  <History className="w-4 h-4 text-cyan-500"/> Atividade Recente
                </CardTitle>
                <CardDescription className="text-xs text-slate-400">Log de auditoria (apenas admin)</CardDescription>
              </CardHeader>
              <CardContent className="p-4">
                <div className="space-y-4">
                  {RECENT_ACTIVITY.map((activity, i) => (
                    <div key={activity.id} className="relative pl-4">
                      {/* Timeline line */}
                      {i !== RECENT_ACTIVITY.length - 1 && (
                        <div className="absolute left-[5px] top-4 bottom-[-16px] w-px bg-slate-800"></div>
                      )}
                      {/* Timeline dot */}
                      <div className="absolute left-0 top-1.5 w-2.5 h-2.5 rounded-full border-2 border-slate-900 bg-cyan-500"></div>
                      
                      <p className="text-xs text-slate-300 leading-tight">
                        <span className="font-semibold text-slate-200">{activity.user}</span> {activity.action} em <span className="text-cyan-400">{activity.target}</span>
                      </p>
                      <p className="text-[10px] text-slate-500 mt-0.5">{activity.time}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

          </div>
        </div>
      </div>
    </div>
  );
}
