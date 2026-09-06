'use client';

import { useRef, useState } from 'react';
import { Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import type { TrendHistoryRow } from '../services/trends-api.service';
import { fmtDateTime, formatValue, isDigitalPoint } from '../lib/trends-utils';

interface TrendsHistoryTableProps {
  rows: TrendHistoryRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  isLoading: boolean;
  colorById: Map<string, string>;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

const ROW_H = 37; // altura fixa de linha — base da virtualização
const VIEWPORT_H = 444; // ~12 linhas visíveis
const OVERSCAN = 6;
const PAGE_SIZES = [25, 50, 100, 200];

export function TrendsHistoryTable({
  rows, total, page, pageSize, totalPages, isLoading, colorById, onPageChange, onPageSizeChange,
}: TrendsHistoryTableProps) {
  const [scrollTop, setScrollTop] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const count = rows.length;
  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const visibleCount = Math.ceil(VIEWPORT_H / ROW_H) + OVERSCAN * 2;
  const end = Math.min(count, start + visibleCount);
  const slice = rows.slice(start, end);
  const padTop = start * ROW_H;
  const padBottom = Math.max(0, (count - end) * ROW_H);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Histórico detalhado</h3>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          Por página
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="rounded-md border border-border px-1.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-cyan-500"
          >
            {PAGE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        {/* Cabeçalho fixo */}
        <table className="w-full min-w-[520px] table-fixed text-sm">
          <colgroup>
            <col className="w-[34%]" />
            <col className="w-[34%]" />
            <col className="w-[20%]" />
            <col className="w-[12%]" />
          </colgroup>
          <thead className="border-b border-border bg-muted/40">
            <tr>
              <th className="px-2 py-2 text-left text-xs font-medium text-muted-foreground sm:px-4">Data / hora</th>
              <th className="px-2 py-2 text-left text-xs font-medium text-muted-foreground sm:px-4">Variável</th>
              <th className="px-2 py-2 text-left text-xs font-medium text-muted-foreground sm:px-4">Valor</th>
              <th className="px-2 py-2 text-left text-xs font-medium text-muted-foreground sm:px-4">Qualidade</th>
            </tr>
          </thead>
        </table>

        {/* Corpo virtualizado */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : count === 0 ? (
          <p className="py-12 text-center text-xs text-muted-foreground">Sem registros no período para as variáveis selecionadas.</p>
        ) : (
          <div
            ref={scrollRef}
            onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
            style={{ maxHeight: VIEWPORT_H }}
            className="overflow-y-auto"
          >
            <table className="w-full min-w-[520px] table-fixed text-sm">
              <colgroup>
                <col className="w-[34%]" />
                <col className="w-[34%]" />
                <col className="w-[20%]" />
                <col className="w-[12%]" />
              </colgroup>
              <tbody className="divide-y divide-border">
                {padTop > 0 && <tr style={{ height: padTop }} aria-hidden />}
                {slice.map((r) => {
                  const digital = isDigitalPoint(r.objectType);
                  const color = colorById.get(r.trendId) ?? '#94a3b8';
                  return (
                    <tr key={r.id} style={{ height: ROW_H }} className="hover:bg-muted/20">
                      <td className="truncate px-2 text-xs text-muted-foreground sm:px-4">{fmtDateTime(r.timestamp)}</td>
                      <td className="truncate px-2 sm:px-4">
                        <span className="flex items-center gap-1.5">
                          <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                          <span className="truncate text-foreground">{r.trendName}</span>
                        </span>
                      </td>
                      <td className="truncate px-2 font-tabular text-foreground sm:px-4">
                        {formatValue(r.value, digital ? 'digital' : 'analog', r.unit)}
                      </td>
                      <td className="px-2 text-xs text-muted-foreground sm:px-4">{r.quality}</td>
                    </tr>
                  );
                })}
                {padBottom > 0 && <tr style={{ height: padBottom }} aria-hidden />}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Paginação */}
      {total > 0 && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            Página {page} de {totalPages} · {total.toLocaleString('pt-BR')} registros
          </span>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => onPageChange(page - 1)} disabled={page <= 1 || isLoading}
              className="flex items-center gap-1 rounded-md border border-border px-2 py-1.5 text-xs text-foreground hover:bg-muted/50 disabled:opacity-40">
              <ChevronLeft className="h-3.5 w-3.5" /> Anterior
            </button>
            <button type="button" onClick={() => onPageChange(page + 1)} disabled={page >= totalPages || isLoading}
              className="flex items-center gap-1 rounded-md border border-border px-2 py-1.5 text-xs text-foreground hover:bg-muted/50 disabled:opacity-40">
              Próxima <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
