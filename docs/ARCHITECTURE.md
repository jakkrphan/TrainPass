# TrainPass architecture

โครงนี้แบ่งตามขอบเขตการเข้าถึงที่ระบุในสเปก:

- `src/app/(public)` — หน้าไม่ต้องเข้าสู่ระบบ เช่น หน้าลงทะเบียนของโครงการ
- `src/app/(auth)` — หน้าเข้าสู่ระบบผู้จัดและเจ้าหน้าที่
- `src/app/(organizer)` — พอร์ทัลผู้จัด ต้องผ่าน auth และ event access guard
- `src/app/(check-in)` — งานหน้างาน รองรับผู้ร่วมจัดสิทธิ์ `checkin_only`
- `src/features` — domain types และ logic แยกตามความสามารถของระบบ
- `src/server/authorization` — policy กลางที่ endpoint และ Server Component ต้องใช้ร่วมกัน
- `prisma/schema.prisma` — MySQL schema สำหรับผู้ใช้ โครงการ วันจัด รอบ ผู้ลงทะเบียน และเช็คชื่อ

## Access-control invariants

1. Query รายการโครงการต้องกรองที่ backend จาก owner/collaborator เสมอ ยกเว้น system admin
2. ผู้ร่วมจัด `CHECKIN_ONLY` เข้าถึงได้เฉพาะ workflow เช็คชื่อ
3. การลบโครงการและจัดการผู้ร่วมจัดเป็นสิทธิ์ owner; admin ทำได้เพื่อดูแลระบบแต่ต้องเขียน `AuditLog`
4. ทุก mutation ของ event ต้องตรวจสิทธิ์อีกครั้งใน server action/route handler ห้ามพึ่งการซ่อนปุ่มใน UI

## Suggested implementation order

1. ติดตั้ง Prisma, สร้าง client และ validate schema กับ MySQL
2. เพิ่ม Auth.js Credentials และ session ที่มี `user.id`, `user.role`, `user.isActive`
3. ทำ guard ที่อ่าน membership จากฐานข้อมูล แล้วจึงเริ่ม Event CRUD
4. ทำ form builder, public registration, approval/dashboard และ check-in ตามลำดับในสเปก

## Authentication roadmap

ระหว่างพัฒนาใช้ Auth.js Credentials ตรวจอีเมล/รหัสผ่านกับ `User.passwordHash` ใน MySQL local เท่านั้น ระบบจริงในอนาคตจะตรวจตัวตนผ่าน LDAP (ต้องกำหนด server, TLS, search/bind, รหัสประจำตัวที่คงที่ และ group mapping ก่อน) โดยให้ `User` ในฐานข้อมูลแอปยังเก็บ role, `isActive` และ event membership ต่อไป ขั้นย้ายไป LDAP ต้องปรับ schema ให้บัญชี LDAP ไม่ต้องมี `passwordHash` และแมป LDAP identity เข้ากับ `User` อย่างชัดเจน โดยยังใช้กฎสิทธิ์ของโครงการและ session guard เดิม

## Session strategy (ตัดสินใจ 27 ก.ย. 2026 — ผู้ใช้ยืนยันแล้ว 28 ก.ย.)

สเปกแนะนำ database session เพื่อให้ปิดบัญชีแล้วตัด session ทันที ระบบนี้ **คง JWT session ของ Auth.js ไว้** เพราะได้ผลเท่ากันในทางปฏิบัติ:

