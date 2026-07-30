'use client';

import { useEffect, useState } from 'react';
import { ArrowRight, Loader2, Mail } from 'lucide-react';
import { useAuth } from '../hooks/use-auth';
import { BrandMark } from './BrandMark';
import { InputField } from './ui/InputField';
import { PasswordField } from './ui/PasswordField';
import { useT } from '@/lib/i18n';

export function LoginForm() {
  const t = useT();
  const { login, isLoading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Usuário derrubado por inativação do cliente chega aqui via
  // /login?reason=tenant-inactive (redirect do api-client ao receber
  // 403 TENANT_INACTIVE). Mostra a mesma mensagem amigável do login bloqueado.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const reason = new URLSearchParams(window.location.search).get('reason');
    if (reason === 'tenant-inactive') {
      setError(
        'O acesso da sua empresa está temporariamente desativado. Entre em contato com o administrador do sistema.',
      );
    }
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    try {
      await login({ email, password });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao realizar login');
    }
  }

  return (
    <div className="w-full max-w-sm">
      {/* Cabeçalho */}
      <div className="mb-8">
        <p className="text-sm font-medium text-cyan-700">{t('Bem-vindo de volta!')}</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-900">
          {t('Acesse sua conta')}
        </h1>
        <div className="mt-3">
          <BrandMark size="sm" />
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <InputField
          id="email"
          label={t('E-mail')}
          type="email"
          icon={Mail}
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="voce@empresa.com.br"
        />

        <PasswordField
          id="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
        />

        {/* Lembrar-me + esqueci a senha */}
        <div className="flex items-center justify-between">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-cyan-700 focus:ring-cyan-600/30"
            />
            {t('Lembrar-me')}
          </label>
          <a href="/forgot-password" className="text-sm font-medium text-cyan-700 hover:text-cyan-800">
            {t('Esqueci minha senha')}
          </a>
        </div>

        {/* Erro */}
        {error && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700"
          >
            {t(error)}
          </div>
        )}

        {/* Botão */}
        <button
          type="submit"
          disabled={isLoading}
          className="group flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-cyan-700 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-cyan-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('Entrando...')}
            </>
          ) : (
            <>
              {t('Entrar')}
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </>
          )}
        </button>
      </form>

      {/* Suporte */}
      <p className="mt-6 text-center text-sm text-slate-500">
        {t('Ainda não tem uma conta?')}{' '}
        <a href="mailto:suporte@autobras.com.br" className="font-medium text-cyan-700 hover:text-cyan-800">
          {t('Fale com o suporte')}
        </a>
      </p>

    </div>
  );
}
