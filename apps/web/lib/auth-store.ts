import 'server-only';

import { cookies } from 'next/headers';
import { getSessionUser } from '@storyboard/db';

export * from '@storyboard/db';

export async function getAuthUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get('session_token')?.value;
  if (!token) return null;
  return getSessionUser(token);
}
