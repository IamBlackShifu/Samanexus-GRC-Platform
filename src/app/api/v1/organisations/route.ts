import { getAuthContext, hasSatisfiedMfa } from "@/lib/auth";
import { errorResponse, pageParams, successResponse } from "@/lib/api";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { organisationSchema } from "@/lib/onboarding";

export async function GET(request: Request) {
  try {
    const { supabase, profile, assurance } = await getAuthContext();
    if (!profile || profile.status !== "active") return errorResponse("Sign in to view your workspace", 401);
    if (profile.role !== "super_admin") return errorResponse("Super admin access required", 403);
    if (!hasSatisfiedMfa(profile.role, assurance?.currentLevel)) return errorResponse("Complete MFA to access your portfolio", 403);
    const { page, limit, from, to } = pageParams(request);
    const { data, error, count } = await supabase.from("organisations")
      .select("id, name, sector, size, status, primary_contact_name, primary_contact_email, created_at, org_frameworks(frameworks(code, name)), users!users_org_id_fkey(id, email, role, status)", { count: "exact" })
      .order("created_at", { ascending: false }).order("id").range(from, to);
    if (error) return errorResponse("Unable to load clients. Check the database migrations.", 500);
    const clients = data ?? [];
    const ids = clients.map(client => client.id);
    const [invitationResult, assessmentResult] = clients.length ? await Promise.all([
      createSupabaseAdminClient().from("client_invitations").select("org_id, email, sent_at, expires_at").in("org_id", ids),
      supabase.rpc("portfolio_assessment_summaries", { p_org_ids: ids }),
    ]) : [{ data: [], error: null }, { data: [], error: null }];
    const { data: invitations, error: invitationError } = invitationResult;
    if (assessmentResult.error) return errorResponse("Unable to load assessment progress. Check the assessment migration.", 500);
    const assessments = (assessmentResult.data ?? []) as { org_id: string; assessment_id: string; status: string; summary: { answered: number; required: number; gapCount: number; criticalCount: number } }[];
    if (invitationError) return errorResponse("Unable to load invitation status", 500);
    return successResponse(clients.map(client => {
      const invite = invitations?.find(item => item.org_id === client.id && item.email === client.primary_contact_email.toLowerCase());
      const assessment = assessments.find(item => item.org_id === client.id);
      return { ...client, assessmentSummary: assessment ? { id: assessment.assessment_id, status: assessment.status, ...assessment.summary } : null, invitation: invite ? { sentAt: invite.sent_at, expired: Date.parse(invite.expires_at) <= Date.now() } : null };
    }), { page, limit, total: count ?? 0 });
  } catch {
    return errorResponse("Workspace unavailable. Check the Supabase configuration and try again.", 503);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, profile, assurance } = await getAuthContext();
    if (!profile || profile.status !== "active") return errorResponse("Sign in to create a client", 401);
    if (profile.role !== "super_admin") return errorResponse("Super admin access required", 403);
    if (!hasSatisfiedMfa(profile.role, assurance?.currentLevel)) return errorResponse("MFA is required for super admin access", 403);
    const body = await request.json().catch(() => null);
    const parsed = organisationSchema.safeParse(body);
    if (!parsed.success) return errorResponse("Check the organisation details and select Cyber Essentials", 422, parsed.error.flatten());
    const form = parsed.data;
    const { data, error } = await supabase.rpc("create_client_workspace", {
      p_setup_key: form.setupKey, p_name: form.name, p_sector: form.sector, p_size: form.size,
      p_contact_name: form.primaryContactName, p_contact_email: form.primaryContactEmail,
      p_framework_codes: form.frameworkCodes,
    });
    if (error) return errorResponse("Unable to create the workspace. Check the P1 migration and try again.", 500);
    return successResponse(data, {}, 201);
  } catch {
    return errorResponse("Workspace unavailable. Your setup has not been confirmed; retry safely.", 503);
  }
}
