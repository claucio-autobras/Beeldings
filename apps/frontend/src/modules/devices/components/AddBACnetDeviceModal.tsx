'use client';

import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, ArrowLeft, CheckSquare, ChevronDown, Loader2, Radar, SearchX, Square, Wifi, X } from 'lucide-react';
import { type BACnetDevice, type DiscoveredBACnetPoint } from '@/mocks/data/devices.mock';
import { type BacnetDiscoverySource, type DiscoveredBacnetDevice, createBACnetDevice, discoverBACnetPoints, scanBacnetNetwork } from '../services/devices.service';
import { translateDeviceError } from '../utils/device-errors';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useSites } from '@/modules/sites/hooks/useSites';
import { getProjects } from '@/modules/projects/services/projects.service';
import { useTenants } from '@/modules/tenants/hooks/useTenants';
import ConnectionTestProgress from './ConnectionTestProgress';

// ─── Tipos locais ─────────────────────────────────────────────────────────────

type Step = 'form' | 'scanning' | 'scan-results' | 'loading' | 'error' | 'points';

interface EditablePoint extends DiscoveredBACnetPoint {
  /** Tag editável pelo admin — inicia igual ao objectName convertido */
  editableTag: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (device: BACnetDevice) => void;
}

// ─── Constantes visuais ───────────────────────────────────────────────────────

