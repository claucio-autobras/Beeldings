import { Star, Camera, WifiOff, MoreVertical } from 'lucide-react';
import { T } from './_shared/theme';

/*
 * Botão "Marcar como crítico" na tela CFTV: estrela no canto de cada card de
 * câmera (mesmo padrão da tela de Dispositivos).
 */

const CAMS = [
  { name: 'Câmera Portaria', model: 'Hikvision DS-2CD2', status: 'offline', uptime: '—', critical: true, sub: 'offline há 12 dias' },
  { name: 'Câmera Garagem', model: 'Intelbras VIP 3230', status: 'online', uptime: '99,2%', critical: false, sub: 'ao vivo agora' },
  { name: 'Câmera Piscina', model: 'Hikvision DS-2CD2', status: 'online', uptime: '98,7%', critical: false, sub: 'ao vivo agora' },
];

function CamCard({ cam }: { cam: (typeof CAMS)[number] }) {
  const off = cam.status === 'offline';
  return (
    <div className="space-y-3 rounded-lg border p-4" style={{ borderColor: off ? 'rgba(251,191,36,0.4)' : T.border, backgroundColor: T.card }}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span
            className="flex h-9 w-9 items-center justify-center rounded-md"
            style={{ backgroundColor: off ? 'rgba(251,191,36,0.12)' : 'rgba(34,211,238,0.1)' }}
          >
            {off ? <WifiOff size={16} style={{ color: '#FBBF24' }} /> : <Camera size={16} className="text-cyan-400" />}
          </span>
          <div>
            <p className="flex items-center gap-1.5 text-sm font-medium" style={{ color: T.foreground }}>
              {cam.name}
              {cam.critical && (
                <span className="rounded-full px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide" style={{ color: '#22D3EE', backgroundColor: 'rgba(34,211,238,0.12)' }}>
                  crítico
                </span>
              )}
            </p>
            <p className="text-[11px]" style={{ color: T.mutedFg }}>{cam.model}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            className="rounded-md border p-1.5"
            style={{
              borderColor: cam.critical ? 'rgba(34,211,238,0.5)' : T.border,
              backgroundColor: cam.critical ? 'rgba(34,211,238,0.12)' : 'transparent',
            }}
            title={cam.critical ? 'Remover dos ativos críticos' : 'Marcar como crítico'}
          >
            <Star size={14} fill={cam.critical ? '#22D3EE' : 'none'} style={{ color: cam.critical ? '#22D3EE' : T.mutedFg }} />
          </button>
          <MoreVertical size={15} style={{ color: T.mutedFg }} />
        </div>
      </div>

      <div className="flex items-center justify-between rounded-md px-3 py-2 text-xs" style={{ backgroundColor: T.muted }}>
        <span
          className="inline-flex items-center gap-1.5 font-medium"
          style={{ color: off ? '#FBBF24' : '#34D399' }}
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: off ? '#FBBF24' : '#34D399' }} />
          {cam.sub}
        </span>
        <span style={{ color: T.mutedFg }}>uptime {cam.uptime}</span>
      </div>
    </div>
  );
}

export function ToggleCFTV() {
  return (
    <div className="min-h-screen p-6 font-sans" style={{ backgroundColor: T.background }}>
      <h1 className="flex items-center gap-2 text-xl font-semibold" style={{ color: T.foreground }}>
        <span className="h-6 w-1.5 rounded-sm bg-cyan-500" /> CFTV
      </h1>
      <p className="mt-0.5 text-sm" style={{ color: T.mutedFg }}>
        Monitoramento de câmeras via SNMP ou ONVIF — status, uptime e saúde de rede
      </p>

      <div className="mt-3 flex items-center gap-4 text-xs">
        <span style={{ color: T.mutedFg }}>3 câmeras</span>
        <span className="flex items-center gap-1.5" style={{ color: '#34D399' }}>
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: '#34D399' }} /> 2 online
        </span>
        <span className="flex items-center gap-1.5" style={{ color: '#F87171' }}>
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: '#F87171' }} /> 1 offline
        </span>
        <span style={{ color: T.mutedFg }}>— 1 marcada como crítica</span>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-4">
        {CAMS.map((c) => <CamCard key={c.name} cam={c} />)}
      </div>

      <p className="mt-4 text-[11px]" style={{ color: T.mutedFg }}>
        ★ A estrela marca a câmera como <span style={{ color: T.foreground }}>ativo crítico</span> — ela passa a ser acompanhada no card "Ativos Críticos" do dashboard.
      </p>
    </div>
  );
}
