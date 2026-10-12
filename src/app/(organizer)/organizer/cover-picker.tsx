"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { ImageIcon, MoveIcon, Trash2Icon, UploadIcon, ZoomInIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { withBasePath } from "@/lib/base-path";

const OUTPUT = { width: 1600, height: 900 };
const MAX_ZOOM = 3;

type Source = { url: string; image: HTMLImageElement; name: string };
type Crop = { x: number; y: number; zoom: number };
const clamp = (value: number) => Math.min(1, Math.max(0, value));

/**
 * Where the image sits inside the 16:9 frame, in frame units: "cover" scaling, positioned by `x`/`y` (0–1 along the
 * overflow, like object-position) and zoomed around that same point. The preview CSS and the canvas export both use it.
 */
function placement(image: HTMLImageElement, frame: { width: number; height: number }, crop: Crop) {
  const base = Math.max(frame.width / image.naturalWidth, frame.height / image.naturalHeight);
  const width = image.naturalWidth * base;
  const height = image.naturalHeight * base;
  const originX = crop.x * frame.width;
  const originY = crop.y * frame.height;
  const left = -(width - frame.width) * crop.x;
  const top = -(height - frame.height) * crop.y;
  return { left: originX + (left - originX) * crop.zoom, top: originY + (top - originY) * crop.zoom, width: width * crop.zoom, height: height * crop.zoom };
}

/**
 * Cover image chooser. A newly selected file can be dragged (or moved with arrow keys) and zoomed inside a 16:9
 * frame; what the frame shows is exported as a 1600×900 JPEG and is the file that gets uploaded. Removal is sent as
 * `removeCover`. The server still checks type and size of whatever arrives.
 */
