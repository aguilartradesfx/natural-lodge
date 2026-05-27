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
    <main className="relative z-[2] min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-md fade-up fade-up-1">
        <div className="mb-8 text-center">
          <div
            className="inline-flex items-center gap-2.5 mb-4 px-3.5 py-1.5 rounded-full border border-[--color-glass-border]"
            style={{ background: 'var(--color-glass-2)', backdropFilter: 'blur(20px)' }}
          >
            <span
              className="w-2 h-2 rounded-full animate-pulse-dot"
              style={{
                background: 'var(--color-accent)',
                boxShadow: '0 0 12px var(--color-accent-glow)',
              }}
            />
            <span className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-[--color-cream-mute]">
              Natural Lodge · Admin
            </span>
          </div>
          <h1 className="font-serif font-light text-[34px] leading-tight tracking-tight text-[--color-cream]">
            Panel del{' '}
            <em
              className="not-italic font-normal italic"
              style={{
                background: 'linear-gradient(135deg, var(--color-light-glow), var(--color-mid))',
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                color: 'transparent',
              }}
            >
              chatbot
            </em>
          </h1>
        </div>

        <div
          className="rounded-[22px] border border-[--color-glass-border] p-8"
          style={{
            background: 'var(--color-glass-1)',
            backdropFilter: 'blur(40px) saturate(180%)',
            WebkitBackdropFilter: 'blur(40px) saturate(180%)',
            boxShadow:
              '0 1px 0 var(--color-glass-highlight) inset, 0 30px 60px -30px rgba(0,0,0,0.6)',
          }}
        >
          <form onSubmit={handleLogin} className="space-y-5">
            <Field
              label="Email"
              type="email"
              value={email}
              onChange={setEmail}
              autoComplete="email"
            />
            <Field
              label="Contraseña"
              type="password"
              value={password}
              onChange={setPassword}
              autoComplete="current-password"
            />
            {error && (
              <p className="text-[13px] text-red-300 font-mono leading-relaxed">{error}</p>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-[12px] text-[13.5px] font-semibold cursor-pointer transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed"
              style={{
                background: loading
                  ? 'rgba(255,255,255,0.10)'
                  : 'linear-gradient(180deg, #f5f5f5, #cfcfcf)',
                color: loading ? 'var(--color-cream-mute)' : '#101012',
                border: 'none',
                letterSpacing: '-0.005em',
                boxShadow: loading
                  ? 'none'
                  : '0 1px 0 rgba(255,255,255,0.4) inset, 0 -1px 0 rgba(0,0,0,0.15) inset, 0 8px 24px -6px var(--color-accent-glow), 0 0 0 1px rgba(255,255,255,0.35)',
              }}
            >
              {loading ? 'Entrando...' : 'Entrar'}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}

function Field({
  label,
  type,
  value,
  onChange,
  autoComplete,
}: {
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
}) {
  return (
    <div>
      <label className="block font-mono text-[10.5px] uppercase tracking-[0.18em] text-[--color-cream-mute] mb-2">
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
        autoComplete={autoComplete}
        className="w-full rounded-[12px] border border-[--color-glass-border] px-4 py-3 text-[--color-cream] placeholder:text-[--color-cream-faint] focus:outline-none focus:border-[rgba(255,255,255,0.30)] transition"
        style={{
          background: 'rgba(0,0,0,0.35)',
          boxShadow:
            '0 1px 0 var(--color-glass-highlight) inset, 0 2px 0 rgba(0,0,0,0.3) inset',
        }}
      />
    </div>
  );
}
