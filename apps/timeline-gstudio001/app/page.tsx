"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  CircleAlert,
  Clapperboard,
  Clock3,
  FolderOpen,
  LoaderCircle,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/core/button";
import { Skeleton } from "@/components/core/skeleton";
import { toast } from "@/components/core/sonner";
import { LoadProjectButton } from "@/components/projects/load-project-button";
import { cn } from "@/lib/utils";

type TimelineProjectSummary = {
  id: string;
  title: string;
  description?: string;
  clipCount: number;
  thumbnailUrl?: string;
  createdAt?: string;
  updatedAt?: string;
};

function formatUpdatedAt(value?: string) {
  if (!value) return "No save timestamp";

  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return "No save timestamp";
  }
}

function ProjectCardSkeleton() {
  return (
    <div
      aria-hidden="true"
      data-project-card-skeleton
      className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/55"
    >
      <Skeleton className="aspect-video w-full rounded-none border-b border-zinc-800" />
      <div className="grid gap-3 p-4">
        <div className="grid gap-2">
          <Skeleton className="h-4 w-3/5" />
          <Skeleton className="h-3 w-4/5" />
        </div>
        <div className="flex items-center justify-between gap-3">
          <Skeleton className="h-3 w-14" />
          <Skeleton className="h-3 w-28" />
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const router = useRouter();
  const [projects, setProjects] = useState<TimelineProjectSummary[]>([]);
  const [projectTitle, setProjectTitle] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Pure request: resolves to the project list or throws — it never touches
  // state, so the mount effect can consume it through promise CALLBACKS
  // (state changes only when the external request answers) and Refresh can
  // wrap it with its own synchronous loading reset.
  const requestProjects = useCallback(async (): Promise<TimelineProjectSummary[]> => {
    const response = await fetch("/api/timelines", { cache: "no-store" });
    const result = (await response.json().catch(() => ({}))) as {
      projects?: TimelineProjectSummary[];
      error?: string;
    };

    if (!response.ok) {
      throw new Error(result.error || "Unable to load projects.");
    }

    return result.projects || [];
  }, []);

  useEffect(() => {
    // Mount needs no sync loading reset — isLoading INITIALIZES true. The
    // cancelled flag keeps a slow answer from writing into an unmounted tree.
    let cancelled = false;
    requestProjects()
      .then((next) => {
        if (cancelled) return;
        setProjects(next);
        setLoadError(null);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : "Unable to load projects.");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [requestProjects]);

  // Refresh (an event handler) re-raises the loading flag before refetching.
  const reloadProjects = useCallback(() => {
    setIsLoading(true);
    setLoadError(null);
    requestProjects()
      .then((next) => {
        setProjects(next);
      })
      .catch((error: unknown) => {
        setLoadError(error instanceof Error ? error.message : "Unable to load projects.");
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [requestProjects]);

  const handleDeleteProject = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    e.preventDefault();

    const project = projects.find((p) => p.id === id);
    if (!project) return;

    if (
      !window.confirm(
        `Are you sure you want to delete the project "${project.title}"? This will also delete all of its nested timeline collections and cannot be undone.`
      )
    ) {
      return;
    }

    try {
      const response = await fetch(`/api/timelines/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        // The API answers JSON. Reading it as text put the raw envelope —
        // `{"error":"…"}` — into the message the user was shown.
        const result = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(result.error || "The server refused the delete.");
      }

      setProjects((prev) => prev.filter((p) => p.id !== id));
      toast.success(`Deleted "${project.title}".`);
    } catch (error) {
      toast.error(
        `Could not delete "${project.title}": ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
    }
  };

  const handleCreateProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isCreating) return;

    setIsCreating(true);
    setLoadError(null);

    try {
      const response = await fetch("/api/timelines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: projectTitle.trim() || "Untitled Project",
        }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        project?: { id: string };
        error?: string;
      };

      if (!response.ok || !result.project) {
        throw new Error(result.error || "Unable to create project.");
      }

      router.push(`/timeline/${encodeURIComponent(result.project.id)}/graph`);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Unable to create project.");
    } finally {
      setIsCreating(false);
    }
  };

  const initialLoading = isLoading && projects.length === 0;

  return (
    <div className="mx-auto grid w-full max-w-[1400px] gap-6 pt-7 animate-fade-in">
      <header className="flex flex-col gap-4 border-b border-zinc-800 pb-5 md:flex-row md:items-end md:justify-between">
        <div className="grid min-w-0 flex-1 gap-2">
          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.24em] text-blue-400">
            <FolderOpen className="h-4 w-4" />
            Projects
          </div>
          <h1 className="text-2xl font-semibold text-zinc-50">Timeline Projects</h1>
          <p className="max-w-2xl text-sm text-zinc-400">
            Open a saved timeline or start a clean project.
          </p>
        </div>

        <div className="flex w-full flex-col items-stretch gap-2 md:w-[420px] md:shrink-0">
        <form
          onSubmit={handleCreateProject}
          className="flex w-full flex-col gap-2 rounded-lg border border-zinc-800 bg-zinc-900/55 p-3 sm:flex-row"
        >
          <label htmlFor="project-title" className="sr-only">
            Project title
          </label>
          <input
            id="project-title"
            value={projectTitle}
            onChange={(event) => setProjectTitle(event.target.value)}
            maxLength={80}
            placeholder="New project name"
            className="h-9 min-w-0 flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-blue-500"
          />
          <Button
            type="submit"
            disabled={isCreating}
            className="h-9 shrink-0 gap-2 bg-blue-500 px-3 text-xs font-bold uppercase tracking-widest text-zinc-950 hover:bg-blue-400"
          >
            {isCreating ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            New Project
          </Button>
        </form>
        {/* OUTSIDE the create form, deliberately — a submit-typed button inside
            it would create an empty project on Enter. Under it rather than
            beside it so the everyday verb keeps the full width it had. */}
        <div className="flex justify-end">
          <LoadProjectButton />
        </div>
        </div>
      </header>

      <section
        aria-busy={initialLoading}
        aria-labelledby="saved-projects-heading"
        className="grid gap-4"
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2
              id="saved-projects-heading"
              className="text-xs font-bold uppercase tracking-widest text-zinc-400"
            >
              Saved Projects
            </h2>
            <p className="mt-1 text-[10px] font-mono uppercase tracking-widest text-zinc-600">
              {initialLoading
                ? "Project library"
                : `${projects.length} ${projects.length === 1 ? "project" : "projects"}`}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-2 border-zinc-800 bg-zinc-950 text-zinc-300 hover:bg-zinc-900"
            onClick={reloadProjects}
            disabled={isLoading}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
            Refresh
          </Button>
        </div>

        {loadError ? (
          <div className="flex items-center gap-3 rounded-lg border border-red-500/25 bg-red-500/10 p-4 text-sm text-red-100">
            <CircleAlert className="h-4 w-4 shrink-0 text-red-300" />
            <span>{loadError}</span>
          </div>
        ) : null}

        {initialLoading ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            <span className="sr-only">Loading projects</span>
            {Array.from({ length: 3 }, (_, index) => (
              <ProjectCardSkeleton key={index} />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <div className="grid min-h-56 place-items-center rounded-lg border border-dashed border-zinc-800 bg-zinc-900/25 p-6 text-center">
            <div className="grid justify-items-center gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-lg border border-zinc-800 bg-zinc-950 text-zinc-500">
                <Clapperboard className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-semibold text-zinc-200">No saved projects yet</p>
                <p className="mt-1 text-xs text-zinc-500">
                  Name a project above, then create it to begin.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {projects.map((project) => (
              <div
                key={project.id}
                className="relative group overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/55 shadow-xl shadow-black/20 transition-all duration-200 hover:border-blue-500/55 hover:bg-zinc-900"
              >
                {/* Link overlay covering the whole card area. It NEEDS a name:
                    as a childless anchor its accessible name was empty, so a
                    screen reader announced the card's only action as an
                    unnamed "link" with no way to tell which project it opened
                    (WCAG 2.4.4). The visible <h3> below is a heading, not this
                    control's label. */}
                <Link
                  href={`/timeline/${encodeURIComponent(project.id)}/graph`}
                  className="absolute inset-0 z-10 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                >
                  <span className="sr-only">Open project {project.title}</span>
                </Link>

                <div className="relative aspect-video overflow-hidden border-b border-zinc-800 bg-zinc-950">
                  {project.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={project.thumbnailUrl}
                      alt=""
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                    />
                  ) : (
                    <div className="grid h-full w-full place-items-center">
                      <Clapperboard className="h-8 w-8 text-zinc-700" />
                    </div>
                  )}
                  {/* Delete button positioned absolute top-right, z-20 so it sits on top of Link overlay */}
                  {/* Hover-revealed, but it must also reveal on FOCUS: with
                      only `group-hover:opacity-100` a keyboard user tabbed onto
                      an invisible control with no focus indicator, one Enter
                      away from a cascade delete (WCAG 2.4.7). `title` is not a
                      reliable accessible name either, hence aria-label. */}
                  <button
                    type="button"
                    onClick={(e) => handleDeleteProject(e, project.id)}
                    aria-label={`Delete project ${project.title}`}
                    className="absolute top-2.5 right-2.5 z-20 flex h-7 w-7 items-center justify-center rounded-md border border-zinc-800 bg-zinc-900/90 hover:bg-red-600/90 text-zinc-400 hover:text-white transition-all opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                    title="Delete project"
                  >
                    <Trash2 aria-hidden="true" className="h-4 w-4" />
                  </button>
                </div>
                <div className="grid gap-3 p-4">
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-semibold text-zinc-100">
                      {project.title}
                    </h3>
                    {project.description ? (
                      <p className="mt-1 line-clamp-2 text-xs text-zinc-500">
                        {project.description}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex items-center justify-between gap-3 text-[10px] font-mono uppercase tracking-widest text-zinc-600">
                    <span>{project.clipCount} clips</span>
                    <span className="flex items-center gap-1 truncate">
                      <Clock3 className="h-3 w-3 shrink-0" />
                      {formatUpdatedAt(project.updatedAt)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
