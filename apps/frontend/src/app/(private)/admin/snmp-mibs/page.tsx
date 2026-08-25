'use client';

/**
 * Página de administração de MIBs SNMP.
 *
 * Permite ao admin importar arquivos MIB (ASN.1) para que os OIDs
 * proprietários de fabricantes apareçam com nomes legíveis na tela de
 * diagnóstico SNMP (CFTV e SCA). Sem MIB, tudo funciona normalmente —
 * a MIB apenas enriquece OIDs "desconhecidos".
 */

import { useCallback, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText, Loader2, Plus, Trash2, Upload, X } from 'lucide-react';
import {
  createSnmpMib,
  deleteSnmpMib,
  listSnmpMibs,
  type SnmpMibSummary,
} from '@/modules/admin/services/snmp-mib.service';

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function SnmpMibsPage() {
  const qc = useQueryClient();

  const { data: mibs = [], isLoading } = useQuery({
    queryKey: ['snmp-mibs'],
    queryFn: listSnmpMibs,
  });

  // ─── Form state ─────────────────────────────────────────────────────────────
  const [showForm, setShowForm] = useState(false);
  const [label, setLabel] = useState('');
  const [content, setContent] = useState('');
  const [filename, setFilename] = useState('');
  const [manufacturer, setManufacturer] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setFilename(file.name);
      const reader = new FileReader();
      reader.onload = (ev) => {
        setContent((ev.target?.result as string) ?? '');
      };
      reader.readAsText(file);
    },
    [],
  );

  const create = useMutation({
    mutationFn: () =>
      createSnmpMib(label.trim(), content, filename || undefined, manufacturer.trim() || undefined),
    onSuccess: (mib) => {
      void qc.invalidateQueries({ queryKey: ['snmp-mibs'] });
      setShowForm(false);
      setLabel('');
      setContent('');
      setFilename('');
      setManufacturer('');
      setFormError(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      // Mostrar mensagem de sucesso inline (entryCount)
      setLastCreated(mib);
    },
    onError: (err) => {
      setFormError((err as Error).message ?? 'Erro ao importar MIB');
    },
  });

  const [lastCreated, setLastCreated] = useState<SnmpMibSummary | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const remove = useMutation({
    mutationFn: (id: string) => deleteSnmpMib(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['snmp-mibs'] });
      setDeleteId(null);
    },
    onError: (err) => {
      alert((err as Error).message ?? 'Erro ao remover MIB');
      setDeleteId(null);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!label.trim()) {
      setFormError('Informe o nome do fabricante / perfil.');
      return;
    }
    if (!content.trim()) {
      setFormError('Selecione ou cole o arquivo MIB.');
      return;
    }
    create.mutate();
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold text-foreground">MIBs SNMP</h1>
        <p className="text-sm text-muted-foreground">
           Importe arquivos MIB de fabricantes (formato ASN.1) para identificar
           OIDs com nomes legíveis na tela de diagnóstico SNMP. A MIB enriquece
           a identificação, mas não habilita coleta: pontos, unidades, escalas,
           trends e alarmes só mudam após revisão explícita do operador. Sem MIB,
           os perfis curados e MIBs padrão/offline continuam funcionando.
        </p>
      </div>

      {/* Botão abrir formulário */}
      {!showForm && (
        <button
          type="button"
          onClick={() => {
            setShowForm(true);
            setLastCreated(null);
            setFormError(null);
          }}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          Importar MIB
        </button>
      )}

      {/* Feedback da última importação */}
      {lastCreated && !showForm && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400">
          ✓ MIB <strong>{lastCreated.label}</strong> importada com{' '}
          <strong>{lastCreated.entryCount}</strong> OID{lastCreated.entryCount !== 1 ? 's' : ''}{' '}
          mapeados.
        </div>
      )}

      {/* Formulário de importação */}
      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="rounded-xl border border-border bg-card p-4 space-y-4 shadow-sm"
        >
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-foreground">Importar arquivo MIB</p>
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setFormError(null);
              }}
              className="rounded-md p-1 text-muted-foreground hover:bg-muted"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-medium text-foreground">
              Nome da MIB *
            </label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Ex.: Control iD, Hikvision, Intelbras…"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-medium text-foreground">
              Fabricante relacionado (opcional)
            </label>
            <input
              value={manufacturer}
              onChange={(e) => setManufacturer(e.target.value)}
              placeholder="Ex.: Control iD, Hikvision, Intelbras"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-medium text-foreground">
              Arquivo MIB (ASN.1) *
            </label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs font-medium text-foreground hover:bg-muted"
              >
                <Upload className="h-3.5 w-3.5" />
                Escolher arquivo
              </button>
              {filename && (
                <span className="text-xs text-muted-foreground font-mono">{filename}</span>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".mib,.txt,.my,.mib2,text/plain"
              onChange={handleFileChange}
              className="hidden"
            />
            <p className="text-[11px] text-muted-foreground">
              Ou cole o conteúdo do arquivo abaixo:
            </p>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={6}
              placeholder="-- Cole aqui o conteúdo do arquivo MIB (ASN.1)"
              className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-[11px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {formError && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
              {formError}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setFormError(null);
              }}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={create.isPending}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Importar
            </button>
          </div>
        </form>
      )}

      {/* Lista de MIBs */}
      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando MIBs…
        </div>
      ) : mibs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-6 py-10 text-center space-y-2">
          <FileText className="mx-auto h-8 w-8 text-muted-foreground/50" />
          <p className="text-sm font-medium text-foreground">Nenhuma MIB importada</p>
          <p className="text-xs text-muted-foreground">
            Importe um arquivo MIB de fabricante para enriquecer os OIDs descobertos
            no diagnóstico SNMP.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                  Fabricante / perfil
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                   OIDs identificados
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                  Importada em
                </th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {mibs.map((mib) => (
                <tr key={mib.id} className="border-b border-border last:border-b-0 hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <p className="font-medium text-foreground">{mib.label}</p>
                    {mib.sourceFilename && (
                      <p className="text-[11px] text-muted-foreground font-mono mt-0.5">
                        {mib.sourceFilename}
                      </p>
                    )}
                    {mib.manufacturer && (
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        Fabricante: {mib.manufacturer}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                     {mib.entryCount}
                     {mib.conflictCount > 0 && (
                       <span className="ml-2 text-amber-600 dark:text-amber-400">
                         · {mib.conflictCount} conflito{mib.conflictCount !== 1 ? 's' : ''}
                       </span>
                     )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {formatDate(mib.createdAt)}
                  </td>
                  <td className="px-4 py-3">
                    {deleteId === mib.id ? (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => remove.mutate(mib.id)}
                          disabled={remove.isPending}
                          className="inline-flex items-center gap-1 rounded-md bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                        >
                          {remove.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                          Confirmar
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteId(null)}
                          className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted"
                        >
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setDeleteId(mib.id)}
                        title="Remover MIB"
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
