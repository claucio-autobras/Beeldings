import { Router } from 'lucide-react';

/** Demonstrates the sidebar Gateways nav item with the amber update-available badge. */
export function GatewayBadgePreview() {
  return (
    <div className="flex gap-8 p-8 bg-white min-h-screen items-start">
      {/* Collapsed sidebar */}
      <div>
        <p className="mb-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">Recolhida</p>
        <div className="w-16 bg-slate-900 rounded-lg p-2 flex flex-col gap-1">
          <MockItem icon={<Router className="h-4 w-4 text-slate-400" strokeWidth={1.5} />} badge={1} collapsed />
        </div>
      </div>

      {/* Expanded sidebar */}
      <div>
        <p className="mb-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">Expandida</p>
        <div className="w-56 bg-slate-900 rounded-lg p-2 flex flex-col gap-1">
          <MockItem icon={<Router className="h-4 w-4 text-slate-400" strokeWidth={1.5} />} label="Gateways" badge={1} />
          <MockItem icon={<Router className="h-4 w-4 text-white" strokeWidth={1.5} />} label="Gateways (ativo)" active />
          <MockItem icon={<Router className="h-4 w-4 text-white" strokeWidth={1.5} />} label="Gateways (ativo+badge)" badge={2} active />
        </div>
      </div>

      {/* No badge */}
      <div>
        <p className="mb-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">Sem badge (atualizado)</p>
        <div className="w-56 bg-slate-900 rounded-lg p-2 flex flex-col gap-1">
          <MockItem icon={<Router className="h-4 w-4 text-slate-400" strokeWidth={1.5} />} label="Gateways" />
        </div>
      </div>
    </div>
  );
}

function MockItem({
  icon,
  label,
  badge,
  active,
  collapsed,
}: {
  icon: React.ReactNode;
  label?: string;
  badge?: number;
  active?: boolean;
  collapsed?: boolean;
}) {
  return (
    <div
      className={[
        'flex items-center rounded-md py-2 text-sm font-medium cursor-pointer',
        collapsed ? 'justify-center px-0' : 'gap-2.5 px-2',
        active ? 'bg-cyan-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white',
      ].join(' ')}
      title={collapsed && badge ? `Gateways — ${badge} gateway(s) com atualização disponível` : collapsed ? 'Gateways' : undefined}
    >
      <span className="relative shrink-0">
        {icon}
        {!!badge && (
          <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-amber-400 ring-1 ring-slate-900" />
        )}
      </span>
      {!collapsed && (
        <span className="flex min-w-0 flex-1 items-center gap-1.5 whitespace-nowrap overflow-hidden">
          <span className="truncate">{label}</span>
          {!!badge && (
            <span className="ml-auto shrink-0 rounded-full bg-amber-400 px-1.5 py-0.5 text-[9px] font-bold leading-none text-slate-900">
              {badge}
            </span>
          )}
        </span>
      )}
    </div>
  );
}
