import {
  Bell, Clock, WifiOff, Activity, Camera, Zap, MapPin, TrendingUp,
  LayoutDashboard, ChevronRight, ClipboardList, Cpu, ShieldCheck,
} from 'lucide-react';
import { T } from './_shared/theme';
import { AtivosCriticosCard } from './_shared/AtivosCriticosCard';

/*
 * Dashboard BlueBee (tema escuro) com o card "Velocidade de resposta da
 * equipe" substituído por "Ativos Críticos". Layout e estilos replicam
 * dashboard.page.tsx (KPI row, timeline+card, tabela, coluna lateral).
 */

function ActionKpi({ title, value, bar, iconBg, icon, trend }: {
  title: string; value: number; bar: string; iconBg: string; icon: React.ReactNode; trend?: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-lg border p-4 shadow-sm" style={{ borderColor: T.border, backgroundColor: T.card }}>
      <span className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: bar }} />
      <div className="mb-2 flex items-start justify-between gap-2">
        <p className="text-xs font-medium" style={{ color: T.mutedFg }}>{title}</p>
        <div className="rounded-md p-1.5" style={{ backgroundColor: iconBg }}>{icon}</div>
      </div>
      <div className="flex items-end justify-between gap-2">
        <h3 className="text-2xl font-bold tabular-nums" style={{ color: T.foreground }}>{value}</h3>
        {trend && (
          <span className="flex items-center gap-0.5 text-xs font-medium text-red-400">
            <TrendingUp size={12} /> {trend}
          </span>
        )}
      </div>
    </div>
  );
}

