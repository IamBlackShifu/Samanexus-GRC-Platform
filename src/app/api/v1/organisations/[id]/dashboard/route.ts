import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { errorResponse, successResponse } from "@/lib/api";
import { getAuthContext, hasRole, hasSatisfiedMfa } from "@/lib/auth";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: orgId } = await params;
    const { supabase, profile, assurance } = await getAuthContext();
    if (!profile || profile.status !== "active" || !hasRole(profile.role, ["super_admin", "org_admin", "org_member", "auditor"])) return errorResponse("Organisation access required", 403);
    if (profile.role === "super_admin" && !hasSatisfiedMfa(profile.role, assurance?.currentLevel)) return errorResponse("MFA is required for super admin access", 403);
    if (profile.role !== "super_admin" && profile.org_id !== orgId) return errorResponse("You cannot access another organisation", 403);

    const [organisationResult, frameworksResult, controlsResult, orgControlsResult, tasksResult, evidenceResult, certificationsResult, licenseResult, selectionsResult, adminsResult] = await Promise.all([
      supabase.from("organisations").select("id, name, sector, size, status, subscription_tier, created_at, primary_contact_name, primary_contact_email").eq("id", orgId).single(),
      supabase.from("frameworks").select("id, code, name, version").eq("is_active", true).order("name"),
      supabase.from("controls").select("id, framework_id"),
      supabase.from("org_controls").select("control_id, status").eq("org_id", orgId),
      supabase.from("tasks").select("id, title, priority, status, due_date, control_id").eq("org_id", orgId).neq("status", "complete").or("assessment_gap_state.is.null,assessment_gap_state.eq.open").order("due_date", { ascending: true, nullsFirst: false }).limit(5),
      supabase.from("evidence").select("id, file_name, control_id, expiry_date, uploaded_at").eq("org_id", orgId).order("uploaded_at", { ascending: false }).limit(10),
      supabase.from("certifications").select("id, framework_id, certification_body, expiry_date, status").eq("org_id", orgId).order("expiry_date", { ascending: true }),
      supabase.from("licenses").select("id, tier, status, seat_limit, starts_at, ends_at, updated_at").eq("org_id", orgId).maybeSingle(),
      supabase.from("org_frameworks").select("framework_id").eq("org_id", orgId),
      supabase.from("users").select("email, role, status").eq("org_id", orgId).eq("role", "org_admin"),
    ]);

    const failedResult = [organisationResult, frameworksResult, controlsResult, orgControlsResult, tasksResult, evidenceResult, certificationsResult, licenseResult, selectionsResult, adminsResult].find((result) => result.error);
    if (failedResult?.error) return errorResponse(failedResult.error.message, 500);

    if (!organisationResult.data) return errorResponse("Organisation not found", 404);

    const controlsById = new Map((controlsResult.data ?? []).map((control) => [control.id, control.framework_id]));
    const statusByFramework = new Map<string, { total: number; complete: number; gaps: number }>();
    for (const control of orgControlsResult.data ?? []) {
      const frameworkId = controlsById.get(control.control_id);
      if (!frameworkId) continue;
      const current = statusByFramework.get(frameworkId) ?? { total: 0, complete: 0, gaps: 0 };
      current.total += 1;
      if (control.status === "implemented" || control.status === "not_applicable") current.complete += 1;
      if (control.status !== "implemented" && control.status !== "not_applicable") current.gaps += 1;
      statusByFramework.set(frameworkId, current);
    }

    const selectedIds = new Set((selectionsResult.data ?? []).map(item => item.framework_id));
    const frameworkScores = (frameworksResult.data ?? []).filter(framework => selectedIds.has(framework.id)).map((framework) => {
      const score = statusByFramework.get(framework.id) ?? { total: 0, complete: 0, gaps: 0 };
      return { ...framework, score: score.total ? Math.round((score.complete / score.total) * 100) : 0, controlsTracked: score.total, gaps: score.gaps };
    });

    const { data: invitation, error: invitationError } = await createSupabaseAdminClient().from("client_invitations")
      .select("sent_at, expires_at").eq("org_id", orgId).eq("email", organisationResult.data.primary_contact_email.toLowerCase()).maybeSingle();
    if (invitationError) return errorResponse("Unable to load invitation status", 500);
    return successResponse({
      invitation: invitation ? { sentAt: invitation.sent_at, expired: Date.parse(invitation.expires_at) <= Date.now() } : null,
      organisation: organisationResult.data,
      admins: adminsResult.data ?? [],
      license: licenseResult.data,
      frameworkScores,
      urgentTasks: tasksResult.data ?? [],
      recentEvidence: evidenceResult.data ?? [],
      certifications: certificationsResult.data ?? [],
    });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Unable to load organisation dashboard", 503);
  }
}