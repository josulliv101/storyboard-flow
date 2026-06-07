import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { getSql, ensureSceneTable, withSceneStorageTimeout } from './db-client';

export type TimelineProjectJson = any;

export type SavedSceneSummary = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  thumbnailUrl?: string;
  isPublished: boolean;
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
  is_published: boolean;
};

type SavedSceneSummaryRow = Omit<SavedSceneRow, 'project'> & {
  thumbnail_url?: string | null;
};

function getSceneThumbnailUrl(project?: TimelineProjectJson) {
  return project?.scenes
    ?.find((scene: any) => typeof scene.thumbnailUrl === 'string' && scene.thumbnailUrl.trim().length > 0)
    ?.thumbnailUrl;
}

function toSummary(row: SavedSceneSummaryRow): SavedSceneSummary {
  return {
    id: row.id,
    name: row.name,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    thumbnailUrl: row.thumbnail_url || undefined,
    isPublished: !!row.is_published,
  };
}

export async function listSavedScenes(onlyPublished = false): Promise<SavedSceneSummary[]> {
  await ensureSceneTable();
  const sql = getSql();
  const rows = await withSceneStorageTimeout(sql<SavedSceneSummaryRow[]>`
    select
      id,
      name,
      project #>> '{scenes,0,thumbnailUrl}' as thumbnail_url,
      is_published,
      created_at,
      updated_at
    from timeline_private.saved_scenes
    ${onlyPublished ? sql`where is_published = true` : sql``}
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
    insert into timeline_private.saved_scenes (id, name, project, is_published)
    values (${randomUUID()}, ${name}, ${sql.json(serializedProject)}, false)
    returning
      id,
      name,
      project #>> '{scenes,0,thumbnailUrl}' as thumbnail_url,
      is_published,
      created_at,
      updated_at
  `, 'Saving scene');

  return toSummary(rows[0]);
}

export async function getSavedScene(id: string): Promise<SavedScene | null> {
  await ensureSceneTable();
  const sql = getSql();
  const rows = await withSceneStorageTimeout(sql<SavedSceneRow[]>`
    select id, name, project, is_published, created_at, updated_at
    from timeline_private.saved_scenes
    where id = ${id}
    limit 1
  `, 'Loading saved scene');
  const row = rows[0];

  if (!row) return null;

  return {
    ...toSummary({ ...row, thumbnail_url: getSceneThumbnailUrl(row.project), is_published: row.is_published }),
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
      is_published,
      created_at,
      updated_at
  `, 'Updating saved scene thumbnail');

  return rows[0] ? toSummary(rows[0]) : null;
}

export async function updateSavedScenePublishStatus(id: string, isPublished: boolean): Promise<SavedSceneSummary | null> {
  await ensureSceneTable();
  const sql = getSql();
  const rows = await withSceneStorageTimeout(sql<SavedSceneSummaryRow[]>`
    update timeline_private.saved_scenes
    set
      is_published = ${isPublished},
      updated_at = now()
    where id = ${id}
    returning
      id,
      name,
      project #>> '{scenes,0,thumbnailUrl}' as thumbnail_url,
      is_published,
      created_at,
      updated_at
  `, 'Updating saved scene publish status');

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
