# Operations

คู่มือสำหรับคนติดตั้ง/ดูแลเซิร์ฟเวอร์ ตามสเปก rev.3 ข้อ "Operations" (อัปเดต 27 ก.ย. 2026)
ค่าตัวอย่างอยู่ใน [`.env.example`](../.env.example) — ห้ามใส่คีย์จริงในไฟล์นั้น เครื่องพัฒนาใช้ `.env.local` (อยู่ใน `.gitignore`) ส่วน production ตั้งเป็น environment ของ server

## Environment variables

### ต้องตั้งก่อนเปิดใช้งานจริง

| ตัวแปร | ใช้ทำอะไร | หมายเหตุ |
| --- | --- | --- |
| `DATABASE_URL` | MySQL 8 ของแอป (Prisma) | บัญชีต้องสร้าง/แก้ตารางได้ตอนรัน `prisma migrate deploy` |
| `AUTH_SECRET` | เซ็น JWT session ของ Auth.js, HMAC ของ ticket หน้าสมัคร (`form-ticket.ts`) และ key ของการนับ login ผิด (`login-throttle.ts`) | สุ่มอย่างน้อย 32 byte (`openssl rand -base64 32`) · เปลี่ยนค่าแล้วทุกคนถูก logout และฟอร์มสมัครที่เปิดค้างไว้ต้องโหลดใหม่ · สเปกเรียกชื่อเดิมว่า `NEXTAUTH_SECRET` |
| `AUTH_TRUST_HOST` | ให้ Auth.js เชื่อ header `Host`/`X-Forwarded-*` | `"true"` เมื่ออยู่หลัง reverse proxy ที่ตั้ง header ให้เอง |
| `APP_BASE_URL` | URL จริงของระบบ เช่น `https://checkin.example.go.th` ใช้สร้างลิงก์สมัคร/QR ของโครงการ ลิงก์เชิญ/ตั้งรหัสผ่านของเจ้าหน้าที่ และเป็นปลายทางของสคริปต์ maintenance | ไม่มี `/` ท้าย · ห้ามตั้งเป็นค่าว่าง `""` (ลิงก์จะไม่มีโดเมน) · ถ้าไม่ตั้ง ลิงก์ใช้ host ของ request (ปลอมได้) และสคริปต์ maintenance ยิงไป `http://localhost:3100` |
| `UPLOAD_DIR` | โฟลเดอร์เก็บไฟล์แนบและรูปปกบนเซิร์ฟเวอร์ เช่น `/srv/attendpass-uploads` | อยู่นอกโฟลเดอร์แอปและไม่อยู่ใต้ `public/` · ให้ user ที่รันแอปเขียนได้คนเดียว (`chmod 700`) · ต้องรวมในการสำรองข้อมูล · ไม่ตั้ง = production ไม่รับอัปโหลด · **ห้ามใช้โฟลเดอร์เดียวกันกับระบบอื่น** (staging, DB ที่ copy มา) — การลบไฟล์ของระบบหนึ่งจะกระทบอีกระบบ · งาน `maintenance:retention` กวาดไฟล์กำพร้าให้ทุกวัน (ไฟล์ค้างจาก process ล่ม/ลบไม่สำเร็จ) โดยลบเฉพาะไฟล์ที่ระบบนี้บันทึกไว้ในตาราง `PendingFile` และไม่มีข้อมูลอ้างถึงเกิน 1 วัน — ไฟล์อื่นในโฟลเดอร์ไม่ถูกแตะ · ผลลัพธ์ `orphanFilesDeleted` (`null` = กวาดไม่สำเร็จ สคริปต์ maintenance จะจบด้วย exit code 1) |
| `CRON_SECRET` | รหัสของ `/api/jobs/pending-holds` และ `/api/jobs/retention` | สุ่มยาว · ไม่ตั้ง = งานตั้งเวลาตอบ 503 |

### บริการภายนอก

| ตัวแปร | ใช้ทำอะไร |
| --- | --- |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | ส่งอีเมลแจ้งผลการลงทะเบียนผ่าน SMTP · 465 ใช้ `SMTP_SECURE=true`; 587 ใช้ `false` และบังคับ STARTTLS · `SMTP_FROM` เป็นอีเมลเดี่ยว · เก็บค่าจริงใน `.env.local` หรือ secrets ของ deployment; แอปไม่อ่าน `.env.example` |
| `LINE_LOGIN_CHANNEL_ID`, `LINE_LOGIN_CHANNEL_SECRET` | ช่อง LINE Login (ผู้สมัคร login) — ลงทะเบียน callback `<APP_BASE_URL>/api/line/callback` และผูก OA ใน Basic settings |
| `LINE_MESSAGING_CHANNEL_ID`, `LINE_MESSAGING_CHANNEL_SECRET`, `LINE_MESSAGING_ACCESS_TOKEN` | ช่อง Messaging API (OA) — ส่งข้อความ · secret ใช้ตรวจลายเซ็น webhook · token เป็น long-lived channel access token · **ทั้งสองช่องต้องอยู่ provider เดียวกัน** |

