'use client';

import { useState } from 'react';
import { Loader2, Pencil, Plus, Radio, X } from 'lucide-react';
import type { MqttDevice, MqttPoint, MqttValueType } from '@/mocks/data/devices.mock';
import { addMqttPoint, sampleMqttTopic, updateMqttPoint, type MqttSample } from '../services/devices.service';
import { translateDeviceError } from '../utils/device-errors';
import { suggestMqttPoint, validateJsonPath } from '../utils/mqtt-suggestions';

interface Props {
  deviceId: string;
  tenantId: string;
  gatewayId: string;
  open: boolean;
  onClose: () => void;
  onAdded: (device: MqttDevice) => void;
  /** Modo edição — quando presente, o modal abre pré-preenchido com este ponto. */
  point?: MqttPoint | null;
  /** Chamado após salvar a edição, com os dados atualizados do ponto. */
  onUpdated?: (point: MqttPoint) => void;
  /**
   * Prefixo de escopo dos tópicos deste dispositivo. Quando ausente, usa o
   * namespace de sensores do gateway (modo prefixo padrão). Dispositivos em
   * modo "tópico raiz próprio" passam `{rootTopic}/`.
   */
  topicPrefixOverride?: string;
}

const inputCls  = 'w-full h-9 px-3 text-sm border border-border rounded-md bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring';
const labelCls  = 'block text-xs font-medium text-foreground mb-1';
const selectCls = `${inputCls} cursor-pointer`;

const valueTypes: MqttValueType[] = ['number', 'boolean'];

