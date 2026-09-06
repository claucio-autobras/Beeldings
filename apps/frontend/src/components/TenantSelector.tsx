'use client';

import { ChevronDown } from 'lucide-react';
import { useTenants } from '@/modules/tenants/hooks/useTenants';

interface TenantSelectorProps {
  value: string | null;
  onChange: (id: string | null) => void;
}

export function TenantSelector({ value, onChange }: TenantSelectorProps) {
  const tenants = useTenants().data ?? [];
  return (
    <div className="relative">
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        className="appearance-none rounded-lg border border-slate-200 bg-card pl-3 pr-8 py-2 text-sm text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 cursor-pointer"
      >
        <option value="">Todos os sites</option>
        {tenants.map((t) => (
          <option key={t.id} value={t.id}>
            {t.active === false ? `${t.name} (Inativo)` : t.name}
          </option>
        ))}
      </select>
      <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
    </div>
  );
}
