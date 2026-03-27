import { hasAdminSession } from "@/lib/admin/auth";
import { redirect, notFound } from "next/navigation";
import { getContentForEditor } from "@/lib/resources/admin-queries";
import { ContentEditorClient } from "./editor-client";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export default async function AdminResourceEditorPage({ params }: Props) {
  if (!(await hasAdminSession())) redirect("/admin/login");
  const { id } = await params;

  const data = await getContentForEditor(id);
  if (!data) notFound();

  return <ContentEditorClient contentId={id} initial={data} />;
}
