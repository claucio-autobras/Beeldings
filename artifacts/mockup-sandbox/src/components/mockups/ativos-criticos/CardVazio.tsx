import { T } from './_shared/theme';
import { AtivosCriticosCard } from './_shared/AtivosCriticosCard';

/* Estado vazio do card "Ativos Críticos", lado a lado com o estado populado. */
export function CardVazio() {
  return (
    <div className="flex min-h-screen items-center justify-center gap-8 p-8 font-sans" style={{ backgroundColor: T.background }}>
      <div className="w-72">
        <p className="mb-2 text-center text-[11px] font-medium uppercase tracking-wide" style={{ color: T.mutedFg }}>
          Estado vazio
        </p>
        <div className="flex min-h-72 flex-col [&>div]:flex-1"><AtivosCriticosCard empty /></div>
      </div>
      <div className="w-72">
        <p className="mb-2 text-center text-[11px] font-medium uppercase tracking-wide" style={{ color: T.mutedFg }}>
          Com ativos marcados
        </p>
        <div className="flex min-h-72 flex-col [&>div]:flex-1"><AtivosCriticosCard /></div>
      </div>
    </div>
  );
}
