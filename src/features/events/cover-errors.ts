/** Why a cover upload was refused; also used as the `?error=` value on the project settings page. */
export type CoverError = "cover-too-large" | "cover-invalid" | "cover-storage";

export const coverErrorMessage: Record<CoverError, string> = {
  "cover-too-large": "รูปปกมีขนาดเกิน 3 MB กรุณาเลือกรูปที่เล็กลง",
  "cover-invalid": "รูปปกไม่ถูกต้อง: ใช้ไฟล์ JPG, PNG หรือ WebP ที่เปิดได้",
  "cover-storage": "เซิร์ฟเวอร์ยังไม่พร้อมรับรูปปก (ยังไม่ได้ตั้งค่าที่เก็บไฟล์) กรุณาแจ้งผู้ดูแลระบบ หรือสร้างโครงการโดยไม่ใส่รูปปกก่อน",
};

export const isCoverError = (value: unknown): value is CoverError => typeof value === "string" && Object.hasOwn(coverErrorMessage, value);
