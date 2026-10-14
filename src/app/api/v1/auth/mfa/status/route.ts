import { errorResponse, successResponse } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) return errorResponse("Authentication required", 401);

    const [{ data: factors }, { data: assurance }] = await Promise.all([
      supabase.auth.mfa.listFactors(),
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    ]);
    const verifiedTotp = factors?.totp.filter((factor) => factor.status === "verified") ?? [];
    return successResponse({
      enabled: verifiedTotp.length > 0,
      currentLevel: assurance?.currentLevel ?? "aal1",
      nextLevel: assurance?.nextLevel ?? "aal1",
      factors: verifiedTotp.map((factor) => ({ id: factor.id, friendlyName: factor.friendly_name })),
    });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Unable to load MFA status", 503);
  }
}