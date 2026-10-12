import { redirect } from "next/navigation";

import { withBasePath } from "@/lib/base-path";

/**
 * Short registration link for posters and QR codes: /r/<slug> → /events/<slug>. Temporary (307) so a changed or
 * reused slug is never pinned in browser caches; unknown slugs get the event page's own 404.
 */
export async function GET(_request: Request, context: RouteContext<"/r/[slug]">) {
  const { slug } = await context.params;
  // Unlike in pages and actions, redirect() in a route handler does not add basePath itself.
  redirect(withBasePath(`/events/${encodeURIComponent(slug)}`));
}
