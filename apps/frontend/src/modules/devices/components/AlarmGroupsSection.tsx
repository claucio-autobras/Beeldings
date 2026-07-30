'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, Layers, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { AlarmGroupModal } from '@/modules/alarms/components/AlarmGroupModal';
import { useAlarmGroups, useDeleteAlarmGroup } from '@/modules/alarms/hooks/useAlarmGroups';
import type { AlarmGroup } from '@/modules/scada/services/alarm-groups.service';
import type { SiteItem } from '@/modules/sites/services/sites.service';

interface Props {
  tenantId: string;
  siteId: string;
  siteName: string;
}

/**
 * Gerenciamento das "Somas de Alarme" escopado ao site do dispositivo.
 * Agrupa os alarmes cadastrados (independente de estarem ativos) em um indicador único,
 * vinculável como widget de SCADA.
 */
export function AlarmGroupsSection({ tenantId, siteId, siteName }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [groupModal, setGroupModal] = useState<{ mode: 'create' } | { mode: 'edit'; group: AlarmGroup } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<AlarmGroup | null>(null);

  const { data: alarmGroups = [], isLoading } = useAlarmGroups({ tenantId, siteId });
  const del = useDeleteAlarmGroup();

  // O modal seleciona o site; aqui ele é fixo no site do dispositivo.
  const sites: SiteItem[] = [{ id: siteId, name: siteName, tenantId, createdAt: '' }];

  function handleConfirmDelete() {
    if (!confirmDelete) return;
    del.mutate(confirmDelete.id, { onSuccess: () => setConfirmDelete(null) });
  }

  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex min-w-0 flex-wrap items-center gap-2 text-left"
          aria-expanded={expanded}
        >
          {expanded ? (
            <ChevronDown size={16} className="shrink-0 text-muted-foreground" strokeWidth={2} />
          ) : (
            <ChevronRight size={16} className="shrink-0 text-muted-foreground" strokeWidth={2} />
          )}
          <Layers size={16} className="shrink-0 text-cyan-700" strokeWidth={2} />
          <h2 className="text-sm font-medium text-foreground">Somas de Alarme</h2>
          <span className="rounded-full border border-border px-1.5 py-0.5 text-[11px] tabular-nums text-muted-foreground">
            {alarmGroups.length}
          </span>
          <span className="hidden truncate text-xs text-muted-foreground sm:inline">
            agrupam os alarmes cadastrados deste site em um indicador único
          </span>
        </button>
        <button
          type="button"
          onClick={() => setGroupModal({ mode: 'create' })}
          className="flex shrink-0 items-center gap-1.5 rounded-md bg-cyan-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-800 transition-colors"
        >
          <Plus size={14} strokeWidth={2} /> Nova soma
        </button>
      </div>

      {expanded && (
        isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="h-12 w-full animate-pulse rounded bg-muted/50" />
            ))}
          </div>
        ) : alarmGroups.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nenhuma soma de alarme cadastrada para este site.</p>
        ) : (
          <ul className="max-h-80 divide-y divide-border overflow-y-auto">
            {alarmGroups.map((g) => {
              const active = g.aggregate.active > 0;
              return (
                <li key={g.id} className="flex items-center gap-3 px-4 py-3">
                  <div
                    className={`flex h-10 min-w-14 items-center justify-center rounded-md px-2 text-sm font-semibold tabular-nums ${
                      active ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'
                    }`}
                  >
                    {g.aggregate.active}/{g.aggregate.total}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">{g.name}</span>
                      {!g.enabled && <span className="rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">desabilitada</span>}
                      {active && g.aggregate.severity && (
                        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                          g.aggregate.severity === 'HIGH' ? 'bg-red-100 text-red-700'
                            : g.aggregate.severity === 'MEDIUM' ? 'bg-amber-100 text-amber-700'
                            : 'bg-cyan-100 text-cyan-700'
                        }`}>
                          {g.aggregate.severity === 'HIGH' ? 'Alta' : g.aggregate.severity === 'MEDIUM' ? 'Média' : 'Baixa'}
                        </span>
                      )}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{g.members.length} alarme(s) cadastrado(s)</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setGroupModal({ mode: 'edit', group: g })}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
                    aria-label="Editar"
                  >
                    <Pencil size={14} strokeWidth={2} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(g)}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-red-50 hover:text-red-600 transition-colors"
                    aria-label="Excluir"
                  >
                    <Trash2 size={14} strokeWidth={2} />
                  </button>
                </li>
              );
            })}
          </ul>
        )
      )}

      {groupModal && (
        <AlarmGroupModal
          tenantId={tenantId}
          sites={sites}
          group={groupModal.mode === 'edit' ? groupModal.group : undefined}
          onClose={() => setGroupModal(null)}
          onSaved={() => setGroupModal(null)}
        />
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm space-y-4 rounded-xl border border-border bg-card p-6 shadow-xl">
            <h2 className="text-sm font-semibold text-foreground">Excluir soma de alarmes?</h2>
            <p className="text-sm text-muted-foreground">
              A soma <span className="font-medium text-foreground">&ldquo;{confirmDelete.name}&rdquo;</span> será removida.
              Os alarmes que a compõem não serão afetados. Esta ação não pode ser desfeita.
            </p>
            {del.error && (
              <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
                {(del.error as Error).message}
              </p>
            )}
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setConfirmDelete(null)}
                className="h-9 rounded-md border border-border px-4 text-sm text-foreground transition-colors hover:bg-muted/50"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmDelete}
                disabled={del.isPending}
                className="flex h-9 items-center gap-2 rounded-md bg-red-600 px-4 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
              >
                {del.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
