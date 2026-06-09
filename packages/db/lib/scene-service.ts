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
  hasAnalysis: boolean;
  publishedAt?: string;
  publisherName?: string;
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
  published_at?: Date | string | null;
  published_by_user_id?: string | null;
};

type SavedSceneSummaryRow = Omit<SavedSceneRow, 'project'> & {
  thumbnail_url?: string | null;
  analysis_model?: string | null;
  analysis_report?: unknown;
  publisher_name?: string | null;
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
    hasAnalysis: Boolean(row.analysis_model || row.analysis_report),
    publishedAt: row.published_at ? new Date(row.published_at).toISOString() : undefined,
    publisherName: row.publisher_name || undefined,
  };
}

export async function listSavedScenes(onlyPublished = false): Promise<SavedSceneSummary[]> {
  await ensureSceneTable();
  const sql = getSql();
  const rows = await withSceneStorageTimeout(sql<SavedSceneSummaryRow[]>`
    select
      saved_scenes.id,
      saved_scenes.name,
      saved_scenes.project #>> '{scenes,0,thumbnailUrl}' as thumbnail_url,
      saved_scenes.project #>> '{scenes,0,analysisModel}' as analysis_model,
      saved_scenes.project #> '{scenes,0,analysisReport}' as analysis_report,
      saved_scenes.is_published,
      saved_scenes.published_at,
      saved_scenes.published_by_user_id,
      users.username as publisher_name,
      saved_scenes.created_at,
      saved_scenes.updated_at
    from timeline_private.saved_scenes
    left join timeline_private.users users
      on users.id = saved_scenes.published_by_user_id
    ${onlyPublished ? sql`where saved_scenes.is_published = true` : sql``}
    order by saved_scenes.updated_at desc
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
      project #>> '{scenes,0,analysisModel}' as analysis_model,
      project #> '{scenes,0,analysisReport}' as analysis_report,
      is_published,
      published_at,
      published_by_user_id,
      null::text as publisher_name,
      created_at,
      updated_at
  `, 'Saving scene');

  return toSummary(rows[0]);
}

export async function getSavedScene(id: string): Promise<SavedScene | null> {
  await ensureSceneTable();
  const sql = getSql();
  const rows = await withSceneStorageTimeout(sql<SavedSceneRow[]>`
    select id, name, project, is_published, published_at, published_by_user_id, created_at, updated_at
    from timeline_private.saved_scenes
    where id = ${id}
    limit 1
  `, 'Loading saved scene');
  const row = rows[0];

  if (!row) return null;

  return {
    ...toSummary({
      ...row,
      thumbnail_url: getSceneThumbnailUrl(row.project),
      analysis_model: row.project?.scenes?.[0]?.analysisModel,
      analysis_report: row.project?.scenes?.[0]?.analysisReport,
      published_at: row.published_at,
      published_by_user_id: row.published_by_user_id,
      is_published: row.is_published,
    }),
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
      project #>> '{scenes,0,analysisModel}' as analysis_model,
      project #> '{scenes,0,analysisReport}' as analysis_report,
      is_published,
      published_at,
      published_by_user_id,
      null::text as publisher_name,
      created_at,
      updated_at
  `, 'Updating saved scene thumbnail');

  return rows[0] ? toSummary(rows[0]) : null;
}

export async function updateSavedScenePublishStatus(id: string, isPublished: boolean, publisherUserId?: string): Promise<SavedSceneSummary | null> {
  await ensureSceneTable();
  const sql = getSql();
  const rows = await withSceneStorageTimeout(sql<SavedSceneSummaryRow[]>`
    update timeline_private.saved_scenes
    set
      is_published = ${isPublished},
      published_at = ${isPublished ? sql`coalesce(published_at, now())` : sql`null`},
      published_by_user_id = ${isPublished ? (publisherUserId || null) : null},
      updated_at = now()
    where id = ${id}
    returning
      id,
      name,
      project #>> '{scenes,0,thumbnailUrl}' as thumbnail_url,
      project #>> '{scenes,0,analysisModel}' as analysis_model,
      project #> '{scenes,0,analysisReport}' as analysis_report,
      is_published,
      published_at,
      published_by_user_id,
      (
        select username
        from timeline_private.users
        where users.id = timeline_private.saved_scenes.published_by_user_id
      ) as publisher_name,
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