export function CoverPicker({ currentUrl }: { currentUrl?: string | null }) {
  const input = useRef<HTMLInputElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; crop: Crop } | null>(null);
  const exportTimer = useRef<number | undefined>(undefined);
  const [source, setSource] = useState<Source | null>(null);
  const [crop, setCrop] = useState<Crop>({ x: 0.5, y: 0.5, zoom: 1 });
  const [removed, setRemoved] = useState(false);
  const [exporting, setExporting] = useState(false);
  useEffect(() => () => { if (source) URL.revokeObjectURL(source.url); }, [source]);
  useEffect(() => () => window.clearTimeout(exportTimer.current), []);

  /** Replaces the file input's file with the cropped export (a programmatic change fires no change event). */
  function scheduleExport(next: Crop, from: Source | null = source) {
    if (!from) return;
    window.clearTimeout(exportTimer.current);
    setExporting(true);
    exportTimer.current = window.setTimeout(() => {
      const canvas = document.createElement("canvas");
      canvas.width = OUTPUT.width;
      canvas.height = OUTPUT.height;
      const context = canvas.getContext("2d");
      if (!context) { setExporting(false); return; }
      context.fillStyle = "#ffffff"; // transparent PNGs would otherwise turn black in JPEG
      context.fillRect(0, 0, OUTPUT.width, OUTPUT.height);
      const box = placement(from.image, OUTPUT, next);
      context.drawImage(from.image, box.left, box.top, box.width, box.height);
      canvas.toBlob((blob) => {
        if (blob && input.current) {
          const transfer = new DataTransfer();
          transfer.items.add(new File([blob], `${from.name.replace(/\.[^.]+$/, "") || "cover"}.jpg`, { type: "image/jpeg" }));
          input.current.files = transfer.files;
        }
        setExporting(false);
      }, "image/jpeg", 0.88);
    }, 200);
  }

  function update(next: Crop) {
    setCrop(next);
    scheduleExport(next);
  }

  function choose(file: File | undefined) {
    if (!file) { setSource(null); return; }
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const next = { x: 0.5, y: 0.5, zoom: 1 };
      const loaded = { url, image, name: file.name };
      setSource(loaded);
      setCrop(next);
      setRemoved(false);
      scheduleExport(next, loaded);
    };
    image.onerror = () => URL.revokeObjectURL(url); // not an image the browser can read; the server will reject it too
    image.src = url;
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!source) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, crop };
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current || !source || !frame.current) return;
    const rect = frame.current.getBoundingClientRect();
    const box = placement(source.image, rect, drag.current.crop);
    // Dragging the picture right reveals more of its left side, so the position moves the other way.
    const overflowX = Math.max(box.width - rect.width, 1);
    const overflowY = Math.max(box.height - rect.height, 1);
    setCrop({ ...drag.current.crop, x: clamp(drag.current.crop.x - (event.clientX - drag.current.x) / overflowX), y: clamp(drag.current.crop.y - (event.clientY - drag.current.y) / overflowY) });
  }

  function onPointerUp() {
    if (!drag.current) return;
    drag.current = null;
    scheduleExport(crop);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 0.2 : 0.05;
    const moves: Record<string, Partial<Crop>> = { ArrowLeft: { x: clamp(crop.x - step) }, ArrowRight: { x: clamp(crop.x + step) }, ArrowUp: { y: clamp(crop.y - step) }, ArrowDown: { y: clamp(crop.y + step) } };
    if (!moves[event.key]) return;
    event.preventDefault();
    update({ ...crop, ...moves[event.key] });
  }

  const existing = !source && !removed ? (currentUrl ? withBasePath(currentUrl) : null) : null;
  // The frame is always 16:9, so the export geometry converts straight to percentages for the preview.
  const box = source ? placement(source.image, OUTPUT, crop) : null;

  return <div className="flex flex-col gap-3">
    <div ref={frame} className="relative aspect-video overflow-hidden rounded-lg bg-muted text-sm text-muted-foreground">
      <span className="pointer-events-none absolute left-2.5 top-2.5 z-10 rounded-md bg-foreground/80 px-2 py-0.5 text-xs font-semibold text-background">16:9</span>
      {source ? <div role="group" tabIndex={0} aria-label="จัดตำแหน่งรูปปก ลากหรือใช้ปุ่มลูกศร" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onKeyDown={onKeyDown}
        className="absolute inset-0 cursor-grab touch-none outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:cursor-grabbing">
        {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
        <img src={source.url} alt="ตัวอย่างรูปปก" draggable={false} className="absolute max-w-none select-none"
          style={box ? { left: `${(box.left / OUTPUT.width) * 100}%`, top: `${(box.top / OUTPUT.height) * 100}%`, width: `${(box.width / OUTPUT.width) * 100}%`, height: `${(box.height / OUTPUT.height) * 100}%` } : undefined} />
      </div>
      : <label htmlFor="coverImage" className="absolute inset-0 flex cursor-pointer flex-col items-center justify-center gap-2 hover:bg-muted/70">
        {/* eslint-disable-next-line @next/next/no-img-element -- saved cover preview */}
        {existing ? <img src={existing} alt="รูปปกปัจจุบัน" className="size-full object-cover" /> : <><ImageIcon className="size-6" aria-hidden="true" />ยังไม่มีรูปปก · คลิกเพื่อเลือก</>}
      </label>}
    </div>
    <input ref={input} id="coverImage" name="coverImage" type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => choose(event.target.files?.[0])} />
    {removed && <input type="hidden" name="removeCover" value="on" />}
    {source && <div className="flex flex-col gap-2 rounded-lg border bg-card p-3">
      <label htmlFor="cover-zoom" className="flex items-center gap-2 text-sm font-medium"><ZoomInIcon className="size-4 text-muted-foreground" aria-hidden="true" />ซูม</label>
      <input id="cover-zoom" type="range" min={1} max={MAX_ZOOM} step={0.05} value={crop.zoom} onChange={(event) => update({ ...crop, zoom: Number(event.target.value) })} className="h-6 w-full accent-primary" />
      <p className="flex items-start gap-1.5 text-xs text-muted-foreground" aria-live="polite"><MoveIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />{exporting ? "กำลังเตรียมรูป…" : "ลากรูปเพื่อเลือกส่วนที่จะแสดง · บันทึกเป็น 1600×900 ตามกรอบนี้"}</p>
    </div>}
    <div className="flex gap-2">
      <Button type="button" variant="outline" size="lg" className="h-10 flex-1" onClick={() => input.current?.click()}><UploadIcon data-icon="inline-start" aria-hidden="true" />{source || existing ? "เปลี่ยนรูป" : "เลือกรูป"}</Button>
      {(source || existing) && <Button type="button" variant="outline" size="lg" className="h-10 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => {
        if (input.current) input.current.value = "";
        setSource(null);
        setRemoved(!!currentUrl);
      }}><Trash2Icon data-icon="inline-start" aria-hidden="true" />ลบ</Button>}
    </div>
  </div>;
}
