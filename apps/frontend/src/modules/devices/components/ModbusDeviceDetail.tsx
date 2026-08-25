'use client';

import { Fragment, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Bell, ChevronDown, ChevronRight, LineChart, Loader2, Network, Pencil, Plus, Radio, SlidersHorizontal, Trash2, WifiOff } from 'lucide-react';
import type { DeviceStatus, ModbusDevice, ModbusPoint } from '@/mocks/data/devices.mock';
import { formatDataType, formatLastCommunication, formatRegisterType } from '../utils/formatters';
import { useBacnetTelemetry } from '@/hooks/useBacnetTelemetry';
import { deleteModbusPoint, renameDevicePoint, setPointCritical, setPointOpRole, type PointOpRole } from '../services/devices.service';
import { CriticalStarButton } from '@/components/CriticalStarButton';
import { translateDeviceError } from '../utils/device-errors';
import AddModbusPointModal from './AddModbusPointModal';
import { ForceModbusValueControl } from './ForceModbusValueControl';
import { getTrends } from '@/modules/trends/services/trends-api.service';
import { getAlarmRules } from '@/modules/alarms/services/alarms-api.service';
import { PointConfigPanel } from '@/modules/trends/components/PointConfigPanel';
import { OpRoleBadge } from './OpRoleBadge';
import { AlarmGroupsSection } from './AlarmGroupsSection';
import { DeviceTimelineTab } from './DeviceTimelineTab';
import { PointNoCommBadge } from './PointNoCommBadge';
import { showNoCommBadge } from '../utils/point-no-comm';
import {
  NO_COMM_BANNER_CLASS,
  NO_COMM_TEXT_CLASS,
  useDeviceNoCommunication,
} from '../hooks/useDeviceNoCommunication';

/** Modbus: coils/discrete inputs são digitais; demais registradores, analógicos. */
function isModbusDigital(registerType: string | undefined): boolean {
  const t = String(registerType ?? '').toLowerCase();
  return t.includes('coil') || t.includes('discrete');
}

/** Só holding registers e coils aceitam escrita (input/discrete são somente leitura). */
function isModbusWritable(registerType: string | undefined): boolean {
  const t = String(registerType ?? '').toLowerCase();
  return t.includes('holding') || t.includes('coil');
}

const statusConfig: Record<DeviceStatus, { dot: string; label: string }> = {
  online:  { dot: 'bg-emerald-500', label: 'Online'  },
  offline: { dot: 'bg-red-500',     label: 'Offline' },
};

const pointStatusBadge: Record<string, string> = {
  normal: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  alarm:  'bg-red-50 text-red-700 border-red-200',
  fault:  'bg-amber-50 text-amber-700 border-amber-200',
};

// Cor do ícone de alarme conforme a severidade da regra configurada no ponto.
const alarmSeverityColor: Record<string, string> = {
  HIGH: 'text-red-500',
  MEDIUM: 'text-amber-500',
  LOW: 'text-blue-500',
};

// Dica mostrada ao marcar como crítico um ponto sem papel "Status" (traduzida no botão).
const CRITICAL_MARK_HINT =
  'Este ponto sempre aparece no card Ativos Críticos. Defina o papel "Status" (ligado/desligado) ou "Falha" (defeito) no painel do ponto para o card mostrar o estado certo.';

interface Props {
  device: ModbusDevice;
  onBack: () => void;
  /** Deep-link do card Ativos Críticos: ponto a destacar/rolar até. */
  highlightPointId?: string;
}

