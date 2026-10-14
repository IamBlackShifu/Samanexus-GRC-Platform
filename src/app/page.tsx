import Portfolio from "@/components/portfolio";
import WorkspaceShell from "@/components/workspace-shell";

export default function Home() {
  const preview = !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return <WorkspaceShell><Portfolio preview={preview} /></WorkspaceShell>;
}
