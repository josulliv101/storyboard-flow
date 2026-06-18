'use client';

import React from 'react';
import { Grid2X2, RefreshCw, Trash2 } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@storyboard/ui';

export type SceneLaunchContextMenuState = {
  type: 'item';
  dragKey: string;
  x: number;
  y: number;
} | {
  type: 'board';
  insertionIndex: number;
  x: number;
  y: number;
} | null;

interface SceneLaunchContextMenuProps {
  menu: SceneLaunchContextMenuState;
  isTrashOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onMoveToTrash: (dragKey: string) => void;
  onRestoreFromTrash: (dragKey: string) => void;
  onDeletePermanently: (dragKey: string) => void;
  onAddCollection: (insertionIndex: number) => void;
}

export function SceneLaunchContextMenu({
  menu,
  isTrashOpen,
  onOpenChange,
  onMoveToTrash,
  onRestoreFromTrash,
  onDeletePermanently,
  onAddCollection,
}: SceneLaunchContextMenuProps) {
  // Guard against Base UI's outside-click detection immediately closing
  // the menu. The right-click that opened the menu is picked up as an
  // outside pointer event by Base UI's Menu component, so we ignore the
  // first onOpenChange(false) that arrives right after opening.
  const openedAtRef = React.useRef<number>(0);

  React.useEffect(() => {
    if (menu) {
      openedAtRef.current = Date.now();
    }
  }, [menu]);

  const handleOpenChange = React.useCallback(
    (open: boolean) => {
      if (!open) {
        // Ignore close requests that arrive within 200ms of opening —
        // they're caused by the right-click itself being treated as an
        // outside interaction.
        const elapsed = Date.now() - openedAtRef.current;
        if (elapsed < 200) return;
      }
      onOpenChange(open);
    },
    [onOpenChange],
  );

  return (
    <DropdownMenu
      open={!!menu}
      onOpenChange={handleOpenChange}
    >
      {menu && (
        <DropdownMenuTrigger
          style={{
            position: 'fixed',
            left: menu.x,
            top: menu.y,
            width: 1,
            height: 1,
            opacity: 0,
            pointerEvents: 'none',
          }}
        />
      )}
      <DropdownMenuContent align="start" className="w-40 bg-[#111114] border-zinc-800 text-zinc-300 z-50">
        {menu?.type === 'board' ? (
          <DropdownMenuItem
            onClick={() => onAddCollection(menu.insertionIndex)}
            className="gap-2 focus:bg-zinc-800 focus:text-white cursor-pointer"
          >
            <Grid2X2 className="h-3.5 w-3.5" />
            Add Collection
          </DropdownMenuItem>
        ) : isTrashOpen ? (
          <>
            <DropdownMenuItem
              onClick={() => {
                if (menu?.type === 'item') {
                  onRestoreFromTrash(menu.dragKey);
                  onOpenChange(false);
                }
              }}
              className="gap-2 focus:bg-zinc-800 focus:text-white cursor-pointer"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Restore Item
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                if (menu?.type === 'item') {
                  onDeletePermanently(menu.dragKey);
                  onOpenChange(false);
                }
              }}
              className="gap-2 focus:bg-red-950/70 focus:text-red-200 text-red-400 cursor-pointer"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete Permanently
            </DropdownMenuItem>
          </>
        ) : (
          <DropdownMenuItem
            onClick={() => {
              if (menu?.type === 'item') {
                onMoveToTrash(menu.dragKey);
                onOpenChange(false);
              }
            }}
            className="gap-2 focus:bg-zinc-800 focus:text-white cursor-pointer"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Move to Trash
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
