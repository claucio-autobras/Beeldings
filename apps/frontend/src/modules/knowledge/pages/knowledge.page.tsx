'use client';

import { useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  CheckCircle2,
  FileText,
  FileUp,
  Loader2,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { API_URL, apiDelete, apiGet, apiPost } from '@/lib/api-client';

type KnowledgeType = 'MANUAL' | 'HOWTO' | 'PLAYBOOK';
type KnowledgeStatus = 'DRAFT' | 'APPROVED';

interface KnowledgeDoc {
  id: string;
  type: KnowledgeType;
  status: KnowledgeStatus;
  title: string;
  equipmentType: string | null;
  equipmentModel: string | null;
  source: string | null;
  anonymized: boolean;
  createdAt: string;
  updatedAt: string;
  _count: { chunks: number };
}

const TYPE_LABEL: Record<KnowledgeType, string> = {
  MANUAL: 'Manual',
  HOWTO: 'Como fazer',
  PLAYBOOK: 'Playbook',
};

const EMPTY_FORM = {
  type: 'PLAYBOOK' as KnowledgeType,
  title: '',
  content: '',
  equipmentType: '',
  equipmentModel: '',
  source: '',
};

export default function KnowledgePage() {
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [extractInfo, setExtractInfo] = useState<string | null>(null);
  // Progresso do OCR (PDFs escaneados): null = sem informação (extração direta
  // ou progresso indisponível) → mantém o texto genérico "Extraindo texto…".
  const [ocrProgress, setOcrProgress] = useState<{ processed: number; total: number } | null>(null);
  // Hash SHA-256 do PDF extraído — enviado no salvamento para o backend
  // bloquear importação duplicada do mesmo arquivo.
  const [pdfHash, setPdfHash] = useState<string | null>(null);

  /** Envia o PDF para extração no backend e pré-preenche o formulário para revisão. */
  async function handlePdfSelected(file: File) {
    setExtracting(true);
    setExtractError(null);
    setExtractInfo(null);
    setOcrProgress(null);

    // ID gerado pelo cliente permite acompanhar o progresso do OCR via polling
    // enquanto o POST de extração ainda está em andamento.
    const extractId =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const poll = window.setInterval(() => {
      void fetch(`${API_URL}/knowledge/extract-pdf/${extractId}/progress`, {
        credentials: 'include',
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((p: { active?: boolean; phase?: string; processed?: number; total?: number; done?: boolean } | null) => {
          if (!p?.active || p.done) return;
          if (p.phase === 'ocr' && typeof p.processed === 'number' && p.total) {
            setOcrProgress({ processed: p.processed, total: p.total });
          } else if (p.phase === 'render' && p.total) {
            setOcrProgress({ processed: 0, total: p.total });
          }
        })
        .catch(() => undefined);
    }, 1500);

    try {
      const data = new FormData();
      data.append('file', file);
      const res = await fetch(
        `${API_URL}/knowledge/extract-pdf?extractId=${encodeURIComponent(extractId)}`,
        {
          method: 'POST',
          credentials: 'include',
          body: data,
        },
      );
      type ExtractBody = {
        message?: string;
        pending?: boolean;
        suggestedTitle?: string;
        content?: string;
        pages?: number;
        chars?: number;
        truncated?: boolean;
        ocr?: boolean;
        ocrPages?: number | null;
        fileHash?: string;
      };
      let body = (await res.json().catch(() => ({}))) as ExtractBody;
      if (!res.ok) {
        throw new Error(body.message ?? `Falha ao extrair o PDF (HTTP ${res.status}).`);
      }
      if (body.fileHash) setPdfHash(body.fileHash);
      if (body.pending) {
        // PDF escaneado: o OCR roda em segundo plano no servidor (manuais de
        // 100+ páginas não cabem num único request). Aguarda o resultado por
        // polling; o progresso página a página segue vindo do outro poll.
        const deadline = Date.now() + 60 * 60_000; // teto generoso (1h)
        for (;;) {
          if (Date.now() > deadline) {
            throw new Error('O OCR demorou mais que o esperado. Tente novamente.');
          }
          await new Promise((r) => setTimeout(r, 2000));
          const rr = await fetch(`${API_URL}/knowledge/extract-pdf/${extractId}/result`, {
            credentials: 'include',
          }).catch(() => null);
          if (!rr?.ok) continue;
          const jr = (await rr.json().catch(() => null)) as
            | ({ status?: string; message?: string } & ExtractBody)
            | null;
          if (!jr) continue;
          if (jr.status === 'pending') continue;
          if (jr.status === 'error') {
            throw new Error(jr.message ?? 'Falha no OCR do PDF escaneado.');
          }
          if (jr.status === 'unknown') {
            throw new Error(
              'O servidor foi reiniciado durante o OCR e o resultado se perdeu. Envie o PDF novamente.',
            );
          }
          body = jr;
          break;
        }
      }
      setForm((prev) => ({
        ...prev,
        type: 'MANUAL',
        title: prev.title.trim() ? prev.title : (body.suggestedTitle ?? file.name),
        content: body.content ?? '',
        source: prev.source.trim() ? prev.source : file.name,
      }));
      if (body.ocr) {
        const scope =
          body.ocrPages && body.pages && body.ocrPages < body.pages
            ? `${body.ocrPages} de ${body.pages} páginas (limite de OCR por envio)`
            : `${body.ocrPages ?? body.pages ?? '?'} página(s)`;
        setExtractInfo(
          `PDF escaneado: texto obtido por OCR de ${scope} (${(body.chars ?? 0).toLocaleString('pt-BR')} caracteres)` +
            (body.truncated ? ' — documento muito grande, o texto foi cortado no limite.' : '') +
            '. OCR pode conter erros — revise com atenção antes de salvar.',
        );
      } else {
        setExtractInfo(
          `Texto extraído de ${body.pages ?? '?'} página(s) (${(body.chars ?? 0).toLocaleString('pt-BR')} caracteres)` +
            (body.truncated ? ' — documento muito grande, o texto foi cortado no limite.' : '') +
            '. Revise abaixo antes de salvar.',
        );
      }
    } catch (e) {
      setPdfHash(null);
      setExtractError(e instanceof Error ? e.message : 'Falha ao extrair o texto do PDF.');
    } finally {
      window.clearInterval(poll);
      setExtracting(false);
      setOcrProgress(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const list = await apiGet<KnowledgeDoc[]>('/knowledge');
      setDocs(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar a base de conhecimento.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function handleCreate() {
    if (!form.title.trim() || !form.content.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await apiPost('/knowledge', {
        type: form.type,
        title: form.title.trim(),
        content: form.content.trim(),
        equipmentType: form.equipmentType.trim() || null,
        equipmentModel: form.equipmentModel.trim() || null,
        source: form.source.trim() || null,
        anonymized: true,
        fileHash: pdfHash,
      });
      setForm({ ...EMPTY_FORM });
      setPdfHash(null);
      setExtractInfo(null);
      setExtractError(null);
      setShowForm(false);
      await refresh();
    } catch (e) {
      // pdfHash é mantido de propósito: se o salvamento falhar (inclusive por
      // duplicidade), o retry continua vinculado ao mesmo arquivo.
      setError(e instanceof Error ? e.message : 'Erro ao salvar o documento.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleApproval(doc: KnowledgeDoc) {
    setBusyId(doc.id);
    setError(null);
    try {
      const action = doc.status === 'APPROVED' ? 'unapprove' : 'approve';
      await apiPost(`/knowledge/${doc.id}/${action}`, {});
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao alterar o status.');
    } finally {
      setBusyId(null);
    }
  }

  async function remove(doc: KnowledgeDoc) {
    if (!window.confirm(`Excluir "${doc.title}" da base de conhecimento?`)) return;
    setBusyId(doc.id);
    setError(null);
    try {
      await apiDelete(`/knowledge/${doc.id}`);
      setDocs((prev) => prev.filter((d) => d.id !== doc.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao excluir o documento.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-xl font-semibold text-foreground">
            <BookOpen className="h-5 w-5 text-cyan-600" />
            Base de Conhecimento
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Manuais, procedimentos e playbooks que alimentam o Bluebee. Apenas documentos
            aprovados são usados nas respostas.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="flex shrink-0 items-center gap-2 rounded-md bg-cyan-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-cyan-700"
        >
          <Plus className="h-4 w-4" />
          Novo documento
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {showForm && (
        <div className="space-y-3 rounded-lg border border-border bg-card p-4">
          <div className="flex flex-col gap-2 rounded-md border border-dashed border-border bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 text-sm">
              <p className="font-medium text-foreground">Importar de um PDF</p>
              <p className="text-xs text-muted-foreground">
                O texto é extraído automaticamente e fica disponível para revisão antes de salvar.
                PDFs escaneados (somente imagem) passam por OCR — pode levar alguns minutos.
              </p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handlePdfSelected(file);
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={extracting}
              className="flex shrink-0 items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            >
              {extracting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileUp className="h-4 w-4" />
              )}
              {extracting
                ? ocrProgress
                  ? `OCR: página ${Math.min(ocrProgress.processed + 1, ocrProgress.total)} de ${ocrProgress.total}…`
                  : 'Extraindo texto…'
                : 'Enviar PDF'}
            </button>
          </div>
          {extracting && ocrProgress && (
            <div className="space-y-1 rounded-md border border-border bg-muted/20 px-3 py-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>PDF escaneado — transcrevendo por OCR</span>
                <span>
                  {ocrProgress.processed} de {ocrProgress.total} página(s)
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-cyan-600 transition-all duration-500"
                  style={{
                    width: `${ocrProgress.total ? Math.round((ocrProgress.processed / ocrProgress.total) * 100) : 0}%`,
                  }}
                />
              </div>
            </div>
          )}
          {extractError && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {extractError}
            </div>
          )}
          {extractInfo && !extractError && (
            <div className="rounded-md border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm text-cyan-800">
              {extractInfo}
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="text-sm">
              <span className="mb-1 block font-medium text-foreground">Tipo</span>
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value as KnowledgeType })}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-cyan-400"
              >
                <option value="PLAYBOOK">Playbook</option>
                <option value="HOWTO">Como fazer</option>
                <option value="MANUAL">Manual</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-foreground">Tipo de equipamento</span>
              <input
                value={form.equipmentType}
                onChange={(e) => setForm({ ...form, equipmentType: e.target.value })}
                placeholder="ex.: Chiller"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-cyan-400"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-foreground">Modelo</span>
              <input
                value={form.equipmentModel}
                onChange={(e) => setForm({ ...form, equipmentModel: e.target.value })}
                placeholder="ex.: 30XA"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-cyan-400"
              />
            </label>
          </div>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-foreground">Título</span>
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="ex.: Playbook — Chiller com alta pressão de condensação"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-cyan-400"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-foreground">Conteúdo</span>
            <textarea
              value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
              rows={8}
              placeholder="Descreva o procedimento, sintomas, causas prováveis e ações recomendadas. Não inclua dados sensíveis de clientes."
              className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-cyan-400"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-foreground">Fonte (opcional)</span>
            <input
              value={form.source}
              onChange={(e) => setForm({ ...form, source: e.target.value })}
              placeholder="ex.: Manual do fabricante, experiência de campo"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-cyan-400"
            />
          </label>
          <p className="text-xs text-muted-foreground">
            O documento entra como rascunho e só passa a ser usado pelo Bluebee após ser aprovado.
            O conteúdo é dividido e indexado automaticamente para a busca semântica.
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setForm({ ...EMPTY_FORM });
                setPdfHash(null);
                setExtractInfo(null);
                setExtractError(null);
              }}
              className="rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground transition hover:bg-muted"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={saving || !form.title.trim() || !form.content.trim()}
              className="flex items-center gap-2 rounded-md bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Salvar rascunho
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg bg-muted/40" />
          ))}
        </div>
      ) : docs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <FileText className="mb-3 h-12 w-12 text-muted-foreground/25" />
          <p className="text-sm text-muted-foreground">
            Nenhum documento ainda. Adicione manuais e playbooks para o Bluebee aprender.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Título</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Tipo</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Equipamento</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-muted-foreground">Trechos</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {docs.map((doc) => {
                const equip = [doc.equipmentType, doc.equipmentModel].filter(Boolean).join(' / ');
                return (
                  <tr key={doc.id} className="transition-colors hover:bg-muted/20">
                    <td className="px-4 py-3">
                      <span className="font-medium text-foreground" title={doc.source ?? undefined}>
                        {doc.title}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{TYPE_LABEL[doc.type]}</td>
                    <td className="px-4 py-3 text-muted-foreground">{equip || '—'}</td>
                    <td className="px-4 py-3 text-center text-muted-foreground">{doc._count.chunks}</td>
                    <td className="px-4 py-3 text-center">
                      {doc.status === 'APPROVED' ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
                          <CheckCircle2 className="h-3 w-3" />
                          Aprovado
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                          Rascunho
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => void toggleApproval(doc)}
                          disabled={busyId === doc.id}
                          className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground transition hover:bg-muted disabled:opacity-50"
                          title={doc.status === 'APPROVED' ? 'Retirar da base' : 'Aprovar para uso'}
                        >
                          {busyId === doc.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : doc.status === 'APPROVED' ? (
                            <RotateCcw className="h-3.5 w-3.5" />
                          ) : (
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          )}
                          {doc.status === 'APPROVED' ? 'Retirar' : 'Aprovar'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void remove(doc)}
                          disabled={busyId === doc.id}
                          className="rounded-md p-1.5 text-muted-foreground transition hover:bg-red-100 hover:text-red-600 disabled:opacity-50"
                          title="Excluir"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
