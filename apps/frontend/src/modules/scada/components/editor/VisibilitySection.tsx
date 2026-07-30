'use client';

import { Eye } from 'lucide-react';
import type { VisibilityCondition, VisibilityOperator, VisibilityBehavior, Widget } from '../../types/scada.types';
import { readWidgetBinding } from '../../types/scada.types';

const OPERATORS: { value: VisibilityOperator; label: string }[] = [
  { value: 'eq',  label: 'igual a' },
  { value: 'neq', label: 'diferente de' },
  { value: 'gt',  label: 'maior que' },
  { value: 'lt',  label: 'menor que' },
  { value: 'gte', label: 'maior ou igual' },
  { value: 'lte', label: 'menor ou igual' },
];

interface Props {
  widget: Widget;
  onChange: (patch: Partial<Widget>) => void;
}

export function VisibilitySection({ widget, onChange }: Props) {
  const cond: VisibilityCondition = widget.visibility ?? { mode: 'always' };
  const { deviceId, tag } = readWidgetBinding(widget);
  const hasPoint = Boolean(deviceId && tag);

  function upd(patch: Partial<VisibilityCondition>) {
    onChange({ visibility: { ...cond, ...patch } } as Partial<Widget>);
  }

  return (
    <div className="border-b border-slate-700/60 pb-4 pt-3">
      <div className="flex items-center gap-2 px-4 pb-2">
        <Eye className="h-3.5 w-3.5 text-slate-400" strokeWidth={1.5} />
        <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
          Visibilidade
        </p>
      </div>

      <div className="flex flex-col gap-2 px-4">
        {/* Mode */}
        <div className="flex gap-3">
          {(['always', 'conditional'] as const).map((m) => (
            <label key={m} className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                name={`vis-mode-${widget.id}`}
                checked={cond.mode === m}
                onChange={() => upd({ mode: m })}
                className="accent-cyan-500"
              />
              <span className="text-xs text-slate-300">
                {m === 'always' ? 'Sempre visível' : 'Condicional'}
              </span>
            </label>
          ))}
        </div>

        {cond.mode === 'conditional' && (
          <>
            {!hasPoint && (
              <p className="text-[11px] text-slate-500">
                Vincule um ponto acima para usar a visibilidade condicional.
              </p>
            )}

            {/* Operator + value */}
            <div className="flex gap-2">
              <label className="flex flex-col gap-0.5 flex-1">
                <span className="text-[10px] uppercase tracking-wider text-slate-500">Quando valor</span>
                <select
                  value={cond.operator ?? 'eq'}
                  onChange={(e) => upd({ operator: e.target.value as VisibilityOperator })}
                  className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 outline-none focus:border-cyan-500"
                >
                  {OPERATORS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-0.5 w-20">
                <span className="text-[10px] uppercase tracking-wider text-slate-500">Valor</span>
                <input
                  type="number"
                  value={cond.value ?? 1}
                  onChange={(e) => upd({ value: Number(e.target.value) })}
                  className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 outline-none focus:border-cyan-500"
                />
              </label>
            </div>

            {/* Behavior */}
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] uppercase tracking-wider text-slate-500">
                Então (ação)
              </span>
              <div className="flex gap-3">
                {(['hide', 'opaque'] as VisibilityBehavior[]).map((b) => (
                  <label key={b} className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name={`vis-beh-${widget.id}`}
                      checked={(cond.behavior ?? 'hide') === b}
                      onChange={() => upd({ behavior: b })}
                      className="accent-cyan-500"
                    />
                    <span className="text-xs text-slate-300">
                      {b === 'hide' ? 'Ocultar' : 'Opaco 20%'}
                    </span>
                  </label>
                ))}
              </div>
            </label>
          </>
        )}
      </div>
    </div>
  );
}
