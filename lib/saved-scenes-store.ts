import 'server-only';

import { randomUUID } from 'node:crypto';
import postgres from 'postgres';

import type { TimelineProjectJson } from '@/lib/timeline-context';

export type SavedSceneSummary = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type SavedScene = SavedSceneSummary & {
  project: TimelineProjectJson;
};

type SavedSceneRow = {
  id: string;
  name: string;
  project: TimelineProjectJson;
  created_at: Date | string;
  updated_at: Date | string;
};

const globals = globalThis as typeof globalThis & {
  savedScenesSql?: ReturnType<typeof postgres>;
  savedScenesTableReady?: Promise<void>;
};

function getConnectionString() {
  const connectionString = process.env.POSTGRES_URL
    || process.env.POSTGRES_PRISMA_URL
    || process.env.POSTGRES_URL_NON_POOLING;

  if (!connectionString) {
    throw new Error('Scene storage is not configured. Add a Supabase Postgres connection string.');
  }

  return connectionString;
}

function getSql() {
  if (!globals.savedScenesSql) {
    globals.savedScenesSql = postgres(getConnectionString(), {
      max: 1,
      prepare: false,
      ssl: 'require',
    });
  }

  return globals.savedScenesSql;
}

async function ensureSceneTable() {
  if (!globals.savedScenesTableReady) {
    const sql = getSql();
    globals.savedScenesTableReady = (async () => {
      await sql`create schema if not exists timeline_private`;
      await sql`
        create table if not exists timeline_private.saved_scenes (
          id text primary key,
          name text not null,
          project jsonb not null,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        )
      `;
    })().catch((error) => {
      globals.savedScenesTableReady = undefined;
      throw error;
    });
  }

  await globals.savedScenesTableReady;
}

function toSummary(row: Omit<SavedSceneRow, 'project'>): SavedSceneSummary {
  return {
    id: row.id,
    name: row.name,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export async function listSavedScenes(): Promise<SavedSceneSummary[]> {
  await ensureSceneTable();
  const sql = getSql();
  const rows = await sql<Omit<SavedSceneRow, 'project'>[]>`
    select id, name, created_at, updated_at
    from timeline_private.saved_scenes
    order by updated_at desc
    limit 30
  `;

  return rows.map(toSummary);
}

export async function saveScene(name: string, project: TimelineProjectJson): Promise<SavedSceneSummary> {
  await ensureSceneTable();
  const sql = getSql();
  const serializedProject = JSON.parse(JSON.stringify(project)) as postgres.JSONValue;
  const rows = await sql<Omit<SavedSceneRow, 'project'>[]>`
    insert into timeline_private.saved_scenes (id, name, project)
    values (${randomUUID()}, ${name}, ${sql.json(serializedProject)})
    returning id, name, created_at, updated_at
  `;

  return toSummary(rows[0]);
}

export async function getSavedScene(id: string): Promise<SavedScene | null> {
  await ensureSceneTable();
  const sql = getSql();
  const rows = await sql<SavedSceneRow[]>`
    select id, name, project, created_at, updated_at
    from timeline_private.saved_scenes
    where id = ${id}
    limit 1
  `;
  const row = rows[0];

  if (!row) return null;

  return {
    ...toSummary(row),
    project: row.project,
  };
}

export async function getOtherSavedSceneProjects(id: string): Promise<TimelineProjectJson[]> {
  await ensureSceneTable();
  const sql = getSql();
  const rows = await sql<Pick<SavedSceneRow, 'project'>[]>`
    select project
    from timeline_private.saved_scenes
    where id <> ${id}
  `;

  return rows.map(row => row.project);
}

export async function deleteSavedScene(id: string): Promise<boolean> {
  await ensureSceneTable();
  const sql = getSql();
  const rows = await sql<{ id: string }[]>`
    delete from timeline_private.saved_scenes
    where id = ${id}
    returning id
  `;

  return rows.length > 0;
}
