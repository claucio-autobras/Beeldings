import type { LucideIcon } from 'lucide-react';

interface FeatureHighlightProps {
  icon: LucideIcon;
  title: string;
  description: string;
}

/**
 * Item de destaque do painel de marca (fundo escuro): cartão translúcido com
 * ícone + título + descrição. Reutilizável para a lista de diferenciais
 * (IA, IoT, Automação...).
 */
export function FeatureHighlight({ icon: Icon, title, description }: FeatureHighlightProps) {
  return (
    <div className="flex items-start gap-4 rounded-xl border border-white/5 bg-white/[0.04] px-4 py-3.5 backdrop-blur-sm">
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cyan-400/10 text-cyan-300 ring-1 ring-inset ring-cyan-400/25">
        <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
      </span>
      <div>
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        <p className="mt-0.5 text-sm leading-snug text-slate-400">{description}</p>
      </div>
    </div>
  );
}
