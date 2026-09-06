'use client';

import { useState } from 'react';
import { Mail, ArrowLeft } from 'lucide-react';
import { LoginBrandPanel } from '@/modules/auth/components/LoginBrandPanel';
import { InputField } from '@/modules/auth/components/ui/InputField';
import { useT } from '@/lib/i18n';
import { apiPost } from '@/lib/api-client';

type Step = 'form' | 'sent';

export default function ForgotPasswordPage() {
  const t = useT();
  const [email, setEmail] = useState('');
  const [step, setStep] = useState<Step>('form');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await apiPost('/auth/forgot-password', { email });
      setStep('sent');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Ocorreu um erro. Tente novamente.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="grid min-h-screen bg-card lg:grid-cols-[1.05fr_1fr]">
      {/* Painel de marca — visível a partir de lg */}
      <LoginBrandPanel />

      {/* Painel do formulário */}
      <section className="flex flex-col items-center justify-center px-6 py-12 sm:px-10">
        <div className="flex w-full max-w-sm flex-1 items-center justify-center">
          <div className="w-full space-y-6">
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
                {t('Esqueci minha senha')}
              </h1>
              <p className="text-sm text-slate-500">
                {step === 'form'
                  ? t('Informe seu e-mail e enviaremos um link para redefinir sua senha.')
                  : t('Verifique sua caixa de entrada.')}
              </p>
            </div>

            {step === 'form' ? (
              <form onSubmit={handleSubmit} className="space-y-4">
                <InputField
                  id="email"
                  label={t('E-mail')}
                  icon={Mail}
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="seu@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />

                {error && (
                  <p role="alert" className="text-sm text-red-600">
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-lg bg-cyan-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-cyan-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-700 disabled:opacity-60"
                >
                  {loading ? t('Enviando…') : t('Enviar link de redefinição')}
                </button>
              </form>
            ) : (
              <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-4 text-sm text-cyan-800">
                {t('Se o e-mail informado estiver cadastrado, você receberá as instruções em breve.')}
              </div>
            )}

            <a
              href="/login"
              className="flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700"
            >
              <ArrowLeft className="h-4 w-4" />
              {t('Voltar para o login')}
            </a>
          </div>
        </div>

        <footer className="pt-8 text-center text-xs text-slate-400">
          © {new Date().getFullYear()} Beeldings · Autobras. {t('Todos os direitos reservados.')}
        </footer>
      </section>
    </main>
  );
}
