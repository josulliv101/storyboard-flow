import postgres from 'postgres';

const globals = globalThis as typeof globalThis & {
  savedScenesSql?: ReturnType<typeof postgres>;
  savedScenesSqlLabel?: string;
  savedScenesTableReady?: Promise<void>;
  savedScenesStorageVersion?: number;
};

const SCENE_STORAGE_TIMEOUT_MS = 8_000;
const SCENE_STORAGE_GLOBAL_VERSION = 4;

export async function withSceneStorageTimeout<T>(operation: Promise<T>, label: string): Promise<T> {
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

export function getSql() {
  if (!globals.savedScenesSql) {
    const [firstConnection] = getRequiredConnectionStrings();
    globals.savedScenesSql = createSql(firstConnection.connectionString);
    globals.savedScenesSqlLabel = firstConnection.label;
  }

  return globals.savedScenesSql;
}

export async function closeSql(sql: ReturnType<typeof postgres>) {
  try {
    await sql.end({ timeout: 0 });
  } catch {
    // Ignore close errors while rotating through candidate connection strings.
  }
}

export async function ensureSceneTable() {
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

          // Migrate is_published column
          await withSceneStorageTimeout(sql`
            alter table timeline_private.saved_scenes
            add column if not exists is_published boolean not null default false
          `, `Migrating is_published column (${candidate.label})`).catch(() => {});

          // Initialize auth tables as well to keep user and session schema verified
          const { ensureAuthTables } = await import('./auth-service');
          await withSceneStorageTimeout(ensureAuthTables(sql), `Auth storage initialization (${candidate.label})`);

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
