import { HeartPulse, AlertTriangle, WifiOff, Star } from 'lucide-react';
import { T } from './theme';

/*
 * Card "Ativos Críticos" — substitui "Velocidade de resposta da equipe".
 * Mesma moldura dos cards do dashboard (rounded-lg, borda, glow decorativo).
 */

type Row = {
  name: string;
  status: 'ok' | 'fail' | 'offline';
  detail: string;
  sub?: string;
};

const ROWS: Row[] = [
  { name: 'Bomba Primária', status: 'ok', detail: '142h', sub: 'em funcionamento no período' },
  { name: 'Chiller 01', status: 'ok', detail: '89h', sub: 'ligado no período' },
  { name: 'Bomba Secundária', status: 'fail', detail: 'em falha', sub: 'há 3d 4h' },
  { name: 'Câmera Portaria', status: 'offline', detail: 'offline', sub: 'há 12 dias' },
];

function Dot({ status }: { status: Row['status'] }) {
  const color = status === 'ok' ? '#34D399' : status === 'fail' ? '#F87171' : '#FBBF24';
  return (
    <span className="relative flex h-2 w-2 shrink-0">
      {status !== 'ok' && (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ backgroundColor: color }} />
      )}
      <span className="relative inline-flex h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
    </span>
  );
}

export function AtivosCriticosCard({ empty = false }: { empty?: boolean }) {
  return (
    <div
      className="relative flex flex-col overflow-hidden rounded-lg border shadow-sm"
      style={{ borderColor: T.border, backgroundColor: T.card }}
    >
      <div className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-cyan-500/10 blur-2xl" aria-hidden="true" />
      <div className="flex items-center gap-2 px-4 pt-4">
        <HeartPulse size={16} className="text-cyan-400 opacity-90" />
        <p className="text-sm font-medium" style={{ color: T.foreground }}>Ativos Críticos</p>
      </div>

      {empty ? (
        <div className="flex flex-1 flex-col items-center justify-center px-5 pb-5 pt-4 text-center">
          <div
            className="mb-3 flex h-10 w-10 items-center justify-center rounded-full border"
            style={{ borderColor: T.border, backgroundColor: T.muted }}
          >
            <Star size={18} className="text-cyan-400/80" />
          </div>
          <p className="text-xs font-medium" style={{ color: T.foreground }}>
            Nenhum ativo crítico marcado
          </p>
          <p className="mt-1 text-[11px] leading-relaxed" style={{ color: T.mutedFg }}>
            Use o botão <Star size={10} className="inline -mt-px text-cyan-400" />{' '}
            <span className="font-medium" style={{ color: T.foreground }}>Marcar como crítico</span>{' '}
            em <span className="font-medium" style={{ color: T.foreground }}>Dispositivos</span> ou{' '}
            <span className="font-medium" style={{ color: T.foreground }}>CFTV</span> para
            acompanhar aqui os equipamentos mais importantes.
          </p>
        </div>
      ) : (
        <ul className="mt-3 flex flex-1 flex-col justify-center px-3 pb-4">
          {ROWS.map((r) => {
            const highlight =
              r.status === 'fail'
                ? { backgroundColor: 'rgba(248,113,113,0.08)', borderColor: 'rgba(248,113,113,0.35)' }
                : r.status === 'offline'
                  ? { backgroundColor: 'rgba(251,191,36,0.07)', borderColor: 'rgba(251,191,36,0.35)' }
                  : { borderColor: 'transparent' };
            return (
              <li
                key={r.name}
                className="mb-1.5 flex items-center gap-2.5 rounded-md border px-2.5 py-2 last:mb-0"
                style={highlight}
              >
                <Dot status={r.status} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium" style={{ color: T.foreground }}>{r.name}</p>
                  <p className="text-[10px]" style={{ color: T.mutedFg }}>{r.sub}</p>
                </div>
                <span
                  className="shrink-0 text-xs font-semibold tabular-nums"
                  style={{
                    color: r.status === 'ok' ? '#34D399' : r.status === 'fail' ? '#F87171' : '#FBBF24',
                  }}
                >
                  {r.status === 'fail' ? (
                    <span className="inline-flex items-center gap-1"><AlertTriangle size={11} /> {r.detail}</span>
                  ) : r.status === 'offline' ? (
                    <span className="inline-flex items-center gap-1"><WifiOff size={11} /> {r.detail}</span>
                  ) : (
                    r.detail
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
