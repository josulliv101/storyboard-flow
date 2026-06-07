import { NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await getAuthUser();
    return NextResponse.json({ user });
  } catch (error) {
    console.error('[AUTH_ME_ERROR]', error);
    return NextResponse.json({ user: null });
  }
}
