'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    router.push('/');
    router.refresh();
  }

  return (
    <main className="relative z-10 min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center gap-2 mb-3">
            <div className="w-1.5 h-1.5 rounded-full bg-[--color-amber] shadow-[0_0_8px_var(--color-amber-glow)]" />
            <span className="font-mono text-xs uppercase tracking-widest text-[--color-text-dim]">
              Natural Lodge / Admin
            </span>
          </div>
          <h1 className="text-3xl font-medium tracking-tight">Panel del chatbot</h1>
        </div>

        <div className="backdrop-blur-xl bg-white/[0.02] border border-white/[0.06] rounded-2xl p-8">
          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="block font-mono text-xs uppercase tracking-wider text-[--color-text-dim] mb-2">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full bg-[--color-surface] border border-[--color-border] rounded-lg px-4 py-3 text-[--color-text] placeholder:text-[--color-text-dim] focus:outline-none focus:border-[--color-cyan]/40 focus:shadow-[0_0_0_3px_rgba(6,182,212,0.08)] transition"
              />
            </div>
            <div>
              <label className="block font-mono text-xs uppercase tracking-wider text-[--color-text-dim] mb-2">
                Contraseña
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full bg-[--color-surface] border border-[--color-border] rounded-lg px-4 py-3 text-[--color-text] placeholder:text-[--color-text-dim] focus:outline-none focus:border-[--color-cyan]/40 focus:shadow-[0_0_0_3px_rgba(6,182,212,0.08)] transition"
              />
            </div>
            {error && (
              <p className="text-sm text-red-400 font-mono">{error}</p>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-[--color-surface-elevated] border border-[--color-border] hover:border-[--color-cyan]/40 hover:bg-white/[0.04] rounded-xl font-medium transition disabled:opacity-50"
            >
              {loading ? 'Entrando...' : 'Entrar'}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