export default function AddMqttPointModal({ deviceId, tenantId, gatewayId, open, onClose, onAdded, point, onUpdated, topicPrefixOverride }: Props) {
  const topicPrefix = topicPrefixOverride
    ?? (tenantId && gatewayId ? `bluebee/${tenantId}/gateway/${gatewayId}/sensors/` : '');
  // Modo raiz: o prefixo não é o namespace bluebee — a amostra precisa do rootTopic.
  const rootTopicParam = topicPrefix && !topicPrefix.startsWith('bluebee/')
    ? topicPrefix.replace(/\/+$/, '')
    : undefined;
  // Rótulo do prefixo nos campos de sub-tópico: raiz do equipamento ou namespace do gateway.
  const prefixLabel = rootTopicParam ? `${rootTopicParam}/` : '…/sensors/';
  const isEdit = !!point;
  // Remove o prefixo do namespace para exibir/editar só o sub-tópico.
  const stripPrefixInit = (full: string | null | undefined) =>
    full && topicPrefix && full.startsWith(topicPrefix) ? full.slice(topicPrefix.length) : (full ?? '');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [tag, setTag] = useState(point?.tag ?? '');
  const [displayName, setDisplayName] = useState(point?.displayName ?? '');
  const [sourceTopic, setSourceTopic] = useState(stripPrefixInit(point?.sourceTopic));
  const [jsonPath, setJsonPath] = useState(point?.jsonPath ?? '');
  const [valueType, setValueType] = useState<MqttValueType>(point?.valueType ?? 'number');
  const [unit, setUnit] = useState(point?.unit ?? '');

  // Comando (escrita) — opcional
  const [writeEnabled, setWriteEnabled] = useState(!!point?.write);
  const [commandTopic, setCommandTopic] = useState(stripPrefixInit(point?.write?.commandTopic));
  const [payloadTemplate, setPayloadTemplate] = useState(point?.write?.payloadTemplate ?? '');
  const [responseTopic, setResponseTopic] = useState(stripPrefixInit(point?.write?.responseTopic));
  const [matchByValue, setMatchByValue] = useState(point?.write?.matchByValue ?? false);

  // Captura de amostra — mesmo fluxo do cadastro de dispositivo
  const [sampling, setSampling] = useState(false);
  const [samples, setSamples] = useState<MqttSample[]>([]);
  const [sampleError, setSampleError] = useState('');

  if (!open) return null;

  const stripPrefix = (full: string) => (topicPrefix && full.startsWith(topicPrefix) ? full.slice(topicPrefix.length) : full);

  function resetAndClose() {
    setTag(''); setDisplayName(''); setSourceTopic(''); setJsonPath(''); setValueType('number'); setUnit('');
    setWriteEnabled(false); setCommandTopic(''); setPayloadTemplate(''); setResponseTopic(''); setMatchByValue(false);
    setErrorMsg('');
    setSampling(false); setSamples([]); setSampleError('');
    onClose();
  }

  /** Preenche os campos de comando com o padrão RPC do Shelly Gen4 (Switch.Set). */
  function applyShellyPreset() {
    const base = sourceTopic.trim().split('/')[0] || 'shelly1';
    setCommandTopic(`${base}/rpc`);
    setResponseTopic(`${base}/resp/rpc`);
    setMatchByValue(false);
    setPayloadTemplate(
      `{"id":{{id}},"src":"${topicPrefix}${base}/resp","method":"Switch.Set","params":{"id":0,"on":{{value}}}}`,
    );
  }

  /**
   * Preenche os campos de comando com o canal OFICIAL de comando Aeris (set/),
   * informado pelo fabricante: `{serial}/set/split/0/force1` (0/1) e
   * `{serial}/set/split/0/sp1` (18–27), com o VALOR PURO como payload — sem
   * envelope JSON, sem `ts` e sem a assinatura proprietária `sh` (que só o
   * canal legado config/ exige).
   * A confirmação vem pelo eco real do equipamento, casada por valor:
   * force1 → `update/sensor/POWER1`; sp1 → `config/split/0/sp_val1`.
   */
  function applyAerisPreset(kind: 'force' | 'sp') {
    // Extrai o serial (primeiro segmento do sourceTopic) ex.: "008065"
    const parts = sourceTopic.trim().split('/');
    const serial = parts[0] || '008065';
    setCommandTopic(`${serial}/set/split/0/${kind === 'force' ? 'force1' : 'sp1'}`);
    setResponseTopic(
      kind === 'force'
        ? `${serial}/update/sensor/POWER1`
        : `${serial}/config/split/0/sp_val1`,
    );
    setMatchByValue(true);
    setPayloadTemplate('{{value}}');
  }

  async function handleSample() {
    if (!gatewayId || !sourceTopic.trim()) return;
    setSampling(true);
    setSampleError('');
    setSamples([]);
    try {
      const result = await sampleMqttTopic({
        tenantId,
        gatewayId,
        topic: topicPrefix + sourceTopic.trim(),
        ...(rootTopicParam ? { rootTopic: rootTopicParam } : {}),
      });
      setSamples(result);
      if (result.length === 0) {
        setSampleError('Nenhuma mensagem recebida no tópico durante a janela de escuta. Verifique se o equipamento está publicando.');
      }
    } catch (err: unknown) {
      setSampleError(translateDeviceError(err, { fallback: 'Falha ao capturar amostra.' }));
    } finally {
      setSampling(false);
    }
  }

  /** Preenche os campos com sugestões extraídas do payload capturado (tudo continua editável). */
  function applySuggestions(sample: MqttSample) {
    const topic = stripPrefix(sample.topic);
    const s = suggestMqttPoint(sample.payload, topic);
    setSourceTopic(topic);
    setJsonPath(s.jsonPath);
    setValueType(s.valueType);
    if (s.unit) setUnit(s.unit);
    if (s.tag && !tag.trim()) setTag(s.tag);
    if (s.displayName && !displayName.trim()) setDisplayName(s.displayName);
  }

  // Aviso não bloqueante quando o jsonPath digitado não existe na amostra capturada do mesmo sub-tópico
  const matchingSample = samples.find((s) => stripPrefix(s.topic) === sourceTopic.trim());
  const pathWarning = matchingSample && jsonPath.trim()
    && validateJsonPath(matchingSample.payload, jsonPath) === 'missing'
    ? 'Este caminho não existe na mensagem capturada.'
    : null;

  const writeValid = !writeEnabled
    || !!(commandTopic.trim() && payloadTemplate.includes('{{value}}'));
  const formValid = !!(tag.trim() && sourceTopic.trim()) && writeValid;

  async function handleSave() {
    if (!formValid) return;
    setSaving(true);
    setErrorMsg('');
    const buildWrite = () =>
      writeEnabled && commandTopic.trim()
        ? {
            commandTopic: topicPrefix + commandTopic.trim(),
            payloadTemplate: payloadTemplate.trim(),
            responseTopic: responseTopic.trim() ? topicPrefix + responseTopic.trim() : null,
            matchByValue: matchByValue || undefined,
          }
        : null;
    if (isEdit && point) {
      try {
        const write = buildWrite();
        await updateMqttPoint(deviceId, point.id, {
          tag: tag.trim(),
          objectName: displayName.trim() || tag.trim(),
          sourceTopic: topicPrefix + sourceTopic.trim(),
          jsonPath: jsonPath.trim(),
          valueType,
          unit: unit.trim(),
          write,
        });
        onUpdated?.({
          ...point,
          tag: tag.trim(),
          displayName: displayName.trim() || tag.trim(),
          sourceTopic: topicPrefix + sourceTopic.trim(),
          jsonPath: jsonPath.trim(),
          valueType,
          unit: unit.trim(),
          write,
        });
        resetAndClose();
      } catch (err: unknown) {
        setErrorMsg(translateDeviceError(err, { fallback: 'Erro ao salvar as alterações do ponto.' }));
      } finally {
        setSaving(false);
      }
      return;
    }
    try {
      const device = await addMqttPoint(deviceId, {
        tag: tag.trim(),
        displayName: displayName.trim() || tag.trim(),
        sourceTopic: topicPrefix + sourceTopic.trim(),
        jsonPath: jsonPath.trim(),
        valueType,
        unit: unit.trim(),
        write: buildWrite(),
      });
      onAdded(device);
      resetAndClose();
    } catch (err: unknown) {
      setErrorMsg(translateDeviceError(err, { fallback: 'Erro ao adicionar ponto.' }));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg max-h-[90vh] overflow-hidden bg-card rounded-xl border border-border shadow-xl flex flex-col">
        <div className="flex items-center justify-between border-b border-border px-5 py-4 shrink-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            {isEdit ? <Pencil className="h-4 w-4 text-sky-600" /> : <Plus className="h-4 w-4 text-sky-600" />}
            {isEdit ? 'Editar Ponto MQTT' : 'Adicionar Ponto MQTT'}
          </h2>
          <button onClick={resetAndClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 px-5 py-4 overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className={labelCls}>Sub-tópico (sob {prefixLabel}) <span className="text-red-500">*</span></label>
              <div className="flex items-center gap-2">
                <input className={`${inputCls} font-mono flex-1`} placeholder="sala/temp" value={sourceTopic} onChange={(e) => setSourceTopic(e.target.value)} />
                <button
                  type="button"
                  onClick={handleSample}
                  disabled={!gatewayId || !sourceTopic.trim() || sampling}
                  className="h-9 px-3 text-xs rounded-md font-medium border border-sky-200 bg-sky-50 text-sky-800 hover:bg-sky-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5 shrink-0 whitespace-nowrap"
                >
                  {sampling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Radio className="h-3.5 w-3.5" />}
                  {sampling ? 'Escutando…' : 'Capturar amostra'}
                </button>
              </div>
              {topicPrefix && (
                <p className="text-[11px] text-muted-foreground mt-1">
                  Tópico completo: <span className="font-mono break-all">{topicPrefix}{sourceTopic.trim() || '…'}</span>
                </p>
              )}
              {sampleError && <p className="text-xs text-amber-700 mt-1">{sampleError}</p>}
              {samples.length > 0 && (
                <div className="mt-2 space-y-2">
                  <p className="text-xs text-muted-foreground">{samples.length} mensagem(ns) capturada(s) — use as sugestões para preencher os campos:</p>
                  {samples.map((s, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <pre className="flex-1 text-xs bg-card border border-border rounded p-2 overflow-x-auto font-mono text-foreground">{s.payload}</pre>
                      <button
                        type="button"
                        onClick={() => applySuggestions(s)}
                        className="shrink-0 h-7 px-2 text-[11px] rounded border border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100 transition-colors"
                      >
                        Usar sugestões
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label className={labelCls}>Tag <span className="text-red-500">*</span></label>
              <input className={`${inputCls} font-mono`} placeholder="TEMP_SALA" value={tag} onChange={(e) => setTag(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))} />
            </div>
            <div>
              <label className={labelCls}>Nome de exibição</label>
              <input className={inputCls} placeholder="Temperatura sala" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>jsonPath</label>
              <input
                className={`${inputCls} font-mono ${pathWarning ? 'border-amber-400 focus:ring-amber-500' : ''}`}
                placeholder="value (vazio = payload cru)"
                value={jsonPath}
                onChange={(e) => setJsonPath(e.target.value)}
              />
              {pathWarning ? (
                <p className="text-[11px] text-amber-700 mt-1">{pathWarning}</p>
              ) : (
                <p className="text-[11px] text-muted-foreground mt-1">
                  Notação por ponto, ex.: <span className="font-mono">value</span> ou <span className="font-mono">data.temp</span>. Capture uma amostra para preencher automaticamente.
                </p>
              )}
            </div>
            <div>
              <label className={labelCls}>Tipo de valor</label>
              <select className={selectCls} value={valueType} onChange={(e) => setValueType(e.target.value as MqttValueType)}>
                {valueTypes.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Unidade</label>
              <input className={inputCls} placeholder="°C" value={unit} onChange={(e) => setUnit(e.target.value)} />
            </div>
          </div>

          {/* Comando (escrita) — opcional */}
          <div className="mt-4 border border-border rounded-lg p-3 bg-muted/20 space-y-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-sky-600"
                checked={writeEnabled}
                onChange={(e) => setWriteEnabled(e.target.checked)}
              />
              <span className="text-sm font-semibold text-foreground">Ponto comandável (escrita)</span>
            </label>
            {writeEnabled && (
              <>
                <p className="text-[11px] text-muted-foreground">
                  Permite enviar comandos ao equipamento pelo SCADA.
                  Placeholders no payload: <span className="font-mono">{'{{value}}'}</span> (valor enviado),{' '}
                  <span className="font-mono">{'{{id}}'}</span> (id RPC — Shelly),{' '}
                  <span className="font-mono">{'{{ts}}'}</span> (epoch UNIX em segundos, gerado automaticamente).
                  Payload contendo apenas <span className="font-mono">{'{{value}}'}</span> publica o valor puro, sem JSON (liga/desliga vira 0/1 — padrão Aeris set/).
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={applyShellyPreset}
                    className="h-7 px-2.5 text-[11px] rounded border border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100 transition-colors"
                  >
                    Padrão Shelly Gen4 (Switch.Set)
                  </button>
                  <button
                    type="button"
                    onClick={() => applyAerisPreset('force')}
                    className="h-7 px-2.5 text-[11px] rounded border border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100 transition-colors"
                    title="Canal oficial de comando Aeris (set/): publica 0 ou 1 puro em {serial}/set/split/0/force1, com confirmação pelo eco em update/sensor/POWER1."
                  >
                    Aeris — force1 (liga/desliga)
                  </button>
                  <button
                    type="button"
                    onClick={() => applyAerisPreset('sp')}
                    className="h-7 px-2.5 text-[11px] rounded border border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100 transition-colors"
                    title="Canal oficial de comando Aeris (set/): publica o setpoint puro (18–27) em {serial}/set/split/0/sp1, com confirmação pelo eco em config/split/0/sp_val1."
                  >
                    Aeris — setpoint (sp1)
                  </button>
                </div>
                <div>
                  <label className={labelCls}>Sub-tópico de comando (sob {prefixLabel}) <span className="text-red-500">*</span></label>
                  <input className={`${inputCls} font-mono`} placeholder="shelly1/rpc" value={commandTopic} onChange={(e) => setCommandTopic(e.target.value)} />
                  {topicPrefix && commandTopic.trim() && (
                    <p className="text-[11px] text-muted-foreground mt-1">Tópico completo: <span className="font-mono break-all">{topicPrefix}{commandTopic.trim()}</span></p>
                  )}
                </div>
                <div>
                  <label className={labelCls}>Payload do comando <span className="text-red-500">*</span></label>
                  <textarea
                    className={`${inputCls} font-mono h-20 py-2 resize-y`}
                    placeholder={'{"id":{{id}},"src":"…/resp","method":"Switch.Set","params":{"id":0,"on":{{value}}}}'}
                    value={payloadTemplate}
                    onChange={(e) => setPayloadTemplate(e.target.value)}
                  />
                  {writeEnabled && payloadTemplate.trim() && !payloadTemplate.includes('{{value}}') && (
                    <p className="text-[11px] text-amber-700 mt-1">O payload precisa conter o placeholder {'{{value}}'}.</p>
                  )}
                  {payloadTemplate.includes('{{sh}}') && (
                    <div className="mt-1 rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
                      <strong>⚠ Campo {'{{sh}}'} pendente:</strong> &quot;sh&quot; é uma assinatura proprietária do canal legado <span className="font-mono">config/</span> do Aeris, cujo algoritmo não foi documentado — o firmware descartará este comando.
                      Para Aeris, use os presets acima: o canal oficial <span className="font-mono">set/</span> do fabricante aceita o valor puro e não exige assinatura.
                    </div>
                  )}
                </div>
                <div>
                  <label className={labelCls}>Sub-tópico de confirmação (opcional)</label>
                  <input className={`${inputCls} font-mono`} placeholder="shelly1/resp/rpc" value={responseTopic} onChange={(e) => setResponseTopic(e.target.value)} />
                  {responseTopic.trim() && (
                    <label className="flex items-center gap-2 mt-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        className="h-3 w-3 accent-amber-600"
                        checked={matchByValue}
                        onChange={(e) => setMatchByValue(e.target.checked)}
                      />
                      <span className="text-[11px] text-muted-foreground">
                        Confirmar pelo valor no eco (Aeris sp_val1) em vez do campo <span className="font-mono">id</span> RPC
                      </span>
                    </label>
                  )}
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {matchByValue && responseTopic.trim()
                      ? 'O gateway confirmará o comando quando o equipamento publicar o novo valor neste tópico (ex.: sp_val1 ≈ valor comandado).'
                      : 'Se preenchido, o gateway aguarda a resposta RPC neste tópico para confirmar o comando. Sem ele, o comando é reportado apenas como "enviado".'}
                  </p>
                </div>
              </>
            )}
          </div>

          {errorMsg && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">{errorMsg}</div>}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-4 shrink-0">
          <button onClick={resetAndClose} className="h-9 px-4 text-sm border border-border rounded-md text-foreground hover:bg-muted/50 transition-colors">
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={!formValid || saving}
            className="h-9 px-4 text-sm rounded-md font-medium bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {isEdit ? 'Salvar Alterações' : 'Adicionar Ponto'}
          </button>
        </div>
      </div>
    </div>
  );
}
