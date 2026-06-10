'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import {
  Activity,
  Clapperboard,
  Cloud,
  Download,
  Info,
  Layers,
  Loader2,
  Lock,
  LogOut,
  MapPin,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  RefreshCw,
  Settings,
  Sparkles,
  Trash2,
  Upload,
  UserCircle,
  Users,
  X,
} from 'lucide-react';
import { Button } from '@storyboard/ui';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';
import { useTimeline } from '@/lib/timeline-context';
import ThemeToggle from '@/components/ThemeToggle';
import LogoMark from '@/components/LogoMark';

const roleBadgeClassName = {
  admin: 'bg-indigo-500/10 text-indigo-300 border-indigo-500/20 shadow-[0_0_8px_rgba(99,102,241,0.1)]',
  editor: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20 shadow-[0_0_8px_rgba(16,185,129,0.1)]',
  viewer: 'bg-zinc-800/40 text-zinc-400 border-zinc-800/80',
} as const;

type HomeSidebarTab = 'scenes' | 'characters' | 'locations' | 'settings' | 'analyze' | null;

export default function HomePage() {
  const router = useRouter();
  const { currentUser, setCurrentUser } = useTimeline();

  const [isAuthModalOpen, setIsAuthModalOpen] = React.useState(false);
  const [authMode, setAuthMode] = React.useState<'login' | 'signup'>('login');
  const [authUsername, setAuthUsername] = React.useState('');
  const [authPassword, setAuthPassword] = React.useState('');
  const [authLoading, setAuthLoading] = React.useState(false);
  const [authError, setAuthError] = React.useState('');

  const [savedScenes, setSavedScenes] = React.useState<any[]>([]);
  const [isLoadingScenes, setIsLoadingScenes] = React.useState(false);
  const [scenesError, setScenesError] = React.useState<string | null>(null);
  const [isFileMenuOpen, setIsFileMenuOpen] = React.useState(false);
  const [isProjectMenuOpen, setIsProjectMenuOpen] = React.useState(false);
  const [isAboutMenuOpen, setIsAboutMenuOpen] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState<HomeSidebarTab>(null);
  const [isIconSidebarExpanded, setIsIconSidebarExpanded] = React.useState(false);
  const [activeHeroIndex, setActiveHeroIndex] = React.useState(0);
  const fileMenuRef = React.useRef<HTMLDivElement>(null);
  const projectMenuRef = React.useRef<HTMLDivElement>(null);
  const aboutMenuRef = React.useRef<HTMLDivElement>(null);
  const sidePanelRef = React.useRef<HTMLElement>(null);

  const fetchScenes = React.useCallback(async () => {
    setIsLoadingScenes(true);
    setScenesError(null);
    try {
      const res = await fetch('/api/scenes', { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load scenes.');
      const data = await res.json();
      setSavedScenes(data.scenes || []);
    } catch (err: any) {
      console.error('Load scenes error:', err);
      setScenesError(err.message || 'Unable to retrieve recent scenes.');
    } finally {
      setIsLoadingScenes(false);
    }
  }, []);

  React.useEffect(() => {
    const sceneLoadTimer = window.setTimeout(() => {
      void fetchScenes();
    }, 0);

    return () => window.clearTimeout(sceneLoadTimer);
  }, [fetchScenes, currentUser]);

  React.useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        fileMenuRef.current?.contains(target) ||
        projectMenuRef.current?.contains(target) ||
        aboutMenuRef.current?.contains(target)
      ) {
        return;
      }

      setIsFileMenuOpen(false);
      setIsProjectMenuOpen(false);
      setIsAboutMenuOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, []);

  React.useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target || !activeTab) return;
      if (sidePanelRef.current?.contains(target)) return;
      setActiveTab(null);
    };

    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [activeTab]);

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

  const openAuth = () => {
    setAuthMode('login');
    setAuthError('');
    setIsAuthModalOpen(true);
  };

  const verifyAuthAndNavigate = (targetPath: string) => {
    if (!currentUser) {
      toast.error('You must be logged in to access the workspace.', { id: 'auth-required' });
      openAuth();
      return;
    }
    router.push(targetPath);
  };

  const closeMenus = () => {
    setIsFileMenuOpen(false);
    setIsProjectMenuOpen(false);
    setIsAboutMenuOpen(false);
  };

  const scrollToLibrary = () => {
    closeMenus();
    document.getElementById('narrative-library')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  const handleOpenScene = (sceneId: string, targetPath: string, isPublished?: boolean) => {
    if (!currentUser && !(targetPath === '/analysis' && isPublished)) {
      toast.error('You must be logged in to access the workspace.', { id: 'auth-required' });
      openAuth();
      return;
    }
    router.push(`${targetPath}?sceneId=${sceneId}`);
  };

  const handleDeleteScene = async (scene: any) => {
    if (scene.isFallback) return;
    if (!currentUser) {
      toast.error('You must be logged in to delete projects.', { id: 'auth-required' });
      openAuth();
      return;
    }
    if (currentUser.role === 'viewer') {
      toast.error('Viewers cannot delete saved projects.');
      return;
    }
    if (!window.confirm(`Delete "${scene.name}"? This cannot be undone.`)) return;

    try {
      const response = await fetch(`/api/scenes/${scene.id}`, { method: 'DELETE' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.error || 'Unable to delete the saved project.');
      }
      setSavedScenes((scenes) => scenes.filter((savedScene) => savedScene.id !== scene.id));
      toast.success('Project deleted.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to delete the saved project.';
      toast.error(message);
    }
  };

  const communityPublishedScenes = React.useMemo(
    () => savedScenes.filter((scene) => scene.isPublished),
    [savedScenes]
  );

  const originalScenes = React.useMemo(
    () => savedScenes.filter((scene) => !scene.isPublished),
    [savedScenes]
  );

  const latestScene = savedScenes[0];
  const sceneCountLabel = `${savedScenes.length} ${savedScenes.length === 1 ? 'scene' : 'scenes'}`;
  const fallbackShowcaseItems = [
    {
      id: 'fallback-goodfellas',
      name: 'Cinematic lounge study',
      thumbnailUrl: '/timeline-thumbnails/good-fellas-v3-thumbnail-1780955080705.jpg',
      isPublished: true,
      isFallback: true,
    },
    {
      id: 'fallback-town',
      name: 'Aerial suburb sequence',
      thumbnailUrl: '/timeline-thumbnails/the-town.mp4--Imported----gemini-3-thumbnail-1780670758020.jpg',
      isPublished: false,
      isFallback: true,
    },
    {
      id: 'fallback-pulp',
      name: 'Character portrait pass',
      thumbnailUrl: '/timeline-thumbnails/pulp-fiction-8min-thumbnail-1780604496969.jpg',
      isPublished: true,
      isFallback: true,
    },
    {
      id: 'fallback-goodfellas-original',
      name: 'Dinner table coverage',
      thumbnailUrl: '/timeline-thumbnails/good-fellas-thumbnail-1780604147352.jpg',
      isPublished: false,
      isFallback: true,
    },
    {
      id: 'fallback-town-2',
      name: 'The Town',
      thumbnailUrl: '/timeline-thumbnails/town-2--thumbnail-1780604649344.jpg',
      isPublished: false,
      isFallback: true,
    },
    {
      id: 'fallback-beat',
      name: 'Scene study',
      thumbnailUrl: '/timeline-thumbnails/beat-thumb-clip-analysis-0-1780666693863.jpg',
      isPublished: false,
      isFallback: true,
    },
  ];
  const flowShowcaseItems = [
    ...savedScenes.filter((scene) => scene.thumbnailUrl).slice(0, 6),
    ...fallbackShowcaseItems,
  ].slice(0, 6);
  const getProjectBadge = (item: any) => {
    const projectScenes = Array.isArray(item.project?.scenes) ? item.project.scenes : [];
    const hasAnalysisData = projectScenes.some((scene: any) => scene?.analysisReport || scene?.analysisModel);
    const analysisLikeText = `${item.name || ''} ${item.thumbnailUrl || ''}`.toLowerCase().includes('analysis');

    return hasAnalysisData || analysisLikeText
      ? {
          label: 'Analysis',
          icon: Activity,
          className: 'border-violet-300/25 bg-violet-500/20 text-violet-100 shadow-violet-950/30',
        }
      : {
          label: 'Workbench',
          icon: Layers,
          className: 'border-sky-300/25 bg-sky-500/18 text-sky-100 shadow-sky-950/30',
        };
  };
  const heroCarouselItems = [
    {
      id: 'benefit-library',
      eyebrow: 'Organized Story Workspace',
      title: 'Keep every scene, version, and visual reference in one place',
      description:
        'Storyboard Flow gives directors, editors, and collaborators a single home for saved projects, thumbnails, timelines, and review-ready scene snapshots.',
      thumbnailUrl: '/timeline-thumbnails/good-fellas-v3-thumbnail-1780955080705.jpg',
      actionLabel: 'Start a project',
      actionPath: '/editor?new=1',
    },
    {
      id: 'benefit-editor',
      eyebrow: 'Timeline Editor',
      title: 'Build faster with a workspace made for visual story decisions',
      description:
        'Cut clips, arrange beats, attach character and location context, and move from an idea to an editable sequence without leaving the tool.',
      thumbnailUrl: '/timeline-thumbnails/the-town.mp4--Imported----gemini-3-thumbnail-1780670758020.jpg',
      actionLabel: 'Open editor',
      actionPath: '/editor',
    },
    {
      id: 'benefit-analysis',
      eyebrow: 'AI Story Analysis',
      title: 'See what is working before you spend time polishing the wrong thing',
      description:
        'Run AI analysis to surface structure, pacing, tension, character focus, and scene notes so revisions become clearer and faster.',
      thumbnailUrl: '/timeline-thumbnails/pulp-fiction-8min-thumbnail-1780604496969.jpg',
      actionLabel: 'Run analysis',
      actionPath: '/analysis/new',
      secondaryLabel: 'View analysis',
      secondaryPath: '/analysis',
    },
    {
      id: 'benefit-collaboration',
      eyebrow: 'Shared Project Memory',
      title: 'Return to the work with context still attached',
      description:
        'Saved projects keep the important creative decisions close to the media, helping teams pick up where they left off instead of rebuilding context.',
      thumbnailUrl: '/timeline-thumbnails/good-fellas-thumbnail-1780604147352.jpg',
      actionLabel: 'Browse projects',
      actionPath: '#narrative-library',
    },
  ];
  const activeHeroIndexBounded = Math.min(activeHeroIndex, Math.max(heroCarouselItems.length - 1, 0));
  const heroSlide = heroCarouselItems[activeHeroIndexBounded] || heroCarouselItems[0];
  const heroImageUrl =
    heroSlide?.thumbnailUrl || '/timeline-thumbnails/good-fellas-v3-thumbnail-1780955080705.jpg';
  const heroTitle = heroSlide?.title || 'Storyboard Flow';

  const renderSceneCard = (scene: any) => (
    <article
      key={scene.id}
      className="group flex min-h-[22rem] w-[min(82vw,20rem)] shrink-0 snap-start scroll-mx-4 flex-col justify-between overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/70 shadow-xl shadow-black/25 transition-colors hover:border-indigo-500/40 sm:w-[20rem] xl:w-[21.5rem]"
    >
      <div>
        <div className="relative flex aspect-video select-none items-center justify-center overflow-hidden border-b border-zinc-800 bg-black">
          {scene.thumbnailUrl ? (
            <img
              src={scene.thumbnailUrl}
              alt=""
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_center,rgba(99,102,241,0.18),rgba(9,9,11,0.95)_55%)]">
              <Clapperboard className="h-8 w-8 text-zinc-700" />
            </div>
          )}
          <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-between px-2 py-1 opacity-60">
            {Array.from({ length: 7 }).map((_, index) => (
              <span key={index} className="h-1.5 w-2 rounded-[1px] bg-black/70 ring-1 ring-white/10" />
            ))}
          </div>
          <div className="absolute left-2 top-2 rounded border border-zinc-700 bg-black/70 px-2 py-0.5 text-[8.5px] font-mono uppercase tracking-wider text-zinc-300">
            {scene.isPublished ? 'Community Published' : 'Original Scene'}
          </div>
        </div>

        <div className="space-y-3 p-4">
          <div>
            <h4 className="truncate text-sm font-bold text-zinc-100 transition-colors group-hover:text-indigo-300">
              {scene.name}
            </h4>
            <p className="mt-1 text-[10px] font-mono uppercase tracking-widest text-zinc-600">
              {new Date(scene.publishedAt || scene.updatedAt).toLocaleString()}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-[9px] font-mono uppercase tracking-widest text-zinc-500">
            <span className="rounded border border-zinc-800 bg-zinc-900/60 px-2 py-1">Timeline</span>
            <span className="rounded border border-zinc-800 bg-zinc-900/60 px-2 py-1">Analysis</span>
            <span className="rounded border border-zinc-800 bg-zinc-900/60 px-2 py-1">Cloud</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 p-4 pt-0">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 border-zinc-700 bg-zinc-900 text-[10px] font-black uppercase tracking-widest text-zinc-300 hover:border-indigo-500/40 hover:bg-indigo-500/10 hover:text-indigo-100"
          onClick={() => void handleOpenScene(scene.id, '/editor', scene.isPublished)}
        >
          <Layers className="h-3.5 w-3.5" />
          Edit
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 border-zinc-700 bg-zinc-900 text-[10px] font-black uppercase tracking-widest text-zinc-300 hover:border-violet-500/40 hover:bg-violet-500/10 hover:text-violet-100"
          onClick={() => void handleOpenScene(scene.id, '/analysis', scene.isPublished)}
        >
          <Activity className="h-3.5 w-3.5" />
          Analyze
        </Button>
      </div>
    </article>
  );

  const renderSceneSection = ({
    title,
    description,
    scenes,
    emptyTitle,
    emptyDescription,
  }: {
    title: string;
    description: string;
    scenes: any[];
    emptyTitle: string;
    emptyDescription: string;
  }) => (
    <section className="space-y-4 rounded-lg border border-zinc-800 bg-[#111114] p-4 shadow-xl shadow-black/20 [content-visibility:auto] [contain-intrinsic-size:auto_520px]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-zinc-200">
            <Cloud className="h-4 w-4 text-indigo-300" />
            {title}
          </h3>
          <p className="mt-1 max-w-xl text-xs leading-relaxed text-zinc-500">{description}</p>
        </div>
        <span className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-[9px] font-mono uppercase tracking-widest text-zinc-500">
          {scenes.length} {scenes.length === 1 ? 'Scene' : 'Scenes'}
        </span>
      </div>

      {scenes.length > 0 ? (
        <div
          className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto overscroll-x-contain px-4 pb-2 pt-1 [scrollbar-width:thin]"
          aria-label={`${title} carousel`}
        >
          {scenes.map(renderSceneCard)}
        </div>
      ) : (
        <div className="flex min-h-48 flex-col items-center justify-center gap-4 rounded-md border border-dashed border-zinc-800 bg-zinc-950/40 px-5 py-10 text-center">
          <Clapperboard className="h-7 w-7 text-zinc-650" />
          <div>
            <div className="text-xs font-bold uppercase tracking-widest text-zinc-400">{emptyTitle}</div>
            <p className="mt-1 max-w-[320px] text-[10px] leading-relaxed text-zinc-600">{emptyDescription}</p>
          </div>
          <Button
            onClick={() => verifyAuthAndNavigate('/editor?new=1')}
            variant="outline"
            size="sm"
            className="h-8 border-zinc-700 bg-zinc-900 text-[10px] font-bold uppercase tracking-widest text-zinc-300 hover:border-indigo-500/50 hover:bg-indigo-500/10 hover:text-white"
          >
            <Plus className="h-3.5 w-3.5" />
            Create Scene
          </Button>
        </div>
      )}
    </section>
  );

  const renderHomeSidePanel = () => {
    if (!activeTab) return null;

    const title = {
      scenes: 'Scenes',
      characters: 'Characters',
      locations: 'Locations',
      settings: 'Project Settings',
      analyze: 'AI Video Analysis',
    }[activeTab];

    return (
      <motion.aside
        ref={sidePanelRef}
        initial={{ x: '-100%' }}
        animate={{ x: 0 }}
        exit={{ x: '-100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        className="fixed inset-y-0 left-0 z-[100] flex w-72 flex-col border-r border-zinc-800 bg-[#111114] shadow-[20px_0_50px_rgba(0,0,0,0.5)]"
      >
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-zinc-800 px-4">
          <h3 className="text-[11px] font-bold uppercase tracking-widest text-zinc-400">{title}</h3>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-zinc-500 hover:text-white"
            onClick={() => setActiveTab(null)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {activeTab === 'scenes' && (
            <div className="flex flex-col gap-4 p-4">
              <Button
                onClick={() => verifyAuthAndNavigate('/editor?new=1')}
                className="h-9 w-full bg-indigo-600 text-[10px] font-bold uppercase tracking-widest text-white hover:bg-indigo-500"
              >
                <Plus className="mr-2 h-3.5 w-3.5" />
                Add New Scene
              </Button>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-md border border-zinc-800 bg-zinc-950/70 p-3">
                  <div className="text-2xl font-black text-zinc-100">{savedScenes.length}</div>
                  <div className="mt-1 text-[9px] font-mono uppercase tracking-widest text-zinc-600">Scenes</div>
                </div>
                <div className="rounded-md border border-zinc-800 bg-zinc-950/70 p-3">
                  <div className="text-2xl font-black text-zinc-100">{communityPublishedScenes.length}</div>
                  <div className="mt-1 text-[9px] font-mono uppercase tracking-widest text-zinc-600">Public</div>
                </div>
              </div>
              <div className="space-y-2">
                {savedScenes.slice(0, 8).map((scene) => (
                  <button
                    key={scene.id}
                    type="button"
                    onClick={() => handleOpenScene(scene.id, '/editor', scene.isPublished)}
                    className="group flex w-full items-center gap-3 rounded-md border border-zinc-800 bg-zinc-900/50 p-3 text-left transition-all hover:border-zinc-700"
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-zinc-800 bg-zinc-950 text-zinc-600 group-hover:text-indigo-300">
                      <Clapperboard className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-xs font-bold text-zinc-300">{scene.name}</div>
                      <div className="mt-1 text-[9px] font-mono uppercase tracking-widest text-zinc-600">
                        {scene.isPublished ? 'Community' : 'Original'}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'characters' && (
            <div className="flex h-full flex-col items-center justify-center p-6 text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-zinc-900 text-zinc-700">
                <Users className="h-6 w-6" />
              </div>
              <h4 className="text-xs font-bold uppercase tracking-widest text-zinc-400">Characters</h4>
              <p className="mt-2 text-xs leading-relaxed text-zinc-600">
                Open a scene in the editor to manage character avatars and dialogue metadata.
              </p>
            </div>
          )}

          {activeTab === 'locations' && (
            <div className="flex h-full flex-col items-center justify-center p-6 text-center">
              <MapPin className="mb-3 h-12 w-12 text-zinc-700" />
              <h4 className="text-xs font-bold uppercase tracking-widest text-zinc-400">Locations</h4>
              <p className="mt-2 text-xs leading-relaxed text-zinc-600">
                Location mapping lives in the project workspace once a scene is opened.
              </p>
            </div>
          )}

          {activeTab === 'analyze' && (
            <div className="flex flex-col gap-4 p-4">
              <div className="rounded-md border border-zinc-800 bg-zinc-950/70 p-4">
                <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-indigo-300">
                  <Sparkles className="h-3.5 w-3.5" />
                  AI Video Analysis
                </div>
                <p className="mt-2 text-xs leading-relaxed text-zinc-500">
                  Start a fresh analysis session or open an analyzed scene from the library.
                </p>
              </div>
              <Button
                onClick={() => verifyAuthAndNavigate('/analysis/new')}
                className="h-9 w-full bg-indigo-600 text-[10px] font-bold uppercase tracking-widest text-white hover:bg-indigo-500"
              >
                <Activity className="mr-2 h-3.5 w-3.5" />
                Run Analysis
              </Button>
            </div>
          )}

          {activeTab === 'settings' && (
            <div className="flex h-full flex-col items-center justify-center p-6 text-center">
              <Settings className="mb-3 h-8 w-8 text-zinc-600" />
              <h4 className="text-xs font-bold uppercase tracking-widest text-zinc-400">Project Settings</h4>
              <p className="mt-2 text-xs leading-relaxed text-zinc-600">
                Scene-specific settings are available after opening a project in the editor.
              </p>
            </div>
          )}
        </div>
      </motion.aside>
    );
  };

  const renderSidebarButton = ({
    tab,
    label,
    icon: Icon,
    title,
  }: {
    tab: Exclude<HomeSidebarTab, null>;
    label: string;
    icon: React.ElementType;
    title?: string;
  }) => {
    const isActive = activeTab === tab;

    return (
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setActiveTab(isActive ? null : tab)}
        className={cn(
          'h-8 transition-all',
          isIconSidebarExpanded ? 'w-full justify-start gap-3 px-3' : 'w-8',
          isActive ? 'bg-indigo-500/10 text-indigo-400' : 'text-zinc-600 hover:text-zinc-300'
        )}
        title={title || label}
        aria-label={label}
      >
        <Icon className="h-4.5 w-4.5 shrink-0" />
        {isIconSidebarExpanded && (
          <span className="min-w-0 truncate text-[10px] font-black uppercase tracking-widest">
            {label}
          </span>
        )}
      </Button>
    );
  };

  return (
    <div className="workbench-shell flex h-screen flex-col overflow-hidden bg-[#0a0a0b] text-zinc-300 selection:bg-indigo-500/30">
      <header className="relative z-[200] flex h-12 shrink-0 items-center justify-between overflow-visible border-b border-zinc-800 bg-[#111114] pr-4">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center border-r border-zinc-800">
            <LogoMark size="sm" />
          </div>
          <div className="hidden items-center gap-4 text-xs font-medium text-zinc-500 sm:flex">
            <div ref={fileMenuRef} className="relative">
              <button
                type="button"
                className="cursor-pointer text-[11px] font-bold uppercase tracking-widest text-zinc-300 outline-none transition-colors hover:text-white"
                onClick={() => {
                  setIsFileMenuOpen(open => !open);
                  setIsProjectMenuOpen(false);
                  setIsAboutMenuOpen(false);
                }}
              >
                File
              </button>

              {isFileMenuOpen && (
                <div className="absolute left-0 top-full z-50 mt-2 w-56 rounded-lg border border-zinc-800 bg-[#111114] p-1 text-zinc-300 shadow-2xl shadow-black/50">
                  <div className="select-none px-2 py-1.5 text-[10px] font-bold uppercase tracking-widest text-zinc-500">Cloud Library</div>
                  <button
                    type="button"
                    disabled
                    className="flex w-full cursor-not-allowed items-center gap-2 rounded-md bg-transparent px-2 py-2 text-left text-sm text-zinc-650"
                    title="Open a project in the editor to save the active scene."
                  >
                    <Cloud className="h-4 w-4" />
                    Save Scene
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      closeMenus();
                      verifyAuthAndNavigate('/editor?new=1');
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-zinc-800 hover:text-white"
                  >
                    <Plus className="h-4 w-4" />
                    New Scene
                  </button>
                  <div className="-mx-1 my-1 h-px bg-zinc-800" />
                  <div className="select-none px-2 py-1.5 text-[10px] font-bold uppercase tracking-widest text-zinc-500">Project JSON</div>
                  <button
                    type="button"
                    disabled
                    className="flex w-full cursor-not-allowed items-center gap-2 rounded-md bg-transparent px-2 py-2 text-left text-sm text-zinc-650"
                    title="Open a project in the editor to export JSON."
                  >
                    <Download className="h-4 w-4" />
                    Export Project
                  </button>
                  <button
                    type="button"
                    disabled
                    className="flex w-full cursor-not-allowed items-center gap-2 rounded-md bg-transparent px-2 py-2 text-left text-sm text-zinc-650"
                    title="Open the editor to import a project JSON file."
                  >
                    <Upload className="h-4 w-4" />
                    Import Project
                  </button>
                </div>
              )}
            </div>

            <div ref={projectMenuRef} className="relative">
              <button
                type="button"
                className="cursor-pointer text-[11px] font-bold uppercase tracking-widest outline-none transition-colors hover:text-zinc-300"
                onClick={() => {
                  setIsProjectMenuOpen(open => !open);
                  setIsFileMenuOpen(false);
                  setIsAboutMenuOpen(false);
                }}
              >
                Project
              </button>

              {isProjectMenuOpen && (
                <div className="absolute left-0 top-full z-50 mt-2 w-60 rounded-lg border border-zinc-800 bg-[#111114] p-1 text-zinc-300 shadow-2xl shadow-black/50">
                  <div className="select-none px-2 py-1.5 text-[10px] font-bold uppercase tracking-widest text-zinc-500">Workspace</div>
                  <button
                    type="button"
                    onClick={() => {
                      closeMenus();
                      verifyAuthAndNavigate('/editor');
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-zinc-800 hover:text-white"
                  >
                    <Layers className="h-4 w-4" />
                    Open Editor
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      closeMenus();
                      verifyAuthAndNavigate('/analysis/new');
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-zinc-800 hover:text-white"
                  >
                    <Activity className="h-4 w-4" />
                    Run Analysis
                  </button>
                  <button
                    type="button"
                    onClick={scrollToLibrary}
                    className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-zinc-800 hover:text-white"
                  >
                    <span className="flex items-center gap-2">
                      <Cloud className="h-4 w-4" />
                      Scene Library
                    </span>
                    <span className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 font-mono text-[9px] text-zinc-500">
                      {savedScenes.length}
                    </span>
                  </button>
                </div>
              )}
            </div>

            <button
              type="button"
              className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-zinc-500 transition-colors hover:text-zinc-200"
              onClick={scrollToLibrary}
              aria-label={scenesError ? 'Open scene library, scenes could not be loaded' : `Open scene library with ${savedScenes.length} scenes`}
              title={scenesError || undefined}
            >
              <span>Scene Library</span>
              <span aria-hidden="true" className="text-zinc-700">(</span>
              <span className={cn(
                'rounded border bg-zinc-950 px-1.5 py-0.5 font-mono text-[9px] tabular-nums',
                scenesError ? 'border-red-500/30 text-red-300' : 'border-zinc-800 text-zinc-400'
              )}>
                {isLoadingScenes ? '...' : savedScenes.length}
              </span>
              <span aria-hidden="true" className="text-zinc-700">)</span>
            </button>

            <div ref={aboutMenuRef} className="relative">
              <button
                type="button"
                className="cursor-pointer text-[11px] font-bold uppercase tracking-widest outline-none transition-colors hover:text-zinc-300"
                onClick={() => {
                  setIsAboutMenuOpen(open => !open);
                  setIsFileMenuOpen(false);
                  setIsProjectMenuOpen(false);
                }}
              >
                About
              </button>

              {isAboutMenuOpen && (
                <div className="absolute left-0 top-full z-50 mt-2 w-72 rounded-lg border border-zinc-800 bg-[#111114] p-3 text-zinc-300 shadow-2xl shadow-black/50">
                  <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-indigo-300">
                    <Info className="h-3.5 w-3.5" />
                    Storyboard Workbench
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-zinc-500">
                    A narrative editing workspace for saved scenes, timeline construction, and AI analysis.
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-[9px] font-mono uppercase tracking-widest text-zinc-500">
                    <span className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1">Editor</span>
                    <span className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1">Analysis</span>
                    <span className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1">Library</span>
                    <span className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1">Cloud</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex shrink-0 select-none rounded border border-zinc-800 bg-zinc-950/60 p-0.5">
            <button
              type="button"
              className="inline-flex h-7 items-center gap-1.5 rounded px-2.5 text-[9px] font-black uppercase tracking-widest text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-200"
              onClick={() => verifyAuthAndNavigate('/editor')}
            >
              <Layers className="h-3.5 w-3.5" />
              Editor
            </button>
            <button
              type="button"
              className="inline-flex h-7 items-center gap-1.5 rounded px-2.5 text-[9px] font-black uppercase tracking-widest text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-200"
              onClick={() => verifyAuthAndNavigate('/analysis/new')}
            >
              <Activity className="h-3.5 w-3.5" />
              Analysis
            </button>
          </div>
          <ThemeToggle />
          <div className="h-4 w-px bg-zinc-800" />
          {currentUser ? (
            <div className="flex items-center gap-3">
              <div className="hidden flex-col items-end sm:flex">
                <span className="text-[10px] font-bold text-zinc-200">{currentUser.username}</span>
                <span
                  className={cn(
                    'mt-0.5 rounded-sm border px-1.5 py-0.5 text-[8px] font-black uppercase leading-none tracking-widest',
                    roleBadgeClassName[currentUser.role]
                  )}
                >
                  {currentUser.role}
                </span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-zinc-500 hover:bg-red-400/10 hover:text-red-400"
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
              onClick={openAuth}
              className="h-8 border-zinc-700 bg-zinc-900 px-3 text-[10px] font-bold uppercase tracking-widest text-zinc-300 hover:border-indigo-500/40 hover:bg-indigo-500/10 hover:text-white"
            >
              <UserCircle className="h-3.5 w-3.5" />
              Sign In
            </Button>
          )}
        </div>
      </header>

      <main className="relative flex flex-1 overflow-hidden bg-zinc-950">
        <AnimatePresence>
          {renderHomeSidePanel()}
        </AnimatePresence>

        <aside
          className={cn(
            'z-10 flex shrink-0 flex-col gap-4 border-r border-zinc-800 bg-[#111114] py-4 transition-[width] duration-200 ease-out',
            isIconSidebarExpanded ? 'w-44 items-stretch px-2' : 'w-12 items-center px-0'
          )}
        >
          {renderSidebarButton({ tab: 'scenes', label: 'Scenes', icon: Clapperboard })}
          {renderSidebarButton({ tab: 'characters', label: 'Characters', icon: Users })}
          {renderSidebarButton({ tab: 'locations', label: 'Locations', icon: MapPin })}
          {renderSidebarButton({ tab: 'analyze', label: 'Analyze', icon: Sparkles, title: 'AI Video Analysis' })}
          <div className="flex-1" />
          {renderSidebarButton({ tab: 'settings', label: 'Settings', icon: Settings })}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsIconSidebarExpanded((expanded) => !expanded)}
            className={cn(
              'h-8 transition-all text-zinc-600 hover:text-zinc-300',
              isIconSidebarExpanded ? 'w-full justify-start gap-3 px-3' : 'w-8'
            )}
            title={isIconSidebarExpanded ? 'Collapse Sidebar' : 'Expand Sidebar'}
            aria-label={isIconSidebarExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
            aria-pressed={isIconSidebarExpanded}
          >
            {isIconSidebarExpanded ? (
              <PanelLeftClose className="h-4.5 w-4.5 shrink-0" />
            ) : (
              <PanelLeftOpen className="h-4.5 w-4.5 shrink-0" />
            )}
            {isIconSidebarExpanded && (
              <span className="min-w-0 truncate text-[10px] font-black uppercase tracking-widest">
                Collapse
              </span>
            )}
          </Button>
        </aside>

        <div className="relative flex min-w-0 flex-1 flex-col overflow-y-auto bg-black">
          <div id="narrative-library" className="min-w-0 scroll-mt-4 p-3 md:p-4">
            <div className="mb-3 flex items-center justify-between">
              <h1 className="[font-family:'Google_Sans','Product_Sans',var(--font-sans),ui-sans-serif,system-ui,sans-serif]">
                Storyboard Workbench
              </h1>
              {currentUser ? (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleLogout}
                  title="Log Out"
                  aria-label="Log out"
                >
                  <LogOut className="h-4 w-4" />
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={openAuth}
                  title="Sign In"
                  aria-label="Sign in"
                >
                  <UserCircle className="h-4 w-4" />
                </Button>
              )}
            </div>

            {scenesError && (
              <div className="mb-3 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-xs text-red-100">
                {scenesError}
              </div>
            )}

            <section
              id="home-featured-panel"
              role="tabpanel"
              aria-label={heroTitle}
              className="relative min-h-[26rem] overflow-hidden rounded-lg border border-zinc-900 bg-zinc-950 shadow-2xl shadow-black/40 md:min-h-[31rem]"
            >
              <img
                src={heroImageUrl}
                alt=""
                className="absolute inset-0 h-full w-full object-cover opacity-80"
                fetchPriority="high"
              />
              <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/45 to-black/10" />
              <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-black/70 to-transparent" />

              <div className="relative z-10 flex min-h-[26rem] max-w-3xl flex-col justify-end px-6 py-7 md:min-h-[31rem] md:px-10 md:py-10">
                <div className="mb-3 flex w-max items-center gap-2 rounded-full border border-white/15 bg-black/35 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-white/80 backdrop-blur">
                  <Sparkles className="h-3.5 w-3.5" />
                  {heroSlide.eyebrow}
                </div>
                <h1 className="max-w-2xl text-4xl font-semibold leading-[1.02] text-white md:text-6xl">
                  {heroTitle}
                </h1>
                <p className="mt-4 max-w-xl text-sm leading-6 text-white/82 md:text-base">
                  {heroSlide.description}
                </p>

                <div className="mt-7 flex flex-wrap items-center gap-3">
                  <Button
                    type="button"
                    onClick={() => {
                      if (heroSlide.actionPath === '#narrative-library') scrollToLibrary();
                      else verifyAuthAndNavigate(heroSlide.actionPath);
                    }}
                    className="h-11 rounded-full bg-white px-5 text-sm font-semibold text-black hover:bg-zinc-200"
                  >
                    <Plus className="h-4 w-4" />
                    {heroSlide.actionLabel}
                  </Button>
                  {heroSlide.secondaryLabel && heroSlide.secondaryPath && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => verifyAuthAndNavigate(heroSlide.secondaryPath)}
                      className="h-11 rounded-full border-white/30 bg-black/25 px-5 text-sm font-semibold text-white hover:bg-white/10"
                    >
                      <Activity className="h-4 w-4" />
                      {heroSlide.secondaryLabel}
                    </Button>
                  )}
                </div>

                <div
                  className="mt-7 flex w-full max-w-xs items-center gap-2"
                  role="tablist"
                  aria-label="Featured home content"
                >
                  {heroCarouselItems.map((item, index) => {
                    const isActive = index === activeHeroIndexBounded;

                    return (
                      <button
                        key={`${item.id}-hero-indicator`}
                        type="button"
                        role="tab"
                        aria-selected={isActive}
                        aria-controls="home-featured-panel"
                        aria-label={`Show featured content: ${item.eyebrow}`}
                        onClick={() => setActiveHeroIndex(index)}
                        className={cn(
                          'h-4 flex-1 rounded-full py-1 transition-opacity focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white',
                          isActive ? 'opacity-100' : 'opacity-55 hover:opacity-80'
                        )}
                      >
                        <span
                          className={cn(
                            'block h-1 rounded-full transition-colors',
                            isActive ? 'bg-white' : 'bg-white/35'
                          )}
                        />
                      </button>
                    );
                  })}
                </div>
              </div>

              {isLoadingScenes && (
                <div className="absolute right-4 top-4 flex items-center gap-2 rounded-full border border-white/15 bg-black/50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/70 backdrop-blur">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Syncing
                </div>
              )}
            </section>

            <section className="mt-5 grid grid-cols-1 gap-x-5 gap-y-10 lg:grid-cols-3">
              {flowShowcaseItems.map((item, index) => {
                const canOpenScene = !item.isFallback;
                const badge = getProjectBadge(item);
                const BadgeIcon = badge.icon;
                const projectTargetPath = badge.label === 'Analysis' ? '/analysis' : '/editor';
                const fallbackTargetPath = badge.label === 'Analysis' ? '/analysis/new' : '/editor?new=1';
                const openProjectItem = () => {
                  if (canOpenScene) {
                    void handleOpenScene(item.id, projectTargetPath, item.isPublished);
                    return;
                  }
                  verifyAuthAndNavigate(fallbackTargetPath);
                };

                return (
                  <article
                    key={`${item.id}-${index}`}
                    className="group overflow-visible"
                  >
                    <div className="relative aspect-[16/9] overflow-hidden rounded-lg bg-zinc-950 shadow-xl shadow-black/35">
                      <img
                        src={item.thumbnailUrl}
                        alt=""
                        className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                        loading="lazy"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent" />
                      <div
                        className={cn(
                          'pointer-events-none absolute left-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-widest shadow-lg backdrop-blur-md',
                          badge.className
                        )}
                        aria-label={`${badge.label} project`}
                      >
                        <BadgeIcon className="h-3.5 w-3.5" />
                        {badge.label}
                      </div>

                      <button
                        type="button"
                        onClick={openProjectItem}
                        className="absolute inset-0 cursor-pointer"
                        aria-label={`Open ${item.name} in ${badge.label === 'Analysis' ? 'analysis' : 'editor'}`}
                      />
                    </div>

                    <div className="mt-4 flex min-h-11 items-center justify-between gap-4 px-4">
                      <div className="flex min-w-0 items-center gap-2">
                        <h3 className="truncate text-xl font-medium text-zinc-100 md:text-2xl">
                          {item.name}
                        </h3>
                        <button
                          type="button"
                          onClick={openProjectItem}
                          className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-zinc-100 opacity-0 transition-all hover:bg-white/10 hover:text-white group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                          aria-label={`Open ${item.name} in ${badge.label === 'Analysis' ? 'analysis' : 'editor'}`}
                        >
                          <Pencil className="h-5 w-5" />
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={() => void handleDeleteScene(item)}
                        disabled={item.isFallback}
                        className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-zinc-100 opacity-0 transition-all hover:bg-red-500/10 hover:text-red-200 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-zinc-100"
                        aria-label={
                          item.isFallback ? 'Delete unavailable' : `Delete ${item.name}`
                        }
                        title={item.isFallback ? 'Delete unavailable' : `Delete ${item.name}`}
                      >
                        <Trash2 className="h-5 w-5" />
                      </button>
                    </div>
                  </article>
                );
              })}
            </section>

            <Button
              type="button"
              onClick={() => verifyAuthAndNavigate('/editor?new=1')}
              className="fixed bottom-10 left-1/2 z-[80] h-12 -translate-x-1/2 rounded-full border border-white/20 bg-zinc-100/16 px-5 text-sm font-semibold text-white shadow-[0_18px_60px_rgba(0,0,0,0.45)] backdrop-blur-xl transition-all hover:border-white/35 hover:bg-white/22 hover:shadow-[0_22px_70px_rgba(0,0,0,0.55)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              aria-label="Create new project"
            >
              <Plus className="h-4.5 w-4.5" />
              New project
            </Button>
          </div>
        </div>
      </main>

      <footer className="flex h-6 shrink-0 items-center justify-between border-t border-zinc-800 bg-[#0a0a0b] px-3 uppercase tracking-[0.2em]">
        <div className="flex items-center gap-4 text-[8px] font-bold text-zinc-600">
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.5)]" />
            ENGINE NOMINAL
          </span>
          <span>LIBRARY: {sceneCountLabel}</span>
        </div>
        <div className="text-[8px] font-bold text-zinc-600">HOME WORKSPACE</div>
      </footer>

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
                  onClick={() => setIsAuthModalOpen(false)}
                  aria-label="Close auth dialog"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="grid grid-cols-2 border-b border-zinc-850 bg-zinc-950/40 p-1">
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode('login');
                    setAuthError('');
                  }}
                  className={cn(
                    'rounded py-2 text-center font-mono text-[10px] font-black uppercase tracking-wider transition-all',
                    authMode === 'login'
                      ? 'border border-zinc-850 bg-zinc-900 text-indigo-300 shadow'
                      : 'text-zinc-500 hover:text-zinc-350'
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
                    'rounded py-2 text-center font-mono text-[10px] font-black uppercase tracking-wider transition-all',
                    authMode === 'signup'
                      ? 'border border-zinc-850 bg-zinc-900 text-indigo-300 shadow'
                      : 'text-zinc-500 hover:text-zinc-350'
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
                    placeholder="Password"
                  />
                </div>

                <Button
                  type="submit"
                  disabled={authLoading}
                  className="h-10 w-full bg-indigo-650 text-xs font-black uppercase tracking-widest text-white shadow-lg shadow-indigo-900/30 hover:bg-indigo-500"
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
