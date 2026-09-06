'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, X } from 'lucide-react';
import { getAlarmRules } from '../services/alarms-api.service';
import { useCreateAlarmGroup, useUpdateAlarmGroup } from '../hooks/useAlarmGroups';
import type { AlarmGroup } from '@/modules/scada/services/alarm-groups.service';
import type { SiteItem } from '@/modules/sites/services/sites.service';
import { useT, useLanguage } from '@/lib/i18n';

interface Props {
  tenantId: string;
  sites: SiteItem[];
  /** Quando presente, abre em modo edição. */
  group?: AlarmGroup;
  onClose: () => void;
  onSaved: () => void;
}

const inputCls =
  'w-full rounded-md border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500';

export function AlarmGroupModal({ tenantId, sites, group, onClose, onSaved }: Props) {
  const t = useT();
  const lang = useLanguage();
  const isEdit = Boolean(group);
  const [name, setName] = useState(group?.name ?? '');
  const [siteId, setSiteId] = useState(group?.siteId ?? sites[0]?.id ?? '');
  const [enabled, setEnabled] = useState(group?.enabled ?? true);
  const [memberIds, setMemberIds] = useState<string[]>(group?.members.map((m) => m.alarmRuleId) ?? []);
  const [error, setError] = useState<string | null>(null);

  const create = useCreateAlarmGroup();
  const update = useUpdateAlarmGroup();
  const pending = create.isPending || update.isPending;

  // Regras de alarme do site escolhido — candidatas a membro do grupo.
  // Busca SEMPRE uma lista fresca ao abrir o modal / trocar de site. Sem isto,
  // a query herda o staleTime global (30s) e o React Query serve o cache antigo
  // (stale-while-revalidate): um alarme recém-criado só surge — e um excluído só
  // some — depois que o refetch em segundo plano termina. Usamos `isFetching`
  // como gate de loading (em vez de `isLoading`, que cobre apenas a 1ª busca)
  // para nunca exibir a lista obsoleta durante a revalidação.
  const { data: rules = [], isFetching: rulesLoading } = useQuery({
    queryKey: ['alarm-rules', 'for-group', tenantId, siteId],
    queryFn: () => getAlarmRules({ tenantId, siteId }),
    enabled: Boolean(tenantId && siteId),
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchInterval: false,
  });

  function toggleMember(id: string) {
    setMemberIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError(t('Informe um nome para a soma de alarmes'));
    if (!isEdit && !siteId) return setError(t('Selecione um site'));

    if (isEdit && group) {
      update.mutate(
        { id: group.id, input: { name: name.trim(), enabled, memberRuleIds: memberIds } },
        { onSuccess: () => { onSaved(); onClose(); }, onError: (err: Error) => setError(err.message) },
      );
    } else {
      create.mutate(
        { siteId, name: name.trim(), enabled, memberRuleIds: memberIds },
        { onSuccess: () => { onSaved(); onClose(); }, onError: (err: Error) => setError(err.message) },
      );
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-base font-semibold text-foreground">{isEdit ? t('Editar Soma de Alarmes') : t('Nova Soma de Alarmes')}</h2>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="max-h-[70vh] space-y-4 overflow-y-auto px-6 py-5">
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">{t('Nome')}</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} autoFocus placeholder={t('Ex.: Alarmes Críticos — Subsolo')} />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">{t('Site')}</label>
            {isEdit ? (
              <input type="text" value={group?.siteName ?? ''} disabled className={`${inputCls} cursor-not-allowed bg-muted/40 text-muted-foreground`} />
            ) : (
              <select value={siteId} onChange={(e) => { setSiteId(e.target.value); setMemberIds([]); }} className={`${inputCls} cursor-pointer`}>
                <option value="">{t('— selecionar —')}</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            )}
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="block text-sm font-medium text-foreground">{t('Alarmes do grupo')}</label>
              <span className="text-[11px] text-muted-foreground">
                {lang === 'en' ? `${memberIds.length} selected` : `${memberIds.length} selecionado(s)`}
              </span>
            </div>
            {!siteId ? (
              <p className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">{t('Selecione um site para listar os alarmes.')}</p>
            ) : rulesLoading ? (
              <p className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">{t('Carregando alarmes…')}</p>
            ) : rules.length === 0 ? (
              <p className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">{t('Nenhum alarme cadastrado neste site.')}</p>
            ) : (
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-border p-2">
                {rules.map((r) => (
                  <label key={r.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-muted/50">
                    <input type="checkbox" checked={memberIds.includes(r.id)} onChange={() => toggleMember(r.id)} className="accent-cyan-600" />
                    <span className="flex-1 truncate text-foreground">{r.name}</span>
                    {r.point?.tag && (
                      <span className="truncate text-[11px] text-muted-foreground">{r.point.tag}</span>
                    )}
                  </label>
                ))}
              </div>
            )}
          </div>

          <label className="flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="accent-cyan-600" />
            {t('Habilitado')}
          </label>

          {error && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/50 transition-colors">
              {t('Cancelar')}
            </button>
            <button type="submit" disabled={pending} className="flex items-center gap-2 rounded-md bg-cyan-700 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-800 disabled:opacity-50 transition-colors">
              {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {isEdit ? t('Salvar') : t('Criar')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
