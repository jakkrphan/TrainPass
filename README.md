# AttendPass

Current development specification: [ระบบเช็คชื่ออบรม rev.3](docs/ระบบเช็คชื่ออบรม%20rev.3.md). It defines the `per_day` and `whole_course` seat modes. Local seed data for both modes is created by `npm.cmd run db:seed` (200 demo registrants); the existing database is not reseeded automatically during migration.

## งานดูแลที่นั่งรออนุมัติบนเครื่อง

ตั้ง `CRON_SECRET` เป็นค่าสุ่มยาวใน `.env.local` แล้วเปิด server ที่ port 3100 คำสั่งนี้จะย้ายรายการรออนุมัติที่เกิน `pendingHoldHours` ไปคิวสำรอง และเลื่อนคิวตามโหมดของโครงการ:

```powershell
npm.cmd run maintenance:pending-holds
```

ให้ตัวตั้งเวลาของเครื่องเรียกคำสั่งนี้เป็นระยะ (เช่น ทุก 15 นาที) เมื่อใช้งานจริง งานนี้ยังไม่มีบริการ scheduler ภายนอกเชื่อมอยู่

งานลบ/ปกปิดข้อมูลส่วนบุคคลตามระยะเก็บข้อมูล (PDPA) ใช้ `CRON_SECRET` เดียวกัน: โครงการที่เลยวันจัดสุดท้าย + `retentionDays` (ค่าเริ่มต้น 365 วัน ตั้งได้ในขั้นที่ 1) จะถูกลบคำตอบ อีเมล IP ความยินยอม QR และไฟล์แนบ เหลือเฉพาะสถานะและสถิติ ควรเรียกวันละครั้ง:

```powershell
npm.cmd run maintenance:retention
```

## Local MySQL with Docker

Docker Compose จะเปิด MySQL ที่ `localhost:3307` และเก็บข้อมูลไว้ใน volume `checkinhub_mysql_data` (ใช้ `3307` เพื่อไม่ชนกับ MySQL อื่นที่อาจใช้ port มาตรฐาน `3306`)

```powershell
npm.cmd run db:setup
npm.cmd run dev
```

`db:setup` จะเริ่ม MySQL, รอจนพร้อมใช้งาน, apply migrations, generate Prisma Client และเพิ่มข้อมูลตัวอย่างให้โดยอัตโนมัติ สามารถ login ด้วยบัญชี local นี้:

- Email: `admin@checkinhub.local`
- Password: `CheckInHub123!`

Local role test accounts all use password `CheckInHub123!`:

| Email | Access to test |
| --- | --- |
| `admin@checkinhub.local` | Admin: all events and `/admin` |
| `organizer@checkinhub.local` | Event owner: full management of the demo event |
| `collaborator@checkinhub.local` | `FULL` collaborator: manage the event, without owner-only collaborator administration |
| `staff@checkinhub.local` | `CHECKIN_ONLY` staff: check-in app only for the demo event |

These shared credentials are for local testing only. Never use them in production.

คำสั่งที่ใช้บ่อย:

```powershell
npm.cmd run db:up
npm.cmd run db:down
npm.cmd run db:logs
npm.cmd run db:seed
```

ข้อมูลจะไม่หายเมื่อใช้ `db:down` หากต้องการลบข้อมูล local ทั้งหมดให้ใช้ `docker compose down --volumes` โดยตั้งใจเท่านั้น

หลังเปิดแอปแบบ development ที่ port `3100` ด้วย `npm.cmd run dev -- -p 3100` ทดสอบ flow กับฐาน local ได้ด้วย:

```powershell
npm.cmd run test:integration:schedule
npm.cmd run test:integration:registration
npm.cmd run test:integration:concurrency
npm.cmd run test:integration:cancellation
npm.cmd run test:integration:pending-holds
npm.cmd run test:integration:admin
npm.cmd run test:integration:whole-course
npm.cmd run test:integration:rules
npm.cmd run test:integration:local-features
```

คำสั่งทดสอบสร้างข้อมูลชั่วคราวแล้วลบเมื่อจบ ก่อนใช้งานจริงต้องตั้งบริการส่งอีเมล/LINE

เว็บแอประบบลงทะเบียนและเช็คชื่อเข้าร่วมอบรม สร้างด้วย Next.js App Router, TypeScript, Tailwind CSS และ shadcn/ui (Radix)

