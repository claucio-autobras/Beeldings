'use client';

import { useEffect, useState } from 'react';
import { Loader2, Radio, Trash2, X } from 'lucide-react';
import type { MqttDevice } from '@/mocks/data/devices.mock';
import { deleteDevice, updateMqttDevice } from '../services/devices.service';
import type { MqttDeviceTopicConfig } from '../types/device.types';
import PasswordConfirmDialog from '@/components/PasswordConfirmDialog';
import { translateDeviceError } from '../utils/device-errors';

interface Props {
  device: MqttDevice | null;
  onClose: () => void;
  onUpdated: (device: MqttDevice) => void;
  onDeleted: (deviceId: string) => void;
}

const inputCls = 'w-full h-9 px-3 text-sm border border-border rounded-md bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring';
const labelCls = 'block text-xs font-medium text-foreground mb-1';

export default function EditMqttDeviceModal({ device, onClose, onUpdated, onDeleted }: Props) {
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [name, setName] = useState('');
  const [heartbeatTopic, setHeartbeatTopic] = useState('');
  const [heartbeatTimeout, setHeartbeatTimeout] = useState('90');

  // Config de tópico do dispositivo (modo raiz + heartbeat + credencial dedicada).
  const cfg = (device as MqttDevice & { mqttConfig?: MqttDeviceTopicConfig } | null)?.mqttConfig;

  useEffect(() => {
    if (device) {
      setName(device.name);
      setConfirmDelete(false);
      setErrorMsg('');
      const c = (device as MqttDevice & { mqttConfig?: MqttDeviceTopicConfig }).mqttConfig;
      setHeartbeatTopic(c?.heartbeatTopic ?? '');
      setHeartbeatTimeout(String(c?.heartbeatTimeoutSeconds ?? 90));
    }
  }, [device]);

  if (!device) return null;

  const hbWindow = Number(heartbeatTimeout);
  const heartbeatValid = !heartbeatTopic.trim()
    || (Number.isFinite(hbWindow) && hbWindow >= 15 && hbWindow <= 3600);
  const formValid = !!name.trim() && heartbeatValid;

  async function handleSave() {
    if (!formValid || saving || !device) return;
    setSaving(true);
    setErrorMsg('');
    try {
      const updated = await updateMqttDevice(device.id, {
        name: name.trim(),
        heartbeatTopic: heartbeatTopic.trim() || null,
        heartbeatTimeoutSeconds: heartbeatTopic.trim() ? hbWindow : null,
      });
      onUpdated(updated);
      onClose();
    } catch (err: unknown) {
      setErrorMsg(translateDeviceError(err, { fallback: 'Não foi possível salvar as alterações. Tente novamente.' }));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(confirmationToken: string) {
    if (saving || !device) return;
    setSaving(true);
    setDeleteError('');
    try {
      await deleteDevice(device.id, confirmationToken);
      onDeleted(device.id);
      onClose();
    } catch (err: unknown) {
      setDeleteError(translateDeviceError(err, { fallback: 'Não foi possível remover o dispositivo. Tente novamente.' }));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg bg-card rounded-xl border border-border shadow-xl flex flex-col max-h-[90vh] overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4 shrink-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Radio className="h-4 w-4 text-sky-600" />
            Editar Dispositivo MQTT
          </h2>
          <button onClick={onClose} disabled={saving} className="text-muted-foreground hover:text-foreground disabled:opacity-50">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 flex-1 overflow-y-auto space-y-4">
          <div>
            <label className={labelCls}>Nome do equipamento</label>
            <input
              className={inputCls}
              placeholder="Ex: Sensor de temperatura sala técnica"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Para alterar os tópicos/pontos, use a tela do dispositivo (Ver pontos → Adicionar Ponto).
            O site/gateway não pode ser alterado aqui porque faz parte do tópico dos sensores.
          </p>

          {/* Tópico raiz próprio + credencial dedicada (modo raiz) */}
          {cfg?.topicMode === 'root' && (
            <div className="space-y-1.5 border border-sky-200 dark:border-sky-900 rounded-lg p-3 bg-sky-50/50 dark:bg-sky-950/30">
              <h3 className="text-sm font-semibold text-foreground">Tópico raiz próprio</h3>
              <p className="text-[11px] text-muted-foreground">
                Este equipamento publica no próprio namespace{' '}
                <span className="font-mono text-foreground">{cfg.rootTopic}</span> (imutável — para trocar, exclua e recadastre).
              </p>
              {cfg.credential ? (
                <div className="grid grid-cols-1 gap-1 text-xs pt-1">
                  {cfg.credential.broker && (
                    <div><span className="text-muted-foreground">Broker:</span> <span className="font-mono text-foreground break-all">{cfg.credential.broker}</span></div>
                  )}
                  <div><span className="text-muted-foreground">Usuário:</span> <span className="font-mono text-foreground break-all">{cfg.credential.username}</span></div>
                  <div><span className="text-muted-foreground">Senha:</span> <span className="font-mono text-foreground break-all">{cfg.credential.password}</span></div>
                  <div><span className="text-muted-foreground">Publicar em:</span> <span className="font-mono text-foreground break-all">{cfg.credential.topicPrefix}&lt;sub-tópico&gt;</span></div>
                </div>
              ) : (
                <p className="text-[11px] text-amber-700">Credencial dedicada indisponível — verifique a configuração do broker.</p>
              )}
            </div>
          )}

          {/* Presença / heartbeat */}
          <div className="space-y-2 border border-border rounded-lg p-3 bg-muted/20">
            <h3 className="text-sm font-semibold text-foreground">Presença (heartbeat)</h3>
            <p className="text-[11px] text-muted-foreground">
              Para equipamentos que só publicam quando o valor muda: enquanto o heartbeat chegar dentro da janela,
              o dispositivo aparece online mesmo sem telemetria nova. Deixe vazio para usar só a recência de telemetria.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label className={labelCls}>Tópico de presença (completo)</label>
                <input className={`${inputCls} font-mono`} placeholder={cfg?.topicMode === 'root' && cfg.rootTopic ? `${cfg.rootTopic}/status` : 'ex: …/sensors/aparelho/status'}
                  value={heartbeatTopic} onChange={(e) => setHeartbeatTopic(e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Janela (s)</label>
                <input className={inputCls} type="number" min={15} max={3600} value={heartbeatTimeout}
                  onChange={(e) => setHeartbeatTimeout(e.target.value)} disabled={!heartbeatTopic.trim()} />
                {!heartbeatValid && <p className="text-[11px] text-red-600 mt-1">Entre 15 e 3600 segundos.</p>}
              </div>
            </div>
          </div>

          {errorMsg && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
              {errorMsg}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border px-5 py-4 shrink-0">
          <button onClick={() => { setDeleteError(''); setConfirmDelete(true); }} disabled={saving}
            className="h-9 px-3 text-sm border border-red-200 rounded-md text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50 flex items-center gap-2">
            <Trash2 className="h-4 w-4" />
            Remover dispositivo
          </button>
          <div className="flex items-center gap-2">
            <button onClick={onClose} disabled={saving}
              className="h-9 px-4 text-sm border border-border rounded-md text-foreground hover:bg-muted/50 transition-colors disabled:opacity-50">
              Cancelar
            </button>
            <button onClick={handleSave} disabled={!formValid || saving}
              className="h-9 px-4 text-sm rounded-md font-medium bg-sky-700 hover:bg-sky-800 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Salvar alterações
            </button>
          </div>
        </div>
      </div>

      {/* Exclusão crítica: exige a senha do operador */}
      {confirmDelete && (
        <PasswordConfirmDialog
          title="Remover dispositivo?"
          description={
            <>
              O dispositivo <span className="font-medium text-foreground">{device?.name}</span> e todos os
              seus pontos, históricos e alarmes serão excluídos permanentemente. Esta ação não pode ser desfeita.
            </>
          }
          confirmLabel="Remover"
          isPending={saving}
          error={deleteError || null}
          onCancel={() => { setConfirmDelete(false); setDeleteError(''); }}
          onConfirm={(token) => void handleDelete(token)}
        />
      )}
    </div>
  );
}
