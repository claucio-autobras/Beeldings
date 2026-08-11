import { useT } from '@/lib/i18n';
import type { PointOpRole } from '../services/devices.service';

const OP_ROLE_LABEL: Record<NonNullable<PointOpRole>, string> = {
  status:   'Status',
  mode:     'Modo',
  setpoint: 'Setpoint',
};

/**
 * Badge discreto exibido ao lado do nome/tag do ponto quando um papel
 * operacional está definido. Estilo consistente com o badge violeta do
 * PointConfigPanel.
 */
export function OpRoleBadge({ role }: { role: PointOpRole }) {
  const t = useT();
  if (!role) return null;
  return (
    <span className="inline-flex shrink-0 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700">
      {t(OP_ROLE_LABEL[role])}
    </span>
  );
}
