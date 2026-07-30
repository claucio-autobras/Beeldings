import { Star, Cpu, ChevronRight, Search } from 'lucide-react';
import { T } from './_shared/theme';

/*
 * Botão "Marcar como crítico" na tela de Dispositivos: estrela por linha da
 * lista. Preenchida (cyan) = crítico; contorno = normal. Tooltip explicativo.
 */

const ROWS = [
  { name: 'CAG — Chiller 01', proto: 'BACnet', status: 'online', critical: true },
  { name: 'Bomba Primária', proto: 'Modbus', status: 'online', critical: true },
  { name: 'Bomba Secundária', proto: 'Modbus', status: 'alarme', critical: true },
  { name: 'Quadro QGBT', proto: 'Modbus', status: 'online', critical: false },
  { name: 'Sensor Reservatório', proto: 'MQTT', status: 'online', critical: false },
];

function StarToggle({ active, showTip }: { active: boolean; showTip?: boolean }) {
  return (
    <div className="relative flex items-center">
      <button
        className="rounded-md border p-1.5 transition-colors"
        style={{
          borderColor: active ? 'rgba(34,211,238,0.5)' : T.border,
          backgroundColor: active ? 'rgba(34,211,238,0.12)' : 'transparent',
        }}
        title={active ? 'Remover dos ativos críticos' : 'Marcar como crítico'}
      >
        <Star size={14} fill={active ? '#22D3EE' : 'none'} style={{ color: active ? '#22D3EE' : T.mutedFg }} />
      </button>
      {showTip && (
        <div
          className="absolute right-0 top-full z-10 mt-2 w-44 rounded-md border px-2.5 py-2 text-[10px] leading-snug shadow-lg"
          style={{ borderColor: T.border, backgroundColor: T.muted, color: T.foreground }}
        >
          <span className="font-semibold">Marcar como crítico</span>
          <br />
          <span style={{ color: T.mutedFg }}>O ativo passa a aparecer no card "Ativos Críticos" do dashboard.</span>
        </div>
      )}
    </div>
  );
}

export function ToggleDispositivos() {
  return (
    <div className="min-h-screen p-6 font-sans" style={{ backgroundColor: T.background }}>
      <h1 className="flex items-center gap-2 text-xl font-semibold" style={{ color: T.foreground }}>
        <span className="h-6 w-1.5 rounded-sm bg-cyan-500" /> Dispositivos
      </h1>
      <p className="mt-0.5 text-sm" style={{ color: T.mutedFg }}>Gerencie os equipamentos IOT/BMS do site</p>

      <div className="mt-4 flex items-center gap-3">
        <div className="flex h-9 w-64 items-center gap-2 rounded-md border px-3 text-sm" style={{ borderColor: T.border, color: T.mutedFg }}>
          <Search size={14} /> Buscar dispositivo…
        </div>
        <span className="text-xs" style={{ color: T.mutedFg }}>5 dispositivos — 3 marcados como críticos</span>
      </div>

      <div className="mt-4 overflow-visible rounded-lg border shadow-sm" style={{ borderColor: T.border, backgroundColor: T.card }}>
        <table className="w-full text-left text-xs">
          <thead>
            <tr style={{ color: T.mutedFg, backgroundColor: T.muted }}>
              <th className="px-4 py-2.5 font-medium">Equipamento</th>
              <th className="px-4 py-2.5 font-medium">Protocolo</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 text-center font-medium">Crítico</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r, i) => (
              <tr key={r.name} className="border-t" style={{ borderColor: T.border }}>
                <td className="px-4 py-3">
                  <span className="flex items-center gap-2.5 font-medium" style={{ color: T.foreground }}>
                    <span className="flex h-7 w-7 items-center justify-center rounded-md" style={{ backgroundColor: T.muted }}>
                      <Cpu size={13} className="text-cyan-400" />
                    </span>
                    {r.name}
                    {r.critical && (
                      <span className="rounded-full px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide" style={{ color: '#22D3EE', backgroundColor: 'rgba(34,211,238,0.12)' }}>
                        crítico
                      </span>
                    )}
                  </span>
                </td>
                <td className="px-4 py-3" style={{ color: T.mutedFg }}>{r.proto}</td>
                <td className="px-4 py-3">
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium"
                    style={r.status === 'online'
                      ? { color: '#34D399', backgroundColor: 'rgba(52,211,153,0.1)' }
                      : { color: '#F87171', backgroundColor: 'rgba(248,113,113,0.1)' }}
                  >
                    <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: r.status === 'online' ? '#34D399' : '#F87171' }} />
                    {r.status}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-center"><StarToggle active={r.critical} showTip={i === 3} /></div>
                </td>
                <td className="px-4 py-3 text-right">
                  <ChevronRight size={14} className="ml-auto" style={{ color: T.mutedFg }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-[11px]" style={{ color: T.mutedFg }}>
        ★ A estrela marca o equipamento como <span style={{ color: T.foreground }}>ativo crítico</span> — ele passa a ser acompanhado no card "Ativos Críticos" do dashboard.
      </p>
    </div>
  );
}
