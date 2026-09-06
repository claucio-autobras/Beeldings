/**
 * Concatena classes condicionais, ignorando valores falsy.
 * Versão leve, sem dependências externas (clsx/tailwind-merge).
 *
 * @example cn('px-2', isActive && 'bg-cyan-700', undefined) // "px-2 bg-cyan-700"
 */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}
