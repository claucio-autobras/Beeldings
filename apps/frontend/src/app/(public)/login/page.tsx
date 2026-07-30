'use client';

import { LoginBrandPanel } from '@/modules/auth/components/LoginBrandPanel';
import { LoginForm } from '@/modules/auth/components/LoginForm';
import { useT } from '@/lib/i18n';

export default function LoginPage() {
  const t = useT();
  return (
    <main className="grid min-h-screen bg-card lg:grid-cols-2">
      {/* Painel de marca — visível a partir de lg */}
      <LoginBrandPanel />

      {/* Painel do formulário */}
      <section className="flex flex-col items-center justify-center px-6 py-12 sm:px-10">
        <div className="flex w-full max-w-sm flex-1 items-center justify-center">
          <LoginForm />
        </div>
        <footer className="pt-8 text-center text-xs text-slate-400">
          © {new Date().getFullYear()} BlueBee · Autobras. {t('Todos os direitos reservados.')}
        </footer>
      </section>
    </main>
  );
}
