import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { Providers } from './providers';
import { ServiceWorkerRegister } from '@/components/ServiceWorkerRegister';
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${inter.variable} ${firaCode.variable} h-full`} suppressHydrationWarning>
      <head>
        {/* Aplica o tema salvo antes do primeiro paint (evita flash claro/escuro). */}
        <script
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: `(function(){try{if(/^\\/(login|forgot-password|reset-password)(\\/|$)/.test(location.pathname)){document.documentElement.classList.remove('dark');document.documentElement.style.colorScheme='light';return;}var p=JSON.parse(localStorage.getItem('bluebee_prefs')||'{}');var t=p.theme;var d=t==='dark'||(t!=='light'&&t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);document.documentElement.style.colorScheme=d?'dark':'light';}catch(e){}})();`,
          }}
        />
      </head>
      <body className="h-full antialiased">
        <ServiceWorkerRegister />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
