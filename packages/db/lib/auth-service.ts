import crypto from 'node:crypto';
import postgres from 'postgres';
import { getSql, ensureSceneTable } from './db-client';

export type UserRole = 'viewer' | 'editor' | 'admin';

export type User = {
  id: string;
  username: string;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
};

export type Session = {
  token: string;
  userId: string;
  expiresAt: string;
  createdAt: string;
};

export async function ensureAuthTables(sql: postgres.Sql) {
  // Ensure the schema exists
  await sql`create schema if not exists timeline_private`;

  // Create users table
  await sql`
    create table if not exists timeline_private.users (
      id text primary key,
      username text unique not null,
      password_hash text not null,
      salt text not null,
      role text not null check (role in ('viewer', 'editor', 'admin')),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `;

  // Create sessions table
  await sql`
    create table if not exists timeline_private.sessions (
      token text primary key,
      user_id text not null references timeline_private.users(id) on delete cascade,
      expires_at timestamptz not null,
      created_at timestamptz not null default now()
    )
  `;
}

function hashPassword(password: string, salt: string): string {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
}

export async function createUser(username: string, password: string): Promise<User> {
  await ensureSceneTable();
  const sql = getSql();
  
  const cleanUsername = username.trim().toLowerCase();
  if (!cleanUsername) {
    throw new Error('Username cannot be empty');
  }
  if (password.length < 6) {
    throw new Error('Password must be at least 6 characters long');
  }

  const countResult = await sql`
    select count(*)::int as count from timeline_private.users
  `;
  const isFirstUser = countResult[0].count === 0;
  const role: UserRole = isFirstUser ? 'admin' : 'viewer';

  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = hashPassword(password, salt);
  const userId = crypto.randomUUID();

  try {
    const rows = await sql`
      insert into timeline_private.users (id, username, password_hash, salt, role)
      values (${userId}, ${cleanUsername}, ${passwordHash}, ${salt}, ${role})
      returning id, username, role, created_at, updated_at
    `;
    
    const row = rows[0];
    return {
      id: row.id,
      username: row.username,
      role: row.role as UserRole,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  } catch (error: any) {
    if (error.code === '23505') {
      throw new Error('Username is already taken');
    }
    throw error;
  }
}

export async function verifyUser(username: string, password: string): Promise<User | null> {
  await ensureSceneTable();
  const sql = getSql();
  const cleanUsername = username.trim().toLowerCase();
  
  const rows = await sql`
    select id, username, password_hash, salt, role, created_at, updated_at
    from timeline_private.users
    where username = ${cleanUsername}
    limit 1
  `;
  
  const row = rows[0];
  if (!row) return null;
  
  const hash = hashPassword(password, row.salt);
  if (hash !== row.password_hash) {
    return null;
  }
  
  return {
    id: row.id,
    username: row.username,
    role: row.role as UserRole,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export async function createSession(userId: string): Promise<string> {
  await ensureSceneTable();
  const sql = getSql();
  const token = crypto.randomBytes(32).toString('hex');
  
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);
  
  await sql`
    insert into timeline_private.sessions (token, user_id, expires_at)
    values (${token}, ${userId}, ${expiresAt})
  `;
  
  return token;
}

export async function getSessionUser(token: string): Promise<User | null> {
  await ensureSceneTable();
  const sql = getSql();
  
  const rows = await sql`
    select 
      u.id, u.username, u.role, u.created_at, u.updated_at,
      s.expires_at
    from timeline_private.sessions s
    join timeline_private.users u on s.user_id = u.id
    where s.token = ${token}
    limit 1
  `;
  
  const row = rows[0];
  if (!row) return null;
  
  const expiresAt = new Date(row.expires_at);
  if (expiresAt < new Date()) {
    await sql`
      delete from timeline_private.sessions
      where token = ${token}
    `;
    return null;
  }
  
  return {
    id: row.id,
    username: row.username,
    role: row.role as UserRole,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export async function deleteSession(token: string): Promise<void> {
  await ensureSceneTable();
  const sql = getSql();
  await sql`
    delete from timeline_private.sessions
    where token = ${token}
  `;
}

export async function listAllUsers(): Promise<User[]> {
  await ensureSceneTable();
  const sql = getSql();
  const rows = await sql`
    select id, username, role, created_at, updated_at
    from timeline_private.users
    order by username asc
  `;
  
  return rows.map(row => ({
    id: row.id,
    username: row.username,
    role: row.role as UserRole,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  }));
}

export async function updateUserRole(userId: string, newRole: UserRole): Promise<User> {
  await ensureSceneTable();
  const sql = getSql();
  
  const rows = await sql`
    update timeline_private.users
    set role = ${newRole}, updated_at = now()
    where id = ${userId}
    returning id, username, role, created_at, updated_at
  `;
  
  if (rows.length === 0) {
    throw new Error('User not found');
  }
  
  const row = rows[0];
  return {
    id: row.id,
    username: row.username,
    role: row.role as UserRole,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}
