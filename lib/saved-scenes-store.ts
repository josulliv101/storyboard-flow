import 'server-only';

import { randomUUID } from 'node:crypto';
import postgres from 'postgres';

import type { TimelineProjectJson } from '@/lib/timeline-context';

export type SavedSceneSummary = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  thumbnailUrl?: string;
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

type SavedSceneSummaryRow = Omit<SavedSceneRow, 'project'> & {
  thumbnail_url?: string | null;
};

const globals = globalThis as typeof globalThis & {
  savedScenesSql?: ReturnType<typeof postgres>;
  savedScenesSqlLabel?: string;
  savedScenesTableReady?: Promise<void>;
  savedScenesStorageVersion?: number;
};

const SCENE_STORAGE_TIMEOUT_MS = 8_000;
const SCENE_STORAGE_GLOBAL_VERSION = 2;

async function withSceneStorageTimeout<T>(operation: Promise<T>, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`${label} timed out. Check the Postgres connection and restart the dev server if .env changed.`));
        }, SCENE_STORAGE_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function getConnectionStrings() {
  const candidates = [
    ['POSTGRES_URL_NON_POOLING', process.env.POSTGRES_URL_NON_POOLING],
    ['POSTGRES_URL', process.env.POSTGRES_URL],
    ['POSTGRES_PRISMA_URL', process.env.POSTGRES_PRISMA_URL],
  ] as const;
  const seen = new Set<string>();

  return candidates.flatMap(([label, value]) => {
    const connectionString = value?.trim();

    if (!connectionString || seen.has(connectionString)) return [];
    seen.add(connectionString);

    return [{ label, connectionString }];
  });
}

function getRequiredConnectionStrings() {
  const connectionStrings = getConnectionStrings();

  if (connectionStrings.length === 0) {
    throw new Error('Scene storage is not configured. Add a Supabase Postgres connection string.');
  }

  return connectionStrings;
}

function createSql(connectionString: string) {
  return postgres(connectionString, {
    max: 1,
    prepare: false,
    ssl: 'require',
    connect_timeout: Math.ceil(SCENE_STORAGE_TIMEOUT_MS / 1000),
  });
}

function getSql() {
  if (!globals.savedScenesSql) {
    const [firstConnection] = getRequiredConnectionStrings();
    globals.savedScenesSql = createSql(firstConnection.connectionString);
    globals.savedScenesSqlLabel = firstConnection.label;
  }

  return globals.savedScenesSql;
}

async function closeSql(sql: ReturnType<typeof postgres>) {
  try {
    await sql.end({ timeout: 0 });
  } catch {
    // Ignore close errors while rotating through candidate connection strings.
  }
}

async function ensureSceneTable() {
  if (globals.savedScenesStorageVersion !== SCENE_STORAGE_GLOBAL_VERSION) {
    const previousSql = globals.savedScenesSql;
    globals.savedScenesSql = undefined;
    globals.savedScenesSqlLabel = undefined;
    globals.savedScenesTableReady = undefined;
    globals.savedScenesStorageVersion = SCENE_STORAGE_GLOBAL_VERSION;

    if (previousSql) {
      await closeSql(previousSql);
    }
  }

  if (!globals.savedScenesTableReady) {
    globals.savedScenesTableReady = (async () => {
      const errors: string[] = [];

      for (const candidate of getRequiredConnectionStrings()) {
        const sql = createSql(candidate.connectionString);

        try {
          await withSceneStorageTimeout(sql`create schema if not exists timeline_private`, `Scene storage initialization (${candidate.label})`);
          await withSceneStorageTimeout(sql`
            create table if not exists timeline_private.saved_scenes (
              id text primary key,
              name text not null,
              project jsonb not null,
              created_at timestamptz not null default now(),
              updated_at timestamptz not null default now()
            )
          `, `Scene storage initialization (${candidate.label})`);

          if (globals.savedScenesSql && globals.savedScenesSql !== sql) {
            await closeSql(globals.savedScenesSql);
          }

          globals.savedScenesSql = sql;
          globals.savedScenesSqlLabel = candidate.label;
          return;
        } catch (error) {
          errors.push(`${candidate.label}: ${error instanceof Error ? error.message : 'Unknown error'}`);
          await closeSql(sql);
        }
      }

      globals.savedScenesSql = undefined;
      globals.savedScenesSqlLabel = undefined;
      throw new Error(`Unable to connect to scene storage. Tried ${errors.join('; ')}`);
    })().catch((error) => {
      globals.savedScenesTableReady = undefined;
      throw error;
    });
  }

  try {
    await withSceneStorageTimeout(globals.savedScenesTableReady, 'Scene storage initialization');
  } catch (error) {
    globals.savedScenesTableReady = undefined;
    throw error;
  }
}

