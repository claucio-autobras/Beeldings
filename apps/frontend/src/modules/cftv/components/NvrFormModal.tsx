'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Loader2, HardDrive, X } from 'lucide-react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useTenantFilter } from '@/hooks/useTenantFilter';
import { useSiteFilter } from '@/hooks/useSiteFilter';
import { useGateways } from '@/modules/gateways/hooks/useGateways';
import { useSites } from '@/modules/sites/hooks/useSites';
import { useTenants } from '@/modules/tenants/hooks/useTenants';
import {
  type ManagedNvr,
  type NvrInput,
  createNvr,
  updateNvr,
} from '../services/cftv.service';

const inputCls =
  'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-primary';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-foreground">{label}</span>
      {children}
    </label>
  );
}

/** Fabricantes suportados com detecção automática de perfil. */
const MANUFACTURER_OPTIONS = [
  { value: '', label: 'Detecção automática' },
  { value: 'Hikvision', label: 'Hikvision' },
  { value: 'Dahua', label: 'Dahua' },
  { value: 'Intelbras', label: 'Intelbras' },
];

interface Props {
  nvr?: ManagedNvr;
  onClose: () => void;
  onSaved: () => void;
}

export function NvrFormModal({ nvr, onClose, onSaved }: Props) {
  const user = useCurrentUser();
  const isGlobal = user.role === 'ADMIN' || user.role === 'CCO' || user.role === 'SUPERVISOR';
  const { selectedTenantId } = useTenantFilter();
  const { selectedSiteId } = useSiteFilter();
  const { data: tenants = [] } = useTenants();

  const [modalTenantId, setModalTenantId] = useState(
    nvr?.tenantId ?? (isGlobal ? (selectedTenantId ?? '') : (user.tenantId ?? '')),
  );
  const tenantId = nvr?.tenantId ?? (isGlobal ? (modalTenantId || undefined) : (user.tenantId ?? undefined));

  // Perfil global sem cliente escolhido: não busca sites/gateways (tenant
  // vazio no backend = "sem filtro") e mantém os selects travados.
  const tenantChosen = Boolean(tenantId);
  const { data: sites = [] } = useSites(tenantId, { enabled: tenantChosen });
  const { data: gateways = [] } = useGateways(tenantId, { enabled: tenantChosen });

  const [name, setName] = useState(nvr?.name ?? '');
  const [ip, setIp] = useState(nvr?.ip ?? '');
  const [port, setPort] = useState(nvr?.port ?? 161);
  const [snmpVersion, setSnmpVersion] = useState<'1' | '2c'>(nvr?.snmpVersion ?? '2c');
  const [community, setCommunity] = useState(nvr?.community ?? 'public');
  const [pollingInterval, setPollingInterval] = useState(nvr?.pollingInterval ?? 30);
  const [siteId, setSiteId] = useState(nvr?.siteId ?? '');
  const [gatewayId, setGatewayId] = useState(nvr?.gatewayId ?? '');
  const [manufacturer, setManufacturer] = useState(nvr?.manufacturer ?? '');

  const prefillApplied = useRef(false);
  useEffect(() => {
    if (nvr || prefillApplied.current) return;
    if (selectedTenantId === null && selectedSiteId === null) return;
    prefillApplied.current = true;
    if (isGlobal && selectedTenantId && !modalTenantId) {
      setModalTenantId(selectedTenantId);
      if (selectedSiteId && !siteId) setSiteId(selectedSiteId);
    } else if (!isGlobal && selectedSiteId && !siteId) {
      setSiteId(selectedSiteId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTenantId, selectedSiteId]);

  function handleTenantChange(id: string) {
    setModalTenantId(id);
    setSiteId('');
    setGatewayId('');
  }

  const valid = Boolean(name.trim() && ip.trim() && (nvr || (tenantId && gatewayId)));

  const save = useMutation({
    mutationFn: () => {
      const payload: NvrInput = {
        name: name.trim(),
        ip: ip.trim(),
        port: Number(port),
        snmpVersion,
        community: community.trim() || 'public',
        pollingInterval: Number(pollingInterval),
        siteId: siteId || undefined,
        manufacturer: manufacturer.trim() || null,
      };
      if (nvr) return updateNvr(nvr.id, payload);
      return createNvr({ ...payload, tenantId, gatewayId });
    },
    onSuccess: () => onSaved(),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form
        onSubmit={(e) => { e.preventDefault(); if (valid && !save.isPending) save.mutate(); }}
        className="w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-xl space-y-4 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <HardDrive className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">
              {nvr ? 'Editar NVR/DVR' : 'Adicionar NVR/DVR'}
            </h3>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        {isGlobal && !nvr && (
          <Field label="Cliente *">
            <select value={modalTenantId} onChange={(e) => handleTenantChange(e.target.value)} className={inputCls}>
              <option value="">Selecione o cliente…</option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </Field>
        )}

        <Field label="Site">
          <select
            value={siteId}
            onChange={(e) => setSiteId(e.target.value)}
            disabled={!tenantChosen}
            className={inputCls + (!tenantChosen ? ' opacity-60 cursor-not-allowed' : '')}
          >
            <option value="">{tenantChosen ? 'Sem site' : 'Selecione o cliente primeiro'}</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </Field>

        {!nvr && (
          <Field label="Gateway (faz o polling) *">
            <select
              value={gatewayId}
              onChange={(e) => setGatewayId(e.target.value)}
              disabled={!tenantChosen}
              className={inputCls + (!tenantChosen ? ' opacity-60 cursor-not-allowed' : '')}
            >
              <option value="">{tenantChosen ? 'Selecione…' : 'Selecione o cliente primeiro'}</option>
              {gateways.map((g) => (
                <option key={g.id} value={g.id}>{g.id} ({g.status})</option>
              ))}
            </select>
          </Field>
        )}

        <Field label="Nome *">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="NVR-01 — Bloco A"
            className={inputCls}
          />
        </Field>

        <Field label="Fabricante">
          <select
            value={manufacturer}
            onChange={(e) => setManufacturer(e.target.value)}
            className={inputCls}
          >
            {MANUFACTURER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </Field>

        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <Field label="Endereço IP *">
              <input
                value={ip}
                onChange={(e) => setIp(e.target.value)}
                placeholder="192.168.1.100"
                className={inputCls}
              />
            </Field>
          </div>
          <Field label="Porta SNMP">
            <input
              type="number"
              value={port}
              onChange={(e) => setPort(Number(e.target.value))}
              className={inputCls}
            />
          </Field>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Field label="Versão SNMP">
            <select
              value={snmpVersion}
              onChange={(e) => setSnmpVersion(e.target.value as '1' | '2c')}
              className={inputCls}
            >
              <option value="2c">v2c</option>
              <option value="1">v1</option>
            </select>
          </Field>
          <Field label="Community">
            <input
              value={community}
              onChange={(e) => setCommunity(e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="Polling (s)">
            <input
              type="number"
              min={5}
              value={pollingInterval}
              onChange={(e) => setPollingInterval(Number(e.target.value))}
              className={inputCls}
            />
          </Field>
        </div>

        <p className="text-[11px] text-muted-foreground">
          Ao salvar, o sistema testa a conexão SNMP com o NVR via sysUpTime. Se
          não responder, o cadastro é recusado — verifique IP, porta e community.
          Após cadastrar, use &quot;Sincronizar discos/canais&quot; para descobrir
          os discos e canais de gravação via SNMP. O fabricante acelera a detecção
          do perfil de OIDs correto (Hikvision, Dahua, Intelbras).
        </p>

        {save.error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
            {(save.error as Error).message}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!valid || save.isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {nvr ? 'Salvar' : 'Adicionar'}
          </button>
        </div>
      </form>
    </div>
  );
}
