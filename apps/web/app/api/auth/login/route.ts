import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyUser, createSession } from '@/lib/auth-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as { username?: unknown; password?: unknown };
    const username = typeof body.username === 'string' ? body.username : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (!username || !password) {
      return NextResponse.json({ error: 'Username and password are required.' }, { status: 400 });
    }

    const user = await verifyUser(username, password);
    if (!user) {
      return NextResponse.json({ error: 'Invalid username or password.' }, { status: 401 });
    }

    const token = await createSession(user.id);
    const cookieStore = await cookies();
    cookieStore.set({
      name: 'session_token',
      value: token,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });

    return NextResponse.json({ user });
  } catch (error: any) {
    console.error('[AUTH_LOGIN_ERROR]', error);
    return NextResponse.json({ error: 'Login failed. Please try again.' }, { status: 500 });
  }
}
