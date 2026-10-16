// System-wide feature switches. Admins change them from /admin?view=settings; a switch without a saved row uses
// `defaultEnabled`. Read them on the server with `getFeatureFlags()` / `isFeatureEnabled()` from
// `@/server/settings/features` — never trust a value sent back from the browser.

export type FeatureGroup = "registration" | "organizer" | "checkin" | "integration";

export type FeatureDefinition = {
  key: string;
  group: FeatureGroup;
  label: string;
  /** What the feature does while on. */
  description: string;
  /** What people see or can no longer do while it is off. */
  whenOff: string;
  defaultEnabled: boolean;
  /** Shown next to the switch when turning it on/off needs care. */
  warning?: string;
  /** Keys a built feature needs in .env; the settings tab shows whether they are set. */
  env?: readonly string[];
  /**
   * `not-built`: the switch is listed so admins can see what is coming, but it stays off and cannot be changed
   * until the feature ships. `env` names the keys it needs in .env.
   */
  availability?: { status: "not-built"; env?: readonly string[] };
};

export const featureGroups: { value: FeatureGroup; label: string; description: string }[] = [
  { value: "registration", label: "ผู้ลงทะเบียน", description: "สิ่งที่ผู้สมัครทำเองได้จากหน้าสมัครและหน้าสถานะ มีผลกับทุกโครงการ" },
  { value: "organizer", label: "ผู้จัดโครงการ", description: "สิทธิ์ของผู้จัดที่เกี่ยวกับการสร้างโครงการและข้อมูลส่วนบุคคล — admin ทำได้เสมอ" },
  { value: "checkin", label: "เช็คชื่อหน้างาน", description: "วิธีเช็คชื่อที่เปิดให้เจ้าหน้าที่ใช้" },
  { value: "integration", label: "บริการภายนอก", description: "ต้องตั้งค่าคีย์ใน .env ของเซิร์ฟเวอร์ · รายการที่ยังไม่พัฒนาจะเปิดได้เมื่อพัฒนาเสร็จ" },
];

