import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { NewEventForm } from "@/app/(organizer)/organizer/new/new-event-form";
import { requireActiveUser } from "@/server/authorization/session";
import { mayCreateEvents } from "@/server/settings/features";

export const metadata: Metadata = { title: "สร้างโครงการ" };

export default async function NewEventPage() {
  const user = await requireActiveUser();
  if (!(await mayCreateEvents(user.role))) redirect("/organizer?error=create-disabled");

  return <NewEventForm />;
}
