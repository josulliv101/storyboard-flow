import { loadClient } from "@/lib/oauth/core";
import {
  errorRedirectUrl,
  successRedirectUrl,
  validateAuthorizeRequest,
} from "@/lib/oauth/authorize-request";
import { mcpResourceUrl, resolveIssuerOrigin } from "@/lib/oauth/metadata";
import { issueAuthCode } from "@/lib/oauth/store";
import { getAuthUser } from "@/lib/firebase-auth-session";

// The consent form POSTs here. Every parameter is re-validated server-side
// against the registered client — the page's rendering is a UI affordance, not
// a trust boundary, so nothing from the form is taken on faith.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const client = loadClient();
  if (!client) {
    return new Response("OAuth is not configured on this server.", { status: 500 });
  }

  const form = new URLSearchParams(await request.text());
  const validation = validateAuthorizeRequest(form, client);

  if (!validation.ok) {
    // Never redirect to an unverified destination.
    if (!validation.redirectable) {
      return new Response(validation.description, { status: 400 });
    }
    return Response.redirect(
      errorRedirectUrl(
        validation.redirectUri,
        validation.error,
        validation.description,
        validation.state,
      ),
      303,
    );
  }

  // The session cookie is the ONLY source of identity here — a uid submitted
  // in the form would let anyone mint a code for someone else's account.
  const user = await getAuthUser();
  if (!user) {
    return Response.redirect(
      errorRedirectUrl(
        validation.params.redirectUri,
        "access_denied",
        "Not signed in.",
        validation.params.state,
      ),
      303,
    );
  }

  if (form.get("decision") !== "approve") {
    return Response.redirect(
      errorRedirectUrl(
        validation.params.redirectUri,
        "access_denied",
        "The user denied the request.",
        validation.params.state,
      ),
      303,
    );
  }

  const { origin } = resolveIssuerOrigin(request);
  const code = await issueAuthCode({
    clientId: validation.params.clientId,
    redirectUri: validation.params.redirectUri,
    codeChallenge: validation.params.codeChallenge,
    codeChallengeMethod: validation.params.codeChallengeMethod,
    uid: user.uid,
    scope: validation.params.scope,
    resource: mcpResourceUrl(origin),
  });

  return Response.redirect(
    successRedirectUrl(validation.params.redirectUri, code, validation.params.state),
    303,
  );
}
