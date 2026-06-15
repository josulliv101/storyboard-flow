'use client';

import { Loader2, Shield, X } from 'lucide-react';
import { motion } from 'motion/react';
import { Button } from '@storyboard/ui';
import { cn } from '@/lib/utils';

export type AdminUserRole = 'viewer' | 'editor' | 'admin';

export type AdminUserSummary = {
  id: string;
  username: string;
  role: AdminUserRole;
  createdAt: string;
};

type AdminUsersModalProps = {
  allUsers: AdminUserSummary[];
  currentUserId?: string;
  isLoadingUsers: boolean;
  onClose: () => void;
  onUpdateUserRole: (userId: string, role: AdminUserRole) => void;
};

export function AdminUsersModal({
  allUsers,
  currentUserId,
  isLoadingUsers,
  onClose,
  onUpdateUserRole,
}: AdminUsersModalProps) {
  return (
    <motion.div
      key="admin-modal"
      className="fixed inset-0 z-[330] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onPointerDown={onClose}
    >
      <motion.section
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-title"
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        className="flex max-h-[min(560px,calc(100vh-4rem))] w-full max-w-2xl flex-col rounded-lg border border-zinc-800 bg-[#111114] shadow-2xl"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-zinc-800 p-4">
          <div>
            <h2 id="admin-title" className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-zinc-200">
              <Shield className="h-4 w-4 text-indigo-300" />
              User Management Panel
            </h2>
            <p className="mt-1 text-[10px] text-zinc-500">Review system users and promote roles (viewer, editor, admin).</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 text-zinc-550 hover:text-white"
            onClick={onClose}
            aria-label="Close admin panel"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 scrollbar-thin scrollbar-thumb-zinc-850">
          {isLoadingUsers ? (
            <div className="flex py-12 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
            </div>
          ) : (
            <div className="overflow-hidden rounded-md border border-zinc-800 bg-zinc-950/40">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-zinc-850 bg-zinc-950 text-[10px] font-bold uppercase tracking-widest text-zinc-550 font-mono">
                    <th className="p-3">Username</th>
                    <th className="p-3">Role</th>
                    <th className="p-3">Created At</th>
                  </tr>
                </thead>
                <tbody>
                  {allUsers.map((user) => {
                    const isSelf = user.id === currentUserId;
                    return (
                      <tr key={user.id} className="border-b border-zinc-850 hover:bg-zinc-900/40 transition-colors">
                        <td className="p-3 font-semibold text-zinc-200">
                          {user.username} {isSelf && <span className="text-[9px] text-zinc-500 font-mono font-normal">(you)</span>}
                        </td>
                        <td className="p-3">
                          <select
                            disabled={isSelf}
                            value={user.role}
                            onChange={(e) => onUpdateUserRole(user.id, e.target.value as AdminUserRole)}
                            className={cn(
                              "bg-zinc-950 border text-xs rounded px-2 py-1 outline-none font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed",
                              user.role === 'admin' ? "border-indigo-500/30 text-indigo-300 focus:border-indigo-400" :
                              user.role === 'editor' ? "border-emerald-500/30 text-emerald-300 focus:border-emerald-400" :
                              "border-zinc-800 text-zinc-400 focus:border-zinc-700"
                            )}
                          >
                            <option value="viewer">Viewer</option>
                            <option value="editor">Editor</option>
                            <option value="admin">Admin</option>
                          </select>
                        </td>
                        <td className="p-3 text-zinc-500 font-mono text-[10px]">
                          {new Date(user.createdAt).toLocaleDateString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </motion.section>
    </motion.div>
  );
}
