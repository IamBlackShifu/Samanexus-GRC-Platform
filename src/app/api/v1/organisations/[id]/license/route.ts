import { z } from "zod";
import { errorResponse, successResponse } from "@/lib/api";
import { getAuthContext, hasRole, hasSatisfiedMfa } from "@/lib/auth";

const licenseSchema = z.object({
  tier: z.enum(["basic", "silver", "gold"]),
  status: z.enum(["trial", "active", "past_due", "cancelled", "expired"]),
  seatLimit: z.number().int().positive().max(10000),
  startsAt: z.string().date(),
  endsAt: z.string().date().optional().nullable(),
  externalReference: z.string().trim().max(255).optional().nullable(),
});

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: orgId } = await params;
    const { supabase, profile } = await getAuthContext();
    if (!profile || !hasRole(profile.role, ["super_admin", "org_admin"])) return errorResponse("Organisation access required", 403);
    if (profile.role === "org_admin" && profile.org_id !== orgId) return errorResponse("You cannot view another organisation's license", 403);

    const { data, error } = await supabase.from("licenses").select("id, org_id, tier, status, seat_limit, starts_at, ends_at, external_reference, updated_at").eq("org_id", orgId).maybeSingle();
    if (error) return errorResponse(error.message, 500);
    return successResponse(data);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Unable to load license", 503);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: orgId } = await params;
    const { supabase, profile, assurance } = await getAuthContext();
    if (!profile || !hasRole(profile.role, ["super_admin"])) return errorResponse("Super admin access required", 403);
    if (!hasSatisfiedMfa(profile.role, assurance?.currentLevel)) return errorResponse("MFA is required for super admin access", 403);
    const parsed = licenseSchema.safeParse(await request.json());
    if (!parsed.success) return errorResponse("Invalid license details", 422, parsed.error.flatten());

    const { data, error } = await supabase.from("licenses").upsert({
      org_id: orgId,
      tier: parsed.data.tier,
      status: parsed.data.status,
      seat_limit: parsed.data.seatLimit,
      starts_at: parsed.data.startsAt,
      ends_at: parsed.data.endsAt,
      external_reference: parsed.data.externalReference,
      managed_by: profile.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: "org_id" }).select("id, org_id, tier, status, seat_limit, starts_at, ends_at, external_reference, updated_at").single();
    if (error) return errorResponse(error.message, 500);
    return successResponse(data);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Unable to update license", 503);
  }
}