import { z } from "zod";
import { getAuthContext } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { errorResponse, successResponse } from "@/lib/api";

export async function POST(request: Request) {
  try {
    const { supabase, user, profile } = await getAuthContext();
    if (!user || !profile || profile.status !== "invited" || !user.email_confirmed_at) return errorResponse("A verified invitation is required", 403);
    const parsed = z.object({ password: z.string().min(12).max(128) }).safeParse(await request.json().catch(() => null));
    if (!parsed.success) return errorResponse("Use a password between 12 and 128 characters", 422);
    const admin = createSupabaseAdminClient();
    const { data: invitation, error } = await admin.from("client_invitations").select("org_id, role, expires_at, accepted_at").eq("email", profile.email).single();
    if (error || !invitation || invitation.org_id !== profile.org_id || invitation.role !== profile.role || invitation.accepted_at || Date.parse(invitation.expires_at) <= Date.now()) {
      return errorResponse("This invitation has expired or is no longer available. Ask your administrator for a new invitation.", 410);
    }
    const { error: passwordError } = await supabase.auth.updateUser({ password: parsed.data.password });
    if (passwordError) return errorResponse("Unable to set the password. Try a longer password and retry.", 422);
    const { data: organisationId, error: activationError } = await admin.rpc("activate_invited_client", { p_user_id: user.id });
    if (activationError) return errorResponse("This invitation expired or could not be activated. Ask your administrator to renew it.", 410);
    return successResponse({ organisationId });
  } catch { return errorResponse("Account setup unavailable. Please retry.", 503); }
}
