'use client';

import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import Link from 'next/link';

export default function SignInPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleOAuth = async (provider: string) => {
    setLoading(true);
    setError('');
    const result = await signIn(provider, { redirect: false, callbackUrl: '/dashboard' });
    if (result?.error) { setError(result.error); setLoading(false); }
    else if (result?.ok) router.push('/dashboard');
  };

  const handleEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await signIn('credentials', {
        redirect: false,
        email,
        password,
        // BUG FIX: replaced confusing checkbox with explicit mode toggle
        isSignUp: mode === 'signup' ? 'true' : 'false',
        callbackUrl: '/dashboard',
      });
      if (result?.error) { setError(result.error); setLoading(false); }
      else if (result?.ok) router.push('/dashboard');
    } catch {
      setError('An unexpected error occurred. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-f1-black flex items-center justify-center p-4">
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-px h-1/3 bg-gradient-to-b from-f1-red/40 to-transparent" />
        <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-f1-red/5 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        {/* Back link */}
        <Link href="/" className="flex items-center gap-2 text-white/40 hover:text-white text-sm mb-8 transition w-fit">
          ← Back to home
        </Link>

        <div className="bg-f1-dark border border-f1-grid rounded-2xl p-8">
          {/* Logo */}
          <div className="flex flex-col items-center mb-8">
            <img src="/F1-Logo.png" alt="F1" style={{width:90,margin:"0 auto 16px",objectFit:"contain"}}/>
            <h1 className="text-2xl font-black text-white">F1 Analytics Hub</h1>
            <p className="text-white/40 text-sm mt-1">
              {mode === 'signin' ? 'Welcome back' : 'Create your account'}
            </p>
          </div>

          {/* Mode toggle — replaced the confusing checkbox */}
          <div className="flex bg-f1-grid rounded-xl p-1 mb-6">
            {(['signin', 'signup'] as const).map(m => (
              <button
                key={m}
                onClick={() => { setMode(m); setError(''); }}
                className={`flex-1 py-2 rounded-lg text-sm font-bold transition ${
                  mode === m ? 'bg-f1-red text-white' : 'text-white/40 hover:text-white/70'
                }`}
              >
                {m === 'signin' ? 'Sign In' : 'Create Account'}
              </button>
            ))}
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red-950/50 border border-red-800 rounded-xl p-3 mb-5 flex items-start gap-2">
              <span className="text-red-400 text-sm">⚠</span>
              <p className="text-red-300 text-sm">{error}</p>
            </div>
          )}

          {/* Email form */}
          <form onSubmit={handleEmail} className="space-y-4 mb-6">
            <div>
              <label htmlFor="signin-email" className="block text-sm font-medium text-white/60 mb-1.5">
                Email address
              </label>
              <input
                id="signin-email"
                name="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="w-full px-4 py-3 bg-f1-black border border-f1-grid rounded-xl text-white placeholder-white/20 focus:outline-none focus:border-f1-red focus:ring-1 focus:ring-f1-red transition text-sm"
              />
            </div>
            <div>
              <label htmlFor="signin-password" className="block text-sm font-medium text-white/60 mb-1.5">
                Password
              </label>
              <input
                id="signin-password"
                name="password"
                type="password"
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={6}
                className="w-full px-4 py-3 bg-f1-black border border-f1-grid rounded-xl text-white placeholder-white/20 focus:outline-none focus:border-f1-red focus:ring-1 focus:ring-f1-red transition text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-f1-red hover:bg-red-700 disabled:opacity-50 rounded-xl font-black text-white transition-all hover:scale-[1.01] text-sm mt-2"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Loading…
                </span>
              ) : mode === 'signin' ? 'Sign In →' : 'Create Account →'}
            </button>
          </form>

          {/* Divider */}
          <div className="flex items-center gap-3 mb-6">
            <div className="flex-1 h-px bg-f1-grid" />
            <span className="text-white/20 text-xs">or continue with</span>
            <div className="flex-1 h-px bg-f1-grid" />
          </div>

          {/* OAuth */}
          <div className="space-y-3">
            <button
              onClick={() => handleOAuth('github')}
              disabled={loading}
              className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-white/5 hover:bg-white/10 border border-f1-grid hover:border-white/20 rounded-xl font-semibold text-white transition disabled:opacity-50 text-sm"
            >
              <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
              GitHub
            </button>
            <button
              onClick={() => handleOAuth('google')}
              disabled={loading}
              className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-white/5 hover:bg-white/10 border border-f1-grid hover:border-white/20 rounded-xl font-semibold text-white transition disabled:opacity-50 text-sm"
            >
              <svg viewBox="0 0 24 24" className="w-5 h-5"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
              Google
            </button>
          </div>

          <p className="text-center text-white/20 text-xs mt-6">
            Passwords are securely hashed · Auth via NextAuth.js
          </p>
        </div>
      </div>
    </div>
  );
}
