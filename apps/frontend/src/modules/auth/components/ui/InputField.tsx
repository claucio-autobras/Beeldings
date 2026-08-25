import { forwardRef } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface InputFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Texto do label — sempre presente para acessibilidade. */
  label: string;
  /** Ícone exibido à esquerda dentro do campo. */
  icon?: LucideIcon;
  /** Conteúdo opcional à direita (ex.: botão de mostrar senha). */
  trailing?: ReactNode;
}

/**
 * Campo de formulário rotulado, com ícone à esquerda e slot à direita.
 * Base reutilizável para os inputs da tela de login.
 */
export const InputField = forwardRef<HTMLInputElement, InputFieldProps>(
  function InputField({ label, icon: Icon, trailing, id, className, ...props }, ref) {
    return (
      <div className="space-y-1.5">
        <label htmlFor={id} className="block text-sm font-medium text-slate-700">
          {label}
        </label>
        <div className="relative">
          {Icon && (
            <Icon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          )}
          <input
            ref={ref}
            id={id}
            className={cn(
              'block h-11 w-full rounded-xl border border-slate-200 bg-slate-50/60 text-sm text-slate-900 placeholder-slate-400 transition',
              'focus:border-cyan-600 focus:bg-card focus:outline-none focus:ring-4 focus:ring-cyan-600/10',
              Icon ? 'pl-10' : 'pl-3',
              trailing ? 'pr-11' : 'pr-3',
              className,
            )}
            {...props}
          />
          {trailing && (
            <div className="absolute right-2 top-1/2 -translate-y-1/2">{trailing}</div>
          )}
        </div>
      </div>
    );
  },
);
