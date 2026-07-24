import { redirect } from "next/navigation";

import { getAuthUser } from "@/lib/firebase-auth-session";
import { errorRedirectUrl, validateAuthorizeRequest } from "@/lib/oauth/authorize-request";
import { loadClient } from "@/lib/oauth/core";

// OAuth consent screen. A PAGE rather than an API route so it renders inside
// the root layout — an unauthenticated visitor gets the existing AuthGate
// sign-in form instead of a bespoke login here.
//
// This screen only *presents* the request; /api/oauth/authorize re-validates
// everything on POST, so nothing here is a trust boundary.

export const dynamic = "force-dynamic";

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto mt-16 max-w-md rounded-lg border border-zinc-800 bg-zinc-900/40 p-6">
      <h1 className="text-lg font-semibold text-zinc-100">{title}</h1>
      <div className="mt-3 text-sm text-zinc-300">{children}</div>
    </div>
  );
}

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const client = loadClient();
  if (!client) {
    return (
      <Shell title="Connection unavailable">
        This server has no OAuth client configured, so it can&apos;t authorize connections yet.
      </Shell>
    );
  }

  const raw = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") query.set(key, value);
    else if (Array.isArray(value) && value[0]) query.set(key, value[0]);
  }

  const validation = validateAuthorizeRequest(query, client);

  if (!validation.ok) {
    // Untrusted client/redirect: show the problem, never bounce to it.
    if (!validation.redirectable) {
      return <Shell title="Invalid request">{validation.description}</Shell>;
    }
    redirect(
      errorRedirectUrl(
        validation.redirectUri,
        validation.error,
        validation.description,
        validation.state,
      ),
    );
  }

  const user = await getAuthUser();
  if (!user) {
    // AuthGate (root layout) renders the sign-in form around this. Signing in
    // via email link returns to the app root, which drops these parameters —
    // so tell the user to restart the connection rather than silently failing.
    return (
      <Shell title="Sign in to continue">
        Sign in above, then start the connection again from Claude — signing in returns you to the
        app and doesn&apos;t preserve this authorization request.
      </Shell>
    );
  }

  const { params } = validation;

  return (
    <Shell title="Connect to Claude">
      <p>
        Claude is asking to read your timeline projects as{" "}
        <span className="font-medium text-zinc-100">{user.email ?? user.uid}</span>.
      </p>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-zinc-400">
        <li>List your projects</li>
        <li>Read the clips in a timeline</li>
      </ul>
      <p className="mt-3 text-zinc-400">
        It cannot change or delete anything — this connection is read-only.
      </p>

      <form method="POST" action="/api/oauth/authorize" className="mt-5 flex gap-2">
        {/* Echoed back for server-side re-validation, not trusted as-is. */}
        <input type="hidden" name="client_id" value={params.clientId} />
        <input type="hidden" name="redirect_uri" value={params.redirectUri} />
        <input type="hidden" name="response_type" value="code" />
        <input type="hidden" name="code_challenge" value={params.codeChallenge} />
        <input type="hidden" name="code_challenge_method" value={params.codeChallengeMethod} />
        <input type="hidden" name="scope" value={params.scope} />
        {params.state !== null && <input type="hidden" name="state" value={params.state} />}

        <button
          type="submit"
          name="decision"
          value="approve"
          className="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500"
        >
          Allow read access
        </button>
        <button
          type="submit"
          name="decision"
          value="deny"
          className="rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:border-zinc-500"
        >
          Deny
        </button>
      </form>
    </Shell>
  );
}