function getSceneThumbnailUrl(project?: TimelineProjectJson) {
  return project?.scenes
    ?.find(scene => typeof scene.thumbnailUrl === 'string' && scene.thumbnailUrl.trim().length > 0)
    ?.thumbnailUrl;
}

function toSummary(row: SavedSceneSummaryRow): SavedSceneSummary {
  return {
    id: row.id,
    name: row.name,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    thumbnailUrl: row.thumbnail_url || undefined,
  };
}

export async function listSavedScenes(): Promise<SavedSceneSummary[]> {
  await ensureSceneTable();
  const sql = getSql();
  const rows = await withSceneStorageTimeout(sql<SavedSceneSummaryRow[]>`
    select
      id,
      name,
      project #>> '{scenes,0,thumbnailUrl}' as thumbnail_url,
      created_at,
      updated_at
    from timeline_private.saved_scenes
    order by updated_at desc
    limit 30
  `, 'Loading saved scenes');

  return rows.map(toSummary);
}

export async function saveScene(name: string, project: TimelineProjectJson): Promise<SavedSceneSummary> {
  await ensureSceneTable();
  const sql = getSql();
  const serializedProject = JSON.parse(JSON.stringify(project)) as postgres.JSONValue;
  const rows = await withSceneStorageTimeout(sql<SavedSceneSummaryRow[]>`
    insert into timeline_private.saved_scenes (id, name, project)
    values (${randomUUID()}, ${name}, ${sql.json(serializedProject)})
    returning
      id,
      name,
      project #>> '{scenes,0,thumbnailUrl}' as thumbnail_url,
      created_at,
      updated_at
  `, 'Saving scene');

  return toSummary(rows[0]);
}

export async function getSavedScene(id: string): Promise<SavedScene | null> {
  await ensureSceneTable();
  const sql = getSql();
  const rows = await withSceneStorageTimeout(sql<SavedSceneRow[]>`
    select id, name, project, created_at, updated_at
    from timeline_private.saved_scenes
    where id = ${id}
    limit 1
  `, 'Loading saved scene');
  const row = rows[0];

  if (!row) return null;

  return {
    ...toSummary({ ...row, thumbnail_url: getSceneThumbnailUrl(row.project) }),
    project: row.project,
  };
}

export async function updateSavedSceneThumbnail(id: string, thumbnailUrl: string): Promise<SavedSceneSummary | null> {
  await ensureSceneTable();
  const sql = getSql();
  const rows = await withSceneStorageTimeout(sql<SavedSceneSummaryRow[]>`
    update timeline_private.saved_scenes
    set
      project = jsonb_set(project, '{scenes,0,thumbnailUrl}', ${sql.json(thumbnailUrl)}, true),
      updated_at = now()
    where id = ${id}
    returning
      id,
      name,
      project #>> '{scenes,0,thumbnailUrl}' as thumbnail_url,
      created_at,
      updated_at
  `, 'Updating saved scene thumbnail');

  return rows[0] ? toSummary(rows[0]) : null;
}

export async function getOtherSavedSceneProjects(id: string): Promise<TimelineProjectJson[]> {
  await ensureSceneTable();
  const sql = getSql();
  const rows = await withSceneStorageTimeout(sql<Pick<SavedSceneRow, 'project'>[]>`
    select project
    from timeline_private.saved_scenes
    where id <> ${id}
  `, 'Loading saved scene references');

  return rows.map(row => row.project);
}

export async function deleteSavedScene(id: string): Promise<boolean> {
  await ensureSceneTable();
  const sql = getSql();
  const rows = await withSceneStorageTimeout(sql<{ id: string }[]>`
    delete from timeline_private.saved_scenes
    where id = ${id}
    returning id
  `, 'Deleting saved scene');

  return rows.length > 0;
}
