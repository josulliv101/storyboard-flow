'use client';

import React from 'react';
import Link from 'next/link';
import { LogOut, UserCircle } from 'lucide-react';
import { Button } from '@storyboard/ui';
import ThemeToggle from '@/components/ThemeToggle';
import { cn } from '@/lib/utils';
import { SwWrenchStripLogo } from './SwWrenchStripLogo';

export type HomeTopNavUser = {
  username: string;
  role: 'admin' | 'editor' | 'viewer';
};

type HomeTopNavProps = {
  currentUser: HomeTopNavUser | null;
  onLogout: () => void;
  onSignIn: () => void;
  themeToggle?: React.ReactNode;
};

const roleBadgeClassName = {
  admin: 'bg-indigo-500/10 text-indigo-300 border-indigo-500/20 shadow-[0_0_8px_rgba(99,102,241,0.1)]',
  editor: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20 shadow-[0_0_8px_rgba(16,185,129,0.1)]',
  viewer: 'bg-zinc-100 dark:bg-zinc-800/40 text-zinc-500 dark:text-zinc-400 border-zinc-250 dark:border-zinc-800/80',
} satisfies Record<HomeTopNavUser['role'], string>;

export function HomeTopNav({
  currentUser,
  onLogout,
  onSignIn,
  themeToggle = <ThemeToggle />,
}: HomeTopNavProps) {
  return (
    <header className="h-20 border-b border-zinc-200 dark:border-zinc-900 bg-white/60 dark:bg-zinc-950/60 backdrop-blur-md flex items-center justify-center px-6 md:px-12 shrink-0 z-20 relative">
      <Link
        href="/"
        className="absolute left-6 md:left-12 max-w-[6.75rem] sm:max-w-none hover:opacity-90 transition-opacity"
      >
        <span className="block font-coiny text-sm sm:text-xl md:text-2xl text-zinc-800 dark:text-zinc-100 tracking-wide leading-tight sm:leading-none mt-0.5">
          Storyboard <span className="text-indigo-600 dark:text-indigo-400">Workbench</span>
        </span>
      </Link>

      <Link
        href="/"
        className="flex items-center justify-center hover:opacity-90 transition-opacity"
        aria-label="Storyboard Workbench home"
      >
        <SwWrenchStripLogo className="h-36 w-36 text-zinc-900 dark:text-zinc-100" />
      </Link>

      <div className="absolute right-6 md:right-12 flex items-center gap-3 md:gap-4">
        {themeToggle}
        {currentUser ? (
          <div className="flex items-center gap-3">
            <div className="flex flex-col items-end">
              <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200">
                {currentUser.username}
              </span>
              <span
                className={cn(
                  'mt-0.5 px-2 py-0.5 text-[8px] font-black uppercase tracking-widest rounded-full border leading-none',
                  roleBadgeClassName[currentUser.role]
                )}
              >
                {currentUser.role}
              </span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-zinc-500 dark:text-zinc-400 hover:text-red-650 dark:hover:text-red-400 hover:bg-red-500/10 dark:hover:bg-red-400/10 rounded-full"
              onClick={onLogout}
              title="Log Out"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={onSignIn}
            className="h-9 border-zinc-250 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-4 text-xs font-bold uppercase tracking-widest text-zinc-650 dark:text-zinc-300 hover:border-indigo-500/40 hover:bg-indigo-500/5 dark:hover:bg-indigo-500/10 hover:text-indigo-650 dark:hover:text-white rounded-md transition-all duration-300"
          >
            <UserCircle className="h-4 w-4 mr-1.5 text-indigo-500 dark:text-indigo-400" />
            Sign In
          </Button>
        )}
      </div>
    </header>
  );
}
