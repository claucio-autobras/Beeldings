import type { Metadata, Viewport } from 'next';
import { headers, cookies } from 'next/headers';
import localFont from 'next/font/local';
import { Providers } from './providers';
import { ServiceWorkerRegister } from '@/components/ServiceWorkerRegister';
import { TenantFilterProvider } from '@/components/TenantFilterProvider';
import './globals.css';

// Fontes locais (woff2 variáveis, subset latin) — o build de produção do
// deploy não tem acesso à rede do Google Fonts, então os arquivos vivem no
// repositório em ./fonts e são servidos pelo próprio Next.
const inter = localFont({
  src: './fonts/inter-latin-var.woff2',
  variable: '--font-inter',
  weight: '100 900',
  style: 'normal',
  display: 'swap',
});

const firaCode = localFont({
  src: './fonts/fira-code-latin-var.woff2',
  variable: '--font-fira-code',
  weight: '400 700',
  style: 'normal',
  display: 'swap',
});

export const metadata: Metadata = {
  applicationName: 'Beeldings',
  title: 'Beeldings - Plataforma Supervisória',
  description: 'Monitoramento remoto de sistemas BMS — Autobras Beeldings',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Beeldings',
  },
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/favicon-16x16.png', type: 'image/png', sizes: '16x16' },
      { url: '/favicon-32x32.png', type: 'image/png', sizes: '32x32' },
    ],
    shortcut: '/favicon-32x32.png',
    apple: '/apple-touch-icon.png',
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: '#0E7490',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Nonce gerado por requisição no middleware (produção). Sem ele, a CSP
  // bloquearia o script inline de tema abaixo. Em dev vem null (sem CSP).
  const [reqHeaders, cookieStore] = await Promise.all([headers(), cookies()]);
  const nonce = reqHeaders.get('x-nonce') ?? undefined;

  // Lê os cookies de tenant para passar o valor inicial ao TenantFilterProvider
  // (bridge server→client). Isso garante que o primeiro paint do servidor já
  // contenha o nome do cliente selecionado, eliminando o flash de "Todos Clientes".
  // Next.js já decodifica o valor do cookie ao lê-lo via `cookies().get()`,
  // portanto não chamamos decodeURIComponent aqui (double-decode causaria
  // URIError em nomes com "%" literal, e.g. "100%").
  const initialTenantId   = cookieStore.get('bluebee_tenant_id')?.value   ?? null;
  const initialTenantName = cookieStore.get('bluebee_tenant_name')?.value ?? null;

  // Lê o tema resolvido do cookie leve (bluebee_theme) para que o SSR já
  // inclua a classe 'dark' no <html> antes de qualquer JS — elimina o flash.
  // Em rotas públicas (login) o SSR sempre renderiza sem 'dark'.
  const themeCookie = cookieStore.get('bluebee_theme')?.value;
  // Não temos o pathname no RSC sem ler headers, mas o script inline abaixo
  // corrige se o cookie estiver desatualizado (ex: usuário vai para /login).
  // Para simplificar: se cookie === 'dark' aplicamos dark no SSR (a esmagadora
  // maioria dos acessos são rotas privadas; login em si não tem o cookie dark).
  const ssrDark = themeCookie === 'dark';

  return (
    <html lang="pt-BR" className={`${inter.variable} ${firaCode.variable} h-full${ssrDark ? ' dark' : ''}`} suppressHydrationWarning>
      <head>
        {/* Aplica/confirma o tema salvo antes do primeiro paint (evita flash claro/escuro).
            O SSR já inclui 'dark' via cookie, mas o script garante consistência quando:
            - o cookie está ausente/desatualizado (ex.: primeira visita);
            - o tema é 'system' e depende da preferência do SO;
            - o usuário está numa rota pública (sempre claro).
            Também persiste o tema resolvido no cookie para o próximo SSR. */}
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: `(function(){try{if(/^\\/(login|forgot-password|reset-password)(\\/|$)/.test(location.pathname)){document.documentElement.classList.remove('dark');document.documentElement.style.colorScheme='light';document.cookie='bluebee_theme=light; path=/; SameSite=Lax; max-age=31536000';return;}var p=JSON.parse(localStorage.getItem('bluebee_prefs')||'{}');var t=p.theme;var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(!t){var c=document.cookie.match(/(?:^|;\\s*)bluebee_theme=([^;]*)/);if(c)d=c[1]==='dark';}document.documentElement.classList.toggle('dark',d);document.documentElement.style.colorScheme=d?'dark':'light';document.cookie='bluebee_theme='+(d?'dark':'light')+'; path=/; SameSite=Lax; max-age=31536000';}catch(e){}})();`,
          }}
        />
      </head>
      <body className="h-full antialiased">
        <ServiceWorkerRegister />
        <TenantFilterProvider
          initialTenantId={initialTenantId}
          initialTenantName={initialTenantName}
        >
          <Providers>{children}</Providers>
        </TenantFilterProvider>
      </body>
    </html>
  );
}
