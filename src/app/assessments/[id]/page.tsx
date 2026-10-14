import { Suspense } from "react";
import WorkspaceShell from "@/components/workspace-shell";
import AssessmentRunner from "@/components/assessment-runner";
async function AssessmentContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const preview = id === "preview" && (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  return <AssessmentRunner id={id} preview={preview} />;
}
export default function AssessmentPage({ params }: { params: Promise<{ id: string }> }) {
  return <WorkspaceShell current="Assessment"><Suspense fallback={<p role="status">Loading assessment...</p>}><AssessmentContent params={params} /></Suspense></WorkspaceShell>;
}
