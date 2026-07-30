import type { Metadata, Viewport } from 'next';
import { Fira_Code, Inter } from 'next/font/google';
import { Providers } from './providers';
import { ServiceWorkerRegister } from '@/components/ServiceWorkerRegister';
import './globals.css';

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
  display: 'swap',
});

const firaCode = Fira_Code({
  variable: '--font-fira-code',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});

export const metadata: Metadata = {
  applicationName: 'BlueBee IoT',
  title: 'BlueBee IoT — Plataforma Supervisória',
  description: 'Monitoramento remoto de sistemas BMS — Autobras BlueBee',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'BlueBee',
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