function InfoKpi({ title, value, total, icon }: { title: string; value: number; total: number; icon: React.ReactNode }) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  return (
    <div className="flex flex-col justify-between rounded-xl border p-3 shadow-sm" style={{ borderColor: T.border, backgroundColor: T.card }}>
      <div className="mb-2 text-cyan-500/80">{icon}</div>
      <div>
        <h4 className="text-lg font-semibold tabular-nums" style={{ color: T.foreground }}>
          {value} <span className="text-xs font-normal" style={{ color: T.mutedFg }}>/ {total}</span>
        </h4>
        <p className="mt-0.5 text-xs" style={{ color: T.mutedFg }}>{title}</p>
      </div>
      <div className="mt-3 h-1 overflow-hidden rounded-full" style={{ backgroundColor: T.muted }}>
        <div className="h-full bg-cyan-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Timeline() {
  const bars = [2, 1, 0, 3, 2, 4, 1, 0, 2, 5, 3, 1, 0, 1, 2, 3, 1, 2, 4, 2, 1, 0, 1, 2];
  return (
    <div className="flex h-full flex-col rounded-lg border p-4 shadow-sm" style={{ borderColor: T.border, backgroundColor: T.card }}>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-medium" style={{ color: T.foreground }}>Alarmes por severidade</p>
        <span className="text-xs" style={{ color: T.mutedFg }}>Últimas 24h</span>
      </div>
      <div className="flex flex-1 items-end gap-1.5 pt-6">
        {bars.map((b, i) => (
          <div key={i} className="flex flex-1 flex-col justify-end gap-0.5" style={{ height: 120 }}>
            {b > 2 && <div className="w-full rounded-sm bg-red-500/80" style={{ height: (b - 2) * 14 }} />}
            {b > 0 && <div className="w-full rounded-sm bg-orange-400/80" style={{ height: Math.min(b, 2) * 14 }} />}
            <div className="w-full rounded-sm bg-cyan-600/50" style={{ height: 8 }} />
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[10px]" style={{ color: T.mutedFg }}>
        <span>00h</span><span>06h</span><span>12h</span><span>18h</span><span>agora</span>
      </div>
    </div>
  );
}

const DEVICES = [
  ['CAG — Chiller 01', 'Térmica', 'online', '2 pts'],
  ['Bomba Primária', 'Hidráulica', 'online', '4 pts'],
  ['Bomba Secundária', 'Hidráulica', 'alarme', '4 pts'],
  ['Quadro QGBT', 'Elétrica', 'online', '12 pts'],
  ['Câmera Portaria', 'CFTV', 'offline', '6 pts'],
];

export function DashboardComCard() {
  return (
    <div className="min-h-screen p-5 font-sans" style={{ backgroundColor: T.background }}>
      {/* Header */}
      <div className="flex items-center justify-between border-b pb-3" style={{ borderColor: T.border }}>
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold" style={{ color: T.foreground }}>
            <span className="h-6 w-1.5 rounded-sm bg-cyan-500" />
            Dashboard
          </h1>
          <p className="mt-0.5 text-sm" style={{ color: T.mutedFg }}>Condomínio Vista Verde — visão do Site</p>
        </div>
        <div className="flex overflow-hidden rounded-md border text-xs" style={{ borderColor: T.border }}>
          <span className="bg-cyan-600 px-3 py-1.5 font-medium text-white">24h</span>
          <span className="px-3 py-1.5" style={{ color: T.mutedFg }}>7d</span>
          <span className="px-3 py-1.5" style={{ color: T.mutedFg }}>30d</span>
        </div>
      </div>

      <div className="mt-4 space-y-4">
        {/* KPI row */}
        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-6 grid grid-cols-3 gap-4">
            <ActionKpi title="Alarmes Ativos" value={3} bar="#EF4444" iconBg="rgba(248,113,113,0.15)" icon={<Bell size={15} className="text-red-400" />} trend="+12%" />
            <ActionKpi title="Aguard. ACK" value={2} bar="#F97316" iconBg="rgba(251,146,60,0.15)" icon={<Clock size={15} className="text-orange-400" />} />
            <ActionKpi title="Disp. Offline" value={1} bar="#F97316" iconBg="rgba(251,146,60,0.15)" icon={<WifiOff size={15} className="text-orange-400" />} />
          </div>
          <div className="col-span-6 grid grid-cols-4 gap-3">
            <InfoKpi title="IOT/BMS online" value={11} total={12} icon={<Activity size={16} strokeWidth={1.5} />} />
            <InfoKpi title="Câmeras online" value={7} total={8} icon={<Camera size={16} strokeWidth={1.5} />} />
            <InfoKpi title="Automações ativas" value={5} total={6} icon={<Zap size={16} strokeWidth={1.5} />} />
            <InfoKpi title="Sites/Áreas" value={2} total={2} icon={<MapPin size={16} strokeWidth={1.5} />} />
          </div>
        </div>

        {/* Main grid */}
        <div className="grid grid-cols-4 gap-4">
          <div className="col-span-3 space-y-4">
            <div className="grid grid-cols-4 gap-4">
              <div className="col-span-3"><Timeline /></div>
              {/* ← substitui "Velocidade de resposta da equipe" */}
              <AtivosCriticosCard />
            </div>

            {/* Devices table */}
            <div className="overflow-hidden rounded-lg border shadow-sm" style={{ borderColor: T.border, backgroundColor: T.card }}>
              <div className="flex items-center justify-between px-4 py-3">
                <p className="text-sm font-medium" style={{ color: T.foreground }}>Dispositivos por área</p>
                <span className="flex items-center gap-1 text-xs text-cyan-400">ver todos <ChevronRight size={12} /></span>
              </div>
              <table className="w-full text-left text-xs">
                <thead>
                  <tr style={{ color: T.mutedFg, backgroundColor: T.muted }}>
                    <th className="px-4 py-2 font-medium">Equipamento</th>
                    <th className="px-4 py-2 font-medium">Área</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 font-medium">Pontos</th>
                  </tr>
                </thead>
                <tbody>
                  {DEVICES.map(([n, a, s, p]) => (
                    <tr key={n} className="border-t" style={{ borderColor: T.border }}>
                      <td className="px-4 py-2.5 font-medium" style={{ color: T.foreground }}>{n}</td>
                      <td className="px-4 py-2.5" style={{ color: T.mutedFg }}>{a}</td>
                      <td className="px-4 py-2.5">
                        <span
                          className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium"
                          style={
                            s === 'online'
                              ? { color: '#34D399', backgroundColor: 'rgba(52,211,153,0.1)' }
                              : s === 'alarme'
                                ? { color: '#F87171', backgroundColor: 'rgba(248,113,113,0.1)' }
                                : { color: '#FBBF24', backgroundColor: 'rgba(251,191,36,0.1)' }
                          }
                        >
                          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: s === 'online' ? '#34D399' : s === 'alarme' ? '#F87171' : '#FBBF24' }} />
                          {s}
                        </span>
                      </td>
                      <td className="px-4 py-2.5" style={{ color: T.mutedFg }}>{p}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Right column */}
          <div className="space-y-4">
            <div className="rounded-lg border p-4 shadow-sm" style={{ borderColor: T.border, backgroundColor: T.card }}>
              <p className="mb-3 text-sm font-medium" style={{ color: T.foreground }}>Acesso rápido</p>
              {[
                [<LayoutDashboard key="1" size={14} />, 'Telas SCADA'],
                [<Bell key="2" size={14} />, 'Painel de alarmes'],
                [<Cpu key="3" size={14} />, 'Dispositivos'],
                [<ClipboardList key="4" size={14} />, 'Relatórios'],
              ].map(([ic, label], i) => (
                <div key={i} className="mb-1.5 flex items-center gap-2.5 rounded-md border px-3 py-2 text-xs last:mb-0" style={{ borderColor: T.border, color: T.foreground, backgroundColor: T.muted }}>
                  <span className="text-cyan-400">{ic}</span>{label}
                  <ChevronRight size={12} className="ml-auto" style={{ color: T.mutedFg }} />
                </div>
              ))}
            </div>
            <div className="rounded-lg border p-4 shadow-sm" style={{ borderColor: T.border, backgroundColor: T.card }}>
              <p className="mb-3 flex items-center gap-2 text-sm font-medium" style={{ color: T.foreground }}>
                <ShieldCheck size={15} className="text-cyan-400" /> Resumo operacional
              </p>
              {[
                ['Alarmes críticos ativos', '1', '#F87171'],
                ['Aguardando reconhecimento', '2', '#FBBF24'],
                ['Resolvidos nas últimas 24h', '6', '#34D399'],
                ['Dispositivos online', '11/12', T.foreground],
              ].map(([l, v, c]) => (
                <div key={l as string} className="flex items-center justify-between border-t py-2 text-xs first:border-t-0" style={{ borderColor: T.border }}>
                  <span style={{ color: T.mutedFg }}>{l}</span>
                  <span className="font-semibold tabular-nums" style={{ color: c as string }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