- ทุกหน้า/server action/route handler ที่ต้อง login เรียก `requireActiveUser` / `requireAdminUser` / `requireEventAccess` (`src/server/authorization/`) ซึ่งอ่าน `User.isActive`, `role` และ membership จาก MySQL **ทุก request** — JWT ใช้บอกแค่ว่าเป็นใคร ไม่ได้เก็บสิทธิ์ ดังนั้นปิดบัญชี เปลี่ยน role หรือถอดออกจากโครงการ มีผลตั้งแต่ request ถัดไป (ตรวจแล้ว 27 ก.ย.: handler ที่ไม่เรียก guard มีแค่ login และตั้งรหัสผ่านจากลิงก์เชิญ ซึ่งเป็นขั้นก่อน login)
- ไม่ต้องมีตาราง Session และไม่ต้อง query เพิ่มตอนอ่าน session (เราอ่าน User อยู่แล้ว)
- ข้อจำกัดที่ยอมรับ: บังคับ logout "ทุกเครื่อง" ของบัญชีที่ยังเปิดอยู่ไม่ได้ (เช่น รหัสผ่านหลุด) ถ้าจำเป็นให้เพิ่ม `User.sessionVersion` ใส่ใน JWT แล้วให้ guard เทียบค่า — เพิ่มได้โดยไม่ต้องเปลี่ยนเป็น database session
- ข้อกำหนดต่อไป: handler ใหม่ที่ต้อง login ต้องเรียก guard ข้างต้นเสมอ ห้ามเชื่อ `session.user` จาก JWT อย่างเดียว
- ใช้ต่อได้หลังเปลี่ยนเป็น LDAP: LDAP ตรวจรหัสแค่ตอน login ส่วน session หลัง login ยังเป็น JWT เหมือนเดิม (ดู "ข้อควรทำตอนเปลี่ยนเป็น LDAP")

## ข้อควรทำตอนเปลี่ยนเป็น LDAP (บันทึก 28 ก.ย. 2026)

> ทำแล้ว 30 ก.ย. 2026 ใน `src/server/auth/ldap.ts` + `ldap-account.ts` (เปิดด้วย `LDAP_URL`): session 12 ชม., ปิดลิงก์/หน้าเปลี่ยนรหัสของบัญชี AD, บัญชีที่มีรหัสในระบบยังเข้าได้ (break-glass), role/สิทธิ์ยังอยู่ใน `User` · ยังไม่มี: แมปกลุ่ม AD → role และงานซิงก์สถานะบัญชีจาก AD

- **รหัสผ่านอยู่ที่ LDAP**: login ตรวจกับ LDAP ทุกครั้ง เปลี่ยนรหัสที่ LDAP มีผลตั้งแต่ login ครั้งถัดไป · บัญชี LDAP ไม่ต้องมี `passwordHash`
- **บัญชีถูกปิด/เปลี่ยนรหัสใน LDAP ไม่รู้ถึงระบบเราเอง** (guard เช็ค `User.isActive` ในฐานเรา) → ตั้ง session ให้หมดอายุสั้น (8–12 ชม.) แล้วบังคับ login ผ่าน LDAP ใหม่ และ/หรือมีงานตั้งเวลาดึงสถานะบัญชีจาก LDAP มาอัปเดต `isActive`
- **ปิดหน้าเปลี่ยนรหัสผ่าน (`/account/password`) และลิงก์ลืม/ตั้งรหัสผ่านสำหรับบัญชี LDAP** — ชี้ไปที่ระบบเปลี่ยนรหัสของหน่วยงานแทน (เปลี่ยนในระบบเราไม่มีผลกับ LDAP)
- **เก็บบัญชี admin ในเครื่อง 1 บัญชี (break-glass)** ไว้เข้าระบบเมื่อ LDAP ล่มหรือเชื่อมไม่ได้ — รหัสแข็งแรง เก็บในที่เก็บความลับของหน่วยงาน ใช้แล้วบันทึก audit
- role และสิทธิ์รายโครงการยังเก็บใน `User`/`EventOrganizer` เหมือนเดิม (แมปกลุ่ม LDAP → role ตามกติกาที่หน่วยงานให้)

## Logging (PDPA)

- ห้ามเขียนอีเมล/ชื่อ/คำตอบลง server log ให้ใช้ id แทน — ตรวจแล้ว 27 ก.ย.: `console.*` ฝั่ง server มีจุดเดียวคือ `LINE link failed: <รหัสเหตุผล>` ใน `/api/line/callback` (ไม่มี token หรือ LINE ID), สคริปต์ maintenance พิมพ์แค่จำนวน
- Prisma ตั้ง `errorFormat: "minimal"` (`src/server/db.ts`) เพื่อไม่ให้ error message แนบ argument ของ query (อีเมล/answers) ลง log
- หน้า error ฝั่ง browser log แค่รหัสอ้างอิง (`digest`)
- ข้อมูลใน `AuditLog.metadata` เป็นหลักฐานในฐานข้อมูล ไม่ใช่ system log: เก็บ id/ชื่อฟิลด์ ไม่เก็บค่าคำตอบของผู้สมัคร (ยกเว้นการแก้บัญชีเจ้าหน้าที่ที่ต้องเก็บอีเมลเดิม/ใหม่ของบัญชีนั้น)

