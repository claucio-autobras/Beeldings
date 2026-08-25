'use client';

import { useEffect, useState } from 'react';
import { ArrowRight, Loader2, Mail } from 'lucide-react';
import { useAuth } from '../hooks/use-auth';
import { TurnstileWidget } from './TurnstileWidget';
import { BrandMark } from './BrandMark';
import { InputField } from './ui/InputField';
import { PasswordField } from './ui/PasswordField';
import { useT } from '@/lib/i18n';
import { resendEmailTwoFactor } from '../services/auth.service';

export function LoginForm() {
  const t = useT();
  const { login, verifyTwoFactor, isLoading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Anti-robô (Cloudflare Turnstile): a site key vem do backend; null = desativado.
  const [turnstileSiteKey, setTurnstileSiteKey] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  // Tokens do Turnstile são de uso único: após login que falhou, força reset.
  const [turnstileReset, setTurnstileReset] = useState(0);
  const [twoFactor, setTwoFactor] = useState<{
    challengeId: string;
    emailMasked: string;
  } | null>(null);
  const [code, setCode] = useState('');
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [isResending, setIsResending] = useState(false);

  useEffect(() => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
    fetch(`${apiUrl}/auth/turnstile-config`)
      .then((res) => (res.ok ? res.json() : { siteKey: null }))
      .then((cfg: { siteKey: string | null }) => setTurnstileSiteKey(cfg.siteKey))
      .catch(() => setTurnstileSiteKey(null)); // sem config → login segue sem widget
  }, []);

  // Usuário derrubado por inativação do cliente chega aqui via
  // /login?reason=tenant-inactive (redirect do api-client ao receber
  // 403 TENANT_INACTIVE). Mostra a mesma mensagem amigável do login bloqueado.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const reason = new URLSearchParams(window.location.search).get('reason');
    if (reason !== 'tenant-inactive') return;
    // setState assíncrono: evita render em cascata no corpo do efeito e
    // mantém o HTML do servidor idêntico ao primeiro render do cliente.
    const id = setTimeout(() => {
      setError(
        'O acesso da sua empresa está temporariamente desativado. Entre em contato com o administrador do sistema.',
      );
    }, 0);
    return () => clearTimeout(id);
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    try {
      const outcome = await login({ email, password, turnstileToken: turnstileToken ?? undefined });
      if (outcome && 'requiresTwoFactor' in outcome && outcome.requiresTwoFactor) {
        setTwoFactor({ challengeId: outcome.challengeId, emailMasked: outcome.emailMasked });
        setCode('');
        setResendMessage(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao realizar login');
      // Token já foi consumido pelo backend — pede um novo antes da retentativa.
      if (turnstileSiteKey) {
        setTurnstileToken(null);
        setTurnstileReset((n) => n + 1);
      }
    }
  }

  async function handleVerifyTwoFactor(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    try {
      await verifyTwoFactor(twoFactor?.challengeId ?? '', code.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível confirmar o código');
    }
  }

  async function handleResendCode() {
    if (!twoFactor) return;
    setError(null);
    setResendMessage(null);
    setIsResending(true);
    try {
      const result = await resendEmailTwoFactor(twoFactor.challengeId);
      setResendMessage(
        result.resent
          ? 'Enviamos um novo código para o seu e-mail.'
          : `O código anterior ainda é válido. Aguarde ${result.retryAfterSeconds ?? 30} segundos para reenviar.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível reenviar o código');
    } finally {
      setIsResending(false);
    }
  }

  return (
    <div className="w-full max-w-sm">
      {/* Cabeçalho */}
      <div className="mb-8">
        {/* Em telas pequenas o painel de marca fica oculto — mostra a marca aqui. */}
        <div className="mb-4 lg:hidden">
          <BrandMark size="sm" />
        </div>
        <p className="text-sm font-medium text-cyan-700">{t(twoFactor ? 'Verificação de segurança' : 'Bem-vindo de volta!')}</p>
        <h1 className="mt-1.5 text-3xl font-semibold tracking-tight text-slate-900">
          {t(twoFactor ? 'Confirme seu acesso' : 'Acesse sua conta')}
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          {twoFactor
            ? `Enviamos um código de seis dígitos para ${twoFactor.emailMasked}.`
            : t('Monitore seus sites, alarmes e equipamentos em um só lugar.')}
        </p>
      </div>

      {twoFactor ? (
        <form onSubmit={handleVerifyTwoFactor} className="space-y-5">
          <InputField
            id="two-factor-code"
            label="Código de confirmação"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
          />
          {error && (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
              {t(error)}
            </div>
          )}
          {resendMessage && (
            <div role="status" className="rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2.5 text-sm text-cyan-800">
              {t(resendMessage)}
            </div>
          )}
          <button
            type="submit"
            disabled={isLoading || code.length !== 6}
            className="group flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-700 to-cyan-600 px-4 text-sm font-semibold text-white shadow-lg shadow-cyan-700/20 transition hover:from-cyan-800 hover:to-cyan-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isLoading ? <><Loader2 className="h-4 w-4 animate-spin" />{t('Confirmando...')}</> : <>{t('Confirmar e entrar')}<ArrowRight className="h-4 w-4" /></>}
          </button>
          <div className="flex items-center justify-between text-sm">
            <button type="button" onClick={() => { setTwoFactor(null); setError(null); }} className="font-medium text-slate-500 hover:text-slate-700">
              {t('Usar outra conta')}
            </button>
            <button type="button" disabled={isResending} onClick={handleResendCode} className="font-medium text-cyan-700 hover:text-cyan-800 disabled:cursor-not-allowed disabled:opacity-60">
              {isResending ? t('Reenviando…') : t('Reenviar código')}
            </button>
          </div>
        </form>
      ) : (
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

        {/* Verificação anti-robô (Cloudflare Turnstile) */}
        {turnstileSiteKey && (
          <TurnstileWidget
            siteKey={turnstileSiteKey}
            onToken={setTurnstileToken}
            resetSignal={turnstileReset}
          />
        )}

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
          disabled={isLoading || (Boolean(turnstileSiteKey) && !turnstileToken)}
          className="group flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-700 to-cyan-600 px-4 text-sm font-semibold text-white shadow-lg shadow-cyan-700/20 transition hover:from-cyan-800 hover:to-cyan-700 disabled:cursor-not-allowed disabled:opacity-60"
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
      )}

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
