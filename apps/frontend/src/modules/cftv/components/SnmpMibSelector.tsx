'use client';

import { useMemo } from 'react';
import { CheckCircle2, Info, Sparkles } from 'lucide-react';
import { useT } from '@/lib/i18n';
import type { SnmpMibSummary } from '@/modules/admin/services/snmp-mib.service';

interface Props {
  mibs: SnmpMibSummary[];
  value: string;
  onChange: (value: string) => void;
  manufacturer?: string | null;
  profileLabel?: string | null;
  inputClassName?: string;
}

function normalize(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function mibMatchesDevice(mib: SnmpMibSummary, manufacturer?: string | null, profileLabel?: string | null) {
  const mibManufacturer = normalize(mib.manufacturer);
  if (!mibManufacturer) return false;
  const deviceTerms = [normalize(manufacturer), normalize(profileLabel)].filter(Boolean);
  return deviceTerms.some((term) => term.includes(mibManufacturer) || mibManufacturer.includes(term));
}

/**
 * Escolha de MIB apenas para enriquecer o diagnóstico.
 * A opção vazia mantém a semântica legada de usar o bundle padrão/offline.
 */
export function SnmpMibSelector({
  mibs,
  value,
  onChange,
  manufacturer,
  profileLabel,
  inputClassName = '',
}: Props) {
  const t = useT();
  const offlineMibs = useMemo(() => mibs.filter((mib) => mib.isOffline), [mibs]);
  const importedMibs = useMemo(() => mibs.filter((mib) => !mib.isOffline), [mibs]);
  const matchingMibs = useMemo(
    () => importedMibs.filter((mib) => mibMatchesDevice(mib, manufacturer, profileLabel)),
    [importedMibs, manufacturer, profileLabel],
  );
  const selectedMib = mibs.find((mib) => mib.id === value) ?? null;
  const recommendedMib = matchingMibs[0] ?? null;
  const hasKnownContext = Boolean(normalize(manufacturer) || normalize(profileLabel));

  return (
    <div className="space-y-2">
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={inputClassName}
        aria-describedby="snmp-mib-help snmp-mib-choice"
      >
        <option value="">{t('Nenhuma — usar nomes padrão/offline')}</option>
        {offlineMibs.length > 0 && (
          <optgroup label={t('Padrão/offline — finalidade geral')}>
            {offlineMibs.map((mib) => (
              <option key={mib.id} value={mib.id}>
                {mib.label} — {mib.entryCount} {t('nomes de OID')}
              </option>
            ))}
          </optgroup>
        )}
        <optgroup label={t('MIBs de fabricante importadas')}>
          {importedMibs.length > 0 ? (
            importedMibs.map((mib) => (
              <option key={mib.id} value={mib.id}>
                {mib.label}{mib.manufacturer ? ` — ${mib.manufacturer}` : ''} · {mib.entryCount} {t('nomes de OID')}
              </option>
            ))
          ) : (
            <option value="" disabled>{t('Nenhuma MIB proprietária importada')}</option>
          )}
        </optgroup>
        {value && !selectedMib && (
          <option value={value}>{t('MIB salva anteriormente (indisponível)')}</option>
        )}
      </select>

      <div id="snmp-mib-help" className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
        <p className="flex items-start gap-1.5">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <span>
            <strong className="font-medium text-foreground">{t('Somente para o diagnóstico.')}</strong>{' '}
            {t('A escolha dá nomes e descrições aos OIDs encontrados. Ela não ativa pontos, coleta, trends nem alarmes.')}
          </span>
        </p>
        <p id="snmp-mib-choice" className="mt-1.5">
          <strong className="font-medium text-foreground">{t('Qual escolher?')}</strong>{' '}
          {t('Use padrão/offline na maioria dos equipamentos; escolha uma MIB proprietária somente se ela corresponder ao fabricante e modelo; use “Nenhuma” se não precisar enriquecer o diagnóstico.')}
        </p>
      </div>

      {selectedMib && (
        <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span>
            {selectedMib.isOffline ? t('Origem: catálogo padrão/offline.') : t('Origem: arquivo importado.')}
            {selectedMib.sourceFilename ? ` ${t('Arquivo')}: ${selectedMib.sourceFilename}.` : ''}
            {` ${selectedMib.entryCount} ${t('nomes de OID disponíveis para o diagnóstico.')}`}
          </span>
        </p>
      )}

      {hasKnownContext && recommendedMib && (!selectedMib || recommendedMib.id !== selectedMib.id) && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-[11px]">
          <p className="flex items-start gap-1.5 text-muted-foreground">
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            <span>
              <strong className="font-medium text-foreground">
                {selectedMib ? t('Outra MIB parece mais compatível:') : t('MIB compatível encontrada:')}
              </strong>{' '}
              {recommendedMib.label}
              {recommendedMib.manufacturer ? ` (${recommendedMib.manufacturer})` : ''}.
              {' '}{t('A recomendação é opcional e não muda a sua escolha atual.')}
            </span>
          </p>
          <button
            type="button"
            onClick={() => onChange(recommendedMib.id)}
            className="shrink-0 rounded-md border border-primary/40 px-2 py-1 font-medium text-primary hover:bg-primary/10 focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            {t('Selecionar')}
          </button>
        </div>
      )}

      {hasKnownContext && selectedMib && !selectedMib.isOffline &&
        !mibMatchesDevice(selectedMib, manufacturer, profileLabel) && (
        <p className="text-[11px] text-amber-700 dark:text-amber-400">
          {t('A MIB selecionada não informa correspondência com este fabricante/perfil. Confirme o modelo antes de usá-la; isso afeta apenas os nomes do diagnóstico.')}
        </p>
      )}

      {importedMibs.length === 0 && (
        <p className="text-[11px] text-muted-foreground">
          {t('Não há MIB de fabricante importada. A opção padrão/offline é suficiente; a coleta continua usando os perfis configurados.')}
        </p>
      )}
    </div>
  );
}