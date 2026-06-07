import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { deleteSession } from '@/lib/auth-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('session_token')?.value;

    if (token) {
      await deleteSession(token);
    }

    cookieStore.delete('session_token');

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[AUTH_LOGOUT_ERROR]', error);
    return NextResponse.json({ error: 'Logout failed.' }, { status: 500 });
  }
}
