import type { LucideIcon } from 'lucide-react';

interface FeatureHighlightProps {
  icon: LucideIcon;
  title: string;
  description: string;
}

/**
 * Item de destaque do painel de marca: ícone + título + descrição.
 * Reutilizável para a lista de diferenciais (IA, IoT, Automação...).
 */
export function FeatureHighlight({ icon: Icon, title, description }: FeatureHighlightProps) {
  return (
    <div className="flex items-start gap-3.5">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-100 bg-cyan-50 text-cyan-700">
        <Icon className="h-5 w-5" />
      </span>
      <div className="space-y-0.5">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        <p className="text-sm leading-snug text-slate-500">{description}</p>
      </div>
    </div>
  );
}
