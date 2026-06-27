'use client';

import React from 'react';
import Link from 'next/link';
import { Activity, Check, Cloud, CloudOff, Download, Loader2, LogOut, Ruler, Settings, Share2, Upload, UserCircle } from 'lucide-react';
import { Button } from '@storyboard/ui';
import ThemeToggle from '@/components/ThemeToggle';
import LogoMark from '@/components/LogoMark';
import { cn } from '@/lib/utils';
import type { WorkspaceViewMode } from '@/lib/timeline-context';

type EditorHeaderUser = {
  id: string;
  username: string;
  role: 'viewer' | 'editor' | 'admin';
};

type AutosaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

type EditorHeaderRailProps = {
  fileMenuRef: React.RefObject<HTMLDivElement | null>;
  projectImportInputRef: React.RefObject<HTMLInputElement | null>;
  isFileMenuOpen: boolean;
  setIsFileMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  currentUser: EditorHeaderUser | null;
  activeSavedSceneId: string | null;
  activeSavedScenePublished: boolean;
  savedScenesCount: number;
  savedScenesLoadError: string | null;
  sceneLibraryCountLabel: string;
  showAutosaveIndicator: boolean;
  autosaveToneClass: string;
  autosaveStatus: AutosaveStatus;
  autosaveMessage: string;
  workspaceViewMode: WorkspaceViewMode;
  onOpenSaveScene: () => void;
  onTogglePublish: () => void;
  onExportProject: () => void;
  onOpenSceneLibrary: () => void;
  onNavigateEditor: () => void;
  onNavigateAnalysis: () => void;
  onOpenAdmin: () => void;
  onLogout: () => void;
  onOpenLogin: () => void;
};

