/**
 * Construção centralizada de rotas internas.
 *
 * Quando a aplicação é servida sob um prefixo de caminho (sub-path), como ocorre
 * no roteamento por caminho da Replit, links com caminho absoluto a partir da
 * raiz (ex.: `/alarms`) escapam do prefixo e batem na rota errada. Para evitar
 * isso, toda navegação interna deve passar por `withBasePath`, que antepõe o
 * prefixo configurado em `NEXT_PUBLIC_BASE_PATH`.
 *
 * Em desenvolvimento (sem prefixo) o comportamento é idêntico ao atual: o
 * prefixo é vazio e as rotas continuam sendo `/alarms`, `/devices`, etc.
 */

const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').replace(/\/+$/, '');

/**
 * Antepõe o prefixo de caminho configurado a uma rota interna.
 *
 * @example withBasePath('/alarms') // '/alarms' (sem prefixo) | '/app/alarms' (com prefixo)
 */
export function withBasePath(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${BASE_PATH}${normalized}`;
}

/**
 * Rotas internas conhecidas, já cientes do prefixo de caminho. Use estes
 * construtores em vez de strings absolutas para que a navegação funcione sob
 * qualquer prefixo de deploy.
 */
export const ROUTES = {
  alarms: () => withBasePath('/alarms'),
  alarmHighlight: (id: string) => withBasePath(`/alarms?highlight=${id}`),
  devices: () => withBasePath('/devices'),
  account: () => withBasePath('/account'),
} as const;
