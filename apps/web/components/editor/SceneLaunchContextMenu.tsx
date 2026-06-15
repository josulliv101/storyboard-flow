'use client';

import { RefreshCw, Trash2 } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@storyboard/ui';

export type SceneLaunchContextMenuState = {
  dragKey: string;
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
}

export function SceneLaunchContextMenu({
  menu,
  isTrashOpen,
  onOpenChange,
  onMoveToTrash,
  onRestoreFromTrash,
  onDeletePermanently,
}: SceneLaunchContextMenuProps) {
  return (
    <DropdownMenu
      open={!!menu}
      onOpenChange={onOpenChange}
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
        {isTrashOpen ? (
          <>
            <DropdownMenuItem
              onClick={() => {
                if (menu) {
                  onRestoreFromTrash(menu.dragKey);
                }
              }}
              className="gap-2 focus:bg-zinc-800 focus:text-white cursor-pointer"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Restore Item
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                if (menu) {
                  onDeletePermanently(menu.dragKey);
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
              if (menu) {
                onMoveToTrash(menu.dragKey);
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
