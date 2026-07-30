'use client';

import { useState, useRef, useEffect } from 'react';
import { FlaskConical, ChevronDown } from 'lucide-react';
import type { Alarm } from '@/mocks/data/alarms.mock';
import { generateMockAlarm } from '@/mocks/data/alarms.mock';

interface AlarmSimulateButtonProps {
  addAlarms: (alarms: Alarm[]) => void;
}

interface SimulateOption {
  label: string;
  description: string;
  action: () => void;
}

export function AlarmSimulateButton({ addAlarms }: AlarmSimulateButtonProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const options: SimulateOption[] = [
    {
      label: '1 alarme — ponto em falha',
      description: 'Status: ALARME (não pode reconhecer)',
      action: () => {
        addAlarms([generateMockAlarm({ status: 'ALARME' })]);
        setOpen(false);
      },
    },
    {
      label: '1 alarme — ponto normalizado',
      description: 'Status: NORMAL (pronto para reconhecer)',
      action: () => {
        addAlarms([generateMockAlarm({ status: 'NORMAL' })]);
        setOpen(false);
      },
    },
    {
      label: '3 alarmes simultâneos',
      description: '2 em falha + 1 normalizado',
      action: () => {
        addAlarms([
          generateMockAlarm({ status: 'ALARME' }),
          generateMockAlarm({ status: 'ALARME' }),
          generateMockAlarm({ status: 'NORMAL' }),
        ]);
        setOpen(false);
      },
    },
    {
      label: 'Acúmulo: 2° alarme chega com modal aberto',
      description: '1° alarme abre o modal → 2° chega 3s depois',
      action: () => {
        addAlarms([generateMockAlarm({ status: 'ALARME' })]);
        setTimeout(() => {
          addAlarms([generateMockAlarm({ status: 'NORMAL' })]);
        }, 3000);
        setOpen(false);
      },
    },
    {
      label: 'Misto: falha + normalizado',
      description: '1 ALARME + 1 NORMAL ao mesmo tempo',
      action: () => {
        addAlarms([
          generateMockAlarm({ status: 'ALARME' }),
          generateMockAlarm({ status: 'NORMAL' }),
        ]);
        setOpen(false);
      },
    },
  ];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-400/50"
        aria-expanded={open}
        aria-haspopup="true"
      >
        <FlaskConical size={12} strokeWidth={2} />
        Simular Alarme
        <ChevronDown
          size={11}
          strokeWidth={2}
          className={`transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div
          className="absolute right-0 top-full z-50 mt-1 w-72 overflow-hidden rounded-lg border border-border bg-card shadow-lg"
          role="menu"
          aria-label="Opções de simulação de alarme"
        >
          <div className="border-b border-border bg-amber-50 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-600">
              Ambiente de testes — mock
            </p>
          </div>
          {options.map((opt) => (
            <button
              key={opt.label}
              type="button"
              role="menuitem"
              onClick={opt.action}
              className="block w-full px-3 py-2.5 text-left transition-colors hover:bg-muted focus:bg-muted focus:outline-none"
            >
              <p className="text-xs font-medium text-foreground">{opt.label}</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">{opt.description}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
