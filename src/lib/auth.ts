import { createSupabaseServerClient } from "@/lib/supabase/server";

export type UserRole = "super_admin" | "org_admin" | "org_member" | "auditor";

export async function getAuthContext() {
  const supabase = await createSupabaseServerClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError || !userData.user) {
    return { supabase, user: null, profile: null };
  }

  const { data: profile, error: profileError } = await supabase
    .from("users")
    .select("id, org_id, role, email, full_name, status")
    .eq("id", userData.user.id)
    .single();

  if (profile?.status === "suspended") return { supabase, user: userData.user, profile: null };

  if (profileError) {
    throw new Error(`Unable to load user profile: ${profileError.message}`);
  }

  const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  return { supabase, user: userData.user, profile, assurance };
}

export function hasRole(role: UserRole, allowedRoles: UserRole[]) {
  return allowedRoles.includes(role);
}

export function hasSatisfiedMfa(role: UserRole, currentLevel?: string | null) {
  return role !== "super_admin" || currentLevel === "aal2";
}