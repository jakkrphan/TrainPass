/** How a project's status reads and looks in staff lists (project list, dashboard), kept in one place. */
export const eventStatusLabel = { DRAFT: "ฉบับร่าง", PUBLISHED: "เผยแพร่แล้ว", CLOSED: "ปิดรับแล้ว" } as const;
export const eventStatusTone = { DRAFT: "bg-amber-100 text-amber-900", PUBLISHED: "bg-accent text-accent-foreground", CLOSED: "bg-muted text-muted-foreground" } as const;
/** Small pill used for status and other tags in those lists. */
export const chipClass = "inline-flex items-center rounded-md px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap";
