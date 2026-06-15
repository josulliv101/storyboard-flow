'use client';

import { Loader2, Plus, Trash2, Upload, X } from 'lucide-react';
import { motion } from 'motion/react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
} from '@storyboard/ui';
import type { TimelineProjectJson } from '@/lib/timeline-context';
import type { SavedSceneSummary } from './saved-scene-utils';

export type PendingProjectImport = {
  fileName: string;
  project: TimelineProjectJson;
  savedSceneId?: string;
  isPublished?: boolean;
};

type EditorConfirmationsProps = {
  pendingSavedSceneDelete: SavedSceneSummary | null;
  deletingSavedSceneId: string | null;
  pendingProjectImport: PendingProjectImport | null;
  setPendingSavedSceneDelete: (scene: SavedSceneSummary | null) => void;
  setPendingProjectImport: (pendingImport: PendingProjectImport | null) => void;
  setIsSceneLibraryOpen: (open: boolean) => void;
  onDeleteSavedScene: () => void;
  onAppendPendingProjectImport: () => void;
  onReplaceWithPendingProjectImport: () => void;
};

export function EditorConfirmations({
  pendingSavedSceneDelete,
  deletingSavedSceneId,
  pendingProjectImport,
  setPendingSavedSceneDelete,
  setPendingProjectImport,
  setIsSceneLibraryOpen,
  onDeleteSavedScene,
  onAppendPendingProjectImport,
  onReplaceWithPendingProjectImport,
}: EditorConfirmationsProps) {
  return (
    <>
      <AlertDialog
        key="saved-scene-delete-confirmation"
        open={Boolean(pendingSavedSceneDelete)}
        onOpenChange={(open) => {
          if (!open && !deletingSavedSceneId) {
            setPendingSavedSceneDelete(null);
            setIsSceneLibraryOpen(true);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete saved scene?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the saved analysis for {pendingSavedSceneDelete?.name}. Hosted video is also removed when no other saved scene uses it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(deletingSavedSceneId)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={Boolean(deletingSavedSceneId)}
              onClick={onDeleteSavedScene}
            >
              {deletingSavedSceneId ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Trash2 data-icon="inline-start" />}
              Delete Permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {pendingProjectImport && (
        <motion.div
          key="project-import-confirmation"
          className="fixed inset-0 z-[320] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onPointerDown={() => setPendingProjectImport(null)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            className="w-full max-w-md rounded-lg border border-zinc-800 bg-[#111114] p-4 shadow-2xl"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h3 className="text-[11px] font-bold uppercase tracking-widest text-zinc-300">Import Project JSON</h3>
                <p className="mt-1 truncate text-[10px] font-mono text-zinc-600">{pendingProjectImport.fileName}</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 text-zinc-500 hover:text-white"
                onClick={() => setPendingProjectImport(null)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="space-y-2">
              <Button
                type="button"
                variant="outline"
                className="h-auto w-full justify-start border-emerald-500/30 bg-emerald-500/10 px-3 py-3 text-left hover:bg-emerald-500/15 hover:text-emerald-100"
                onClick={onAppendPendingProjectImport}
              >
                <Plus className="h-4 w-4 text-emerald-300" />
                <span className="ml-2 flex min-w-0 flex-col items-start">
                  <span className="text-xs font-bold uppercase tracking-wider text-emerald-200">Add to Current Project</span>
                  <span className="mt-1 text-[10px] font-medium normal-case leading-snug text-emerald-100/70">
                    Appends imported scenes with new IDs. Existing scenes, clips, tracks, characters, and settings stay unchanged.
                  </span>
                </span>
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-auto w-full justify-start border-zinc-800 bg-zinc-900/70 px-3 py-3 text-left hover:bg-zinc-800 hover:text-zinc-100"
                onClick={onReplaceWithPendingProjectImport}
              >
                <Upload className="h-4 w-4 text-zinc-400" />
                <span className="ml-2 flex min-w-0 flex-col items-start">
                  <span className="text-xs font-bold uppercase tracking-wider text-zinc-200">Open as New Project</span>
                  <span className="mt-1 text-[10px] font-medium normal-case leading-snug text-zinc-500">
                    Replaces the open workspace with the imported JSON.
                  </span>
                </span>
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </>
  );
}
