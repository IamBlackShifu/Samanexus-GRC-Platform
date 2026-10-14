import { Suspense } from "react";
import WorkspaceShell from "@/components/workspace-shell";
import ClientWorkspace from "@/components/client-workspace";
async function ClientContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ClientWorkspace id={id} />;
}
export default function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  return <WorkspaceShell current="Client workspace"><Suspense fallback={<p role="status">Loading client workspace...</p>}><ClientContent params={params} /></Suspense></WorkspaceShell>;
}