หน้า admin "ตั้งค่าระบบ" (`/admin?view=settings`) บอกว่าตั้งคีย์ของอีเมล/LINE แล้วหรือยัง (ไม่แสดงค่า) · LINE ใช้งานได้เมื่อตั้งคีย์ครบ **และ** admin เปิดสวิตช์ "LINE Login และแจ้งเตือนทาง LINE"

อีเมลแจ้งผลเปิดเป็นค่าเริ่มต้นเมื่อยังไม่มีค่าที่ admin บันทึกไว้ ปิดได้ที่สวิตช์ "ส่งอีเมลแจ้งผู้สมัคร" (คิวที่หยิบมาขณะปิดจะเป็น `SKIPPED`) · ใช้ SMTP เท่านั้น ไม่ใช้ `RESEND_API_KEY`/`EMAIL_FROM` เดิม · ตรวจ DNS/TLS/รหัสผ่านโดยไม่ส่งข้อความด้วย `npm run email:verify` ตาม [SMTP transport ของ Nodemailer](https://nodemailer.com/smtp) การตรวจนี้ไม่ได้ยืนยันว่าอีเมลจะเข้ากล่องผู้รับ

แจ้งผลตอนสมัครออนไลน์/ผู้จัดเพิ่มผู้สมัครและเมื่ออนุมัติ ปฏิเสธ เลื่อนคิว ยกเลิก หรือเปลี่ยนวัน ผ่าน `NotificationLog` ใน transaction เดียวกับสถานะ แล้วส่งด้วย `after()` · แนบ QR PNG เฉพาะผู้มีวันอนุมัติ และมีลิงก์สถานะที่ถูกยกเลิกได้ด้วยการออกลิงก์ใหม่ · production ต้องตั้ง `APP_BASE_URL=https://โดเมนแอป` (ไม่ใช้ Host header); development ใช้ `http://localhost:3100` ถ้าไม่ตั้ง

SMTP 4xx/connection timeout ลองใหม่สูงสุด 4 ครั้ง รวมครั้งแรก เว้น 1/5/30 นาที; 5xx หยุดและแสดงส่งไม่สำเร็จ · ประวัติ 3 รายการล่าสุดอยู่ในรายละเอียดผู้สมัคร · `SENT` หมายถึง SMTP รับข้อความแล้ว ไม่ยืนยัน inbox/bounce · Message-ID คงเดิมเมื่อ retry แต่ SMTP ไม่รับประกัน exactly-once หากโปรเซสล่มหลังส่งสำเร็จก่อนบันทึกฐานข้อมูล · ถ้า LINE ส่งไม่สำเร็จถาวรจะเข้าคิวอีเมลแทน และข้ามหากส่งผลสถานะเดียวกันทางอีเมลสำเร็จแล้ว

ขอบเขต 30 ก.ย. คือ **แจ้งผลเท่านั้น**: ยังไม่มีปุ่มส่งอีเมลซ้ำ/แก้อีเมล ประกาศ ลืมรหัสผ่าน magic link/OTP หรือเตือนก่อนวันงาน · ทดสอบโดยไม่ส่งอีเมลจริงด้วย `npm test` และ `npm run test:integration:email` (ใช้ฐานข้อมูล local และ sender จำลอง) · smoke test อื่นที่สมัครผ่านแอปต้องปิดสวิตช์อีเมลหรือใช้ SMTP ทดสอบก่อนรัน

**ที่เก็บไฟล์:** ไฟล์แนบและรูปปกเก็บบนดิสก์ของเซิร์ฟเวอร์ในโฟลเดอร์ `UPLOAD_DIR` (ตารางด้านบน) — production ที่ไม่ได้ตั้งค่านี้จะไม่รับอัปโหลด (โครงการที่มีฟิลด์ไฟล์เผยแพร่/รับสมัครไม่ได้ และใส่รูปปกไม่ได้) · development ไม่ตั้งก็ได้ ใช้ `.local-uploads/` · ไฟล์ส่งผ่านแอปเท่านั้น (ตรวจสิทธิ์ก่อน) ห้ามให้ web server เสิร์ฟโฟลเดอร์นี้ตรง · ระบบรองรับเซิร์ฟเวอร์แอปเครื่องเดียว ถ้ามีหลายเครื่องต้องใช้โฟลเดอร์ร่วม (NFS) ที่เดียวกัน

**ตั้งค่า `UPLOAD_DIR` (เซิร์ฟเวอร์ PM2):**

1. สร้างโฟลเดอร์นอกโฟลเดอร์แอป ให้ user ที่รัน PM2 เป็นเจ้าของ
   ```sh
   sudo mkdir -p /srv/attendpass-uploads
   sudo chown <user ที่รัน pm2> /srv/attendpass-uploads
   sudo chmod 700 /srv/attendpass-uploads
   ```
   (Windows: เช่น `D:\attendpass-uploads` ให้ user ที่รันแอปมีสิทธิ์เขียน)
2. เพิ่มใน `.env` ข้าง `ecosystem.config.cjs` — ใช้ path เต็ม: `UPLOAD_DIR="/srv/attendpass-uploads"`
3. `pm2 reload ecosystem.config.cjs` — ค่านี้อ่านตอนเริ่มโปรเซส ไม่ต้อง build ใหม่
4. ทดสอบ: สร้างโครงการแล้วใส่รูปปก

**อัปรูปปกไม่ได้:** ข้อความในหน้าสร้าง/แก้ไขโครงการบอกสาเหตุ (`cover-errors.ts`) — "เซิร์ฟเวอร์ยังไม่พร้อมรับรูปปก" = ยังไม่ได้ตั้ง `UPLOAD_DIR` · "เกิน 3 MB" = ไฟล์ที่ส่งถึงเซิร์ฟเวอร์ใหญ่เกินจริง (หน้าเว็บย่อรูปเป็น 1600×900 ก่อนส่ง จึงไม่ค่อยเกิด) · "รูปปกไม่ถูกต้อง" = ไม่ใช่ JPG/PNG/WebP หรือ `sharp` อ่านรูปไม่ได้ · ดูรายละเอียดด้วย `pm2 logs attendpass` (บรรทัด `Cover upload refused: UPLOAD_DIR is not set` หรือ `Cover image could not be processed:` ตามด้วย error ของ `sharp` — ถ้าทุกรูปขึ้นแบบหลัง ให้ตรวจว่าติดตั้ง `sharp` ตรงกับ OS/CPU ของเซิร์ฟเวอร์ โดยรัน `npm ci` บนเครื่องนั้นแล้ว build ใหม่)

### ตัวเลือก

| ตัวแปร | ใช้ทำอะไร |
| --- | --- |
| `LDAP_URL` | เปิด login ด้วย AD/LDAP (`ldaps://ad.example:636`) — ว่าง = ใช้อีเมล + รหัสในระบบอย่างเดียว · ต้องตั้ง `LDAP_BASE_DN`, `LDAP_BIND_DN` (DN หรือ UPN), `LDAP_BIND_PASSWORD` (service account อ่านอย่างเดียว) ด้วย — ชื่อตัวแปรเหมือน portalrpp ใช้ค่าเดิมได้ · ห้ามใช้ `ldap://` เปล่าบน production (รหัสผ่านวิ่งแบบไม่เข้ารหัส) ถ้าจำเป็นให้ตั้ง `LDAP_STARTTLS="true"` |
| `LDAP_REQUIRED_OU` / `LDAP_AUTO_PROVISION` / `LDAP_SEARCH_FILTER` | OU ที่อนุญาตให้เข้า (เช่น `rpp-user`) · `"true"` = สร้างบัญชีผู้จัดโครงการ (ORGANIZER) ให้อัตโนมัติตอน login AD ครั้งแรก (ค่าเริ่มต้นปิด: admin ต้องสร้างบัญชีโดยใส่ UPN ของ AD เป็นอีเมลก่อน) · filter ค้นหา (`{{username}}` ถูก escape ให้) |
| `LDAP_TLS_CA_FILE` / `LDAP_TLS_REJECT_UNAUTHORIZED` / `LDAP_TIMEOUT` / `LDAP_CONNECT_TIMEOUT` | CA ของหน่วยงาน (PEM) · ห้ามตั้ง `false` บน production · timeout (ค่าเริ่มต้น 5000 ms) |
| `FEATURE_KIOSK` | ค่าเริ่มต้นของสวิตช์ kiosk (`"true"` = เปิด) ใช้เฉพาะตอนที่ admin ยังไม่เคยบันทึกสวิตช์นี้ในหน้าตั้งค่าระบบ |
| `NODE_ENV` | `production` ตั้งให้เองโดย `next build`/`next start` — เปิด HSTS, cookie `secure`, ปิดการเก็บไฟล์ในเครื่อง |

### ใช้เฉพาะสคริปต์ (ไม่ต้องตั้งบน server)

| ตัวแปร | สคริปต์ |
| --- | --- |
| `CHECKIN_ADMIN_NAME`, `CHECKIN_ADMIN_EMAIL`, `CHECKIN_ADMIN_PASSWORD` | `npm run admin:create` สร้าง admin คนแรก (รหัสผ่าน ≥ 12 ตัว) |
| `BASE_URL`, `CHROME_PATH`, `CHECK_EMAIL`, `CHECK_PASSWORD` | `npm run test:responsive` |

## ขั้นตอนขึ้นระบบ

```sh
npm ci
npx prisma migrate deploy   # ใช้ DATABASE_URL
npm run build
npm run admin:create        # ครั้งแรกเท่านั้น
npm run start
```

ห้ามรัน `npm run db:seed` บน production (สร้างบัญชีทดสอบที่ใช้รหัสผ่านร่วมกัน)

**Reverse proxy ต้องเขียนทับ `X-Forwarded-For`** (ไม่ใช่ต่อท้ายค่าที่ client ส่งมา) — rate limit ของการสมัครและ login อ่าน IP จากค่าแรกของ header นี้ ถ้า proxy ส่งต่อค่าจาก client บอทจะปลอม IP ใหม่ทุกครั้งและข้าม limit ได้ (nginx: `proxy_set_header X-Forwarded-For $remote_addr;`)

## Health check

`GET /api/health` — ไม่ต้อง login, ไม่ cache, ตรวจว่าต่อ MySQL ได้

- `200 {"status":"ok","database":"ok"}`
- `503 {"status":"unavailable","database":"unavailable"}`

ใช้กับ load balancer / uptime monitor

## งานตั้งเวลา

ทั้งสองงานเป็น `GET` ที่ต้องส่ง header `Authorization: Bearer <CRON_SECRET>` (เทียบแบบ constant-time) ตอบกลับเป็นจำนวนอย่างเดียว

| งาน | endpoint | สคริปต์ | ความถี่ | ทำอะไร |
| --- | --- | --- | --- | --- |
| หมดเวลาจองที่ | `/api/jobs/pending-holds` | `npm run maintenance:pending-holds` | ทุก ~15 นาที | ย้ายผู้สมัครรออนุมัติที่เกิน `pendingHoldHours` ไปคิวสำรอง แล้วเลื่อนคิวตามโหมดของโครงการ |
| กวาดไฟล์กำพร้า | `/api/jobs/retention` | `npm run maintenance:retention` | วันละครั้ง | ลบไฟล์ที่ไม่มีข้อมูลอ้างถึงแล้ว (ดู `UPLOAD_DIR`) · **ไม่ลบหรือปกปิดข้อมูลที่ลงทะเบียน** — ข้อมูลเก็บถาวรตั้งแต่ 16 ต.ค. 2026 (ชื่อ endpoint คงเดิมเพื่อไม่ให้ cron เดิมเสีย) |
| ส่งแจ้งเตือนที่ค้าง (LINE + อีเมล) | `/api/jobs/notifications` | `npm run maintenance:notifications` | ทุก ~5 นาที | เก็บคิวหลังเซิร์ฟเวอร์รีสตาร์ตและ retry · ครั้งละไม่เกิน 25 รายการต่อช่องทาง; LINE ก่อนเพื่อให้อีเมล fallback ส่งได้ในรอบเดียวกัน |

ตัวอย่าง crontab (เครื่องที่มีโค้ดและ `.env` ของแอป — สคริปต์อ่าน `CRON_SECRET` และ `APP_BASE_URL`):

```cron
*/15 * * * *  cd /srv/attendpass && npm run -s maintenance:pending-holds
*/5 * * * *   cd /srv/attendpass && npm run -s maintenance:notifications
30 2 * * *    cd /srv/attendpass && npm run -s maintenance:retention
```

หรือเรียก endpoint ตรงจากตัวตั้งเวลาภายนอก: `curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://…/api/jobs/retention`

## โครงสร้าง log

ระบบมีบันทึก 2 แบบ แยกหน้าที่กัน (กติกา PDPA อยู่ใน [ARCHITECTURE.md → Logging (PDPA)](ARCHITECTURE.md#logging-pdpa))

**1. ตาราง `AuditLog` ใน MySQL** — หลักฐานว่าใครทำอะไร ดูได้ที่ `/admin?view=audit` (กรองตามผู้ทำ/โครงการ/ช่วงวันที่)

| คอลัมน์ | ความหมาย |
| --- | --- |
| `action` | รหัสเหตุการณ์ เช่น `REGISTRANT_DAYS_CHANGED`, `EXPORT_XLSX`, `ADMIN_FEATURE_TOGGLED` — ป้ายภาษาไทยอยู่ที่ `src/features/audit/labels.ts` |
| `actorId` | เจ้าหน้าที่ที่ทำ · `null` = ผู้สมัครทำเองหรืองานของระบบ |
| `eventId` | โครงการที่เกี่ยวข้อง (ถ้ามี) |
| `target` | id ของสิ่งที่ถูกกระทำ เช่น registrantId, userId |
| `metadata` | JSON ของ id และชื่อฟิลด์ ไม่เก็บค่าคำตอบ/อีเมลผู้สมัคร (ยกเว้นการแก้อีเมลบัญชีเจ้าหน้าที่) |
| `createdAt` | เวลา (UTC ในฐานข้อมูล แสดงเป็นเวลาไทย) |

audit log ไม่ถูกลบ — ข้อมูลที่ถูกปกปิดตามคำขอลบข้อมูลยังอ้างถึงได้ด้วย id

**2. stdout/stderr ของ process** — ส่งเข้าระบบเก็บ log ของเครื่อง (journald, Docker, PM2 ฯลฯ)

- โค้ดของแอปไม่เขียน `console.*` ฝั่ง server — สิ่งที่ออกมาคือ log ของ Next.js เอง (สตาร์ต, error ที่ไม่ได้ดัก) ซึ่งเป็น stack trace และ `digest` ไม่มีค่าที่ผู้ใช้กรอก
- `LINE link failed: <รหัส>` — ผู้สมัครเชื่อม LINE ไม่สำเร็จ รหัสบอกขั้นที่ล้ม เช่น `token-400-invalid_client` = Channel secret ของช่อง Login ใน env ไม่ตรงกับใน LINE Developers (มักเกิดหลังกด Issue secret ใหม่), `id-token-400-…` = ตรวจ id_token ไม่ผ่าน
- Prisma ตั้ง `errorFormat: "minimal"` ข้อความ error จึงไม่แนบ argument ของ query
- หน้า error ฝั่ง browser บอกผู้ใช้แค่รหัสอ้างอิง (`digest`) — ใช้ค่านี้ค้นใน log ของ server
- สคริปต์ maintenance พิมพ์บรรทัดเดียวเป็นจำนวน เช่น `Checked 12 events; expired 3 pending seats.` และ exit code ≠ 0 เมื่อล้มเหลว (ให้ตัวตั้งเวลาแจ้งเตือน)
- ถ้า reverse proxy เก็บ access log ให้ระวัง URL ที่มี token: `/events/<slug>/status/<token>` (ลิงก์สถานะผู้สมัคร รวมแบบ `l.<id>.<sig>` ที่ส่งทาง LINE), `/api/line/callback?code=…` และ `/account/setup/<token>` (ลิงก์เชิญ/ตั้งรหัสผ่านของเจ้าหน้าที่) — ตัด path ส่วน token ทิ้ง หรือเก็บ access log สั้นและจำกัดคนเข้าถึง

โค้ดใหม่ที่ต้อง log: ใช้ id (registrantId, eventId, userId) เท่านั้น ห้ามอีเมล/ชื่อ/คำตอบ/token

## ข้อมูลที่ต้องสำรอง

- MySQL ทั้งฐาน (รวม `AuditLog`)
- ไฟล์แนบและรูปปกในโฟลเดอร์ `UPLOAD_DIR` (ชื่อไฟล์อ้างจากฐานข้อมูล — สำรองและกู้คืนคู่กับ MySQL จากเวลาเดียวกัน)
- ค่า env ของ production (โดยเฉพาะ `AUTH_SECRET`, `CRON_SECRET`) เก็บในที่เก็บความลับของหน่วยงาน

แผนสำรอง/กู้คืนจริง (ความถี่, ระยะเก็บ, ที่เก็บ, การทดสอบกู้) ยังรอข้อมูลจากหน่วยงาน — PROGRESS.md หมวด E
