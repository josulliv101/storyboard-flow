'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Sparkles,
  Clapperboard,
  Layers,
  Eye,
  Lock,
  Cloud,
  Play,
  ArrowRight,
  Upload,
  Activity,
  UserCircle,
  LogOut,
  Loader2,
  X,
  FileVideo,
  ChevronRight,
  Users,
  MapPin,
  Camera
} from 'lucide-react';
import { Button } from '@storyboard/ui';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';
import { useTimeline } from '@/lib/timeline-context';
import ThemeToggle from '@/components/ThemeToggle';

export default function HomePage() {
  const router = useRouter();
  const { currentUser, setCurrentUser } = useTimeline();

  // Authentication states
  const [isAuthModalOpen, setIsAuthModalOpen] = React.useState(false);
  const [authMode, setAuthMode] = React.useState<'login' | 'signup'>('login');
  const [authUsername, setAuthUsername] = React.useState('');
  const [authPassword, setAuthPassword] = React.useState('');
  const [authLoading, setAuthLoading] = React.useState(false);
  const [authError, setAuthError] = React.useState('');

  // Scenes list state
  const [savedScenes, setSavedScenes] = React.useState<any[]>([]);
  const [isLoadingScenes, setIsLoadingScenes] = React.useState(false);
  const [scenesError, setScenesError] = React.useState<string | null>(null);

  // Fetch scenes
  const fetchScenes = React.useCallback(async () => {
    setIsLoadingScenes(true);
    setScenesError(null);
    try {
      const res = await fetch('/api/scenes', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setSavedScenes(data.scenes || []);
      } else {
        throw new Error('Failed to load scenes.');
      }
    } catch (err: any) {
      console.error('Load scenes error:', err);
      setScenesError(err.message || 'Unable to retrieve recent scenes.');
    } finally {
      setIsLoadingScenes(false);
    }
  }, []);

  React.useEffect(() => {
    void fetchScenes();
  }, [fetchScenes, currentUser]);

  const handleLogout = async () => {
    try {
      const res = await fetch('/api/auth/logout', { method: 'POST' });
      if (res.ok) {
        setCurrentUser(null);
        toast.success('Successfully logged out.');
      }
    } catch (err) {
      console.error('Logout error:', err);
      toast.error('Failed to log out.');
    }
  };

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    if (!authUsername.trim() || !authPassword) {
      setAuthError('All fields are required.');
      return;
    }
    setAuthLoading(true);
    try {
      const endpoint = authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: authUsername.trim(), password: authPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        if (authMode === 'signup') {
          toast.success('Account created successfully! You can now log in.');
          setAuthMode('login');
          setAuthPassword('');
          setAuthLoading(false);
          return;
        }

        setCurrentUser(data.user);
        setIsAuthModalOpen(false);
        setAuthUsername('');
        setAuthPassword('');
        toast.success(`Welcome back, ${data.user.username}!`);
      } else {
        setAuthError(data.error || 'Authentication failed.');
      }
    } catch (err) {
      console.error('Auth error:', err);
      setAuthError('An error occurred. Please try again.');
    } finally {
      setAuthLoading(false);
    }
  };

  const verifyAuthAndNavigate = (targetPath: string) => {
    if (!currentUser) {
      toast.error('You must be logged in to access the workspace.', { id: 'auth-required' });
      setAuthMode('login');
      setIsAuthModalOpen(true);
      return;
    }
    router.push(targetPath);
  };

  const handleOpenScene = (sceneId: string, targetPath: string, isPublished?: boolean) => {
    if (!currentUser && !(targetPath === '/analysis' && isPublished)) {
      toast.error('You must be logged in to access the workspace.', { id: 'auth-required' });
      setAuthMode('login');
      setIsAuthModalOpen(true);
      return;
    }
    router.push(`${targetPath}?sceneId=${sceneId}`);
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-[#0a0a0b] text-zinc-850 dark:text-zinc-100 flex flex-col font-sans selection:bg-indigo-500/30 relative overflow-hidden">
      {/* Background Decorative Glow */}
      <div className="absolute top-[-10%] left-[-20%] w-[60vw] h-[60vw] rounded-full bg-gradient-to-br from-indigo-600/5 dark:from-indigo-600/10 via-transparent to-transparent blur-3xl pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-20%] w-[60vw] h-[60vw] rounded-full bg-gradient-to-tl from-violet-600/5 dark:from-violet-600/10 via-transparent to-transparent blur-3xl pointer-events-none" />

      {/* Header */}
      <header className="h-16 border-b border-zinc-200 dark:border-zinc-900 bg-white/60 dark:bg-zinc-950/60 backdrop-blur-md flex items-center justify-between px-6 md:px-12 shrink-0 z-20">
        <Link href="/" className="flex items-center gap-2.5 hover:opacity-90 transition-opacity">
          <div className="w-9.5 h-9.5 rounded-xl bg-[#f2f2ef] border border-zinc-200 flex items-center justify-center font-sans font-bold text-base text-[#242c31] select-none shadow-sm">
            S/<span className="text-indigo-600 dark:text-indigo-400">W</span>
          </div>
          <span className="font-bold text-base text-zinc-800 dark:text-zinc-100 tracking-tight">Storyboard <span className="text-indigo-600 dark:text-indigo-400">Workbench</span></span>
        </Link>

        <div className="flex items-center gap-3 md:gap-4">
          <ThemeToggle />
          {currentUser ? (
            <div className="flex items-center gap-3">
              <div className="flex flex-col items-end">
                <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200">{currentUser.username}</span>
                <span className={cn(
                  "mt-0.5 px-2 py-0.5 text-[8px] font-black uppercase tracking-widest rounded-full border leading-none",
                  currentUser.role === 'admin' && "bg-indigo-500/10 text-indigo-300 border-indigo-500/20 shadow-[0_0_8px_rgba(99,102,241,0.1)]",
                  currentUser.role === 'editor' && "bg-emerald-500/10 text-emerald-300 border-emerald-500/20 shadow-[0_0_8px_rgba(16,185,129,0.1)]",
                  currentUser.role === 'viewer' && "bg-zinc-100 dark:bg-zinc-800/40 text-zinc-500 dark:text-zinc-400 border-zinc-250 dark:border-zinc-800/80"
                )}>
                  {currentUser.role}
                </span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-zinc-500 dark:text-zinc-400 hover:text-red-650 dark:hover:text-red-400 hover:bg-red-500/10 dark:hover:bg-red-400/10 rounded-full"
                onClick={handleLogout}
                title="Log Out"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setAuthMode('login');
                setAuthError('');
                setIsAuthModalOpen(true);
              }}
              className="h-9 border-zinc-250 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-4 text-xs font-bold uppercase tracking-widest text-zinc-650 dark:text-zinc-300 hover:border-indigo-500/40 hover:bg-indigo-500/5 dark:hover:bg-indigo-500/10 hover:text-indigo-650 dark:hover:text-white rounded-md transition-all duration-300"
            >
              <UserCircle className="h-4 w-4 mr-1.5 text-indigo-500 dark:text-indigo-400" />
              Sign In
            </Button>
          )}
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 flex flex-col z-10">
        {/* Hero Section */}
        <section className="relative py-16 md:py-24 px-6 md:px-12 flex flex-col items-center text-center max-w-4xl mx-auto">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-indigo-500/20 bg-indigo-500/5 px-3.5 py-1 text-[10px] font-black uppercase tracking-widest text-indigo-600 dark:text-indigo-300 mb-6 shadow-inner animate-pulse">
            <Sparkles className="h-3.5 w-3.5" />
            Multimodal AI Timeline Assessor
          </div>
          <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight leading-tight text-zinc-900 dark:text-white max-w-3xl">
            AI-Powered Narrative <br className="hidden md:inline" />
            <span className="bg-gradient-to-r from-indigo-600 via-violet-500 to-indigo-500 dark:from-indigo-400 dark:via-violet-400 dark:to-indigo-300 bg-clip-text text-transparent">
              Timeline Orchestration
            </span>
          </h1>
          <p className="mt-6 text-sm md:text-base text-zinc-600 dark:text-zinc-400 max-w-2xl leading-relaxed">
            Deconstruct emotional curves, monitor anticipatory suspense peaks, and synchronize dialogue loops with Google Gemini. An agentic workspace engineered for screenwriters and film editors.
          </p>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <Button
              onClick={() => verifyAuthAndNavigate('/editor')}
              className="h-11 bg-indigo-600 hover:bg-indigo-500 text-xs font-black uppercase tracking-widest text-white px-6 rounded-lg shadow-lg shadow-indigo-500/20 dark:shadow-indigo-900/30 flex items-center gap-2 group transition-all"
            >
              Open Editor Canvas
              <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
            </Button>
            <Button
              variant="outline"
              onClick={() => verifyAuthAndNavigate('/analysis/new')}
              className="h-11 border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950/40 hover:border-zinc-300 dark:hover:border-zinc-750 text-xs font-black uppercase tracking-widest text-zinc-650 dark:text-zinc-300 px-6 rounded-lg hover:text-zinc-900 dark:hover:text-white transition-all"
            >
              Run AI Analysis
            </Button>
          </div>
        </section>

        {/* Cloud Scenes Section */}
        <section className="border-t border-zinc-200 dark:border-zinc-900 bg-zinc-50 dark:bg-zinc-950/20 py-16 px-6 md:px-12 flex-1">
          <div className="max-w-6xl mx-auto">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
              <div>
                <h3 className="text-xs font-black uppercase tracking-widest text-indigo-650 dark:text-indigo-400 font-mono flex items-center gap-1.5">
                  <Cloud className="h-4 w-4" />
                  Narrative Library
                </h3>
                <h2 className="text-xl md:text-2xl font-bold text-zinc-850 dark:text-zinc-100 mt-1">Your Saved Scene Snapshots</h2>
              </div>
              
              <div className="text-[10px] font-mono text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                {savedScenes.length} {savedScenes.length === 1 ? 'Scene' : 'Scenes'} Available
              </div>
            </div>

            {isLoadingScenes ? (
              <div className="flex flex-col py-16 items-center justify-center gap-3">
                <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
                <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 dark:text-zinc-400">Syncing Cloud Database</span>
              </div>
            ) : scenesError ? (
              <div className="rounded-md border border-red-500/20 bg-red-500/5 py-8 text-center text-xs text-red-300">
                {scenesError}
              </div>
            ) : savedScenes.length === 0 ? (
              <div className="rounded-lg border border-dashed border-zinc-250 dark:border-zinc-800 py-16 text-center max-w-lg mx-auto flex flex-col items-center justify-center gap-4 bg-zinc-100/30 dark:bg-zinc-900/10">
                <Clapperboard className="h-8 w-8 text-zinc-400 dark:text-zinc-600" />
                <div>
                  <div className="text-xs font-bold text-zinc-650 dark:text-zinc-400 uppercase tracking-widest">No Cloud Scenes Yet</div>
                  <p className="text-[10px] text-zinc-500 dark:text-zinc-500 mt-1 max-w-[280px] leading-relaxed">
                    Open the editor canvas, connect a scene, and click "Save Scene" in the File menu to compile to the cloud.
                  </p>
                </div>
                <Button
                  onClick={() => router.push('/editor')}
                  variant="outline"
                  size="sm"
                  className="border-zinc-250 dark:border-zinc-800 hover:border-indigo-500/50 hover:bg-indigo-500/5 dark:hover:bg-indigo-500/10 text-[10px] font-bold uppercase tracking-widest text-zinc-650 dark:text-zinc-300 hover:text-indigo-600 dark:hover:text-white"
                >
                  Create New Scene
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {savedScenes.map((scene) => (
                  <article
                    key={scene.id}
                    className="group overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-900 bg-white dark:bg-zinc-950/60 shadow-sm dark:shadow-xl hover:border-indigo-500/30 transition-all hover:bg-zinc-50/50 dark:hover:bg-zinc-950/90 flex flex-col justify-between"
                  >
                    <div>
                      {/* Image Preview Block */}
                      <div className="relative aspect-video overflow-hidden bg-black border-b border-zinc-200 dark:border-zinc-900 flex items-center justify-center select-none">
                        {scene.thumbnailUrl ? (
                          <img src={scene.thumbnailUrl} alt="" className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-500" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_center,rgba(99,102,241,0.1),transparent_70%)]">
                            <Clapperboard className="h-8 w-8 text-zinc-800" />
                          </div>
                        )}
                        <div className="absolute top-2 left-2 rounded bg-black/60 border border-zinc-200/20 dark:border-zinc-800/80 px-2 py-0.5 text-[8.5px] font-mono uppercase text-zinc-200 dark:text-zinc-400 tracking-wider">
                          Scene Link
                        </div>
                      </div>

                      {/* Content block */}
                      <div className="p-4 space-y-2">
                        <h4 className="text-sm font-bold text-zinc-800 dark:text-zinc-200 truncate group-hover:text-indigo-650 dark:group-hover:text-indigo-300 transition-colors">{scene.name}</h4>
                        <p className="text-[10px] text-zinc-500 dark:text-zinc-400 leading-relaxed font-mono uppercase">
                          Last Updated: {new Date(scene.updatedAt).toLocaleString()}
                        </p>
                      </div>
                    </div>

                    {/* Actions bar */}
                    <div className="p-4 pt-0 flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="flex-1 border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 hover:bg-indigo-500/5 dark:hover:bg-indigo-500/10 hover:border-indigo-500/30 text-[10px] font-black uppercase tracking-widest text-zinc-650 dark:text-zinc-300 hover:text-indigo-600 dark:hover:text-indigo-200"
                        onClick={() => void handleOpenScene(scene.id, '/editor', scene.isPublished)}
                      >
                        <Layers className="h-3.5 w-3.5 mr-1" />
                        Edit Timeline
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="flex-1 border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 hover:bg-violet-500/5 dark:hover:bg-violet-500/10 hover:border-violet-500/30 text-[10px] font-black uppercase tracking-widest text-zinc-650 dark:text-zinc-300 hover:text-violet-600 dark:hover:text-violet-200"
                        onClick={() => void handleOpenScene(scene.id, '/analysis', scene.isPublished)}
                      >
                        <Activity className="h-3.5 w-3.5 mr-1" />
                        AI Analysis
                      </Button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Feature Highlights Grid */}
        <section className="py-20 px-6 md:px-12 border-t border-zinc-200 dark:border-zinc-900 bg-zinc-100/30 dark:bg-black/30">
          <div className="max-w-5xl mx-auto space-y-12">
            <div className="text-center space-y-2">
              <h3 className="text-xs font-black uppercase tracking-widest text-indigo-650 dark:text-indigo-400 font-mono">Platform Capabilities</h3>
              <h2 className="text-2xl md:text-3xl font-extrabold text-zinc-900 dark:text-white">Two Workspaces. One Unified Model.</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl mx-auto">
              {/* Feature 1 */}
              <div 
                onClick={() => verifyAuthAndNavigate('/analysis/new')}
                className="group border border-zinc-200 dark:border-zinc-900 bg-white dark:bg-zinc-950/40 rounded-xl p-6 hover:border-indigo-500/30 transition-all hover:bg-zinc-50/50 dark:hover:bg-zinc-950/70 hover:translate-y-[-2px] cursor-pointer flex flex-col justify-between"
              >
                <div className="space-y-4">
                  <div className="w-10 h-10 rounded-lg bg-indigo-500/5 dark:bg-indigo-500/10 border border-indigo-500/10 dark:border-indigo-500/20 flex items-center justify-center text-indigo-650 dark:text-indigo-400 shadow-[0_0_15px_rgba(99,102,241,0.15)] group-hover:scale-110 transition-transform">
                    <Activity className="h-5 w-5" />
                  </div>
                  <h4 className="text-base font-bold text-zinc-800 dark:text-zinc-200 group-hover:text-indigo-650 dark:group-hover:text-indigo-300 transition-colors">AI Analysis Dashboard</h4>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                    Automated structural mapping utilizing Gemini multimodal analysis. Plot dynamic dramatic tension lines, track stakes, and evaluate anticipation curves over script logs.
                  </p>
                </div>
                <div className="mt-6 text-[10px] font-black uppercase tracking-widest text-indigo-650 dark:text-indigo-400 group-hover:translate-x-1.5 transition-transform flex items-center gap-1">
                  Launch Analyzer <ChevronRight className="h-3.5 w-3.5" />
                </div>
              </div>

              {/* Feature 2 */}
              <div 
                onClick={() => verifyAuthAndNavigate('/editor')}
                className="group border border-zinc-200 dark:border-zinc-900 bg-white dark:bg-zinc-950/40 rounded-xl p-6 hover:border-indigo-500/30 transition-all hover:bg-zinc-50/50 dark:hover:bg-zinc-950/70 hover:translate-y-[-2px] cursor-pointer flex flex-col justify-between"
              >
                <div className="space-y-4">
                  <div className="w-10 h-10 rounded-lg bg-indigo-500/5 dark:bg-indigo-500/10 border border-indigo-500/10 dark:border-indigo-500/20 flex items-center justify-center text-indigo-650 dark:text-indigo-400 shadow-[0_0_15px_rgba(99,102,241,0.15)] group-hover:scale-110 transition-transform">
                    <Layers className="h-5 w-5" />
                  </div>
                  <h4 className="text-base font-bold text-zinc-800 dark:text-zinc-200 group-hover:text-indigo-650 dark:group-hover:text-indigo-300 transition-colors">Timeline Editor Canvas</h4>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                    Cut tracks, append video blobs, overlay dialogue scripts, and map character headshots over a frame-accurate video editor timeline rendering.
                  </p>
                </div>
                <div className="mt-6 text-[10px] font-black uppercase tracking-widest text-indigo-650 dark:text-indigo-400 group-hover:translate-x-1.5 transition-transform flex items-center gap-1">
                  Launch Editor <ChevronRight className="h-3.5 w-3.5" />
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="h-12 border-t border-zinc-200 dark:border-zinc-900 bg-white/60 dark:bg-zinc-950/60 backdrop-blur-md flex items-center justify-between px-6 md:px-12 text-[10px] font-mono text-zinc-550 dark:text-zinc-400 uppercase tracking-widest shrink-0 z-20">
        <span>© {new Date().getFullYear()} Storyboard Workbench</span>
        <span>Engine Nominal</span>
      </footer>

      {/* Auth Modal Dialog */}
      <AnimatePresence>
        {isAuthModalOpen && (
          <motion.div
            key="auth-modal-overlay"
            className="fixed inset-0 z-[300] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onPointerDown={() => setIsAuthModalOpen(false)}
          >
            <motion.section
              role="dialog"
              aria-modal="true"
              aria-labelledby="auth-title"
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 12 }}
              className="flex w-full max-w-sm flex-col rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111114] shadow-2xl"
              onPointerDown={(event) => event.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4 border-b border-zinc-200 dark:border-zinc-800 p-4">
                <div>
                  <h2 id="auth-title" className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-zinc-800 dark:text-zinc-200">
                    <Lock className="h-4 w-4 text-indigo-650 dark:text-indigo-300" />
                    {authMode === 'login' ? 'Sign In' : 'Create Account'}
                  </h2>
                  <p className="mt-1 text-[10px] text-zinc-500 dark:text-zinc-550">
                    {authMode === 'login' ? 'Access your saved scenes and editing permissions.' : 'Join and get default viewer permissions.'}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 text-zinc-450 hover:text-zinc-850 dark:text-zinc-550 dark:hover:text-white"
                  onClick={() => setIsAuthModalOpen(false)}
                  aria-label="Close auth dialog"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              {/* Tabs */}
              <div className="grid grid-cols-2 border-b border-zinc-200 dark:border-zinc-850 p-1 bg-zinc-50 dark:bg-zinc-950/40">
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode('login');
                    setAuthError('');
                  }}
                  className={cn(
                    "py-2 rounded text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer font-mono text-center",
                    authMode === 'login'
                      ? "bg-white dark:bg-zinc-900 text-indigo-650 dark:text-indigo-300 border border-zinc-200 dark:border-zinc-850 shadow-sm"
                      : "text-zinc-450 dark:text-zinc-500 hover:text-zinc-750 dark:hover:text-zinc-350"
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
                      ? "bg-white dark:bg-zinc-900 text-indigo-650 dark:text-indigo-300 border border-zinc-200 dark:border-zinc-850 shadow-sm"
                      : "text-zinc-450 dark:text-zinc-500 hover:text-zinc-750 dark:hover:text-zinc-350"
                  )}
                >
                  Create Account
                </button>
              </div>

              <form className="space-y-4 p-5" onSubmit={handleAuthSubmit}>
                {authError && (
                  <div className="rounded border border-red-500/20 bg-red-500/10 p-2.5 text-xs text-red-200">
                    {authError}
                  </div>
                )}

                <div className="space-y-1.5">
                  <label htmlFor="auth-username" className="block text-[10px] font-bold uppercase tracking-widest text-zinc-500 dark:text-zinc-550">
                    Username
                  </label>
                  <input
                    id="auth-username"
                    type="text"
                    required
                    value={authUsername}
                    onChange={(e) => setAuthUsername(e.target.value)}
                    className="h-9 w-full rounded-md border border-zinc-250 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 text-sm text-zinc-800 dark:text-zinc-200 outline-none transition-colors placeholder:text-zinc-400 dark:placeholder:text-zinc-700 focus:border-indigo-500 dark:focus:border-indigo-400"
                    placeholder="e.g. editor_pro"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="auth-password" className="block text-[10px] font-bold uppercase tracking-widest text-zinc-500 dark:text-zinc-550">
                    Password
                  </label>
                  <input
                    id="auth-password"
                    type="password"
                    required
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                    className="h-9 w-full rounded-md border border-zinc-250 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 text-sm text-zinc-800 dark:text-zinc-200 outline-none transition-colors placeholder:text-zinc-400 dark:placeholder:text-zinc-700 focus:border-indigo-500 dark:focus:border-indigo-400"
                    placeholder="••••••••"
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
        )}
      </AnimatePresence>
    </div>
  );
}
