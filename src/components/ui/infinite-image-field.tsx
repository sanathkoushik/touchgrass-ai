"use client";

import { cn } from "@/lib/utils";
import { useCallback, useEffect, useRef } from "react";

export const INFINITE_IMAGE_FIELD_IMAGES: string[] = Array.from(
  { length: 10 },
  (_, i) => `/photos/field-${String(i + 1).padStart(2, "0")}.webp`,
);

export interface InfiniteImageFieldProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "children"> {
  className?: string;
  images?: string[];
  imageWidth?: number;
  imageHeight?: number;
  gap?: number;
  maxSpeed?: number;
  smoothing?: number;
  borderRadius?: number;
  /** Slow constant drift (px/frame) used when there is no cursor, e.g. touch devices. */
  idleDrift?: { x: number; y: number };
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const clampedR = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + clampedR, y);
  ctx.lineTo(x + w - clampedR, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + clampedR);
  ctx.lineTo(x + w, y + h - clampedR);
  ctx.quadraticCurveTo(x + w, y + h, x + w - clampedR, y + h);
  ctx.lineTo(x + clampedR, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - clampedR);
  ctx.lineTo(x, y + clampedR);
  ctx.quadraticCurveTo(x, y, x + clampedR, y);
  ctx.closePath();
}

/** Stride coprime with n scatters consecutive indices; a row offset keeps vertical neighbours distinct. */
function pickImageIndex(col: number, row: number, n: number): number {
  if (n <= 1) return 0;
  let stride = 3;
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  while (gcd(stride, n) !== 1) stride++;
  const rowStep = Math.max(1, Math.floor(n * 0.4));
  const k = (((col + row * rowStep) % n) + n) % n;
  return (k * stride) % n;
}

