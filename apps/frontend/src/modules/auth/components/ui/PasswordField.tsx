'use client';

import { useState } from 'react';
import type { InputHTMLAttributes } from 'react';
import { Eye, EyeOff, Lock } from 'lucide-react';
import { InputField } from './InputField';
import { useT } from '@/lib/i18n';

type PasswordFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  label?: string;
};

/**
 * Campo de senha com ícone de cadeado e botão de mostrar/ocultar.
 * Encapsula o estado de visibilidade para reuso em login e troca de senha.
 */
export function PasswordField({ label = 'Senha', ...props }: PasswordFieldProps) {
  const t = useT();
  const [visible, setVisible] = useState(false);

  return (
    <InputField
      {...props}
      label={t(label)}
      type={visible ? 'text' : 'password'}
      icon={Lock}
      trailing={
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? t('Ocultar senha') : t('Mostrar senha')}
          className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      }
    />
  );
}
