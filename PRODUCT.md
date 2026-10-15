# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Next.js, deployed to Vercel

## Users

Event and venue staff (hosts, front-of-house, organizers) who check in attendees or guests at an event, venue, or front desk.

## Product Purpose

AttendPass helps training teams manage registration through arrival in one workflow: configurable registration forms, approval and waitlists, attendee QR passes, and check-in with an encrypted offline queue.

## Positioning

A training operations workflow that connects registration, approval, attendee passes, and on-site check-in. Its distinguishing value is continuity across those steps, including a check-in queue that can work offline. Do not claim comparative superiority, guaranteed speed, or production readiness.

## Operating Context

Staff perform check-ins as attendees/guests arrive at an event, venue, or front desk — likely a fast-paced, standing/mobile use context, though device and environment specifics are not yet confirmed.

## Capabilities and Constraints

The local development flow now covers organizer event creation and publishing, public registration with dynamic fields and conditional logic, approval and waitlist lifecycle, private status links and QR codes, organizer registrant management and CSV export, check-in with undo and an encrypted offline queue, and system administration with audit logs. Local attachments and cover images use private disk storage. This is a development-ready local flow, not a production-ready deployment: production still needs persistent private object storage, email and LINE delivery/login, LDAP configuration from the organization's directory team, and browser/device acceptance checks. Credentials sign-in is temporary for development. UI references are in `docs/checkin-mockup-b v3/checkin-mockup-b/`.

## Product Principles

- Optimize for the moment of arrival: the check-in action itself must be fast and low-friction for staff under time pressure.
- Prefer clarity for staff over guest-facing polish, unless a future decision makes this guest-facing.
- Do not fabricate a competitive differentiator; ship what's confirmed and flag gaps.