export const featureDefinitions = [
  {
    key: "publicRegistration", group: "registration", defaultEnabled: true,
    label: "รับลงทะเบียนออนไลน์",
    description: "หน้าลงทะเบียนสาธารณะของทุกโครงการที่เผยแพร่แล้วรับใบสมัครได้",
    whenOff: "ทุกโครงการแสดง \"ปิดรับลงทะเบียนออนไลน์ชั่วคราว\" · ผู้จัดยังเพิ่มผู้ลงทะเบียนเองได้ และคนที่สมัครแล้วยังใช้หน้าสถานะ/เช็คชื่อได้ตามปกติ",
    warning: "ใช้เป็นสวิตช์ฉุกเฉิน เช่น ระหว่างปิดปรับปรุงระบบหรือพบการสมัครผิดปกติ",
  },
  {
    key: "selfEdit", group: "registration", defaultEnabled: true,
    label: "ผู้สมัครแก้ข้อมูลเอง",
    description: "ปุ่ม \"แก้ไขข้อมูลของฉัน\" ในหน้าสถานะ (ก่อนปิดรับและก่อนเช็คชื่อ)",
    whenOff: "ซ่อนปุ่มและปิดหน้าแก้ข้อมูล · ผู้สมัครต้องติดต่อผู้จัดให้แก้แทน",
  },
  {
    key: "selfDayChange", group: "registration", defaultEnabled: true,
    label: "ผู้สมัครเปลี่ยนวันเอง",
    description: "ปุ่ม \"เปลี่ยนวันที่เข้าร่วม\" สำหรับโครงการที่นับที่นั่งรายวัน",
    whenOff: "ซ่อนปุ่มและปิดหน้าเปลี่ยนวัน",
  },
  {
    key: "selfCancel", group: "registration", defaultEnabled: true,
    label: "ผู้สมัครยกเลิกเอง",
    description: "กล่อง \"มาไม่ได้?\" และ \"ยกเลิกเฉพาะบางวัน\" ในหน้าสถานะ — คืนที่นั่งให้คิวสำรองทันที",
    whenOff: "ผู้สมัครยกเลิกเองไม่ได้ ต้องแจ้งผู้จัด · ที่นั่งจะไม่ถูกคืนจนกว่าผู้จัดจะยกเลิกให้",
  },
  {
    key: "dataDeletionRequest", group: "registration", defaultEnabled: true,
    label: "ขอลบข้อมูลของฉัน (PDPA)",
    description: "ผู้สมัครส่งคำขอลบข้อมูลจากหน้าสถานะ ผู้จัดกดลบ (ปกปิดข้อมูลและยกเลิกการลงทะเบียน) หรือปฏิเสธพร้อมเหตุผล — บันทึก audit ทุกขั้น",
    whenOff: "ซ่อนช่องทางส่งคำขอ ผู้สมัครต้องติดต่อผู้จัดเอง · คำขอที่ส่งมาแล้วยังดำเนินการต่อได้",
    warning: "PDPA กำหนดให้มีช่องทางใช้สิทธิ์เจ้าของข้อมูล — ถ้าปิดต้องมีช่องทางอื่นแทน",
  },
  {
    key: "organizerCreateEvents", group: "organizer", defaultEnabled: true,
    label: "ผู้จัดสร้างโครงการเอง",
    description: "บัญชีสิทธิ์ \"ผู้จัดโครงการ\" กดสร้างโครงการใหม่และทำสำเนาได้",
    whenOff: "เฉพาะ admin สร้างโครงการได้ ผู้จัดยังแก้/ดูแลโครงการที่มีอยู่ได้ตามปกติ",
  },
  {
    key: "eventClone", group: "organizer", defaultEnabled: true,
    label: "ทำสำเนาโครงการ (clone)",
    description: "คัดลอกข้อมูล ฟอร์ม และรอบเช็คชื่อไปเป็นโครงการใหม่ฉบับร่าง",
    whenOff: "ซ่อนปุ่มทำสำเนาทุกที่ (รวมถึง admin)",
  },
  {
    key: "walkIn", group: "organizer", defaultEnabled: true,
    label: "เพิ่มผู้ลงทะเบียนเอง (walk-in)",
    description: "ผู้จัดกรอกใบสมัครแทนผู้เข้าร่วมจากหน้ารายชื่อ",
    whenOff: "ซ่อนปุ่มและปิดหน้าเพิ่มผู้ลงทะเบียนเอง",
  },
  {
    key: "exportData", group: "organizer", defaultEnabled: true,
    label: "ส่งออกรายชื่อ (Excel/CSV)",
    description: "ดาวน์โหลดรายชื่อและคำตอบของผู้ลงทะเบียน (บันทึก audit log ทุกครั้ง)",
    whenOff: "ปิดการส่งออกทุกโครงการ รวมถึง admin — ลดความเสี่ยงข้อมูลส่วนบุคคลหลุดออกนอกระบบ",
    warning: "ข้อมูลส่วนบุคคล (PDPA) — เปิดเฉพาะช่วงที่จำเป็นได้",
  },
  {
    key: "cameraScan", group: "checkin", defaultEnabled: true,
    label: "สแกนด้วยกล้อง",
    description: "ตัวเลือก \"กล้อง\" ในหน้าเช็คชื่อ สำหรับเครื่องที่ไม่มีเครื่องยิง QR",
    whenOff: "ทุกเครื่องใช้โหมดเครื่องยิง QR/พิมพ์รหัสเท่านั้น",
  },
  {
    key: "checkinOverride", group: "checkin", defaultEnabled: true,
    label: "อนุญาตเช็คชื่อกรณีพิเศษ",
    description: "owner/ผู้ร่วมจัดเต็มสิทธิ์ให้คนที่ไม่ได้ลงวันนี้เช็คชื่อได้ พร้อมบันทึกเหตุผลลง audit log",
    whenOff: "คนที่ไม่ได้ลงวันนั้นเช็คชื่อไม่ได้เลย ต้องให้ผู้จัดอนุมัติวันก่อน",
  },
  {
    key: "kiosk", group: "checkin", defaultEnabled: false,
    label: "ตู้ kiosk ให้ผู้เข้าร่วมสแกนเอง",
    description: "หน้าจอสแกน QR ด้วยตัวเอง ล็อกด้วย PIN ของเจ้าหน้าที่",
    whenOff: "ซ่อนปุ่ม kiosk และปิดหน้า kiosk",
    warning: "ยังไม่มีขั้นตอน \"ลืม PIN\" — PIN อยู่แค่ในแท็บเบราว์เซอร์ ถ้าลืมต้องปิดแท็บแล้วเข้าสู่ระบบใหม่",
  },
  {
    key: "emailNotifications", group: "integration", defaultEnabled: true,
    label: "ส่งอีเมลแจ้งผู้สมัคร",
    description: "ส่งผลการลงทะเบียน อนุมัติ/ปฏิเสธ เลื่อนคิว และยกเลิกทางอีเมล พร้อมแนบ QR เมื่ออนุมัติ · ส่งผ่าน SMTP และดูผลการส่งได้ในหน้ารายชื่อ",
    whenOff: "ไม่ส่งอีเมลแจ้งผล รวมอีเมลที่ยังค้างในคิวและการส่งแทน LINE · ผู้สมัครยังดูผลจากลิงก์หน้าสถานะได้",
    env: ["SMTP_HOST", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"],
  },
  {
    key: "lineLogin", group: "integration", defaultEnabled: false,
    label: "LINE Login และแจ้งเตือนทาง LINE",
    description: "ผู้สมัครเลือกช่องทางรับ QR ได้ระหว่างอีเมลกับ LINE (ตอนสมัครหรือในหน้าสถานะ) → login ด้วย LINE และเพิ่มเพื่อน OA → ระบบส่งผลอนุมัติ/ปฏิเสธ/เลื่อนคิว/ยกเลิก พร้อมลิงก์ QR ทาง LINE แทนอีเมล · ผู้จัดเห็นสถานะการส่งและส่งซ้ำได้ในหน้ารายชื่อ",
    whenOff: "ซ่อนตัวเลือก LINE และไม่ส่งข้อความทาง LINE · ข้อความที่ค้างอยู่ส่งทางอีเมลแทน",
    warning: "OA แพ็กเกจฟรีส่งได้ 300 ข้อความ/เดือน — ข้อความที่เกินจะส่งไม่ถึง (ผู้จัดเห็นเป็น \"ส่งไม่ถึง\")",
    env: ["LINE_LOGIN_CHANNEL_ID", "LINE_LOGIN_CHANNEL_SECRET", "LINE_MESSAGING_ACCESS_TOKEN"],
  },
] as const satisfies readonly FeatureDefinition[];

export type FeatureKey = (typeof featureDefinitions)[number]["key"];
export type FeatureFlags = Record<FeatureKey, boolean>;

export const featureKeys = featureDefinitions.map((feature) => feature.key) as FeatureKey[];

export function findFeature(key: string): FeatureDefinition | undefined {
  return (featureDefinitions as readonly FeatureDefinition[]).find((feature) => feature.key === key);
}