## เริ่มต้น

```powershell
npm.cmd install
npm.cmd run db:validate
npm.cmd run db:generate
npm.cmd run db:migrate
npm.cmd run dev
```

เปิด `http://localhost:3000`

ก่อนรันคำสั่งฐานข้อมูล ให้ตั้งค่า `DATABASE_URL` ใน `.env.local` เป็น MySQL URL ของบัญชีที่สร้างตารางได้ และกำหนด `AUTH_SECRET` เป็นค่าสุ่มยาวอย่างน้อย 32 ไบต์ รวมถึง `AUTH_TRUST_HOST="true"` สำหรับการรันบนเครื่องนี้ ตัวอย่างตัวแปรอยู่ใน `.env.example` โดย Prisma CLI จะอ่าน `.env.local` ผ่าน `prisma.config.ts`

หลัง migration สำเร็จ สามารถสร้างบัญชี admin คนแรกด้วย `npm.cmd run admin:create` โดยตั้ง `CHECKIN_ADMIN_NAME`, `CHECKIN_ADMIN_EMAIL` และ `CHECKIN_ADMIN_PASSWORD` (อย่างน้อย 12 ตัวอักษร) ใน environment ของคำสั่งนั้น บัญชีที่มีอีเมลซ้ำจะไม่ถูกเขียนทับ

## Routes ที่เตรียมไว้

- `/` — หน้าหลัก
- `/events/[slug]` — หน้าลงทะเบียนสาธารณะ
- `/login` — เข้าสู่ระบบผู้จัด/เจ้าหน้าที่
- `/organizer` — พอร์ทัลผู้จัด
- `/check-in` — แอปเช็คชื่อหน้างาน
- `/organizer/new` — สร้างโครงการฉบับร่าง
- `/organizer/[eventId]` — ตั้งค่าโครงการ วัน/รอบ/ฟิลด์ ผู้ร่วมจัด และเผยแพร่
- `/organizer/[eventId]/registrants` — ตรวจและจัดการผู้สมัคร พร้อม CSV
- `/organizer/[eventId]/registrants/new` — เพิ่มผู้สมัครแทนผู้เข้าร่วม (ต้องยืนยันว่าได้รับความยินยอม)
- `/organizer/[eventId]/dashboard` — ยอดสมัคร ที่นั่ง และเช็คชื่อแบบ refresh ทุก 5 วินาที
- `/check-in/[eventId]` — เช็คชื่อด้วยกล้อง เครื่องยิง หรือค้นหา
- `/events/[slug]/status/[token]` — ดูสถานะ/QR และยกเลิกด้วยลิงก์ส่วนตัว

รายละเอียดขอบเขตระบบอยู่ใน `ระบบเช็คชื่ออบรม.md` และแนวทางจัดวางโค้ดอยู่ใน `docs/ARCHITECTURE.md`

## สถานะฐานข้อมูลและล็อกอิน

Prisma migration แรกถูก apply ลง Docker MySQL local แล้ว `db:setup` จะสร้างข้อมูลตัวอย่างสำหรับทดสอบ ระบบล็อกอินปัจจุบันใช้ Auth.js Credentials กับบัญชีใน MySQL; ในอนาคตจะเปลี่ยนขั้นตรวจตัวตนเป็น LDAP โดยคง role และ event membership ในฐานข้อมูลแอป

หน้าจอและธีมอ้างอิง `docs/checkin-mockup-b v3/checkin-mockup-b/` โดยสีและฟอนต์หลักแมปไว้ใน `src/app/globals.css`

ในโหมด local ผู้จัดดาวน์โหลด QR หรือออกลิงก์สถานะใหม่เพื่อส่งให้ผู้เข้าร่วมเองได้ การออกลิงก์ใหม่ทำให้ลิงก์เก่าใช้ไม่ได้ทันที หน้าเช็คชื่อจะเก็บรายการสแกนที่ส่งไม่สำเร็จแบบเข้ารหัสใน IndexedDB และซิงก์เมื่อออนไลน์อีกครั้งขณะเปิดหน้าเช็คชื่ออยู่ ต้องทดสอบการตัดเน็ตและกล้องบนอุปกรณ์จริงก่อนใช้งานหน้างาน
