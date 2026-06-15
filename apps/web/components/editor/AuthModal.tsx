'use client';

import React from 'react';
import { Lock, Loader2, X } from 'lucide-react';
import { motion } from 'motion/react';
import { Button } from '@storyboard/ui';
import { cn } from '@/lib/utils';

export type AuthMode = 'login' | 'signup';

type AuthModalProps = {
  authMode: AuthMode;
  setAuthMode: (mode: AuthMode) => void;
  authUsername: string;
  setAuthUsername: (username: string) => void;
  authPassword: string;
  setAuthPassword: (password: string) => void;
  authLoading: boolean;
  authError: string;
  setAuthError: (error: string) => void;
  onClose: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
};

export function AuthModal({
  authMode,
  setAuthMode,
  authUsername,
  setAuthUsername,
  authPassword,
  setAuthPassword,
  authLoading,
  authError,
  setAuthError,
  onClose,
  onSubmit,
}: AuthModalProps) {
  return (
    <motion.div
      key="auth-modal"
      className="fixed inset-0 z-[330] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onPointerDown={onClose}
    >
      <motion.section
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-title"
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        className="flex w-full max-w-sm flex-col rounded-lg border border-zinc-800 bg-[#111114] shadow-2xl"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-zinc-800 p-4">
          <div>
            <h2 id="auth-title" className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-zinc-200">
              <Lock className="h-4 w-4 text-indigo-300" />
              {authMode === 'login' ? 'Sign In' : 'Create Account'}
            </h2>
            <p className="mt-1 text-[10px] text-zinc-500">
              {authMode === 'login' ? 'Access your saved scenes and editing permissions.' : 'Join and get default viewer permissions.'}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 text-zinc-550 hover:text-white"
            onClick={onClose}
            aria-label="Close auth dialog"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="grid grid-cols-2 border-b border-zinc-850 p-1 bg-zinc-950/40">
          <button
            type="button"
            onClick={() => {
              setAuthMode('login');
              setAuthError('');
            }}
            className={cn(
              "py-2 rounded text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer font-mono text-center",
              authMode === 'login'
                ? "bg-zinc-900 text-indigo-300 border border-zinc-850 shadow"
                : "text-zinc-500 hover:text-zinc-350"
            )}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => {
              setAuthMode('signup');
              setAuthError('');
            }}
            className={cn(
              "py-2 rounded text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer font-mono text-center",
              authMode === 'signup'
                ? "bg-zinc-900 text-indigo-300 border border-zinc-850 shadow"
                : "text-zinc-500 hover:text-zinc-350"
            )}
          >
            Create Account
          </button>
        </div>

        <form className="space-y-4 p-5" onSubmit={onSubmit}>
          {authError && (
            <div className="rounded border border-red-500/20 bg-red-500/10 p-2.5 text-xs text-red-200">
              {authError}
            </div>
          )}

          <div className="space-y-1.5">
            <label htmlFor="auth-username" className="block text-[10px] font-bold uppercase tracking-widest text-zinc-500">
              Username
            </label>
            <input
              id="auth-username"
              type="text"
              required
              value={authUsername}
              onChange={(e) => setAuthUsername(e.target.value)}
              className="h-9 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-200 outline-none transition-colors placeholder:text-zinc-700 focus:border-indigo-400"
              placeholder="e.g. editor_pro"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="auth-password" className="block text-[10px] font-bold uppercase tracking-widest text-zinc-500">
              Password
            </label>
            <input
              id="auth-password"
              type="password"
              required
              value={authPassword}
              onChange={(e) => setAuthPassword(e.target.value)}
              className="h-9 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-200 outline-none transition-colors placeholder:text-zinc-700 focus:border-indigo-400"
              placeholder="********"
            />
          </div>

          <Button
            type="submit"
            disabled={authLoading}
            className="w-full h-10 bg-indigo-650 hover:bg-indigo-500 text-xs font-black uppercase tracking-widest text-white shadow-lg shadow-indigo-900/30"
          >
            {authLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : authMode === 'login' ? 'Sign In' : 'Create Account'}
          </Button>
        </form>
      </motion.section>
    </motion.div>
  );
}
