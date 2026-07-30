'use client';

import { useState } from 'react';
import {
  RefreshCw, Loader2, CheckCircle2, AlertCircle,
  ArrowDownToLine, RotateCcw, X, Trash2,
} from 'lucide-react';
import type { BACnetDevice } from '@/mocks/data/devices.mock';
import type { DiscoveredBACnetPoint } from '@/mocks/data/devices.mock';
import {
  syncBACnetPoints,
  applySyncNewPoints,
  applyReplaceAllPoints,
  type SyncBACnetResult,
} from '../services/devices.service';
import { translateDeviceError } from '../utils/device-errors';

const OBJECT_TYPE_BADGE: Record<string, string> = {
  AI:  'bg-blue-50 text-blue-700 border-blue-200',
  AO:  'bg-indigo-50 text-indigo-700 border-indigo-200',
  BI:  'bg-teal-50 text-teal-700 border-teal-200',
  BO:  'bg-orange-50 text-orange-700 border-orange-200',
  AV:  'bg-purple-50 text-purple-700 border-purple-200',
  BV:  'bg-pink-50 text-pink-700 border-pink-200',
  MSI: 'bg-amber-50 text-amber-700 border-amber-200',
  MSO: 'bg-amber-50 text-amber-700 border-amber-200',
  MSV: 'bg-amber-50 text-amber-800 border-amber-300',
  ACC: 'bg-lime-50 text-lime-700 border-lime-200',
  PC:  'bg-lime-50 text-lime-800 border-lime-300',
  CSV: 'bg-slate-50 text-slate-700 border-slate-200',
  IV:  'bg-sky-50 text-sky-700 border-sky-200',
  LAV: 'bg-violet-50 text-violet-700 border-violet-200',
  PIV: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

interface Props {
  device: BACnetDevice;
  onClose: () => void;
  onSynced: (updatedDevice: BACnetDevice) => void;
}

type Phase =
  | 'idle'        // aguardando ação do usuário
  | 'scanning'    // executando discovery
  | 'results'     // exibindo resultado
  | 'applying'    // aplicando sync
  | 'done';       // sincronização concluída

export default function BACnetSyncModal({ device, onClose, onSynced }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<SyncBACnetResult | null>(null);
  const [addedCount, setAddedCount] = useState(0);
  const [removedCount, setRemovedCount] = useState(0);
  // Índices (na lista newPoints) dos pontos marcados para sincronizar.
  const [selectedIdx, setSelectedIdx] = useState<Set<number>>(new Set());

  function toggleSelected(i: number) {
    setSelectedIdx((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  }

  function toggleSelectAll() {
    if (!syncResult) return;
    setSelectedIdx((prev) =>
      prev.size === syncResult.newPoints.length
        ? new Set()
        : new Set(syncResult.newPoints.map((_, i) => i)),
    );
  }

  async function handleScan() {
    setPhase('scanning');
    setError(null);
    setSyncResult(null);
    try {
      const result = await syncBACnetPoints(device);
      setSyncResult(result);
      // Todos os novos pontos começam marcados (comportamento anterior preservado).
      setSelectedIdx(new Set(result.newPoints.map((_, i) => i)));
      setPhase('results');
    } catch (err) {
      setError(translateDeviceError(err, {
        ip: device.ip,
        port: device.port,
        fallback: 'Não foi possível consultar a controladora. Tente novamente.',
      }));
      setPhase('idle');
    }
  }

  async function handleSyncNew() {
    if (!syncResult || syncResult.newPoints.length === 0) return;
    const selectedPoints = syncResult.newPoints.filter((_, i) => selectedIdx.has(i));
    if (selectedPoints.length === 0) return;
    setPhase('applying');
    setError(null);
    try {
      const updated = await applySyncNewPoints(device.id, selectedPoints);
      setAddedCount(selectedPoints.length);
      setRemovedCount(0);
      setPhase('done');
      onSynced(updated);
    } catch (err) {
      setError(translateDeviceError(err, {
        ip: device.ip,
        port: device.port,
        fallback: 'Erro ao sincronizar pontos.',
      }));
      setPhase('results');
    }
  }

  async function handleReplaceAll() {
    if (!syncResult) return;

    // Substitui pelos pontos que existem AGORA na controladora: obsoletos saem,
    // novos entram e os que continuam preservam o nome/tag customizado salvo.
    setPhase('applying');
    setError(null);
    try {
      const existingByKey = new Map(
        syncResult.existing.map((p) => [`${String(p.objectType)}:${p.instance}`, p]),
      );
      const payload: DiscoveredBACnetPoint[] = syncResult.discovered.map((dp) => {
        const saved = existingByKey.get(`${String(dp.objectType)}:${dp.instance}`);
        if (!saved) return dp;
        // Ponto que continua existindo: mantém o dado salvo (nome do mprog,
        // tag e unidade customizadas) em vez do valor genérico do discovery.
        return {
          ...dp,
          objectName: saved.objectName ?? dp.objectName,
          tag: saved.tag,
          unit: saved.unit || dp.unit,
        };
      });
      const updated = await applyReplaceAllPoints(device.id, payload);
      setAddedCount(syncResult.newPoints.length);
      setRemovedCount(syncResult.removedPoints.length);
      setPhase('done');
      onSynced(updated);
    } catch (err) {
      setError(translateDeviceError(err, {
        ip: device.ip,
        port: device.port,
        fallback: 'Erro ao atualizar pontos.',
      }));
      setPhase('results');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-card border border-border rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <RefreshCw className="h-5 w-5 text-cyan-700 shrink-0" />
            <h2 className="text-base font-semibold text-foreground shrink-0">Sincronizar Pontos</h2>
            <span className="text-sm text-muted-foreground truncate">— {device.name}</span>
          </div>
          <button
            onClick={onClose}
            disabled={phase === 'scanning' || phase === 'applying'}
            className="text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5 flex-1 overflow-y-auto">

          {/* Fase: idle — instrução inicial */}
          {phase === 'idle' && (
            <>
              <p className="text-sm text-muted-foreground">
                O sistema irá conectar à controladora{' '}
                <span className="font-mono text-foreground">{device.ip}:{device.port}</span>{' '}
                e comparar os pontos disponíveis com os já cadastrados.
                Novos pontos serão identificados e poderão ser sincronizados.
              </p>
              {error && (
                <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}
              <button
                onClick={() => void handleScan()}
                className="flex items-center gap-2 h-9 px-4 text-sm bg-cyan-700 text-white rounded-md hover:bg-cyan-800 transition-colors"
              >
                <RefreshCw className="h-4 w-4" />
                Consultar controladora
              </button>
            </>
          )}

          {/* Fase: scanning */}
          {phase === 'scanning' && (
            <div className="flex flex-col items-center gap-4 py-8">
              <Loader2 className="h-8 w-8 text-cyan-600 animate-spin" />
              <div className="text-center space-y-1">
                <p className="text-sm font-medium text-foreground">Consultando a controladora...</p>
                <p className="text-xs text-muted-foreground">
                  Conectando em <span className="font-mono">{device.ip}:{device.port}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  Enumerando objetos BACnet em paralelo — pode levar até 15s
                </p>
              </div>
            </div>
          )}

          {/* Fase: results */}
          {phase === 'results' && syncResult && (
            <>
              {/* Origem da lista de pontos (exata vs varredura heurística) */}
              {syncResult.discoverySource === 'scan' ? (
                <div className="flex items-start gap-2 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                  <span>
                    A controladora não expôs a lista completa de objetos — os pontos foram
                    encontrados por <span className="font-medium">varredura heurística</span> e
                    podem não incluir todos os objetos existentes.
                  </span>
                </div>
              ) : syncResult.discoverySource ? (
                <div className="flex items-start gap-2 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span>
                    Lista completa de objetos obtida diretamente da controladora — o resultado é exato.
                  </span>
                </div>
              ) : null}

              {/* Resumo */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-muted/40 rounded-lg border border-border px-4 py-3 text-center">
                  <div className="text-2xl font-bold text-foreground">{syncResult.existing.length}</div>
                  <div className="text-xs text-muted-foreground mt-1">Cadastrados</div>
                </div>
                <div className="bg-muted/40 rounded-lg border border-border px-4 py-3 text-center">
                  <div className="text-2xl font-bold text-foreground">{syncResult.foundCount}</div>
                  <div className="text-xs text-muted-foreground mt-1">Encontrados agora</div>
                </div>
                <div className={`rounded-lg border px-4 py-3 text-center ${
                  syncResult.newPoints.length > 0
                    ? 'bg-emerald-50 border-emerald-200'
                    : 'bg-muted/40 border-border'
                }`}>
                  <div className={`text-2xl font-bold ${
                    syncResult.newPoints.length > 0 ? 'text-emerald-700' : 'text-foreground'
                  }`}>{syncResult.newPoints.length}</div>
                  <div className="text-xs text-muted-foreground mt-1">Pontos novos</div>
                </div>
                <div className={`rounded-lg border px-4 py-3 text-center ${
                  syncResult.removedPoints.length > 0
                    ? 'bg-red-50 border-red-200'
                    : 'bg-muted/40 border-border'
                }`}>
                  <div className={`text-2xl font-bold ${
                    syncResult.removedPoints.length > 0 ? 'text-red-700' : 'text-foreground'
                  }`}>{syncResult.removedPoints.length}</div>
                  <div className="text-xs text-muted-foreground mt-1">Não existem mais</div>
                </div>
              </div>

              {/* Lista de novos pontos */}
              {syncResult.newPoints.length > 0 ? (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">
                    Novos pontos encontrados
                  </p>
                  <div className="border border-border rounded-lg overflow-hidden max-h-52 overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/40 border-b border-border sticky top-0">
                        <tr>
                          <th className="px-3 py-2 text-left w-8">
                            <input
                              type="checkbox"
                              aria-label="Selecionar todos os pontos novos"
                              checked={selectedIdx.size === syncResult.newPoints.length}
                              onChange={toggleSelectAll}
                              className="h-3.5 w-3.5 accent-cyan-700 cursor-pointer align-middle"
                            />
                          </th>
                          {['Nome', 'Tipo', 'Instância', 'Tag'].map((h) => (
                            <th key={h} className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {syncResult.newPoints.map((p, i) => (
                          <tr
                            key={i}
                            className="hover:bg-muted/20 cursor-pointer"
                            onClick={() => toggleSelected(i)}
                          >
                            <td className="px-3 py-2 w-8">
                              <input
                                type="checkbox"
                                aria-label={`Selecionar ${p.objectName}`}
                                checked={selectedIdx.has(i)}
                                onChange={() => toggleSelected(i)}
                                onClick={(e) => e.stopPropagation()}
                                className="h-3.5 w-3.5 accent-cyan-700 cursor-pointer align-middle"
                              />
                            </td>
                            <td className="px-3 py-2 font-medium text-foreground text-xs">{p.objectName}</td>
                            <td className="px-3 py-2">
                              <span className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium border ${OBJECT_TYPE_BADGE[String(p.objectType)] ?? ''}`}>
                                {p.objectType}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-muted-foreground text-xs">{p.instance}</td>
                            <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{p.tag}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : syncResult.removedPoints.length === 0 && (
                <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span>Todos os pontos da controladora já estão cadastrados. Nenhuma sincronização necessária.</span>
                </div>
              )}

              {/* Lista de pontos removidos (não existem mais na controladora) */}
              {syncResult.removedPoints.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-red-700 mb-2 uppercase tracking-wide flex items-center gap-1.5">
                    <Trash2 className="h-3.5 w-3.5" />
                    Pontos que não existem mais na controladora
                  </p>
                  <div className="border border-red-200 rounded-lg overflow-hidden max-h-52 overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-red-50/60 border-b border-red-200 sticky top-0">
                        <tr>
                          {['Nome', 'Tipo', 'Instância', 'Tag'].map((h) => (
                            <th key={h} className="px-3 py-2 text-left text-xs font-medium text-red-700">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {syncResult.removedPoints.map((p) => (
                          <tr key={p.id} className="hover:bg-red-50/40">
                            <td className="px-3 py-2 font-medium text-foreground text-xs">{p.objectName ?? p.tag}</td>
                            <td className="px-3 py-2">
                              <span className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium border ${OBJECT_TYPE_BADGE[String(p.objectType)] ?? ''}`}>
                                {p.objectType}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-muted-foreground text-xs">{p.instance}</td>
                            <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{p.tag}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    Ao clicar em <span className="font-medium text-foreground">Atualizar todos os pontos</span>,
                    estes pontos serão removidos da lista e o gateway deixará de lê-los.
                    Trends e regras de alarme associadas também serão removidas.
                  </p>
                </div>
              )}

              {error && (
                <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              {/* Ações */}
              <div className="flex items-center gap-3 flex-wrap">
                {syncResult.newPoints.length > 0 && (
                  <button
                    onClick={() => void handleSyncNew()}
                    disabled={selectedIdx.size === 0}
                    className="flex items-center gap-2 h-9 px-4 text-sm bg-cyan-700 text-white rounded-md hover:bg-cyan-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <ArrowDownToLine className="h-4 w-4" />
                    {selectedIdx.size === 0
                      ? 'Nenhum ponto selecionado'
                      : selectedIdx.size === syncResult.newPoints.length
                        ? `Sincronizar ${syncResult.newPoints.length} novo${syncResult.newPoints.length > 1 ? 's' : ''} ponto${syncResult.newPoints.length > 1 ? 's' : ''}`
                        : `Sincronizar ${selectedIdx.size} de ${syncResult.newPoints.length} pontos`}
                  </button>
                )}
                <button
                  onClick={() => void handleReplaceAll()}
                  className="flex items-center gap-2 h-9 px-4 text-sm border border-orange-300 text-orange-700 bg-orange-50 rounded-md hover:bg-orange-100 transition-colors"
                  title="Substitui todos os pontos cadastrados pelos encontrados agora"
                >
                  <RotateCcw className="h-4 w-4" />
                  Atualizar todos os pontos
                </button>
                <button
                  onClick={() => void handleScan()}
                  className="flex items-center gap-2 h-9 px-3 text-sm border border-border text-muted-foreground rounded-md hover:bg-muted/40 transition-colors"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Consultar novamente
                </button>
              </div>
            </>
          )}

          {/* Fase: applying */}
          {phase === 'applying' && (
            <div className="flex flex-col items-center gap-4 py-8">
              <Loader2 className="h-8 w-8 text-cyan-600 animate-spin" />
              <p className="text-sm font-medium text-foreground">Aplicando sincronização...</p>
            </div>
          )}

          {/* Fase: done */}
          {phase === 'done' && (
            <div className="flex flex-col items-center gap-4 py-6">
              <div className="flex items-center justify-center h-14 w-14 rounded-full bg-emerald-50 border border-emerald-200">
                <CheckCircle2 className="h-7 w-7 text-emerald-600" />
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-foreground">Sincronização concluída!</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {addedCount === 0 && removedCount === 0 && 'Pontos atualizados com sucesso.'}
                  {addedCount > 0 && `${addedCount} novo${addedCount > 1 ? 's pontos adicionados' : ' ponto adicionado'} ao dispositivo.`}
                  {addedCount > 0 && removedCount > 0 && ' '}
                  {removedCount > 0 && `${removedCount} ponto${removedCount > 1 ? 's' : ''} que não exist${removedCount > 1 ? 'em' : 'e'} mais na controladora ${removedCount > 1 ? 'foram removidos' : 'foi removido'}.`}
                </p>
              </div>
              <button
                onClick={onClose}
                className="h-9 px-5 text-sm bg-cyan-700 text-white rounded-md hover:bg-cyan-800 transition-colors"
              >
                Fechar
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
