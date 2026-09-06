import Link from 'next/link';
import { ShieldOff } from 'lucide-react';

export default function ForbiddenPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-50 mb-4">
        <ShieldOff className="h-8 w-8 text-red-400" />
      </div>
      <h1 className="text-xl font-semibold text-foreground">Acesso não autorizado</h1>
      <p className="mt-2 text-sm text-muted-foreground text-center max-w-sm">
        Você não tem permissão para acessar esta página. Entre em contato com o administrador
        caso acredite que isso seja um erro.
      </p>
      <div className="mt-6 flex items-center gap-3">
        <Link
          href="/dashboard"
          className="h-9 px-4 text-sm rounded-md font-medium bg-cyan-700 text-white hover:bg-cyan-800 transition-colors inline-flex items-center"
        >
          Voltar ao dashboard
        </Link>
      </div>
      <p className="mt-8 text-xs text-muted-foreground/60">Erro 403 — Proibido</p>
    </div>
  );
}
