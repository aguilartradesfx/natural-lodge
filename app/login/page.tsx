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
          <div className="glass-pill inline-flex items-center gap-2.5 mb-5 px-3.5 py-1.5 rounded-full">
            <span
              className="w-2 h-2 rounded-full animate-pulse-dot"
              style={{
                background: 'var(--color-green-glow)',
                boxShadow: '0 0 14px var(--color-green-ring)',
              }}
            />
            <span className="text-[10.5px] font-medium uppercase tracking-[0.18em] text-[--color-cream-mute]">
              Natural Lodge · Admin
            </span>
          </div>
          <h1 className="text-[34px] font-light leading-tight tracking-[-0.025em] text-[--color-cream]">
            Panel del{' '}
            <em
              className="italic font-medium"
              style={{
                background:
                  'linear-gradient(135deg, var(--color-green-glow), var(--color-green))',
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                color: 'transparent',
              }}
            >
              chatbot
            </em>
          </h1>
        </div>

        <div className="glass-lifted relative p-8 overflow-hidden">
          {/* Línea verde superior */}
          <div className="absolute top-0 left-[30%] right-[30%] h-px green-line opacity-60" />
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
              <p className="text-[13px] font-medium text-red-300 leading-relaxed">{error}</p>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-[14px] text-[13.5px] font-semibold cursor-pointer transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed"
              style={
                loading
                  ? {
                      background:
                        'linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0.03))',
                      color: 'var(--color-cream-mute)',
                      boxShadow:
                        '0 1px 0 rgba(255,255,255,0.06) inset, 0 0 0 1px rgba(255,255,255,0.04)',
                    }
                  : {
                      background:
                        'linear-gradient(180deg, var(--color-green-glow), var(--color-green))',
                      color: '#0a1c11',
                      letterSpacing: '-0.005em',
                      boxShadow:
                        '0 1px 0 rgba(255,255,255,0.4) inset, 0 -1px 0 rgba(0,0,0,0.18) inset, 0 8px 24px -6px var(--color-green-ring), 0 0 0 1px rgba(127,184,138,0.5)',
                    }
              }
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
      <label className="block text-[10.5px] font-semibold uppercase tracking-[0.18em] text-[--color-cream-mute] mb-2">
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
        autoComplete={autoComplete}
        className="glass-inset w-full px-4 py-3 text-[--color-cream] text-[14px] font-normal placeholder:text-[--color-cream-faint] focus:outline-none focus:[box-shadow:0_1px_0_rgba(255,255,255,0.08)_inset,_0_2px_4px_rgba(0,0,0,0.4)_inset,_0_0_0_1px_var(--color-green-ring),_0_0_0_4px_var(--color-green-soft)] transition-shadow"
      />
    </div>
  );
}
