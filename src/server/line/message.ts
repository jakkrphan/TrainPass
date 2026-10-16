import type { Prisma, RegistrantStatus } from "@prisma/client";

import { formatEventDayWithWeekday } from "@/lib/format";

// Content of the LINE messages (kept free of Next.js/database imports so it can be unit-tested on its own).

export type LineNotificationKind = "linked" | "status" | "resend";

const statusWords: Record<RegistrantStatus, string> = {
  APPROVED: "ได้รับอนุมัติ ✅",
  PENDING: "รอผู้จัดอนุมัติ",
  WAITLISTED: "อยู่ในคิวสำรอง",
  REJECTED: "ไม่ได้รับอนุมัติ",
  CANCELLED: "ยกเลิกแล้ว",
};

export type Recipient = Prisma.RegistrantGetPayload<{ select: typeof recipientSelect }>;
export const recipientSelect = {
  id: true, status: true, statusTokenHash: true, lineUserId: true, lineNotifiedDays: true, rejectReason: true, anonymizedAt: true,
  days: { select: { eventDayId: true, status: true } },
  event: { select: { title: true, slug: true, seatMode: true, deletedAt: true, days: { orderBy: { date: "asc" }, select: { id: true, date: true } } } },
} satisfies Prisma.RegistrantSelect;

export function snapshotOf(person: Recipient) {
  return Object.fromEntries(person.days.map((day) => [day.eventDayId, day.status]));
}

type LineContent = {
  title: string;
  intro: string | null;
  heading: string;
  items: { label: string; status: RegistrantStatus }[];
  reason: string | null;
  approved: boolean;
};

/** What a message says, or null when a "status" message has nothing new to say. */
function lineContent(kind: LineNotificationKind, person: Recipient): LineContent | null {
  const previous = (person.lineNotifiedDays && typeof person.lineNotifiedDays === "object" && !Array.isArray(person.lineNotifiedDays) ? person.lineNotifiedDays : {}) as Record<string, string>;
  const order = person.event.days;
  const dayLabel = (eventDayId: string) => {
    const index = order.findIndex((day) => day.id === eventDayId);
    return `วันที่ ${index + 1} (${index >= 0 ? formatEventDayWithWeekday(order[index].date) : "-"})`;
  };
  const days = [...person.days].sort((a, b) => order.findIndex((day) => day.id === a.eventDayId) - order.findIndex((day) => day.id === b.eventDayId));
  const changed = kind === "status" ? days.filter((day) => previous[day.eventDayId] !== day.status) : days;
  if (!changed.length) return null;
  return {
    title: person.event.title,
    intro: kind === "linked" ? "เชื่อม LINE สำเร็จ — ระบบจะแจ้งผลการลงทะเบียนทางนี้" : null,
    heading: kind === "status" ? "อัปเดตสถานะการลงทะเบียน" : "สถานะการลงทะเบียนของคุณ",
    // A whole course moves as one; list it once instead of repeating the same status for every day.
    items: person.event.seatMode === "whole_course"
      ? [{ label: `หลักสูตร ${order.length} วัน`, status: person.status }]
      : changed.map((day) => ({ label: dayLabel(day.eventDayId), status: day.status })),
    reason: changed.some((day) => day.status === "REJECTED") ? person.rejectReason : null,
    approved: person.status === "APPROVED",
  };
}

const statusColors: Partial<Record<RegistrantStatus, string>> = { APPROVED: "#15803d", REJECTED: "#b91c1c" };

/**
 * The message as a Flex card with a button to the status page (where the QR is shown), or null when a "status"
 * message has nothing new to say.
 * altText is what the chat list and push notification show, and what old LINE clients get instead of the card.
 */
export function buildLineFlexMessage(kind: LineNotificationKind, person: Recipient, statusUrl: string) {
  const content = lineContent(kind, person);
  if (!content) return null;
  const altText = `${content.title}: ${content.intro ?? content.heading}${content.approved ? " — เปิด QR สำหรับเช็คชื่อ" : ""}`;
  return {
    type: "flex" as const,
    altText: altText.slice(0, 400),
    contents: {
      type: "bubble",
      body: {
        type: "box", layout: "vertical", spacing: "md",
        contents: [
          { type: "text", text: "TrainPass", size: "xs", color: "#6b7280" },
          { type: "text", text: content.title, weight: "bold", size: "lg", wrap: true },
          ...(content.intro ? [{ type: "text", text: content.intro, size: "sm", color: "#374151", wrap: true }] : []),
          { type: "separator" },
          { type: "text", text: content.heading, weight: "bold", size: "sm" },
          ...content.items.map((item) => ({
            type: "box", layout: "horizontal", spacing: "md",
            contents: [
              { type: "text", text: item.label, size: "sm", color: "#374151", wrap: true, flex: 3 },
              { type: "text", text: statusWords[item.status], size: "sm", weight: "bold", color: statusColors[item.status] ?? "#6b7280", align: "end", wrap: true, flex: 2 },
            ],
          })),
          ...(content.reason ? [{ type: "text", text: `เหตุผล: ${content.reason}`, size: "sm", color: "#b91c1c", wrap: true }] : []),
        ],
      },
      footer: {
        type: "box", layout: "vertical", spacing: "sm",
        contents: [
          { type: "button", style: content.approved ? "primary" : "secondary", height: "sm", action: { type: "uri", label: content.approved ? "เปิด QR สำหรับเช็คชื่อ" : "ดูรายละเอียด", uri: statusUrl } },
          ...(content.approved ? [{ type: "text", text: "แสดง QR ที่จุดลงทะเบียน", size: "xs", color: "#6b7280", align: "center" }] : []),
        ],
      },
    },
  };
}

export type AnnouncementContent = { subject: string; body: string };

/** An organizer's announcement as a Flex card: what they wrote, and a button to the person's own status page. */
export function buildLineAnnouncement(person: Pick<Recipient, "status" | "event">, announcement: AnnouncementContent, statusUrl: string) {
  const approved = person.status === "APPROVED";
  return {
    type: "flex" as const,
    altText: `ประกาศ: ${announcement.subject} · ${person.event.title}`.slice(0, 400),
    contents: {
      type: "bubble",
      body: {
        type: "box", layout: "vertical", spacing: "md",
        contents: [
          { type: "text", text: "ประกาศจากผู้จัด", size: "xs", weight: "bold", color: "#b45309" },
          { type: "text", text: person.event.title, size: "sm", color: "#6b7280", wrap: true },
          { type: "text", text: announcement.subject, weight: "bold", size: "lg", wrap: true },
          { type: "separator" },
          { type: "text", text: announcement.body, size: "sm", color: "#374151", wrap: true },
        ],
      },
      footer: {
        type: "box", layout: "vertical", spacing: "sm",
        contents: [{ type: "button", style: "secondary", height: "sm", action: { type: "uri", label: approved ? "ดูสถานะและ QR" : "ดูสถานะการลงทะเบียน", uri: statusUrl } }],
      },
    },
  };
}