const OBJECT_TYPE_BADGE: Record<string, string> = {
  AI:  'bg-blue-50 text-blue-700 border-blue-200',
  AO:  'bg-indigo-50 text-indigo-700 border-indigo-200',
  BI:  'bg-teal-50 text-teal-700 border-teal-200',
  BO:  'bg-orange-50 text-orange-700 border-orange-200',
  AV:  'bg-purple-50 text-purple-700 border-purple-200',
  BV:  'bg-pink-50 text-pink-700 border-pink-200',
  MSI: 'bg-amber-50 text-amber-700 border-amber-200',
  MSO: 'bg-rose-50 text-rose-700 border-rose-200',
  MSV: 'bg-amber-50 text-amber-800 border-amber-300',
  ACC: 'bg-lime-50 text-lime-700 border-lime-200',
  PC:  'bg-lime-50 text-lime-800 border-lime-300',
  CSV: 'bg-slate-50 text-slate-700 border-slate-200',
  IV:  'bg-sky-50 text-sky-700 border-sky-200',
  LAV: 'bg-violet-50 text-violet-700 border-violet-200',
  PIV: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

/** Descrição amigável da origem da lista de pontos. */
const DISCOVERY_SOURCE_INFO: Record<BacnetDiscoverySource, { label: string; exact: boolean; hint: string }> = {
  objectList: {
    label: 'Lista completa da controladora',
    exact: true,
    hint: 'A controladora informou a lista exata de objetos (objectList).',
  },
  objectListIndex: {
    label: 'Lista completa da controladora (índice a índice)',
    exact: true,
    hint: 'A lista exata de objetos foi lida índice a índice — resultado completo.',
  },
  scan: {
    label: 'Varredura heurística',
    exact: false,
    hint: 'A controladora não expôs a lista de objetos; os pontos foram encontrados por varredura de instâncias comuns e podem não incluir todos os objetos.',
  },
};

const inputCls  = 'w-full h-9 px-3 text-sm border border-border rounded-md bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring';
const labelCls  = 'block text-xs font-medium text-foreground mb-1';
const selectCls = `${inputCls} cursor-pointer`;

// ─── Utilitário: nome do ponto → tag SNAKE_CASE_UPPER ─────────────────────────

function toTagName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')    // remove acentos
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

// ─── Componente ───────────────────────────────────────────────────────────────

export default function AddBACnetDeviceModal({ open, onClose, onCreated }: Props) {
  const user = useCurrentUser();
  const isGlobalRole = user.role === 'ADMIN' || user.role === 'CCO' || user.role === 'SUPERVISOR';

  const [step, setStep]     = useState<Step>('form');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  // 'connection' = falha ao achar/conectar a controladora; 'validation' = campos.
  const [errorKind, setErrorKind] = useState<'connection' | 'validation'>('connection');

  // Coordenação: só transita para 'points' quando API E animação terminaram
  const apiDoneRef  = useRef(false);
  const animDoneRef = useRef(false);

  // Campos do formulário
  const [name, setName]                         = useState('');
  const [selectedClientId, setSelectedClientId] = useState('');
  const [siteId, setSiteId]                     = useState('');
  const [siteGatewayId, setSiteGatewayId]       = useState('');
  const [siteName, setSiteName]                 = useState('');
  const [siteOpen, setSiteOpen]                 = useState(false);
  const [projectId, setProjectId]               = useState('');
  const [ip, setIp]                             = useState('');
  const [port, setPort]                         = useState('47808');
  const [deviceInstance, setDeviceInstance]     = useState('');

  // Pontos descobertos com tag editável
  const [points, setPoints]       = useState<EditablePoint[]>([]);
  const [selected, setSelected]   = useState<Set<number>>(new Set());
  const [discoveredCount, setDiscoveredCount] = useState<number | undefined>(undefined);

  // Metadados do discovery: origem da lista + rota/instância resolvidas pelo gateway
  const [discoverySource, setDiscoverySource] = useState<BacnetDiscoverySource | undefined>(undefined);
  const [resolvedInstance, setResolvedInstance] = useState<number | null>(null);
  const [route, setRoute] = useState<{ net: number | null; adr: number[] | null }>({ net: null, adr: null });

  // Controladoras encontradas no scan de rede (Who-Is broadcast)
  const [scanResults, setScanResults] = useState<DiscoveredBacnetDevice[]>([]);

  // Dados reais do backend
  const effectiveTenantId = isGlobalRole ? selectedClientId : (user.tenantId ?? '');
  const { data: tenants = [] } = useTenants();
  const { data: allSites = [] } = useSites(effectiveTenantId || undefined);
  const { data: siteProjects = [] } = useQuery({
    queryKey: ['projects', siteId || null, effectiveTenantId || null],
    queryFn: () => getProjects(siteId || undefined, effectiveTenantId || undefined),
    enabled: !!siteId,
  });

  if (!open) return null;

  const availableSites = allSites;
  const filteredSites = availableSites.filter((s) =>
    s.name.toLowerCase().includes(siteName.toLowerCase()),
  );

  // ── Handlers ────────────────────────────────────────────────────────────────

  function resetAndClose() {
    setStep('form');
    setName('');
    setSelectedClientId('');
    setSiteId('');
    setSiteGatewayId('');
    setSiteName('');
    setSiteOpen(false);
    setProjectId('');
    setIp('');
    setPort('47808');
    setDeviceInstance('');
    setPoints([]);
    setSelected(new Set());
    setDiscoveredCount(undefined);
    setDiscoverySource(undefined);
    setResolvedInstance(null);
    setRoute({ net: null, adr: null });
    setScanResults([]);
    setErrorMsg('');
    apiDoneRef.current  = false;
    animDoneRef.current = false;
    onClose();
  }

  function handleClientChange(clientId: string) {
    setSelectedClientId(clientId);
    setSiteId('');
    setSiteGatewayId('');
    setSiteName('');
    setProjectId('');
  }

  function handleProjectChange(id: string) {
    setProjectId(id);
    const proj = siteProjects.find((p) => p.id === id);
    setSiteGatewayId(proj?.gateway?.id ?? '');
  }

  function tryTransitionToPoints() {
    if (apiDoneRef.current && animDoneRef.current) {
      setStep('points');
    }
  }

  /**
   * Dispara o scan de rede (Who-Is broadcast) no gateway do projeto selecionado.
   * Mostra a lista de controladoras encontradas para o usuário escolher uma.
   */
  async function handleScan() {
    if (!effectiveTenantId || !siteGatewayId) {
      setErrorKind('validation');
      setErrorMsg('Selecione o cliente e o local antes de escanear a rede.');
      setStep('error');
      return;
    }
    setErrorMsg('');
    setStep('scanning');
    try {
      const devices = await scanBacnetNetwork({
        tenantId: effectiveTenantId,
        gatewayId: siteGatewayId,
      });
      setScanResults(devices);
      setStep('scan-results');
    } catch (err: unknown) {
      setErrorKind('connection');
      setErrorMsg(translateDeviceError(err, { fallback: 'Erro ao escanear a rede.' }));
      setStep('error');
    }
  }

  /**
   * Usuário escolheu uma controladora encontrada no scan — preenche IP/porta/
   * instância automaticamente e volta ao formulário para confirmar/seguir
   * direto para o discovery de pontos.
   */
  function handleSelectScannedDevice(device: DiscoveredBacnetDevice) {
    // O gateway pode reportar "ip:porta" quando a controladora usa porta não-padrão
    const [bareIp, embeddedPort] = device.ip.includes(':')
      ? [device.ip.slice(0, device.ip.lastIndexOf(':')), device.ip.slice(device.ip.lastIndexOf(':') + 1)]
      : [device.ip, null];
    setIp(bareIp);
    setPort(String(device.port ?? (embeddedPort && /^\d+$/.test(embeddedPort) ? Number(embeddedPort) : 47808)));
    setDeviceInstance(String(device.instance));
    // Rota BACnet (device MS/TP atrás de roteador) — repassada ao discovery e ao salvar
    setRoute({
      net: typeof device.net === 'number' && device.net > 0 ? device.net : null,
      adr: Array.isArray(device.adr) && device.adr.length > 0 ? device.adr : null,
    });
    if (!name.trim()) {
      setName(device.modelName || device.objectName || `Controladora ${device.instance}`);
    }
    setStep('form');
  }

  async function handleDiscover() {
    if (!effectiveTenantId || !siteGatewayId) {
      setErrorKind('validation');
      setErrorMsg('Selecione o cliente e o local antes de buscar os pontos.');
      setStep('error');
      return;
    }
    setErrorMsg('');
    apiDoneRef.current  = false;
    animDoneRef.current = false;
    setStep('loading');
    try {
      const outcome = await discoverBACnetPoints({
        ip,
        port: Number(port),
        deviceInstance: deviceInstance ? Number(deviceInstance) : undefined,
        net: route.net,
        adr: route.adr,
        tenantId: effectiveTenantId,
        gatewayId: siteGatewayId,
      });

      const editable: EditablePoint[] = outcome.points.map((p) => ({
        ...p,
        editableTag: toTagName(p.objectName ?? p.tag),
      }));

      setPoints(editable);
      setSelected(new Set(editable.map((_, i) => i)));
      setDiscoveredCount(editable.length);
      setDiscoverySource(outcome.discoverySource);
      setResolvedInstance(outcome.deviceInstance ?? null);
      // O gateway pode ter descoberto a rota via I-Am mesmo sem o scan
      if (outcome.net || outcome.adr) {
        setRoute({ net: outcome.net ?? null, adr: outcome.adr ?? null });
      }
      apiDoneRef.current = true;
      tryTransitionToPoints();
    } catch (err: unknown) {
      setErrorKind('connection');
      setErrorMsg(translateDeviceError(err, { ip, port, fallback: 'Não foi possível buscar os pontos da controladora.' }));
      setStep('error');
    }
  }

  function handleAnimationComplete() {
    animDoneRef.current = true;
    tryTransitionToPoints();
  }

  function updateTag(idx: number, value: string) {
    setPoints((prev) =>
      prev.map((p, i) => (i === idx ? { ...p, editableTag: value } : p)),
    );
  }

  function togglePoint(idx: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  }

  function toggleAll() {
    setSelected(
      selected.size === points.length
        ? new Set()
        : new Set(points.map((_, i) => i)),
    );
  }

  async function handleSave() {
    if (selected.size === 0) return;
    setSaving(true);
    try {
      const selectedSite = allSites.find((s) => s.id === siteId);
      const selectedPoints = points
        .filter((_, i) => selected.has(i))
        .map((p) => ({ ...p, tag: p.editableTag }));

      const effectiveInstance = resolvedInstance
        ?? (deviceInstance ? Number(deviceInstance) : undefined);

      const device = await createBACnetDevice({
        name,
        site: selectedSite?.name ?? siteName,
        siteId,
        tenantId: effectiveTenantId,
        gatewayId: siteGatewayId,
        ip,
        port: Number(port),
        protocol: 'bacnet',
        deviceInstance: effectiveInstance ?? undefined,
        net: route.net,
        adr: route.adr,
        selectedPoints,
      });
      onCreated(device);
      resetAndClose();
    } catch (err: unknown) {
      setErrorMsg(translateDeviceError(err, { ip, port, fallback: 'Erro ao salvar dispositivo.' }));
      setStep('error');
    } finally {
      setSaving(false);
    }
  }

  // ── Derivações ──────────────────────────────────────────────────────────────

  const clientSelected = isGlobalRole ? !!selectedClientId : true;
  const formValid      = name && siteId && projectId && siteGatewayId && ip && port && clientSelected;
  const selectedCount  = selected.size;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-3xl max-h-[90vh] bg-card rounded-xl border border-border shadow-xl flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4 shrink-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Wifi className="h-4 w-4 text-cyan-600" />
            Adicionar Dispositivo BACnet
          </h2>
          <button
            onClick={resetAndClose}
            aria-label="Fechar modal"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 px-5 py-4 overflow-y-auto space-y-4">

          {/* ── Etapa 1 — Formulário ── */}
          {(step === 'form' || step === 'error') && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

              {/* Cliente — apenas roles globais */}
              {isGlobalRole && (
                <div className="sm:col-span-2">
                  <label className={labelCls}>
                    Cliente <span className="text-red-500">*</span>
                  </label>
                  <select
                    className={selectCls}
                    value={selectedClientId}
                    onChange={(e) => handleClientChange(e.target.value)}
                  >
                    <option value="">Selecione o cliente</option>
                    {tenants.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Nome da controladora */}
              <div className="sm:col-span-2">
                <label className={labelCls}>
                  Nome da controladora <span className="text-red-500">*</span>
                </label>
                <input
                  className={inputCls}
                  placeholder="Ex: MCP-46D Bloco A"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              {/* Local — Combobox */}
              <div className="relative">
                <label className={labelCls}>
                  Site <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <input
                    className={inputCls}
                    placeholder="Selecione ou digite um local"
                    value={siteName}
                    onChange={(e) => {
                      setSiteName(e.target.value);
                      setSiteId('');
                      setSiteGatewayId('');
                      setProjectId('');
                      setSiteOpen(true);
                    }}
                    onFocus={() => setSiteOpen(true)}
                    onBlur={() => setTimeout(() => setSiteOpen(false), 150)}
                    autoComplete="off"
                  />
                  <div className="absolute inset-y-0 right-2 flex items-center gap-1 pointer-events-none">
                    {siteName && (
                      <button
                        type="button"
                        className="pointer-events-auto text-muted-foreground hover:text-foreground"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setSiteId('');
                          setSiteName('');
                          setProjectId('');
                          setSiteGatewayId('');
                          setSiteOpen(false);
                        }}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                </div>

                {siteOpen && (
                  <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-card border border-border rounded-md shadow-lg overflow-y-auto max-h-40">
                    {filteredSites.length > 0 ? (
                      filteredSites.map((s) => (
                        <div
                          key={s.id}
                          className="px-3 py-2 text-sm cursor-pointer hover:bg-muted/50"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setSiteId(s.id);
                            setSiteName(s.name);
                            setProjectId('');
                            setSiteGatewayId('');
                            setSiteOpen(false);
                          }}
                        >
                          <span>{s.name}</span>
                          {typeof s._count?.projects === 'number' && (
                            <span className="ml-2 text-xs text-muted-foreground">
                              ({s._count.projects} projeto{s._count.projects !== 1 ? 's' : ''})
                            </span>
                          )}
                        </div>
                      ))
                    ) : siteName.trim() ? (
                      <div className="px-3 py-2 text-sm text-muted-foreground">
                        Nenhum local encontrado para <span className="font-medium">{siteName}</span>
                      </div>
                    ) : (
                      <div className="px-3 py-2 text-sm text-muted-foreground">
                        {allSites.length === 0 ? 'Nenhum local cadastrado' : 'Digite para filtrar'}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Projeto — define o gateway do dispositivo */}
              <div>
                <label className={labelCls}>
                  Projeto <span className="text-red-500">*</span>
                </label>
                <select
                  className={selectCls}
                  value={projectId}
                  onChange={(e) => handleProjectChange(e.target.value)}
                  disabled={!siteId}
                >
                  <option value="">
                    {!siteId
                      ? 'Selecione um local primeiro'
                      : siteProjects.length === 0
                        ? 'Nenhum projeto neste local'
                        : 'Selecione o projeto'}
                  </option>
                  {siteProjects.map((p) => (
                    <option key={p.id} value={p.id} disabled={!p.gateway}>
                      {p.name}{!p.gateway ? ' (sem gateway)' : ''}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-muted-foreground mt-1">
                  O dispositivo será vinculado ao gateway deste projeto.
                </p>
              </div>

              {/* Endereço IP */}
              <div>
                <label className={labelCls}>
                  Endereço IP <span className="text-red-500">*</span>
                </label>
                <input
                  className={inputCls}
                  placeholder="Digite o endereço IP do dispositivo"
                  value={ip}
                  onChange={(e) => setIp(e.target.value)}
                />
              </div>

              {/* Porta BACnet */}
              <div>
                <label className={labelCls}>
                  Porta BACnet <span className="text-red-500">*</span>
                </label>
                <input
                  className={inputCls}
                  type="number"
                  placeholder="47808"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                />
              </div>

              {/* Device Instance removido — descoberta automática via Who-Is */}

              {/* Scan de rede — descobre controladoras automaticamente via Who-Is broadcast */}
              <div className="sm:col-span-2">
                <button
                  type="button"
                  onClick={handleScan}
                  disabled={!effectiveTenantId || !siteGatewayId}
                  className="h-9 px-4 text-sm rounded-md font-medium border border-cyan-200 bg-cyan-50 text-cyan-800 hover:bg-cyan-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                >
                  <Radar className="h-4 w-4" />
                  Escanear rede
                </button>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Procura automaticamente controladoras BACnet na rede do gateway e preenche o
                  IP/porta para você.
                </p>
              </div>

              {/* Erro de validação (campos faltando) */}
              {step === 'error' && errorKind === 'validation' && errorMsg && (
                <div className="sm:col-span-2 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
                  <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-red-800">Atenção</p>
                    <p className="text-xs text-red-700 mt-0.5">{errorMsg}</p>
                  </div>
                </div>
              )}

              {/* Controladora não encontrada — mensagem amigável e orientativa */}
              {step === 'error' && errorKind === 'connection' && (
                <div className="sm:col-span-2 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                  <SearchX className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-amber-900">Não foi possível encontrar a controladora</p>
                    <p className="text-xs text-amber-800 mt-0.5">
                      Não houve resposta em{' '}
                      <span className="font-mono">{ip || '—'}{port ? `:${port}` : ''}</span>. Verifique se o
                      endereço IP e a porta estão corretos e se o dispositivo está ligado e acessível pela rede
                      do gateway, e tente novamente.
                    </p>
                    {errorMsg && (
                      <p className="text-[11px] text-amber-700/70 mt-1.5">Detalhe técnico: {errorMsg}</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Etapa Scan — Procurando controladoras na rede ── */}
          {step === 'scanning' && (
            <ConnectionTestProgress
              protocol="bacnet"
              onComplete={() => {}}
              title="Escaneando a rede…"
              description="Varrendo os IPs da rede do gateway em busca de controladoras BACnet. Isso pode levar até 1 minuto."
            />
          )}

          {/* ── Etapa Scan — Resultado: controladoras encontradas ── */}
          {step === 'scan-results' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {scanResults.length > 0 ? (
                    <>
                      <span className="font-semibold text-foreground">{scanResults.length}</span>{' '}
                      controladora{scanResults.length !== 1 ? 's' : ''} encontrada{scanResults.length !== 1 ? 's' : ''}.
                      Selecione uma para continuar:
                    </>
                  ) : (
                    'Nenhuma controladora encontrada na rede do gateway.'
                  )}
                </p>
                <button
                  onClick={() => setStep('form')}
                  className="text-xs font-medium text-cyan-700 hover:underline flex items-center gap-1 shrink-0"
                >
                  <ArrowLeft className="h-3 w-3" />
                  Voltar
                </button>
              </div>

              {scanResults.length > 0 ? (
                <div className="border border-border rounded-lg overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/40 border-b border-border">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">IP</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">Instância</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">Rede</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">Fabricante</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">Modelo / Nome</th>
                          <th className="w-10 px-3 py-2"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {scanResults.map((d) => (
                          <tr key={`${d.ip}-${d.instance}-${d.net ?? 0}`} className="hover:bg-cyan-50/40 transition-colors">
                            <td className="px-3 py-2 text-xs font-mono text-foreground whitespace-nowrap">
                              {d.ip}{d.port && d.port !== 47808 ? `:${d.port}` : ''}
                            </td>
                            <td className="px-3 py-2 text-xs text-muted-foreground tabular-nums whitespace-nowrap">{d.instance}</td>
                            <td className="px-3 py-2 text-xs whitespace-nowrap">
                              {typeof d.net === 'number' && d.net > 0 ? (
                                <span
                                  className="inline-flex px-1.5 py-0.5 rounded text-[11px] font-medium border bg-cyan-50 text-cyan-800 border-cyan-200"
                                  title={`Dispositivo MS/TP atrás de roteador BACnet — rede ${d.net}`}
                                >
                                  MS/TP · rede {d.net}
                                </span>
                              ) : (
                                <span className="text-muted-foreground">Local (IP)</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-xs text-foreground whitespace-nowrap">{d.vendorName ?? '—'}</td>
                            <td className="px-3 py-2 text-xs text-foreground whitespace-nowrap max-w-[200px] truncate" title={d.modelName ?? d.objectName ?? ''}>
                              {d.modelName ?? d.objectName ?? '—'}
                            </td>
                            <td className="px-3 py-2">
                              <button
                                onClick={() => handleSelectScannedDevice(d)}
                                className="h-7 px-3 text-xs rounded-md font-medium bg-cyan-700 text-white hover:bg-cyan-800 transition-colors whitespace-nowrap"
                              >
                                Usar
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                  <SearchX className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-amber-900">Nenhuma controladora respondeu</p>
                    <p className="text-xs text-amber-800 mt-0.5">
                      Verifique se as controladoras estão ligadas e na mesma rede local do gateway, ou
                      informe o IP manualmente.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Etapa 2 — Progresso animado ── */}
          {step === 'loading' && (
            <ConnectionTestProgress
              protocol="bacnet"
              onComplete={handleAnimationComplete}
              pointsReady={discoveredCount}
              target={ip ? `${ip}${port ? `:${port}` : ''}` : undefined}
            />
          )}

          {/* ── Etapa 3 — Pontos descobertos ── */}
          {step === 'points' && (
            <div className="space-y-3">

              {/* Resumo + controle "selecionar todos" */}
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  <span className="font-semibold text-foreground">{points.length} pontos</span>{' '}
                  encontrados. Selecione os que deseja monitorar:
                </p>
                <button
                  onClick={toggleAll}
                  className="text-xs font-medium text-cyan-700 hover:underline"
                >
                  {selectedCount === points.length ? 'Desmarcar todos' : 'Selecionar todos'}
                </button>
              </div>

              {/* Origem da lista de pontos (exata vs varredura heurística) */}
              {discoverySource && DISCOVERY_SOURCE_INFO[discoverySource] && (
                <div
                  className={`flex items-start gap-2 rounded-lg border px-3 py-2 ${
                    DISCOVERY_SOURCE_INFO[discoverySource].exact
                      ? 'border-emerald-200 bg-emerald-50'
                      : 'border-amber-200 bg-amber-50'
                  }`}
                >
                  <AlertCircle className={`h-4 w-4 mt-0.5 shrink-0 ${
                    DISCOVERY_SOURCE_INFO[discoverySource].exact ? 'text-emerald-600' : 'text-amber-600'
                  }`} />
                  <div>
                    <p className={`text-xs font-medium ${
                      DISCOVERY_SOURCE_INFO[discoverySource].exact ? 'text-emerald-800' : 'text-amber-900'
                    }`}>
                      {DISCOVERY_SOURCE_INFO[discoverySource].label}
                    </p>
                    <p className={`text-[11px] mt-0.5 ${
                      DISCOVERY_SOURCE_INFO[discoverySource].exact ? 'text-emerald-700' : 'text-amber-800'
                    }`}>
                      {DISCOVERY_SOURCE_INFO[discoverySource].hint}
                    </p>
                  </div>
                </div>
              )}

              {/* Tabela de pontos */}
              <div className="border border-border rounded-lg overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 border-b border-border">
                      <tr>
                        <th className="w-10 px-3 py-2 text-left"></th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">Tipo</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">Inst.</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">Nome (dispositivo)</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">Tag (editável)</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">Unidade</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {points.map((p, i) => {
                        const isSelected = selected.has(i);
                        return (
                          <tr
                            key={i}
                            className={`transition-colors ${isSelected ? 'bg-card hover:bg-cyan-50/40' : 'bg-muted/20 opacity-60'}`}
                          >
                            {/* Checkbox */}
                            <td className="px-3 py-2">
                              <button
                                type="button"
                                onClick={() => togglePoint(i)}
                                aria-label={isSelected ? 'Desmarcar ponto' : 'Selecionar ponto'}
                                className="flex items-center justify-center"
                              >
                                {isSelected
                                  ? <CheckSquare className="h-4 w-4 text-cyan-700" />
                                  : <Square className="h-4 w-4 text-muted-foreground" />}
                              </button>
                            </td>

                            {/* Tipo / Badge */}
                            <td className="px-3 py-2">
                              <span className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium border ${OBJECT_TYPE_BADGE[String(p.objectType)] ?? 'bg-gray-50 text-gray-600 border-gray-200'}`}>
                                {String(p.objectType)}
                              </span>
                            </td>

                            {/* Instância */}
                            <td className="px-3 py-2 text-xs text-muted-foreground tabular-nums">
                              {p.instance}
                            </td>

                            {/* Nome original do dispositivo */}
                            <td
                              className={`px-3 py-2 text-xs whitespace-nowrap max-w-[160px] truncate ${
                                p.unnamed ? 'text-muted-foreground italic' : 'text-foreground font-medium'
                              }`}
                              title={p.unnamed
                                ? `${p.objectName} — o dispositivo não informou nome para este objeto; nome padrão gerado`
                                : p.objectName}
                            >
                              {p.objectName ?? '—'}
                              {p.unnamed && (
                                <span className="ml-1.5 inline-flex px-1 py-0.5 rounded text-[10px] font-medium border bg-gray-50 text-gray-500 border-gray-200 not-italic align-middle">
                                  sem nome
                                </span>
                              )}
                            </td>

                            {/* Tag editável */}
                            <td className="px-3 py-2">
                              <input
                                type="text"
                                value={p.editableTag}
                                onChange={(e) => updateTag(i, e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))}
                                disabled={!isSelected}
                                aria-label={`Tag para ${p.objectName}`}
                                className="h-7 w-full min-w-[110px] px-2 text-xs font-mono border border-border rounded bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-cyan-600 disabled:bg-muted/30 disabled:text-muted-foreground disabled:cursor-not-allowed"
                              />
                            </td>

                            {/* Unidade */}
                            <td className="px-3 py-2 text-xs text-muted-foreground">
                              {p.unit || '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                {selectedCount} de {points.length} ponto{points.length !== 1 ? 's' : ''} selecionado{selectedCount !== 1 ? 's' : ''}.
                {' '}A coluna <span className="font-medium text-foreground">Tag</span> pode ser editada antes de salvar.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-4 shrink-0">
          <button
            onClick={resetAndClose}
            className="h-9 px-4 text-sm border border-border rounded-md text-foreground hover:bg-muted/50 transition-colors"
          >
            Cancelar
          </button>

          {/* Botão Etapa 1 — Testar Conexão */}
          {(step === 'form' || step === 'error') && (
            <button
              onClick={handleDiscover}
              disabled={!formValid}
              className="h-9 px-4 text-sm rounded-md font-medium bg-cyan-700 text-white hover:bg-cyan-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
            >
              <Wifi className="h-4 w-4" />
              {step === 'error' ? 'Tentar novamente' : 'Testar Conexão'}
            </button>
          )}

          {/* Botão Etapa 3 — Salvar Dispositivo */}
          {step === 'points' && (
            <button
              onClick={handleSave}
              disabled={selectedCount === 0 || saving}
              className="h-9 px-4 text-sm rounded-md font-medium bg-cyan-700 text-white hover:bg-cyan-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
            >
              {saving
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : null}
              {saving
                ? 'Salvando...'
                : `Salvar Dispositivo (${selectedCount} ponto${selectedCount !== 1 ? 's' : ''})`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
