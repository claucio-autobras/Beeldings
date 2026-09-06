'use client';

import { useState } from 'react';
import { ArrowLeft, CheckCircle2 } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { LoginBrandPanel } from '@/modules/auth/components/LoginBrandPanel';
import { PasswordField } from '@/modules/auth/components/ui/PasswordField';
import { apiPost } from '@/lib/api-client';
import { useT } from '@/lib/i18n';

export default function ResetPasswordPage() {
  const t = useT();
  const params = useSearchParams();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (password.length < 8) {
      setError('A nova senha deve ter ao menos 8 caracteres.');
      return;
    }
    if (password !== confirmation) {
      setError('As senhas não coincidem.');
      return;
    }
    const token = params.get('token') ?? '';
    if (!token) {
      setError('O link de redefinição é inválido ou expirou.');
      return;
    }
    setLoading(true);
    try {
      await apiPost('/auth/reset-password', { token, newPassword: password });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível redefinir a senha.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="grid min-h-screen bg-card lg:grid-cols-[1.05fr_1fr]">
      <LoginBrandPanel />
      <section className="flex flex-col items-center justify-center px-6 py-12 sm:px-10">
        <div className="flex w-full max-w-sm flex-1 items-center justify-center">
          <div className="w-full space-y-6">
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{t('Crie uma nova senha')}</h1>
              <p className="text-sm text-slate-500">
                {done ? t('Sua senha foi atualizada com segurança.') : t('Escolha uma senha nova com pelo menos 8 caracteres.')}
              </p>
            </div>
            {done ? (
              <div className="space-y-5">
                <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-4 text-sm text-cyan-800">
                  <CheckCircle2 className="mb-2 h-5 w-5" />
                  {t('Senha redefinida. Entre novamente para continuar.')}
                </div>
                <a href="/login" className="block w-full rounded-lg bg-cyan-700 px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-cyan-800">
                  {t('Ir para o login')}
                </a>
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-4">
                <PasswordField id="new-password" label="Nova senha" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
                <PasswordField id="confirm-password" label="Confirmar nova senha" autoComplete="new-password" required value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />
                {error && <p role="alert" className="text-sm text-red-600">{t(error)}</p>}
                <button type="submit" disabled={loading} className="w-full rounded-lg bg-cyan-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-cyan-800 disabled:opacity-60">
                  {loading ? t('Redefinindo…') : t('Salvar nova senha')}
                </button>
              </form>
            )}
            <a href="/login" className="flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700">
              <ArrowLeft className="h-4 w-4" />{t('Voltar para o login')}
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}