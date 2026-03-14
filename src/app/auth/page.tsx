'use client';

import { useState, useEffect, useCallback } from 'react';
import { startRegistration, startAuthentication } from '@simplewebauthn/browser';

type Mode = 'loading' | 'register' | 'login';

export default function AuthPage() {
  const [mode, setMode] = useState<Mode>('loading');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/auth/session')
      .then((res) => res.json())
      .then((data) => {
        if (data.authenticated) {
          window.location.href = '/';
        } else {
          setMode(data.hasCredentials ? 'login' : 'register');
        }
      })
      .catch(() => setMode('register'));
  }, []);

  const handleRegister = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const optionsRes = await fetch('/api/auth/register/options', { method: 'POST' });
      if (!optionsRes.ok) {
        const msg = await optionsRes.json();
        throw new Error(msg.error || 'Failed to get registration options');
      }
      const options = await optionsRes.json();

      const credential = await startRegistration({ optionsJSON: options });

      const verifyRes = await fetch('/api/auth/register/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credential),
      });

      if (!verifyRes.ok) {
        const msg = await verifyRes.json();
        throw new Error(msg.error || 'Verification failed');
      }

      window.location.href = '/';
    } catch (err: any) {
      if (err.name === 'NotAllowedError') {
        setError('Passkey creation was cancelled.');
      } else {
        setError(err.message || 'Registration failed');
      }
    } finally {
      setBusy(false);
    }
  }, []);

  const handleLogin = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const optionsRes = await fetch('/api/auth/login/options', { method: 'POST' });
      if (!optionsRes.ok) {
        const msg = await optionsRes.json();
        throw new Error(msg.error || 'Failed to get authentication options');
      }
      const options = await optionsRes.json();

      const credential = await startAuthentication({ optionsJSON: options });

      const verifyRes = await fetch('/api/auth/login/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credential),
      });

      if (!verifyRes.ok) {
        const msg = await verifyRes.json();
        throw new Error(msg.error || 'Authentication failed');
      }

      window.location.href = '/';
    } catch (err: any) {
      if (err.name === 'NotAllowedError') {
        setError('Authentication was cancelled.');
      } else {
        setError(err.message || 'Sign-in failed');
      }
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div className="flex h-full items-center justify-center bg-light-primary dark:bg-dark-primary">
      <div className="w-full max-w-sm mx-auto px-6">
        <div className="flex flex-col items-center space-y-8">
          {/* Logo */}
          <div className="flex flex-col items-center space-y-2">
            <img src="/icon-100.png" alt="Vane" className="w-16 h-16 rounded-2xl" />
            <h1 className="text-2xl font-bold text-black dark:text-white">Vane</h1>
          </div>

          {mode === 'loading' && (
            <div className="flex items-center justify-center py-8">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#24A0ED] border-t-transparent" />
            </div>
          )}

          {mode === 'register' && (
            <div className="flex flex-col items-center space-y-4 w-full">
              <p className="text-sm text-black/60 dark:text-white/60 text-center">
                Set up a passkey to secure your Vane instance.
                <br />
                You can use Face ID, Touch ID, or a security key.
              </p>
              <button
                onClick={handleRegister}
                disabled={busy}
                className="w-full rounded-xl bg-[#24A0ED] px-6 py-3 text-sm font-medium text-white transition-all hover:bg-[#1a8fd4] active:scale-[0.98] disabled:opacity-50"
              >
                {busy ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    Setting up…
                  </span>
                ) : (
                  'Create Passkey'
                )}
              </button>
            </div>
          )}

          {mode === 'login' && (
            <div className="flex flex-col items-center space-y-4 w-full">
              <p className="text-sm text-black/60 dark:text-white/60 text-center">
                Sign in with your passkey to continue.
              </p>
              <button
                onClick={handleLogin}
                disabled={busy}
                className="w-full rounded-xl bg-[#24A0ED] px-6 py-3 text-sm font-medium text-white transition-all hover:bg-[#1a8fd4] active:scale-[0.98] disabled:opacity-50"
              >
                {busy ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    Verifying…
                  </span>
                ) : (
                  'Sign in with Passkey'
                )}
              </button>
            </div>
          )}

          {error && (
            <p className="text-xs text-red-500 text-center">{error}</p>
          )}
        </div>
      </div>
    </div>
  );
}