export function EditorHeaderRail({
  fileMenuRef,
  projectImportInputRef,
  isFileMenuOpen,
  setIsFileMenuOpen,
  currentUser,
  activeSavedSceneId,
  activeSavedScenePublished,
  savedScenesCount,
  savedScenesLoadError,
  sceneLibraryCountLabel,
  showAutosaveIndicator,
  autosaveToneClass,
  autosaveStatus,
  autosaveMessage,
  workspaceViewMode,
  onOpenSaveScene,
  onTogglePublish,
  onExportProject,
  onOpenSceneLibrary,
  onNavigateEditor,
  onNavigateAnalysis,
  onOpenAdmin,
  onLogout,
  onOpenLogin,
}: EditorHeaderRailProps) {
  const isReadOnlyUser = !currentUser || currentUser.role === 'viewer';

  return (
    <header className="h-12 border-b border-zinc-800 bg-[#111114] flex items-center justify-between pr-4 pl-0 shrink-0 overflow-visible relative z-[200]">
      <div className="flex items-center gap-4">
        <Link href="/" className="w-12 h-12 flex items-center justify-center border-r border-zinc-800 hover:opacity-90 transition-opacity" title="Back to Homepage">
          <LogoMark size="sm" />
        </Link>
        <div className="flex items-center gap-4 text-xs font-medium text-zinc-500">
          <div ref={fileMenuRef} className="relative">
            <button
              type="button"
              className="text-zinc-300 cursor-pointer text-[11px] font-bold uppercase tracking-widest outline-none hover:text-white transition-colors"
              onClick={() => setIsFileMenuOpen(open => !open)}
            >
              File
            </button>

            {isFileMenuOpen && (
              <div className="absolute left-0 top-full mt-2 z-50 w-56 rounded-lg border border-zinc-800 bg-[#111114] p-1 text-zinc-300 shadow-2xl shadow-black/50">
                <div className="px-2 py-1.5 text-[10px] uppercase tracking-widest text-zinc-500 font-bold select-none">Cloud Library</div>
                <button
                  type="button"
                  disabled={isReadOnlyUser}
                  onClick={() => {
                    onOpenSaveScene();
                    setIsFileMenuOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors",
                    isReadOnlyUser
                      ? "text-zinc-650 cursor-not-allowed bg-transparent"
                      : "hover:bg-zinc-800 hover:text-white"
                  )}
                  title={isReadOnlyUser ? "Log in as an editor or admin to save scenes" : undefined}
                >
                  <Cloud className="h-4 w-4" />
                  Save Scene
                </button>
                {currentUser?.role === 'admin' && activeSavedSceneId && (
                  <button
                    type="button"
                    onClick={onTogglePublish}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-zinc-800 hover:text-white"
                  >
                    <Share2 className="h-4 w-4 text-indigo-400" />
                    {activeSavedScenePublished ? 'Unpublish Scene' : 'Publish Scene'}
                  </button>
                )}
                <div className="-mx-1 my-1 h-px bg-zinc-800" />
                <div className="px-2 py-1.5 text-[10px] uppercase tracking-widest text-zinc-500 font-bold select-none">Project JSON</div>
                <button
                  type="button"
                  onClick={() => {
                    onExportProject();
                    setIsFileMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-zinc-800 hover:text-white"
                >
                  <Download className="h-4 w-4" />
                  Export Project
                </button>
                <div className="-mx-1 my-1 h-px bg-zinc-800" />
                <button
                  type="button"
                  onClick={() => {
                    projectImportInputRef.current?.click();
                    setIsFileMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-zinc-800 hover:text-white"
                >
                  <Upload className="h-4 w-4" />
                  Import Project
                </button>
              </div>
            )}
          </div>
          <span className="hover:text-zinc-300 cursor-pointer transition-colors text-[11px] font-bold uppercase tracking-widest">Project</span>

          <button
            type="button"
            className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-zinc-500 transition-colors hover:text-zinc-200"
            onClick={onOpenSceneLibrary}
            aria-label={savedScenesLoadError ? 'Open scene library, scenes could not be loaded' : `Open scene library with ${savedScenesCount} scenes`}
            title={savedScenesLoadError || undefined}
          >
            <span>Scene Library</span>
            <span aria-hidden="true" className="text-zinc-700">(</span>
            <span className={cn(
              "rounded border bg-zinc-950 px-1.5 py-0.5 font-mono text-[9px] tabular-nums",
              savedScenesLoadError ? "border-red-500/30 text-red-300" : "border-zinc-800 text-zinc-400"
            )}>
              {sceneLibraryCountLabel}
            </span>
            <span aria-hidden="true" className="text-zinc-700">)</span>
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {showAutosaveIndicator && (
          <div
            className={cn(
              "hidden h-7 items-center gap-1.5 rounded border px-2 text-[9px] font-black uppercase tracking-widest sm:inline-flex",
              autosaveToneClass
            )}
            aria-live="polite"
            aria-atomic="true"
            title={autosaveMessage}
          >
            {autosaveStatus === 'saving' || autosaveStatus === 'pending' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : autosaveStatus === 'error' ? (
              <CloudOff className="h-3.5 w-3.5" />
            ) : autosaveStatus === 'saved' ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Cloud className="h-3.5 w-3.5" />
            )}
            <span>{autosaveMessage}</span>
          </div>
        )}

        <div className="flex bg-zinc-950/60 rounded border border-zinc-800 p-0.5 shrink-0 select-none">
          <button
            type="button"
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded px-2.5 text-[9px] font-black uppercase tracking-widest transition-colors cursor-pointer",
              workspaceViewMode === 'editor'
                ? "bg-indigo-600 text-white shadow"
                : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
            )}
            onClick={onNavigateEditor}
          >
            <Ruler className="h-3.5 w-3.5" />
            Editor
          </button>

          <button
            type="button"
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded px-2.5 text-[9px] font-black uppercase tracking-widest transition-colors cursor-pointer",
              workspaceViewMode === 'analysis'
                ? "bg-indigo-600 text-white shadow"
                : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
            )}
            onClick={onNavigateAnalysis}
          >
            <Activity className="h-3.5 w-3.5" />
            Analysis
          </button>
        </div>

        <ThemeToggle />

        <div className="h-4 w-px bg-zinc-800" />

        {currentUser ? (
          <div className="flex items-center gap-3">
            <div className="flex flex-col items-end">
              <span className="text-[10px] font-bold text-zinc-200">{currentUser.username}</span>
              <span className={cn(
                "mt-0.5 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-widest rounded-sm border leading-none",
                currentUser.role === 'admin' && "bg-indigo-500/10 text-indigo-300 border-indigo-500/20 shadow-[0_0_8px_rgba(99,102,241,0.1)]",
                currentUser.role === 'editor' && "bg-emerald-500/10 text-emerald-300 border-emerald-500/20 shadow-[0_0_8px_rgba(16,185,129,0.1)]",
                currentUser.role === 'viewer' && "bg-zinc-800/40 text-zinc-400 border-zinc-800/80"
              )}>
                {currentUser.role}
              </span>
            </div>

            {currentUser.role === 'admin' && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-zinc-500 hover:text-white hover:bg-zinc-850 rounded"
                onClick={onOpenAdmin}
                title="Admin User Management"
              >
                <Settings className="h-4 w-4" />
              </Button>
            )}

            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-zinc-500 hover:text-red-400 hover:bg-red-400/10 rounded"
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
            onClick={onOpenLogin}
            className="h-8 border-zinc-800 bg-zinc-950 px-3 text-[10px] font-black uppercase tracking-widest text-zinc-300 hover:border-indigo-500/50 hover:bg-indigo-500/10 hover:text-white"
          >
            <UserCircle className="h-3.5 w-3.5 mr-1 text-indigo-400" />
            Sign In
          </Button>
        )}
      </div>
    </header>
  );
}