## ทำต่างจากสเปก rev.3 และเหตุผล (บันทึก 5 ต.ค. 2026)

| เรื่อง | สเปก | ระบบนี้ | เหตุผล |
|---|---|---|---|
| ลิงก์สมัคร | `/r/<slug>` | หน้าจริง `/events/<slug>` · `/r/<slug>` redirect 307 มาที่หน้านี้ และเป็นลิงก์ที่โปสเตอร์/QR/ปุ่มคัดลอกใช้ | หน้าลูก (`/status/<token>`, `/cover`) อยู่ใต้ `/events/<slug>` อยู่แล้ว · ลิงก์ที่แชร์ยังสั้นตามสเปก |
| เก็บรหัสผ่าน | argon2id หรือ bcrypt | bcrypt cost 12 (`bcryptjs`) | สเปกยอมรับทั้งสองแบบ · bcryptjs เป็น JS ล้วน ไม่ต้องคอมไพล์ native module บน Windows/Vercel · บัญชีส่วนใหญ่ login ผ่าน AD จึงแทบไม่มีรหัสในระบบ |
| ชื่อรอบเช็คชื่อซ้ำ | `@@unique([eventId, label])` | ซ้ำได้ถ้าอยู่คนละวัน · ห้ามซ้ำในวันเดียวกัน (ตรวจใน `sessionLabelTaken`, `schedule-actions.ts`) | หลักสูตรหลายวันใช้ชื่อเดิมทุกวัน ("เช้า", "บ่าย") · `eventDayId` เป็น null ได้ unique index ของ MySQL จึงบังคับกฎนี้ไม่ได้ ต้องตรวจในโค้ด |
| Session ผู้จัด | database session | JWT ของ Auth.js + guard อ่าน `User` ทุก request | ดู "Session strategy" ด้านบน |
| ช่องทางรับ QR | อีเมล **หรือ** LINE · คนใช้ LINE มี `dedupeKey = line:<lineUserId>` | ตรงสเปก แต่ตั้ง `line:<id>` **ตอนเชื่อม LINE สำเร็จ** ไม่ใช่ตอนส่งใบสมัคร | ตอนส่งใบสมัครยังไม่รู้ LINE user ID (ได้หลัง LINE Login) · ก่อนเชื่อมมีแค่ rate limit ต่อ IP กันยิงซ้ำ · ถ้า LINE นั้นลงโครงการไว้แล้ว ใบใหม่ถูกยกเลิกอัตโนมัติ (`cancelDuplicateRegistration`) และพาไปหน้าใบเดิม |
| ข้อความ LINE | push QR | การ์ด Flex + ปุ่มเปิดหน้าสถานะ (มี QR) | LINE รับรูปจาก URL https เท่านั้น — ส่งรูปตรงได้เมื่อขึ้น production ที่มี HTTPS |
| หน้าเช็คสถานะ | กรอกอีเมลแล้วรับ magic link/OTP | ลิงก์หน้าสถานะเป็น bearer token (สุ่ม 256 บิต เก็บแค่ hash) ส่งให้ตอนสมัคร/ในอีเมล/LINE · ผู้จัดออกลิงก์ใหม่ได้ (ลิงก์เก่าใช้ไม่ได้) | ผู้ใช้ตัดสิน 5 ต.ค. ไม่ทำ magic link/OTP · ไม่มีช่องให้กรอกอีเมลเพื่อดึงข้อมูล จึงไม่มีปัญหา enumeration ที่สเปกเตือน |
| ลืมรหัสผ่านเจ้าหน้าที่ | ส่งลิงก์ทางอีเมล | ไม่มี · หน้า login ลิงก์ไประบบเปลี่ยนรหัสของ intranet | เจ้าหน้าที่ใช้บัญชี AD ของโดเมน (ผู้ใช้ตัดสิน 5 ต.ค.) |
| `AuditLog.ip` / `userAgent` | มีในโมเดล | ไม่เก็บ | ผู้ใช้ตัดสิน 5 ต.ค. · audit ยังมีผู้ทำ เวลา การกระทำ และเป้าหมาย |