export default function ModbusDeviceDetail({ device, onBack, highlightPointId }: Props) {
  // Rola até o ponto destacado assim que ele renderiza (uma vez).
  const scrollToHighlight = (el: HTMLElement | null) => {
    el?.scrollIntoView({ block: 'center' });
  };
  const [points, setPoints] = useState<ModbusPoint[]>(device.points);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'points' | 'timeline'>('points');
  const [expandedPointId, setExpandedPointId] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [deletingPointId, setDeletingPointId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [renamingPointId, setRenamingPointId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [savingRename, setSavingRename] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [editingPoint, setEditingPoint] = useState<ModbusPoint | null>(null);
  const [forcingPointId, setForcingPointId] = useState<string | null>(null);
  const status = statusConfig[device.status] ?? statusConfig.offline;
  const qc = useQueryClient();

  // Toggle de ponto crítico (estrela) — otimista, reverte em erro.
  const [criticalById, setCriticalById] = useState<Record<string, boolean>>({});
  const isCritical = (p: { id: string; critical?: boolean }) => criticalById[p.id] ?? !!p.critical;

  // Papel operacional por ponto — override local após salvar no painel (evita refetch).
  const [opRoleById, setOpRoleById] = useState<Record<string, PointOpRole>>({});
  const pointOpRole = (p: { id: string; opRole?: PointOpRole }): PointOpRole =>
    opRoleById[p.id] !== undefined ? opRoleById[p.id] : (p.opRole ?? null);
  async function handleToggleCritical(pointId: string, current: boolean) {
    const next = !current;
    setCriticalById((m) => ({ ...m, [pointId]: next }));
    try {
      await setPointCritical(device.id, pointId, next);
      qc.invalidateQueries({ queryKey: ['devices'] });
      qc.invalidateQueries({ queryKey: ['dashboard-critical-assets'] });
    } catch {
      setCriticalById((m) => ({ ...m, [pointId]: current }));
    }
  }

  async function handleSetStatusRole(pointId: string) {
    await setPointOpRole(device.id, pointId, 'status');
    setOpRoleById((m) => ({ ...m, [pointId]: 'status' }));
    qc.invalidateQueries({ queryKey: ['devices'] });
    qc.invalidateQueries({ queryKey: ['dashboard-critical-assets'] });
  }

  async function handleDeletePoint(pointId: string) {
    setDeletingPointId(pointId);
    setDeleteError(null);
    try {
      await deleteModbusPoint(device.id, pointId);
      setPoints((prev) => prev.filter((p) => p.id !== pointId));
      if (expandedPointId === pointId) setExpandedPointId(null);
      setConfirmingDeleteId(null);
      // Invalida o cache do dispositivo (e trends/alarmes do ponto removido) para
      // refletir a remoção de forma consistente após recarregar/reabrir a tela.
      qc.invalidateQueries({ queryKey: ['devices'] });
      qc.invalidateQueries({ queryKey: ['trends', 'device', device.id] });
      qc.invalidateQueries({ queryKey: ['alarm-rules', 'device', device.id] });
    } catch (err: unknown) {
      setDeleteError(translateDeviceError(err, { fallback: 'Não foi possível excluir o ponto. Tente novamente.' }));
    } finally {
      setDeletingPointId(null);
    }
  }

  // Após salvar a edição técnica, atualiza a lista local e invalida caches que
  // exibem dados do ponto (nome/tag em alarmes/relatórios) — mesmo padrão do MQTT.
  function handlePointUpdated(updated: ModbusPoint) {
    setPoints((prev) => prev.map((p) => (p.id === updated.id ? { ...p, ...updated } : p)));
    setEditingPoint(null);
    qc.invalidateQueries({ queryKey: ['devices'] });
    qc.invalidateQueries({ queryKey: ['alarm-events'] });
  }

  function startRename(pointId: string, currentName: string) {
    setRenamingPointId(pointId);
    setRenameValue(currentName);
    setRenameError(null);
  }

  async function handleRenamePoint(pointId: string) {
    const trimmed = renameValue.trim();
    if (!trimmed) {
      setRenameError('O nome não pode ficar vazio.');
      return;
    }
    setSavingRename(true);
    setRenameError(null);
    try {
      const updated = await renameDevicePoint(device.id, pointId, trimmed);
      // O backend serializa o nome do ponto Modbus como `displayName`, mas o
      // endpoint genérico devolve `objectName` — mapeia para atualizar a lista.
      setPoints((prev) =>
        prev.map((p) => (p.id === pointId ? { ...p, displayName: updated.objectName } : p)),
      );
      setRenamingPointId(null);
      // Invalida caches que exibem o nome do ponto (alarmes/relatórios) para
      // refletir o novo nome sem recarregar a página.
      qc.invalidateQueries({ queryKey: ['devices'] });
      qc.invalidateQueries({ queryKey: ['alarm-events'] });
    } catch (err: unknown) {
      setRenameError(translateDeviceError(err, { fallback: 'Não foi possível renomear o ponto. Tente novamente.' }));
    } finally {
      setSavingRename(false);
    }
  }

  // Editor do nome de exibição do ponto (tag somente leitura). Reutilizado nos
  // cards (mobile) e na tabela (desktop), igual ao padrão do BACnet.
  function renderNameEditor(p: ModbusPoint) {
    return (
      <div className="border-b border-border bg-muted/30 px-4 pt-4">
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">Nome do ponto</span>
          </div>
          {renamingPointId === p.id ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                type="text"
                value={renameValue}
                autoFocus
                disabled={savingRename}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); void handleRenamePoint(p.id); }
                  if (e.key === 'Escape') { setRenamingPointId(null); setRenameError(null); }
                }}
                placeholder="Ex.: Tensão Fase A"
                className="w-full max-w-sm rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400 disabled:opacity-50"
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={savingRename}
                  onClick={() => void handleRenamePoint(p.id)}
                  className="flex items-center gap-1 rounded-md bg-cyan-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-cyan-700 disabled:opacity-50"
                >
                  {savingRename && <Loader2 className="h-3 w-3 animate-spin" />} Salvar
                </button>
                <button
                  type="button"
                  disabled={savingRename}
                  onClick={() => { setRenamingPointId(null); setRenameError(null); }}
                  className="rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted/50 disabled:opacity-50"
                >
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-medium text-foreground">{p.displayName || p.tag}</span>
              <button
                type="button"
                onClick={() => startRename(p.id, p.displayName || p.tag)}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground hover:border-cyan-300 hover:text-cyan-700 transition-colors"
              >
                Editar nome
              </button>
            </div>
          )}
          {renameError && renamingPointId === p.id && (
            <p className="mt-1.5 text-[11px] font-medium text-red-700">{renameError}</p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            Tag (identificador técnico, somente leitura):{' '}
            <span className="font-mono text-foreground">{p.tag}</span>
          </p>
        </div>
      </div>
    );
  }

  // Seção "Forçar valor" — só para pontos comandáveis (holding/coil).
  // Reutilizada nos cards (mobile) e na tabela (desktop), como o nome do ponto.
  function renderForceControl(p: ModbusPoint) {
    if (!isModbusWritable(p.registerType)) return null;
    return (
      <div className="border-b border-border bg-muted/30 px-4 pt-4 pb-4">
        {forcingPointId === p.id ? (
          <ForceModbusValueControl
            device={device}
            point={p}
            onClose={() => setForcingPointId(null)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setForcingPointId(p.id)}
            className="inline-flex items-center gap-1.5 rounded-md border border-cyan-200 bg-cyan-50/50 px-3 py-1.5 text-xs font-medium text-cyan-700 hover:border-cyan-300 hover:bg-cyan-50 transition-colors"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Forçar valor
          </button>
        )}
      </div>
    );
  }

  // Telemetria em tempo real — Modbus casa por tag (não tem objectType/instance).
  // Timeout de loading inicial alinhado ao ciclo real de publicação do gateway
  // (~15s + tempo da leitura), igual ao BACnet.
  const { byTag, connected, initialLoad, lastUpdate } = useBacnetTelemetry({
    enabled: true,
    initialLoadTimeoutMs: 20_000,
    deviceIdFilter: device.id,
  });

  // Detecção de "sem comunicação" compartilhada com BACnet (staleness da
  // telemetria + status do device com carência inicial).
  const { awaitingFirstRead, noCommunication } = useDeviceNoCommunication({
    deviceStatus: device.status,
    lastUpdate,
    initialLoad,
  });

  const { data: deviceTrends = [] } = useQuery({
    queryKey: ['trends', 'device', device.id],
    queryFn: () => getTrends({ deviceId: device.id }),
  });
  const trendByPoint = new Map(deviceTrends.map((t) => [t.pointId, t]));
  const refreshTrends = () => qc.invalidateQueries({ queryKey: ['trends', 'device', device.id] });

  const { data: deviceAlarmRules = [] } = useQuery({
    queryKey: ['alarm-rules', 'device', device.id],
    queryFn: () => getAlarmRules({ deviceId: device.id }),
  });
  const alarmRuleByPoint = new Map(deviceAlarmRules.map((r) => [r.pointId, r]));
  const refreshAlarmRules = () => qc.invalidateQueries({ queryKey: ['alarm-rules', 'device', device.id] });

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      {/* Mobile: linha de controles (Voltar + adicionar ponto) em cima e o título
          ocupando a largura toda embaixo. Desktop (md+): `md:contents` dissolve
          o wrapper e mantém o layout original em linha única. */}
      <div className="flex flex-col gap-3 md:flex-row md:items-start">
        <div className="flex flex-wrap items-center justify-between gap-2 md:contents">
          <button
            onClick={onBack}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors md:order-first md:mt-1"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar
          </button>

          <button
            onClick={() => setAddModalOpen(true)}
            className="flex items-center gap-2 h-9 px-3 text-sm rounded-md font-medium bg-violet-600 text-white hover:bg-violet-700 transition-colors shrink-0 md:order-last"
          >
            <Plus className="h-4 w-4" />
            Adicionar Ponto Modbus
          </button>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-3 flex-wrap">
            <div className="bg-violet-50 border border-violet-200 rounded-lg p-2 shrink-0">
              <Network className="h-5 w-5 text-violet-600" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-semibold text-foreground break-words">{device.name}</h1>
                <span className="text-xs font-medium px-2 py-0.5 rounded border border-violet-200 text-violet-700 bg-violet-50">
                  {device.equipmentType}
                </span>
              </div>
              <div className="flex items-center gap-4 mt-1 flex-wrap text-sm text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-full ${status.dot}`} />
                  {status.label}
                </span>
                {device.connectionType === 'rtu' ? (
                  <span className="font-mono">
                    {device.serial?.path ?? device.ip}
                    {device.serial ? ` @ ${device.serial.baudRate} bps` : ''} (RS485)
                  </span>
                ) : (
                  <span className="font-mono">{device.ip}:{device.port}</span>
                )}
                <span>Unit ID: {device.unitId}</span>
                <span>Polling: {device.pollingInterval}min</span>
                <span>Última comunicação: {formatLastCommunication(device.lastCommunication)}</span>
                {connected ? (
                  <span className="flex items-center gap-1.5 text-emerald-600">
                    <Radio className="h-3 w-3 animate-pulse" />
                    Tempo real{lastUpdate ? ` · ${new Date(lastUpdate).toLocaleTimeString('pt-BR')}` : ''}
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5">
                    <WifiOff className="h-3 w-3" />
                    Sem tempo real
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <AlarmGroupsSection tenantId={device.tenantId} siteId={device.siteId} siteName={device.site} />

      {/* ── Abas: Pontos | Linha do tempo ── */}
      <div className="flex items-center gap-1 border-b border-border">
        <button
          onClick={() => setActiveTab('points')}
          className={`px-3 py-2 text-sm border-b-2 -mb-px transition-colors ${
            activeTab === 'points'
              ? 'border-cyan-600 text-foreground font-medium'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          Pontos
        </button>
        <button
          onClick={() => setActiveTab('timeline')}
          className={`px-3 py-2 text-sm border-b-2 -mb-px transition-colors ${
            activeTab === 'timeline'
              ? 'border-cyan-600 text-foreground font-medium'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          Linha do tempo
        </button>
      </div>

      {activeTab === 'timeline' && <DeviceTimelineTab deviceId={device.id} />}

      {/* ── Banner: sem comunicação com o equipamento ── */}
      {noCommunication && (
        <div role="alert" className={NO_COMM_BANNER_CLASS}>
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Sem comunicação com o equipamento Modbus — verifique se está online.
          </span>
        </div>
      )}

      {/* Tabela */}
      <div className={`bg-card border border-border rounded-lg overflow-hidden ${activeTab === 'timeline' ? 'hidden' : ''}`}>
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <h2 className="text-sm font-medium text-foreground">Pontos Modbus cadastrados</h2>
          <span className="text-xs text-muted-foreground border border-border rounded px-1.5 py-0.5">{points.length} pontos</span>
        </div>

        {/* ── Cards (mobile) — mesma telemetria em tempo real da tabela ── */}
        <div className="md:hidden divide-y divide-border">
          {points.map((p) => {
            const pointTrend = trendByPoint.get(p.id);
            const pointAlarm = alarmRuleByPoint.get(p.id);
            const expanded = expandedPointId === p.id;
            const live = byTag.get(p.tag);
            const digital = isModbusDigital(p.registerType);
            const liveLabel = live
              ? live.value === null
                ? '—'
                : typeof live.value === 'string'
                  ? (p.unit ? `${live.value} ${p.unit}` : live.value)
                  : digital
                    ? (live.value === 1 ? 'ATIVO' : 'INATIVO')
                    : `${live.value.toFixed(2)}${p.unit ? ` ${p.unit}` : ''}`
              : null;

            return (
              <div
                key={p.id}
                ref={p.id === highlightPointId ? scrollToHighlight : undefined}
                className={
                  p.id === highlightPointId
                    ? 'bg-cyan-50/70 ring-1 ring-inset ring-cyan-300 dark:bg-cyan-950/30 dark:ring-cyan-800'
                    : expanded ? 'bg-muted/30' : ''
                }
              >
                <div
                  onClick={() => setExpandedPointId(expanded ? null : p.id)}
                  className="cursor-pointer px-4 py-3 space-y-2 transition-colors active:bg-muted/20"
                >
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                        {pointTrend && <LineChart className="h-3.5 w-3.5 text-cyan-600 shrink-0" strokeWidth={2} aria-label="Trend ativa" />}
                        {pointAlarm && (
                          <Bell
                            className={`h-3.5 w-3.5 shrink-0 ${alarmSeverityColor[pointAlarm.severity] ?? 'text-amber-500'}`}
                            strokeWidth={2}
                            aria-label="Alarme configurado"
                          />
                        )}
                        <span className="min-w-0 break-words">{p.displayName || p.tag}</span>
                        <OpRoleBadge role={pointOpRole(p)} />
                      </div>
                      {p.displayName && (
                        <div className="font-mono text-xs text-muted-foreground mt-0.5 break-all">{p.tag}</div>
                      )}
                    </div>
                    <span className="inline-flex items-center gap-1 shrink-0 text-muted-foreground">
                      <CriticalStarButton critical={isCritical(p)} size={16} onToggle={() => handleToggleCritical(p.id, isCritical(p))} markHint={pointOpRole(p) !== 'status' ? CRITICAL_MARK_HINT : undefined} onSetStatusRole={pointOpRole(p) !== 'status' && isModbusDigital(p.registerType) ? () => handleSetStatusRole(p.id) : undefined} />
                      <button
                        type="button"
                        title="Editar ponto"
                        aria-label="Editar ponto"
                        onClick={(e) => { e.stopPropagation(); setEditingPoint(p); }}
                        className="rounded p-1.5 text-muted-foreground hover:bg-violet-50 hover:text-violet-600 transition-colors"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        title="Excluir ponto"
                        aria-label="Excluir ponto"
                        onClick={(e) => { e.stopPropagation(); setDeleteError(null); setConfirmingDeleteId(p.id); }}
                        className="rounded p-1.5 text-muted-foreground hover:bg-red-50 hover:text-red-600 transition-colors"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                      {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap text-sm">
                    {showNoCommBadge(noCommunication, p.status) ? (
                      <PointNoCommBadge />
                    ) : (
                      <span className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium border capitalize ${pointStatusBadge[p.status] ?? ''}`}>
                        {p.status}
                      </span>
                    )}
                    {liveLabel !== null ? (
                      <span className="flex items-center gap-1.5 min-w-0">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                        <span className="font-medium text-foreground">{liveLabel}</span>
                      </span>
                    ) : awaitingFirstRead ? (
                      <span className="text-muted-foreground text-xs italic">Aguardando leitura…</span>
                    ) : (
                      <span className={`${NO_COMM_TEXT_CLASS} text-xs italic`}>Sem resposta do equipamento</span>
                    )}
                  </div>

                  <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-xs text-muted-foreground">
                    <span className="font-mono">Reg. {p.register}</span>
                    <span>{formatRegisterType(p.registerType)}</span>
                    <span>{formatDataType(p.dataType)}</span>
                    <span>Escala: {p.scale}</span>
                    {p.unit && <span>{p.unit}</span>}
                  </div>
                </div>

                {confirmingDeleteId === p.id && (
                  <div className="bg-red-50/60 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <p className="text-xs text-red-700">
                        Excluir o ponto <span className="font-mono font-medium">{p.tag}</span>? Isso remove também suas trends e regras de alarme, e o gateway para de ler este registrador.
                      </p>
                      <div className="ml-auto flex items-center gap-2">
                        <button
                          type="button"
                          disabled={deletingPointId === p.id}
                          onClick={(e) => { e.stopPropagation(); handleDeletePoint(p.id); }}
                          className="flex items-center gap-1 rounded-md bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                        >
                          {deletingPointId === p.id && <Loader2 className="h-3 w-3 animate-spin" />}
                          Excluir
                        </button>
                        <button
                          type="button"
                          disabled={deletingPointId === p.id}
                          onClick={(e) => { e.stopPropagation(); setConfirmingDeleteId(null); setDeleteError(null); }}
                          className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted/50 disabled:opacity-50"
                        >
                          Cancelar
                        </button>
                      </div>
                      {deleteError && (
                        <p className="w-full text-xs font-medium text-red-700">{deleteError}</p>
                      )}
                    </div>
                  </div>
                )}

                {expanded && (
                  <div>
                    {renderNameEditor(p)}
                    {renderForceControl(p)}
                    <PointConfigPanel
                      pointId={p.id}
                      pointLabel={p.displayName ?? p.tag}
                      isDigital={isModbusDigital(p.registerType)}
                      unit={p.unit}
                      trend={pointTrend}
                      alarmRule={pointAlarm}
                      onChanged={refreshTrends}
                      onAlarmChanged={refreshAlarmRules}
                      deviceId={device.id}
                      opRole={pointOpRole(p)}
                      onOpRoleChanged={(pid, role) => setOpRoleById((m) => ({ ...m, [pid]: role }))}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* ── Tabela (desktop) ── */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-muted/40 border-b border-border">
              <tr>
                {['Tag', 'Nome', 'Registrador', 'Tipo', 'Dado', 'Escala', 'Unidade', 'Valor atual', 'Status', ''].map((h, i) => (
                  <th key={h || `c${i}`} className="px-4 py-3 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {points.map((p) => {
                const pointTrend = trendByPoint.get(p.id);
                const pointAlarm = alarmRuleByPoint.get(p.id);
                const expanded = expandedPointId === p.id;
                const live = byTag.get(p.tag);
                const digital = isModbusDigital(p.registerType);
                const liveLabel = live
                  ? live.value === null
                    ? '—'
                    : typeof live.value === 'string'
                      ? (p.unit ? `${live.value} ${p.unit}` : live.value)
                      : digital
                        ? (live.value === 1 ? 'ATIVO' : 'INATIVO')
                        : `${live.value.toFixed(2)}${p.unit ? ` ${p.unit}` : ''}`
                  : null;
                return (
                <Fragment key={p.id}>
                <tr ref={p.id === highlightPointId ? scrollToHighlight : undefined} onClick={() => setExpandedPointId(expanded ? null : p.id)} className={`cursor-pointer transition-colors ${p.id === highlightPointId ? 'bg-cyan-50/70 ring-1 ring-inset ring-cyan-300 dark:bg-cyan-950/30 dark:ring-cyan-800' : expanded ? 'bg-muted/30' : 'hover:bg-muted/20'}`}>
                  <td className="px-4 py-3 font-mono text-xs text-foreground">
                    <span className="flex items-center gap-1.5">
                      {pointTrend && <LineChart className="h-3.5 w-3.5 text-cyan-600 shrink-0" strokeWidth={2} aria-label="Trend ativa" />}
                      {pointAlarm && (
                        <Bell
                          className={`h-3.5 w-3.5 shrink-0 ${alarmSeverityColor[pointAlarm.severity] ?? 'text-amber-500'}`}
                          strokeWidth={2}
                          aria-label="Alarme configurado"
                        />
                      )}
                      {p.tag}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-foreground whitespace-nowrap">
                    <span className="flex items-center gap-1.5">
                      {p.displayName}
                      <OpRoleBadge role={pointOpRole(p)} />
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{p.register}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{formatRegisterType(p.registerType)}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{formatDataType(p.dataType)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{p.scale}</td>
                  <td className="px-4 py-3 text-muted-foreground">{p.unit || '—'}</td>
                  <td className="px-4 py-3 font-medium text-foreground">
                    {liveLabel !== null ? (
                      <span className="flex items-center gap-1.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                        <span>{liveLabel}</span>
                      </span>
                    ) : awaitingFirstRead ? (
                      <span className="text-muted-foreground text-xs italic">Aguardando leitura…</span>
                    ) : (
                      <span className={`${NO_COMM_TEXT_CLASS} text-xs italic`}>Sem resposta do equipamento</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {showNoCommBadge(noCommunication, p.status) ? (
                      <PointNoCommBadge />
                    ) : (
                      <span className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium border capitalize ${pointStatusBadge[p.status] ?? ''}`}>
                        {p.status}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <CriticalStarButton critical={isCritical(p)} size={16} className="!p-1" onToggle={() => handleToggleCritical(p.id, isCritical(p))} markHint={pointOpRole(p) !== 'status' ? CRITICAL_MARK_HINT : undefined} onSetStatusRole={pointOpRole(p) !== 'status' && isModbusDigital(p.registerType) ? () => handleSetStatusRole(p.id) : undefined} />
                      <button
                        type="button"
                        title="Editar ponto"
                        aria-label="Editar ponto"
                        onClick={(e) => { e.stopPropagation(); setEditingPoint(p); }}
                        className="rounded p-1 text-muted-foreground hover:bg-violet-50 hover:text-violet-600 transition-colors"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        title="Excluir ponto"
                        aria-label="Excluir ponto"
                        onClick={(e) => { e.stopPropagation(); setDeleteError(null); setConfirmingDeleteId(p.id); }}
                        className="rounded p-1 text-muted-foreground hover:bg-red-50 hover:text-red-600 transition-colors"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                      {expanded ? <ChevronDown className="h-4 w-4 inline" /> : <ChevronRight className="h-4 w-4 inline" />}
                    </span>
                  </td>
                </tr>
                {confirmingDeleteId === p.id && (
                  <tr>
                    <td colSpan={10} className="bg-red-50/60 px-4 py-3">
                      <div className="flex flex-wrap items-center gap-3">
                        <p className="text-xs text-red-700">
                          Excluir o ponto <span className="font-mono font-medium">{p.tag}</span>? Isso remove também suas trends e regras de alarme, e o gateway para de ler este registrador.
                        </p>
                        <div className="ml-auto flex items-center gap-2">
                          <button
                            type="button"
                            disabled={deletingPointId === p.id}
                            onClick={(e) => { e.stopPropagation(); handleDeletePoint(p.id); }}
                            className="flex items-center gap-1 rounded-md bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                          >
                            {deletingPointId === p.id && <Loader2 className="h-3 w-3 animate-spin" />}
                            Excluir
                          </button>
                          <button
                            type="button"
                            disabled={deletingPointId === p.id}
                            onClick={(e) => { e.stopPropagation(); setConfirmingDeleteId(null); setDeleteError(null); }}
                            className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted/50 disabled:opacity-50"
                          >
                            Cancelar
                          </button>
                        </div>
                        {deleteError && (
                          <p className="w-full text-xs font-medium text-red-700">{deleteError}</p>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
                {expanded && (
                  <tr>
                    <td colSpan={10} className="p-0">
                      {renderNameEditor(p)}
                      {renderForceControl(p)}
                      <PointConfigPanel
                        pointId={p.id}
                        pointLabel={p.displayName ?? p.tag}
                        isDigital={isModbusDigital(p.registerType)}
                        unit={p.unit}
                        trend={pointTrend}
                        alarmRule={pointAlarm}
                        onChanged={refreshTrends}
                        onAlarmChanged={refreshAlarmRules}
                      deviceId={device.id}
                      opRole={pointOpRole(p)}
                      onOpRoleChanged={(pid, role) => setOpRoleById((m) => ({ ...m, [pid]: role }))}
                      />
                    </td>
                  </tr>
                )}
                </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {points.length === 0 && (
          <div className="py-12 text-center text-muted-foreground text-sm">
            Nenhum ponto cadastrado. Clique em "Adicionar Ponto Modbus" para começar.
          </div>
        )}
      </div>

      <AddModbusPointModal
        deviceId={device.id}
        open={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        onAdded={(updated) => setPoints(updated.points)}
      />

      {/* Edição técnica do ponto — mesma folha do cadastro, pré-preenchida.
          `key` remonta o modal a cada ponto para os useState iniciarem certos. */}
      {editingPoint && (
        <AddModbusPointModal
          key={editingPoint.id}
          deviceId={device.id}
          open
          onClose={() => setEditingPoint(null)}
          onAdded={(updated) => setPoints(updated.points)}
          point={editingPoint}
          onUpdated={handlePointUpdated}
        />
      )}
    </div>
  );
}
