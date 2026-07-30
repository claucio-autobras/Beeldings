'use client';

import { AlertCircle } from 'lucide-react';
import { useT } from '@/lib/i18n';

interface AlarmBadgeProps {
  label?: string;
  className?: string;
}

export function AlarmBadge({ label, className = '' }: AlarmBadgeProps) {
  const t = useT();
  const resolvedLabel = label ?? t('Alarme');
  return (
    <span
      className={[
        'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-semibold leading-none bg-red-50 text-red-600 border-red-200',
        className,
      ].join(' ')}
    >
      <AlertCircle size={10} strokeWidth={2} />
      {resolvedLabel}
    </span>
  );
}
