import { z } from "zod";
import { errorResponse, successResponse } from "@/lib/api";
import { getAuthContext, hasSatisfiedMfa } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  fullName: z.string().trim().min(2).max(255),
  role: z.enum(["org_admin", "org_member", "auditor"]).default("org_member"),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: orgId } = await params;
    if (!z.uuid().safeParse(orgId).success) return errorResponse("Invalid organisation", 422);
    const { supabase, profile, assurance } = await getAuthContext();
    if (!profile || profile.status !== "active") return errorResponse("Active organisation admin access required", 403);
    if (!["super_admin", "org_admin"].includes(profile.role)) return errorResponse("Organisation admin access required", 403);
    if (!hasSatisfiedMfa(profile.role, assurance?.currentLevel)) return errorResponse("MFA is required for super admin access", 403);
    if (profile.role !== "super_admin" && profile.org_id !== orgId) return errorResponse("You cannot invite users to another organisation", 403);
    const parsed = inviteSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return errorResponse("Check the contact name and email address", 422);
    const { data: org, error: orgError } = await supabase.from("organisations").select("id, name, status").eq("id", orgId).single();
    if (orgError || !org || org.status !== "active") return errorResponse("Active organisation not found", 404);
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
    if (!siteUrl) return errorResponse("Invitation delivery needs NEXT_PUBLIC_SITE_URL configured", 503);
    const admin = createSupabaseAdminClient();
    const { data: existing, error: existingError } = await admin.from("users").select("id, org_id, role, status").eq("email", parsed.data.email).maybeSingle();
    if (existingError) return errorResponse("Unable to check existing membership", 500);
    if (existing && (existing.org_id !== orgId || existing.role !== parsed.data.role || existing.status !== "invited")) {
      return errorResponse("This email already belongs to a workspace. Use a different address or manage the existing membership.", 409);
    }
    // Concurrent requests must not reserve the same address for different tenants.
    const { data: previous, error: previousError } = await admin.from("client_invitations").select("org_id, role, expires_at, sent_at").eq("email", parsed.data.email).maybeSingle();
    if (previousError) return errorResponse("Invitation storage unavailable. Apply the P1 migration.", 500);
    if (previous && (previous.org_id !== orgId || previous.role !== parsed.data.role)) return errorResponse("An invitation already exists for this address", 409);
    if (previous?.sent_at && new Date(previous.expires_at).getTime() > Date.now()) {
      return successResponse({ email: parsed.data.email, organisationId: orgId, expiresAt: previous.expires_at, alreadySent: true });
    }
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    if (previous) {
      const { error } = await admin.from("client_invitations").update({ expires_at: expiresAt, sent_at: null }).eq("email", parsed.data.email).eq("org_id", orgId).eq("role", parsed.data.role);
      if (error) return errorResponse("Unable to renew the invitation", 500);
    } else {
      const { error } = await admin.from("client_invitations").insert({ email: parsed.data.email, org_id: orgId, full_name: parsed.data.fullName, role: parsed.data.role, expires_at: expiresAt });
      if (error) return errorResponse("Invitation already being prepared. Try again.", 409);
    }
    let deliveryError: unknown = null;
    if (existing) {
      const { data: existingAuth, error } = await admin.auth.admin.getUserById(existing.id);
      if (error) return errorResponse("Unable to verify the invited account", 500);
      if (existingAuth.user.email_confirmed_at) {
        // Renew setup for someone who verified an older link but never finished activation.
        const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, { redirectTo: new URL("/account", siteUrl).toString() });
        deliveryError = error;
      } else {
        const { error } = await admin.auth.admin.inviteUserByEmail(parsed.data.email, { redirectTo: new URL("/account", siteUrl).toString(), data: { full_name: parsed.data.fullName } });
        deliveryError = error;
      }
    } else {
      const { error } = await admin.auth.admin.inviteUserByEmail(parsed.data.email, { redirectTo: new URL("/account", siteUrl).toString(), data: { full_name: parsed.data.fullName } });
      deliveryError = error;
    }
    if (deliveryError) return errorResponse("The invitation could not be sent. The workspace is saved; check email delivery and retry.", 502);
    // The database trigger provisions the profile before the email is issued.
    const { error: sentError } = await admin.from("client_invitations").update({ sent_at: new Date().toISOString() }).eq("email", parsed.data.email).eq("org_id", orgId);
    if (sentError) return errorResponse("Email sent, but delivery status could not be recorded. Check the invitation ledger before retrying.", 500);
    return successResponse({ organisationId: orgId, email: parsed.data.email, expiresAt }, {}, 201);
  } catch {
    return errorResponse("Invitation service unavailable. Your workspace is saved; retry when the service is available.", 503);
  }
}
