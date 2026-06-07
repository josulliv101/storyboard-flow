import { NextResponse } from 'next/server';
import { createUser } from '@/lib/auth-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as { username?: unknown; password?: unknown };
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (!username || username.length < 3 || username.length > 50) {
      return NextResponse.json({ error: 'Username must be between 3 and 50 characters.' }, { status: 400 });
    }

    if (!password || password.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters long.' }, { status: 400 });
    }

    const user = await createUser(username, password);
    return NextResponse.json({ user }, { status: 201 });
  } catch (error: any) {
    console.error('[AUTH_REGISTER_ERROR]', error);
    return NextResponse.json({ error: error.message || 'Registration failed.' }, { status: 400 });
  }
}
