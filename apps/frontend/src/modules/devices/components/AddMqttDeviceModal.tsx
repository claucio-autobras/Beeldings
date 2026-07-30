'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Loader2, Plus, Radio, Trash2, X } from 'lucide-react';
import { type MqttDevice, type MqttValueType } from '../types/device.types';
import { createMqttDeviceWithPoints, ensureMqttSensorCredential, sampleMqttTopic, type MqttSample, type MqttSensorCredential } from '../services/devices.service';
import { translateDeviceError } from '../utils/device-errors';
import { suggestMqttPoint, validateJsonPath } from '../utils/mqtt-suggestions';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useSites } from '@/modules/sites/hooks/useSites';
import { useTenants } from '@/modules/tenants/hooks/useTenants';
import { getProjects } from '@/modules/projects/services/projects.service';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (device: MqttDevice) => void;
}

/** Linha editável da tabela manual de pontos MQTT. */
interface PointRow {
  tag: string;
  displayName: string;
  sourceTopic: string;
  jsonPath: string;
  valueType: MqttValueType;
  unit: string;
  /** Comando (escrita) — opcional. */
  writeEnabled: boolean;
  commandTopic: string;
  payloadTemplate: string;
  responseTopic: string;
}

const valueTypes: MqttValueType[] = ['number', 'boolean'];

const inputCls  = 'w-full h-9 px-3 text-sm border border-border rounded-md bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring';
const labelCls  = 'block text-xs font-medium text-foreground mb-1';
const selectCls = `${inputCls} cursor-pointer`;
const cellInputCls = 'h-7 w-full min-w-[90px] px-2 text-xs border border-border rounded bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-sky-600';
const cellSelectCls = `${cellInputCls} cursor-pointer`;

function emptyRow(topic = ''): PointRow {
  return {
    tag: '', displayName: '', sourceTopic: topic, jsonPath: '', valueType: 'number', unit: '',
    writeEnabled: false, commandTopic: '', payloadTemplate: '', responseTopic: '',
  };
}

