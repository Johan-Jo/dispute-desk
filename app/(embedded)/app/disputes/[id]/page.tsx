"use client";

import { useParams } from "next/navigation";
import WorkspaceShell from "./WorkspaceShell";

export default function DisputeWorkspacePage() {
  const { id } = useParams<{ id: string }>();
  return <WorkspaceShell disputeId={id} />;
}
