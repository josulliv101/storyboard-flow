"use client";

import { LogOut, User } from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/core/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/core/dropdown-menu";
import { toast } from "@/components/core/sonner";
import { cn } from "@/lib/utils";

/**
 * Who is signed in, and the way out.
 *
 * It was the last tile in the icon rail, at the bottom of the sidebar. It sits
 * in the board's header row now, after undo/redo — the end of the run of
 * controls that are about YOU and the board rather than about the work in it.
 *
 * NO FENCE before it, unlike every other group boundary in this row. A fence
 * separates controls that could be confused for one another; nobody mistakes an
 * avatar for a button that edits the board, and the face is its own boundary.
 *
 * THE SIGNED-OUT FACE IS A PERSON, not a letter. Signed in without a picture
 * still shows the initial, which says something; signed out has nothing to take
 * an initial FROM, and `initialOf` fell back to a hard-coded "U" — a "U" in a
 * circle reads as a user named U rather than as nobody.
 */
export function GraphAccountControl() {
  const { user, logout } = useAuth();
  const label = user?.name || user?.email || "Account";

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={user ? `Account — ${label}` : "Account — signed out"}
          title={user?.email ? `Signed in as ${user.email}` : "Account"}
          data-graph-account
          // `h-8 w-8` to match the header's other icon controls, with the face
          // filling it: the avatar IS the control, so an inset would leave a
          // ring of dead button around a picture that already reads as round.
          className="h-8 w-8 shrink-0 rounded-full p-0 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
        >
          {user?.picture ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={user.picture}
              alt=""
              className="h-full w-full rounded-full border border-zinc-700 object-cover transition-colors hover:border-zinc-500"
            />
          ) : (
            <span
              className={cn(
                "flex h-full w-full items-center justify-center rounded-full border border-zinc-700",
                "bg-zinc-800/60 text-[11px] font-bold text-zinc-400 transition-colors",
                "hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-100",
              )}
            >
              {user ? (
                (user.name?.[0] ?? user.email?.[0] ?? "?").toUpperCase()
              ) : (
                <User aria-hidden className="h-4 w-4" strokeWidth={1.8} />
              )}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="bottom"
        align="end"
        className="w-64 border-zinc-800/80 bg-zinc-950/95 text-zinc-100"
      >
        <div className="flex min-w-0 flex-col px-2 py-1.5">
          <p className="truncate text-xs font-semibold text-zinc-100">
            {user?.name || (user ? "User" : "Signed out")}
          </p>
          {user?.email ? (
            <p className="truncate text-[10px] font-medium text-zinc-500">{user.email}</p>
          ) : null}
        </div>
        {user ? (
          <>
            <DropdownMenuSeparator className="bg-zinc-800/60" />
            <DropdownMenuItem
              data-graph-account-sign-out
              onSelect={() => {
                void logout().then(
                  () => toast("Signed out.", { id: "auth-signed-out" }),
                  () => toast("Unable to sign out.", { id: "auth-signed-out" }),
                );
              }}
              className="text-zinc-400 focus:bg-red-500/10 focus:text-red-400"
            >
              <LogOut aria-hidden className="h-3.5 w-3.5" />
              Sign Out
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