export default function AddMqttDeviceModal({ open, onClose, onCreated }: Props) {
  const user         = useCurrentUser();
  const isGlobalRole = user.role === 'ADMIN' || user.role === 'CCO' || user.role === 'SUPERVISOR';

  const [saving, setSaving]                     = useState(false);
  const [errorMsg, setErrorMsg]                 = useState('');
  const [name, setName]                         = useState('');
  const [selectedClientId, setSelectedClientId] = useState('');

  const [siteId, setSiteId]               = useState('');
  const [siteName, setSiteName]           = useState('');
  const [siteOpen, setSiteOpen]           = useState(false);
  const [projectId, setProjectId]         = useState('');
  const [siteGatewayId, setSiteGatewayId] = useState('');
  const [sensorCred, setSensorCred]       = useState<MqttSensorCredential | null>(null);

  // Captura de amostra
  const [sampleTopicInput, setSampleTopicInput] = useState('');
  const [sampling, setSampling]                 = useState(false);
  const [samples, setSamples]                   = useState<MqttSample[]>([]);
  const [sampleError, setSampleError]           = useState('');
  const [sampled, setSampled]                   = useState(false);

  const [rows, setRows] = useState<PointRow[]>([emptyRow()]);

  // Modo de tópico: 'prefix' (namespace de sensores do gateway — padrão) ou
  // 'root' (equipamento sem suporte a prefixo, publica no próprio raiz).
  const [topicMode, setTopicMode]       = useState<'prefix' | 'root'>('prefix');
  const [rootTopic, setRootTopic]       = useState('');
  // Presença/heartbeat (opcional, ambos os modos) — sub-tópico relativo ao escopo.
  const [heartbeatSub, setHeartbeatSub]         = useState('');
  const [heartbeatTimeout, setHeartbeatTimeout] = useState('90');
  // Dispositivo criado em modo raiz: mostra a credencial dedicada antes de fechar.
  const [createdDevice, setCreatedDevice] = useState<MqttDevice | null>(null);

  const effectiveTenantId = isGlobalRole ? selectedClientId : (user.tenantId ?? '');
  const { data: tenants = [] } = useTenants();
  const { data: allSites = [] } = useSites(effectiveTenantId || undefined);
  const { data: siteProjects = [] } = useQuery({
    queryKey: ['projects', siteId || null, effectiveTenantId || null],
    queryFn: () => getProjects(siteId || undefined, effectiveTenantId || undefined),
    enabled: !!siteId,
  });

  if (!open) return null;

  const filteredSites = allSites.filter((s) =>
    s.name.toLowerCase().includes(siteName.toLowerCase()),
  );

  // Os sensores deste gateway publicam sob este prefixo (namespace do tenant que
  // a ACL do gateway já libera). O usuário informa só o sub-tópico relativo.
  const topicPrefix = effectiveTenantId && siteGatewayId
    ? `bluebee/${effectiveTenantId}/gateway/${siteGatewayId}/sensors/`
    : '';
  const isRootMode = topicMode === 'root';
  const rootNorm = rootTopic.trim().replace(/\/+$/, '');
  // Prefixo efetivo dos tópicos deste dispositivo (sub-tópicos são relativos a ele).
  const effectivePrefix = isRootMode ? (rootNorm ? `${rootNorm}/` : '') : topicPrefix;
  const rootTopicInvalid = isRootMode && !!rootNorm && (
    rootNorm.includes('+') || rootNorm.includes('#') || rootNorm.startsWith('$') ||
    rootNorm.startsWith('/') || rootNorm.split('/').some((s) => s.length === 0) ||
    rootNorm === 'bluebee' || rootNorm.startsWith('bluebee/')
  );
  const stripPrefix = (full: string) => (effectivePrefix && full.startsWith(effectivePrefix) ? full.slice(effectivePrefix.length) : full);

  function resetAndClose() {
    setSaving(false); setErrorMsg('');
    setName(''); setSelectedClientId('');
    setSiteId(''); setSiteName(''); setSiteOpen(false); setProjectId(''); setSiteGatewayId(''); setSensorCred(null);
    setSampleTopicInput(''); setSampling(false); setSamples([]); setSampleError(''); setSampled(false);
    setRows([emptyRow()]);
    setTopicMode('prefix'); setRootTopic(''); setHeartbeatSub(''); setHeartbeatTimeout('90');
    setCreatedDevice(null);
    onClose();
  }

  function handleClientChange(clientId: string) {
    setSelectedClientId(clientId);
    setSiteId(''); setSiteName(''); setProjectId(''); setSiteGatewayId('');
  }

  function handleProjectChange(id: string) {
    setProjectId(id);
    const proj = siteProjects.find((p) => p.id === id);
    const gwId = proj?.gateway?.id ?? '';
    setSiteGatewayId(gwId);
    setSensorCred(null);
    if (gwId && effectiveTenantId) {
      // Garante/busca a credencial que o equipamento deve usar para publicar.
      ensureMqttSensorCredential({ tenantId: effectiveTenantId, gatewayId: gwId })
        .then(setSensorCred)
        .catch(() => setSensorCred(null));
    }
  }

  function updateRow(idx: number, patch: Partial<PointRow>) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }
  function addRow(topic = '') {
    setRows((prev) => [...prev, emptyRow(topic)]);
  }
  /** Adiciona uma linha pré-preenchida com sugestões extraídas do payload capturado. */
  function addRowFromSample(topic: string, payload: string) {
    const s = suggestMqttPoint(payload, topic);
    setRows((prev) => [...prev, {
      ...emptyRow(topic),
      tag: s.tag,
      displayName: s.displayName,
      jsonPath: s.jsonPath,
      valueType: s.valueType,
      unit: s.unit,
    }]);
  }
  /** Aviso não bloqueante quando o jsonPath digitado não existe na amostra capturada do mesmo sub-tópico. */
  function jsonPathWarning(row: PointRow): string | null {
    const jsonPath = row.jsonPath.trim();
    if (!jsonPath) return null;
    const sample = samples.find((s) => stripPrefix(s.topic) === row.sourceTopic.trim());
    if (!sample) return null;
    return validateJsonPath(sample.payload, jsonPath) === 'missing'
      ? 'Este caminho não existe na mensagem capturada.'
      : null;
  }
  function removeRow(idx: number) {
    setRows((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== idx)));
  }

  async function handleSample() {
    if (!siteGatewayId || !sampleTopicInput.trim()) return;
    setSampling(true);
    setSampleError('');
    setSamples([]);
    try {
      const result = await sampleMqttTopic({
        tenantId: effectiveTenantId,
        gatewayId: siteGatewayId,
        topic: effectivePrefix + sampleTopicInput.trim(),
        ...(isRootMode && rootNorm ? { rootTopic: rootNorm } : {}),
      });
      setSamples(result);
      setSampled(true);
      if (result.length === 0) {
        setSampleError('Nenhuma mensagem recebida no tópico durante a janela de escuta. Verifique se o equipamento está publicando.');
      }
    } catch (err: unknown) {
      setSampleError(translateDeviceError(err, { fallback: 'Falha ao capturar amostra.' }));
    } finally {
      setSampling(false);
    }
  }

  /** Preenche o comando da linha com o padrão RPC do Shelly Gen4 (Switch.Set). */
  function applyShellyPreset(idx: number) {
    const row = rows[idx];
    const base = row.sourceTopic.trim().split('/')[0] || 'shelly1';
    updateRow(idx, {
      commandTopic: `${base}/rpc`,
      responseTopic: `${base}/resp/rpc`,
      payloadTemplate: `{"id":{{id}},"src":"${effectivePrefix}${base}/resp","method":"Switch.Set","params":{"id":0,"on":{{value}}}}`,
    });
  }

  const rowWriteValid = (r: PointRow) =>
    !r.writeEnabled || !!(r.commandTopic.trim() && r.payloadTemplate.includes('{{value}}'));
  const validRows = rows.filter((r) => r.tag.trim() && r.sourceTopic.trim());
  const clientSelected = isGlobalRole ? !!selectedClientId : true;
  const heartbeatWindow = Number(heartbeatTimeout);
  const heartbeatValid = !heartbeatSub.trim()
    || (Number.isFinite(heartbeatWindow) && heartbeatWindow >= 15 && heartbeatWindow <= 3600);
  const formValid = !!(name && siteId && projectId && siteGatewayId && clientSelected)
    && validRows.length > 0
    && validRows.every(rowWriteValid)
    && (!isRootMode || (!!rootNorm && !rootTopicInvalid))
    && heartbeatValid;

  async function handleSave() {
    if (!formValid) return;
    setSaving(true);
    setErrorMsg('');
    try {
      const selectedSite = allSites.find((s) => s.id === siteId);
      const device = await createMqttDeviceWithPoints({
        name,
        protocol: 'mqtt',
        site:     selectedSite?.name ?? siteName,
        siteId,
        tenantId: effectiveTenantId,
        gatewayId: siteGatewayId,
        topicMode,
        ...(isRootMode ? { rootTopic: rootNorm } : {}),
        heartbeatTopic: heartbeatSub.trim() ? effectivePrefix + heartbeatSub.trim() : null,
        heartbeatTimeoutSeconds: heartbeatSub.trim() ? heartbeatWindow : null,
        selectedPoints: validRows.map((r) => ({
          tag:         r.tag.trim(),
          displayName: r.displayName.trim() || r.tag.trim(),
          sourceTopic: effectivePrefix + r.sourceTopic.trim(),
          jsonPath:    r.jsonPath.trim(),
          valueType:   r.valueType,
          unit:        r.unit.trim(),
          write: r.writeEnabled && r.commandTopic.trim()
            ? {
                commandTopic: effectivePrefix + r.commandTopic.trim(),
                payloadTemplate: r.payloadTemplate.trim(),
                responseTopic: r.responseTopic.trim() ? effectivePrefix + r.responseTopic.trim() : null,
              }
            : null,
        })),
      });
      if (device.mqttConfig?.credential) {
        // Modo raiz: mostra a credencial dedicada do equipamento antes de fechar.
        setCreatedDevice(device);
      } else {
        onCreated(device);
        resetAndClose();
      }
    } catch (err: unknown) {
      setErrorMsg(translateDeviceError(err, { fallback: 'Erro ao salvar dispositivo.' }));
    } finally {
      setSaving(false);
    }
  }

  // Etapa pós-criação (modo raiz): exibe a credencial dedicada do equipamento.
  if (createdDevice) {
    const cred = createdDevice.mqttConfig?.credential;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
        <div className="w-full max-w-lg bg-card rounded-xl border border-border shadow-xl flex flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Radio className="h-4 w-4 text-sky-600" />
              Dispositivo criado — credencial do equipamento
            </h2>
          </div>
          <div className="px-5 py-4 space-y-3">
            <p className="text-xs text-muted-foreground">
              Configure estes dados no cliente MQTT do equipamento. Esta credencial só pode
              <span className="font-medium"> publicar</span> sob o tópico raiz declarado (e assinar os tópicos de comando dele).
              Ela fica disponível também na edição do dispositivo.
            </p>
            {cred ? (
              <div className="grid grid-cols-1 gap-1.5 text-xs border border-sky-200 dark:border-sky-900 rounded-lg p-3 bg-sky-50/50 dark:bg-sky-950/30">
                {cred.broker && (
                  <div><span className="text-muted-foreground">Broker:</span> <span className="font-mono text-foreground break-all">{cred.broker}</span></div>
                )}
                <div><span className="text-muted-foreground">Usuário:</span> <span className="font-mono text-foreground break-all">{cred.username}</span></div>
                <div><span className="text-muted-foreground">Senha:</span> <span className="font-mono text-foreground break-all">{cred.password}</span></div>
                <div><span className="text-muted-foreground">Publicar em:</span> <span className="font-mono text-foreground break-all">{cred.topicPrefix}&lt;sub-tópico&gt;</span></div>
              </div>
            ) : (
              <p className="text-xs text-amber-700">A credencial não pôde ser provisionada agora — tente reabrir o dispositivo em edição.</p>
            )}
          </div>
          <div className="flex justify-end border-t border-border px-5 py-4">
            <button
              onClick={() => { const d = createdDevice; onCreated(d); resetAndClose(); }}
              className="h-9 px-4 text-sm rounded-md font-medium bg-sky-700 text-white hover:bg-sky-800 transition-colors"
            >
              Concluir
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-4xl max-h-[90vh] overflow-hidden bg-card rounded-xl border border-border shadow-xl flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4 shrink-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Radio className="h-4 w-4 text-sky-600" />
            Adicionar Dispositivo MQTT
          </h2>
          <button onClick={resetAndClose} aria-label="Fechar modal" className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 px-5 py-4 overflow-y-auto space-y-5">

          {/* Identificação */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {isGlobalRole && (
              <div className="sm:col-span-2">
                <label className={labelCls}>Cliente <span className="text-red-500">*</span></label>
                <select className={selectCls} value={selectedClientId} onChange={(e) => handleClientChange(e.target.value)}>
                  <option value="">Selecione o cliente</option>
                  {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            )}

            <div className="sm:col-span-2">
              <label className={labelCls}>Nome do equipamento <span className="text-red-500">*</span></label>
              <input className={inputCls} placeholder="Ex: Sensor de temperatura sala técnica" value={name} onChange={(e) => setName(e.target.value)} />
            </div>

            {/* Site — combobox */}
            <div className="relative">
              <label className={labelCls}>Site <span className="text-red-500">*</span></label>
              <div className="relative">
                <input
                  className={inputCls}
                  placeholder="Selecione ou digite um local"
                  value={siteName}
                  onChange={(e) => { setSiteName(e.target.value); setSiteId(''); setProjectId(''); setSiteGatewayId(''); setSiteOpen(true); }}
                  onFocus={() => setSiteOpen(true)}
                  onBlur={() => setTimeout(() => setSiteOpen(false), 150)}
                  autoComplete="off"
                />
                <div className="absolute inset-y-0 right-2 flex items-center gap-1 pointer-events-none">
                  {siteName && (
                    <button type="button" className="pointer-events-auto text-muted-foreground hover:text-foreground"
                      onMouseDown={(e) => { e.preventDefault(); setSiteId(''); setSiteName(''); setProjectId(''); setSiteGatewayId(''); setSiteOpen(false); }}>
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
                      <div key={s.id} className="px-3 py-2 text-sm cursor-pointer hover:bg-muted/50"
                        onMouseDown={(e) => { e.preventDefault(); setSiteId(s.id); setSiteName(s.name); setProjectId(''); setSiteGatewayId(''); setSiteOpen(false); }}>
                        {s.name}
                      </div>
                    ))
                  ) : (
                    <div className="px-3 py-2 text-sm text-muted-foreground">
                      {allSites.length === 0 ? 'Nenhum local cadastrado' : 'Digite para filtrar'}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Projeto — define o gateway */}
            <div>
              <label className={labelCls}>Projeto <span className="text-red-500">*</span></label>
              <select className={selectCls} value={projectId} onChange={(e) => handleProjectChange(e.target.value)} disabled={!siteId}>
                <option value="">
                  {!siteId ? 'Selecione um local primeiro' : siteProjects.length === 0 ? 'Nenhum projeto neste local' : 'Selecione o projeto'}
                </option>
                {siteProjects.map((p) => (
                  <option key={p.id} value={p.id} disabled={!p.gateway}>
                    {p.name}{!p.gateway ? ' (sem gateway)' : ''}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-muted-foreground mt-1">O gateway deste projeto fará o bridge dos tópicos.</p>
            </div>
          </div>

          {/* Modo de tópico */}
          <div className="space-y-2 border border-border rounded-lg p-3 bg-muted/20">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Modo de tópico</h3>
              <p className="text-[11px] text-muted-foreground">
                Use o <span className="font-medium">tópico raiz próprio</span> quando o equipamento não suporta prefixo de tópico
                (ou o perde após reconexões — ex.: controladores Aeris). A plataforma gera uma credencial exclusiva restrita ao namespace dele.
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="flex items-start gap-2 text-xs text-foreground cursor-pointer">
                <input type="radio" name="topicMode" className="mt-0.5 accent-sky-600" checked={!isRootMode} onChange={() => setTopicMode('prefix')} />
                <span><span className="font-medium">Prefixo de sensores (padrão)</span> — o equipamento publica sob o namespace do gateway.</span>
              </label>
              <label className="flex items-start gap-2 text-xs text-foreground cursor-pointer">
                <input type="radio" name="topicMode" className="mt-0.5 accent-sky-600" checked={isRootMode} onChange={() => setTopicMode('root')} />
                <span><span className="font-medium">Tópico raiz próprio</span> — o equipamento publica no próprio namespace, sem nenhum prefixo configurado nele.</span>
              </label>
            </div>
            {isRootMode && (
              <div>
                <label className={labelCls}>Tópico raiz do equipamento <span className="text-red-500">*</span></label>
                <input className={`${inputCls} font-mono`} placeholder="ex: 008065" value={rootTopic} onChange={(e) => setRootTopic(e.target.value)} />
                {rootTopicInvalid && (
                  <p className="text-[11px] text-red-600 mt-1">Tópico inválido: sem wildcards (+/#), sem “$”, sem barras nas pontas e fora do namespace “bluebee”.</p>
                )}
                <p className="text-[11px] text-muted-foreground mt-1">
                  Precisa ser único na plataforma. Os sub-tópicos abaixo são relativos a ele (ex.: <span className="font-mono">update/sensor/NTC1</span>).
                </p>
              </div>
            )}
            {/* Presença / heartbeat (ambos os modos) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
              <div>
                <label className={labelCls}>Tópico de presença (opcional, relativo)</label>
                <input className={`${inputCls} font-mono`} placeholder="ex: status" value={heartbeatSub} onChange={(e) => setHeartbeatSub(e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Janela do heartbeat (s)</label>
                <input className={inputCls} type="number" min={15} max={3600} value={heartbeatTimeout}
                  onChange={(e) => setHeartbeatTimeout(e.target.value)} disabled={!heartbeatSub.trim()} />
              </div>
              <p className="sm:col-span-2 text-[11px] text-muted-foreground">
                Para equipamentos que só publicam quando o valor muda: enquanto o heartbeat chegar dentro da janela, o dispositivo
                aparece online mesmo sem telemetria nova.
                {!heartbeatValid && <span className="text-red-600"> Janela entre 15 e 3600 segundos.</span>}
              </p>
            </div>
          </div>

          {/* Credencial do equipamento — provisionada para este gateway (modo prefixo) */}
          {!isRootMode && siteGatewayId && sensorCred && (
            <div className="space-y-1.5 border border-sky-200 dark:border-sky-900 rounded-lg p-3 bg-sky-50/50 dark:bg-sky-950/30">
              <h3 className="text-sm font-semibold text-foreground">Credencial para o equipamento</h3>
              <p className="text-[11px] text-muted-foreground">
                Configure estes dados no cliente MQTT do equipamento. Esta credencial só pode
                <span className="font-medium"> publicar</span> nos tópicos de sensores deste gateway.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs">
                {sensorCred.broker && (
                  <div><span className="text-muted-foreground">Broker:</span> <span className="font-mono text-foreground break-all">{sensorCred.broker}</span></div>
                )}
                <div><span className="text-muted-foreground">Usuário:</span> <span className="font-mono text-foreground break-all">{sensorCred.username}</span></div>
                <div className="sm:col-span-2"><span className="text-muted-foreground">Senha:</span> <span className="font-mono text-foreground break-all">{sensorCred.password}</span></div>
                <div className="sm:col-span-2"><span className="text-muted-foreground">Publicar em:</span> <span className="font-mono text-foreground break-all">{sensorCred.topicPrefix}&lt;sub-tópico&gt;</span></div>
              </div>
            </div>
          )}

          {/* Captura de amostra */}
          <div className="space-y-2 border border-border rounded-lg p-3 bg-muted/20">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Capturar amostra do tópico</h3>
              <p className="text-[11px] text-muted-foreground">
                Escute um sub-tópico por alguns segundos para ver o payload publicado pelo equipamento e descobrir o caminho do valor (jsonPath).
              </p>
            </div>
            {effectivePrefix && (
              <p className="text-[11px] text-muted-foreground">
                Configure o sensor para publicar sob:{' '}
                <span className="font-mono text-foreground break-all">{effectivePrefix}…</span>
              </p>
            )}
            <div className="flex items-end gap-2 flex-wrap">
              <div className="flex-1 min-w-[200px]">
                <label className={labelCls}>{isRootMode ? `Sub-tópico (sob ${rootNorm || 'o raiz'}/)` : 'Sub-tópico (sob …/sensors/)'}</label>
                <input className={`${inputCls} font-mono`} placeholder="ex: sala-tecnica/temp" value={sampleTopicInput} onChange={(e) => setSampleTopicInput(e.target.value)} />
              </div>
              <button
                type="button"
                onClick={handleSample}
                disabled={!siteGatewayId || !sampleTopicInput.trim() || sampling || (isRootMode && (!rootNorm || rootTopicInvalid))}
                className="h-9 px-4 text-sm rounded-md font-medium border border-sky-200 bg-sky-50 text-sky-800 hover:bg-sky-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
              >
                {sampling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radio className="h-4 w-4" />}
                {sampling ? 'Escutando…' : 'Capturar amostra'}
              </button>
            </div>

            {sampleError && <p className="text-xs text-amber-700">{sampleError}</p>}

            {samples.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">{samples.length} mensagem(ns) capturada(s):</p>
                {samples.map((s, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <pre className="flex-1 text-xs bg-card border border-border rounded p-2 overflow-x-auto font-mono text-foreground">{s.payload}</pre>
                    <button
                      type="button"
                      onClick={() => addRowFromSample(stripPrefix(s.topic), s.payload)}
                      className="shrink-0 h-7 px-2 text-[11px] rounded border border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100 transition-colors"
                    >
                      + ponto
                    </button>
                  </div>
                ))}
                {sampled && (
                  <p className="text-[11px] text-muted-foreground">
                    Ao clicar em "+ ponto", os campos são preenchidos automaticamente a partir do payload capturado — revise e ajuste se necessário.
                    O jsonPath usa notação por ponto, ex.: <span className="font-mono">value</span> ou <span className="font-mono">data.temp</span>. Deixe vazio se o payload já for o valor cru.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Pontos */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Pontos</h3>
                <p className="text-[11px] text-muted-foreground">Cada ponto liga um tópico de origem a uma tag monitorada.</p>
              </div>
              <button
                type="button"
                onClick={() => addRow()}
                className="h-8 px-3 text-xs rounded-md font-medium border border-sky-200 bg-sky-50 text-sky-800 hover:bg-sky-100 transition-colors flex items-center gap-1.5"
              >
                <Plus className="h-3.5 w-3.5" />
                Adicionar ponto
              </button>
            </div>

            <div className="border border-border rounded-lg overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 border-b border-border">
                  <tr>
                    <th className="px-2 py-2 text-left text-xs font-medium text-muted-foreground">Tag *</th>
                    <th className="px-2 py-2 text-left text-xs font-medium text-muted-foreground">Nome</th>
                    <th className="px-2 py-2 text-left text-xs font-medium text-muted-foreground">Sub-tópico *</th>
                    <th className="px-2 py-2 text-left text-xs font-medium text-muted-foreground">jsonPath</th>
                    <th className="px-2 py-2 text-left text-xs font-medium text-muted-foreground">Tipo</th>
                    <th className="px-2 py-2 text-left text-xs font-medium text-muted-foreground">Unidade</th>
                    <th className="px-2 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">Comando</th>
                    <th className="w-8 px-2 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r, i) => {
                    const pathWarning = jsonPathWarning(r);
                    return (
                    <React.Fragment key={i}>
                    <tr className="hover:bg-muted/20">
                      <td className="px-2 py-1.5">
                        <input className={`${cellInputCls} font-mono`} placeholder="TEMP_SALA" value={r.tag}
                          onChange={(e) => updateRow(i, { tag: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_') })} />
                      </td>
                      <td className="px-2 py-1.5">
                        <input className={cellInputCls} placeholder="Temperatura sala" value={r.displayName} onChange={(e) => updateRow(i, { displayName: e.target.value })} />
                      </td>
                      <td className="px-2 py-1.5">
                        <input className={`${cellInputCls} font-mono min-w-[160px]`} placeholder="sala/temp" value={r.sourceTopic} onChange={(e) => updateRow(i, { sourceTopic: e.target.value })} />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          className={`${cellInputCls} font-mono ${pathWarning ? 'border-amber-400 focus:ring-amber-500' : ''}`}
                          placeholder="temperature"
                          value={r.jsonPath}
                          onChange={(e) => updateRow(i, { jsonPath: e.target.value })}
                        />
                        {pathWarning && (
                          <p className="mt-1 text-[10px] leading-tight text-amber-700">{pathWarning}</p>
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        <select className={cellSelectCls} value={r.valueType} onChange={(e) => updateRow(i, { valueType: e.target.value as MqttValueType })}>
                          {valueTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </td>
                      <td className="px-2 py-1.5">
                        <input className={`${cellInputCls} min-w-[60px]`} placeholder="°C" value={r.unit} onChange={(e) => updateRow(i, { unit: e.target.value })} />
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5 accent-sky-600 cursor-pointer"
                          checked={r.writeEnabled}
                          onChange={(e) => updateRow(i, { writeEnabled: e.target.checked })}
                          aria-label="Ponto comandável (escrita)"
                        />
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <button type="button" onClick={() => removeRow(i)} disabled={rows.length === 1} aria-label="Remover ponto"
                          className="text-muted-foreground hover:text-red-600 disabled:opacity-30 disabled:cursor-not-allowed">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                    {r.writeEnabled && (
                      <tr className="bg-muted/10">
                        <td colSpan={8} className="px-3 py-2">
                          <div className="space-y-2">
                            <div className="flex items-center justify-between flex-wrap gap-2">
                              <p className="text-[11px] text-muted-foreground">
                                Comando (escrita): payload com <span className="font-mono">{'{{value}}'}</span> obrigatório e <span className="font-mono">{'{{id}}'}</span> opcional (id RPC para casar a confirmação).
                              </p>
                              <button
                                type="button"
                                onClick={() => applyShellyPreset(i)}
                                className="h-6 px-2 text-[11px] rounded border border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100 transition-colors"
                              >
                                Usar padrão Shelly Gen4 (Switch.Set)
                              </button>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              <div>
                                <label className={labelCls}>Sub-tópico de comando *</label>
                                <input className={`${cellInputCls} font-mono`} placeholder="shelly1/rpc" value={r.commandTopic}
                                  onChange={(e) => updateRow(i, { commandTopic: e.target.value })} />
                              </div>
                              <div>
                                <label className={labelCls}>Sub-tópico de confirmação (opcional)</label>
                                <input className={`${cellInputCls} font-mono`} placeholder="shelly1/resp/rpc" value={r.responseTopic}
                                  onChange={(e) => updateRow(i, { responseTopic: e.target.value })} />
                              </div>
                              <div className="sm:col-span-2">
                                <label className={labelCls}>Payload do comando *</label>
                                <textarea
                                  className={`${cellInputCls} font-mono h-14 py-1.5 resize-y`}
                                  placeholder={'{"id":{{id}},"src":"…/resp","method":"Switch.Set","params":{"id":0,"on":{{value}}}}'}
                                  value={r.payloadTemplate}
                                  onChange={(e) => updateRow(i, { payloadTemplate: e.target.value })}
                                />
                                {r.payloadTemplate.trim() && !r.payloadTemplate.includes('{{value}}') && (
                                  <p className="text-[10px] text-amber-700 mt-0.5">O payload precisa conter o placeholder {'{{value}}'}.</p>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">
              {validRows.length} ponto{validRows.length !== 1 ? 's' : ''} válido{validRows.length !== 1 ? 's' : ''} (tag + tópico preenchidos).
            </p>
          </div>

          {errorMsg && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">{errorMsg}</div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-border px-5 py-4 shrink-0">
          <button onClick={resetAndClose} className="h-9 px-4 text-sm border border-border rounded-md text-foreground hover:bg-muted/50 transition-colors">
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={!formValid || saving}
            className="h-9 px-4 text-sm rounded-md font-medium bg-sky-700 text-white hover:bg-sky-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {saving ? 'Salvando...' : `Salvar Dispositivo (${validRows.length})`}
          </button>
        </div>
      </div>
    </div>
  );
}