export function InfiniteImageField({
  className,
  images = INFINITE_IMAGE_FIELD_IMAGES,
  imageWidth = 200,
  imageHeight = 280,
  gap = 28,
  maxSpeed = 5,
  smoothing = 0.07,
  borderRadius = 0,
  idleDrift,
  ...rest
}: InfiniteImageFieldProps) {
  const idleX = idleDrift?.x ?? 0.35;
  const idleY = idleDrift?.y ?? 0.18;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const loadedImagesRef = useRef<HTMLImageElement[]>([]);
  const dimsRef = useRef({ w: 0, h: 0 });
  const camRef = useRef({ x: 0, y: 0 });
  const velRef = useRef({ x: 0, y: 0 });
  const mouseRef = useRef({ x: 0.5, y: 0.5 });
  const isInsideRef = useRef(false);
  const rafRef = useRef<number>(0);
  const visibleRef = useRef(true);
  const reducedRef = useRef(false);

  // Pre-load images
  useEffect(() => {
    const imgs = images.map((src) => {
      const img = new Image();
      img.decoding = "async";
      img.src = src;
      return img;
    });
    loadedImagesRef.current = imgs;
  }, [images]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { w: W, h: H } = dimsRef.current;
    if (W === 0 || H === 0) {
      rafRef.current = requestAnimationFrame(draw);
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const cellW = imageWidth + gap;
    const cellH = imageHeight + gap;
    const imgs = loadedImagesRef.current;
    const numImages = imgs.length;

    // Physics — cursor offset from center drives velocity
    const reduced = reducedRef.current;
    const tx = reduced
      ? 0
      : isInsideRef.current
        ? (mouseRef.current.x - 0.5) * 2 * maxSpeed
        : idleX;
    const ty = reduced
      ? 0
      : isInsideRef.current
        ? (mouseRef.current.y - 0.5) * 2 * maxSpeed
        : idleY;

    velRef.current.x += (tx - velRef.current.x) * smoothing;
    velRef.current.y += (ty - velRef.current.y) * smoothing;

    camRef.current.x += velRef.current.x;
    camRef.current.y += velRef.current.y;

    const camX = camRef.current.x;
    const camY = camRef.current.y;

    ctx.clearRect(0, 0, W, H);

    // Compute visible cell range
    const colMin = Math.floor((camX - W / 2) / cellW) - 1;
    const colMax = Math.ceil((camX + W / 2) / cellW) + 1;
    const rowMin = Math.floor((camY - H / 2) / cellH) - 1;
    const rowMax = Math.ceil((camY + H / 2) / cellH) + 1;

    for (let row = rowMin; row <= rowMax; row++) {
      for (let col = colMin; col <= colMax; col++) {
        // Top-left corner in screen space
        const sx = col * cellW - camX + W / 2 - imageWidth / 2;
        const sy = row * cellH - camY + H / 2 - imageHeight / 2;

        // Deterministic assignment: neighbours (left/right/up/down) never share an image.
        const imgIdx = pickImageIndex(col, row, numImages);
        const img = imgs[imgIdx];

        ctx.save();
        drawRoundedRect(ctx, sx, sy, imageWidth, imageHeight, borderRadius);
        ctx.clip();

        if (img && img.complete && img.naturalWidth > 0) {
          ctx.drawImage(img, sx, sy, imageWidth, imageHeight);
        } else {
          // Placeholder while loading — semi-transparent so background shows
          ctx.fillStyle = "rgba(0,0,0,0.15)";
          ctx.fillRect(sx, sy, imageWidth, imageHeight);
        }
        ctx.restore();

        // Subtle border overlay for glass-panel effect
        ctx.save();
        drawRoundedRect(ctx, sx, sy, imageWidth, imageHeight, borderRadius);
        ctx.strokeStyle = "rgba(255,255,255,0.06)";
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
      }
    }

    // Keep drawing while images are still decoding so reduced-motion users still see the photos.
    const settling = loadedImagesRef.current.some((i) => !i.complete);
    if (visibleRef.current && (!reducedRef.current || settling)) {
      rafRef.current = requestAnimationFrame(draw);
    } else {
      rafRef.current = 0;
    }
  }, [imageWidth, imageHeight, gap, maxSpeed, smoothing, borderRadius, idleX, idleY]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      dimsRef.current = { w: rect.width, h: rect.height };
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      // Resizing clears the canvas; redraw once even if the loop is paused.
      if (!rafRef.current && visibleRef.current) {
        rafRef.current = requestAnimationFrame(draw);
      }
    };

    resize();

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const onMove = (e: PointerEvent) => {
      // Touch has no hover: let it fall back to idle drift instead of steering.
      if (e.pointerType === "touch") return;
      const rect = canvas.getBoundingClientRect();
      mouseRef.current = {
        x: (e.clientX - rect.left) / rect.width,
        y: (e.clientY - rect.top) / rect.height,
      };
      isInsideRef.current = true;
    };
    const onLeave = () => {
      isInsideRef.current = false;
    };

    // Pause the loop whenever motion is unwanted or the field is not on screen.
    const start = () => {
      if (!rafRef.current && visibleRef.current) {
        rafRef.current = requestAnimationFrame(draw);
      }
    };
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMotionPref = () => {
      reducedRef.current = mq.matches;
      start();
    };
    onMotionPref();
    mq.addEventListener("change", onMotionPref);

    const io = new IntersectionObserver(([entry]) => {
      visibleRef.current = !!entry?.isIntersecting && !document.hidden;
      if (visibleRef.current) start();
    });
    io.observe(canvas);
    const onVisibility = () => {
      visibleRef.current = !document.hidden;
      if (visibleRef.current) start();
    };
    document.addEventListener("visibilitychange", onVisibility);

    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", onLeave);

    rafRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      ro.disconnect();
      io.disconnect();
      mq.removeEventListener("change", onMotionPref);
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
    };
  }, [draw]);

  return (
    <div
      {...rest}
      className={cn("relative w-full h-full overflow-hidden", className)}
    >
      <canvas ref={canvasRef} className="block w-full h-full bg-transparent" />
    </div>
  );
}
