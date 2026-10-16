import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { hash } from "bcryptjs";

const db = new PrismaClient();

const demoDate = new Date("2030-01-15T00:00:00.000Z");

try {
  const passwordHash = await hash("CheckInHub123!", 12);
  const seedUser = (name, email, role) => db.user.upsert({
    where: { email },
    update: { name, passwordHash, role, isActive: true },
    create: { name, email, passwordHash, role },
  });
  const [admin, organizer, fullCollaborator, checkInStaff] = await Promise.all([
    seedUser("Local Admin", "admin@checkinhub.local", "ADMIN"),
    seedUser("Local Organizer", "organizer@checkinhub.local", "ORGANIZER"),
    seedUser("Full Collaborator", "collaborator@checkinhub.local", "ORGANIZER"),
    seedUser("Check-in Staff", "staff@checkinhub.local", "ORGANIZER"),
  ]);

  const event = await db.event.upsert({
    where: { slug: "demo-training" },
    update: { ownerId: organizer.id },
    create: {
      slug: "demo-training",
      title: "อบรมการใช้งาน TrainPass",
      description: "กิจกรรมตัวอย่างสำหรับทดสอบระบบในเครื่อง",
      location: "ห้องอบรม A",
      status: "PUBLISHED",
      eventType: "INTERNAL",
      autoApprove: true,
      waitlistEnabled: true,
      ownerId: organizer.id,
      fields: [
        { key: "name", label: "ชื่อ-นามสกุล", type: "text", required: true },
        { key: "organization", label: "หน่วยงาน", type: "text", required: false },
      ],
    },
  });
  if (!event.registrationDeadline) await db.event.update({ where: { id: event.id }, data: { registrationDeadline: new Date("2030-01-14T16:59:59.999Z") } });

  await Promise.all([
    db.eventOrganizer.upsert({
      where: { eventId_userId: { eventId: event.id, userId: fullCollaborator.id } },
      update: { role: "FULL" },
      create: { eventId: event.id, userId: fullCollaborator.id, role: "FULL" },
    }),
    db.eventOrganizer.upsert({
      where: { eventId_userId: { eventId: event.id, userId: checkInStaff.id } },
      update: { role: "CHECKIN_ONLY" },
      create: { eventId: event.id, userId: checkInStaff.id, role: "CHECKIN_ONLY" },
    }),
  ]);

  const eventDay = await db.eventDay.upsert({
    where: { eventId_date: { eventId: event.id, date: demoDate } },
    update: {},
    create: { eventId: event.id, date: demoDate, maxSeats: 50 },
  });

  const existingSession = await db.session.findFirst({
    where: { eventId: event.id, label: "รอบเช้า" },
  });

  if (!existingSession) {
    const startTime = new Date("2030-01-15T02:00:00.000Z");
    const endTime = new Date("2030-01-15T05:00:00.000Z");

    await db.session.create({
      data: {
        eventId: event.id,
        eventDayId: eventDay.id,
        label: "รอบเช้า",
        startTime,
        endTime,
      },
    });
  }

  const registrant = await db.registrant.findFirst({ where: { eventId: event.id, email: "demo@example.com" } }) ?? await db.registrant.create({
    data: {
      eventId: event.id,
      email: "demo@example.com",
      dedupeKey: "demo@example.com",
      consentVersion: "v1",
      answers: { name: "ผู้เข้าร่วมตัวอย่าง", organization: "TrainPass" },
      status: "APPROVED",
      notifyVia: "EMAIL",
      approvedAt: new Date(),
      approvedById: admin.id,
      qrCode: "CHECKINHUB-DEMO-001",
      statusTokenHash: "local-demo-status-token",
    },
  });

  await db.registrantEventDay.upsert({
    where: { registrantId_eventDayId: { registrantId: registrant.id, eventDayId: eventDay.id } },
    update: { status: "APPROVED" },
    create: { registrantId: registrant.id, eventDayId: eventDay.id, status: "APPROVED" },
  });

  const perDayDates = [15, 16, 17].map((day) => new Date(`2030-01-${day}T00:00:00.000Z`));
  for (const date of perDayDates.slice(1)) await db.eventDay.upsert({
    where: { eventId_date: { eventId: event.id, date } }, update: {}, create: { eventId: event.id, date, maxSeats: 50 },
  });
  for (const [dateIndex, label] of ["Afternoon", "Day 2", "Day 3"].entries()) {
    const date = perDayDates[dateIndex === 0 ? 0 : dateIndex];
    const day = await db.eventDay.findUniqueOrThrow({ where: { eventId_date: { eventId: event.id, date } } });
    if (!await db.session.count({ where: { eventId: event.id, eventDayId: day.id, label } })) await db.session.create({ data: { eventId: event.id, eventDayId: day.id, label } });
  }

  const whole = await db.event.upsert({
    where: { slug: "demo-whole-course" },
    update: { ownerId: organizer.id },
    create: {
      slug: "demo-whole-course", title: "Continuous training course (demo)", location: "Training room B",
      eventType: "INTERNAL", status: "PUBLISHED", seatMode: "whole_course", maxSeats: 50,
      attendanceThreshold: 80, autoApprove: false, waitlistEnabled: true, ownerId: organizer.id,
      registrationDeadline: new Date("2030-02-09T16:59:59.999Z"),
      fields: [{ key: "name", label: "Full name", type: "text", required: true }],
    },
  });
  const wholeDays = [];
  for (let index = 0; index < 5; index++) {
    const date = new Date(`2030-02-${String(10 + index).padStart(2, "0")}T00:00:00.000Z`);
    const day = await db.eventDay.upsert({ where: { eventId_date: { eventId: whole.id, date } }, update: {}, create: { eventId: whole.id, date } });
    wholeDays.push(day);
    for (const label of ["Morning", "Afternoon"]) {
      if (!await db.session.count({ where: { eventId: whole.id, eventDayId: day.id, label } })) await db.session.create({ data: { eventId: whole.id, eventDayId: day.id, label } });
    }
  }

  for (let index = 0; index < 100; index++) {
    const status = ["APPROVED", "PENDING", "WAITLISTED", "REJECTED"][index % 4];
    for (const [targetEvent, selectedDays, prefix] of [[event, [eventDay], "perday"], [whole, wholeDays, "course"]]) {
      const email = `${prefix}-${index + 1}@demo.checkinhub.local`;
      const person = await db.registrant.findFirst({ where: { eventId: targetEvent.id, email } }) ?? await db.registrant.create({
        data: {
          eventId: targetEvent.id, email, dedupeKey: status === "REJECTED" ? null : email, answers: { name: `Demo Participant ${index + 1}` }, status,
          notifyVia: "EMAIL", consentedAt: new Date(), consentVersion: "v1", approvedAt: status === "APPROVED" ? new Date() : null,
          qrCode: status === "APPROVED" ? `DEMO-${prefix}-${index + 1}` : null,
          statusTokenHash: createHash("sha256").update(`demo-${prefix}-${index + 1}`).digest("hex"),
        },
      });
      for (const day of selectedDays) await db.registrantEventDay.upsert({
        where: { registrantId_eventDayId: { registrantId: person.id, eventDayId: day.id } }, update: {},
        create: { registrantId: person.id, eventDayId: day.id, status, waitlistedAt: status === "WAITLISTED" ? new Date() : null, pendingSince: status === "PENDING" ? new Date() : null },
      });
    }
  }
  const occupiedDemoSeats = await db.registrantEventDay.count({ where: { eventDayId: eventDay.id, status: { in: ["PENDING", "APPROVED"] } } });
  if (eventDay.maxSeats !== null && eventDay.maxSeats < occupiedDemoSeats) await db.eventDay.update({ where: { id: eventDay.id }, data: { maxSeats: occupiedDemoSeats } });

  process.stdout.write("Seeded local accounts, per-day demo (3 days, 4 sessions), whole-course demo (5 days, 10 sessions), and 200 demo registrants.\n");
} finally {
  await db.$disconnect();
}
