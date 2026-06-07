import { NextResponse } from 'next/server';
import { getAuthUser, listAllUsers, updateUserRole, type UserRole } from '@/lib/auth-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const currentUser = await getAuthUser();
    if (!currentUser || currentUser.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden. Admin access required.' }, { status: 403 });
    }

    const users = await listAllUsers();
    return NextResponse.json({ users });
  } catch (error) {
    console.error('[AUTH_USERS_GET_ERROR]', error);
    return NextResponse.json({ error: 'Failed to retrieve users.' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const currentUser = await getAuthUser();
    if (!currentUser || currentUser.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden. Admin access required.' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({})) as { userId?: unknown; role?: unknown };
    const targetUserId = typeof body.userId === 'string' ? body.userId : '';
    const newRole = typeof body.role === 'string' ? (body.role as UserRole) : null;

    if (!targetUserId) {
      return NextResponse.json({ error: 'User ID is required.' }, { status: 400 });
    }

    if (!newRole || !['viewer', 'editor', 'admin'].includes(newRole)) {
      return NextResponse.json({ error: 'A valid role (viewer, editor, admin) is required.' }, { status: 400 });
    }

    // Safety: Prevent self-demotion
    if (targetUserId === currentUser.id) {
      return NextResponse.json({ error: 'Admins cannot change their own role.' }, { status: 400 });
    }

    const updatedUser = await updateUserRole(targetUserId, newRole);
    return NextResponse.json({ user: updatedUser });
  } catch (error: any) {
    console.error('[AUTH_USERS_PUT_ERROR]', error);
    return NextResponse.json({ error: error.message || 'Failed to update user role.' }, { status: 500 });
  }
}
