import { memo, useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

type GalaxyCanvasProps = {
  className?: string;
  mobile?: boolean;
  reducedMotion?: boolean;
};

type StaticStar = {
  x: number;
  y: number;
  radius: number;
  alpha: number;
  color: string;
};

type TwinkleStar = {
  x: number;
  y: number;
  radius: number;
  base: number;
  amp: number;
  speed: number;
  phase: number;
  color: string;
};

type ShootingStar = {
  startX: number;
  startY: number;
  vx: number;
  vy: number;
  length: number;
  life: number;
  wait: number;
  age: number;
  alpha: number;
};

function random(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export const GalaxyCanvas = memo(function GalaxyCanvas({
  className,
  mobile = false,
  reducedMotion = false
}: GalaxyCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const staticLayer = document.createElement("canvas");
    const staticCtx = staticLayer.getContext("2d", { alpha: true });
    if (!staticCtx) return;

    let width = 0;
    let height = 0;
    let dpr = 1;
    let frame = 0;
    let lastTime = 0;

    let staticStars: StaticStar[] = [];
    let twinkleStars: TwinkleStar[] = [];
    let shootingStars: ShootingStar[] = [];

    const staticCount = reducedMotion ? (mobile ? 45 : 70) : mobile ? 90 : 150;
    const twinkleCount = reducedMotion ? (mobile ? 8 : 12) : mobile ? 14 : 24;
    const shootingCount = reducedMotion ? (mobile ? 2 : 3) : mobile ? 4 : 6;
    const targetFps = reducedMotion ? 18 : mobile ? 24 : 30;
    const frameStep = 1000 / targetFps;

    const resetShooter = (star: ShootingStar, immediate = false) => {
      star.startX = random(-width * 0.18, width * 0.92);
      star.startY = random(-height * 0.42, height * 0.2);

      const angle = random(0.45, 0.82);
      const speed = random(width * 0.2, width * 0.36);
      star.vx = Math.cos(angle) * speed;
      star.vy = Math.sin(angle) * speed;
      star.length = random(mobile ? 40 : 58, mobile ? 88 : 130);
      star.life = random(0.65, 1.35);
      star.wait = immediate ? random(0.05, 2.2) : random(1.2, 5.6);
      star.age = 0;
      star.alpha = random(0.22, 0.64);
    };

    const buildStars = () => {
      staticStars = Array.from({ length: staticCount }, () => {
        const cool = Math.random() > 0.74;
        return {
          x: random(0, width),
          y: random(0, height),
          radius: random(0.35, mobile ? 1.25 : 1.6),
          alpha: random(0.15, 0.8),
          color: cool ? "rgba(147,197,253,1)" : "rgba(255,255,255,1)"
        };
      });

      twinkleStars = Array.from({ length: twinkleCount }, () => {
        const warm = Math.random() > 0.84;
        return {
          x: random(0, width),
          y: random(0, height),
          radius: random(mobile ? 0.9 : 1.1, mobile ? 2 : 2.4),
          base: random(0.12, 0.42),
          amp: random(0.1, 0.5),
          speed: random(1.2, 4),
          phase: random(0, Math.PI * 2),
          color: warm ? "rgba(255,234,181,1)" : "rgba(191,219,254,1)"
        };
      });

      shootingStars = Array.from({ length: shootingCount }, () => {
        const star: ShootingStar = {
          startX: 0,
          startY: 0,
          vx: 0,
          vy: 0,
          length: 0,
          life: 0,
          wait: 0,
          age: 0,
          alpha: 0
        };
        resetShooter(star, true);
        return star;
      });
    };

    const drawStaticLayer = () => {
      staticCtx.setTransform(1, 0, 0, 1, 0, 0);
      staticCtx.clearRect(0, 0, staticLayer.width, staticLayer.height);

      staticCtx.fillStyle = "#000000";
      staticCtx.fillRect(0, 0, staticLayer.width, staticLayer.height);

      const nebulaA = staticCtx.createRadialGradient(
        width * 0.2,
        height * 0.17,
        0,
        width * 0.2,
        height * 0.17,
        width * 0.42
      );
      nebulaA.addColorStop(0, "rgba(56,189,248,0.2)");
      nebulaA.addColorStop(0.45, "rgba(30,64,175,0.08)");
      nebulaA.addColorStop(1, "rgba(0,0,0,0)");
      staticCtx.fillStyle = nebulaA;
      staticCtx.fillRect(0, 0, staticLayer.width, staticLayer.height);

      const nebulaB = staticCtx.createRadialGradient(
        width * 0.78,
        height * 0.14,
        0,
        width * 0.78,
        height * 0.14,
        width * 0.36
      );
      nebulaB.addColorStop(0, "rgba(167,139,250,0.18)");
      nebulaB.addColorStop(0.52, "rgba(99,102,241,0.06)");
      nebulaB.addColorStop(1, "rgba(0,0,0,0)");
      staticCtx.fillStyle = nebulaB;
      staticCtx.fillRect(0, 0, staticLayer.width, staticLayer.height);

      const vignette = staticCtx.createRadialGradient(
        width * 0.5,
        height * 0.45,
        width * 0.2,
        width * 0.5,
        height * 0.45,
        width * 0.82
      );
      vignette.addColorStop(0, "rgba(0,0,0,0)");
      vignette.addColorStop(0.78, "rgba(0,0,0,0.55)");
      vignette.addColorStop(1, "rgba(0,0,0,0.86)");
      staticCtx.fillStyle = vignette;
      staticCtx.fillRect(0, 0, staticLayer.width, staticLayer.height);

      for (const star of staticStars) {
        staticCtx.globalAlpha = star.alpha;
        staticCtx.fillStyle = star.color;
        staticCtx.beginPath();
        staticCtx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
        staticCtx.fill();
      }
      staticCtx.globalAlpha = 1;
    };

    const setupCanvas = () => {
      const nextWidth = Math.max(1, window.innerWidth);
      const nextHeight = Math.max(1, window.innerHeight);
      const nextDpr = Math.min(mobile ? 1.25 : 1.55, window.devicePixelRatio || 1);

      width = nextWidth;
      height = nextHeight;
      dpr = nextDpr;

      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      staticLayer.width = canvas.width;
      staticLayer.height = canvas.height;
      staticLayer.style.width = canvas.style.width;
      staticLayer.style.height = canvas.style.height;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      staticCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

      buildStars();
      drawStaticLayer();
    };

    const drawFrame = (time: number) => {
      frame = window.requestAnimationFrame(drawFrame);
      if (lastTime && time - lastTime < frameStep) return;

      const delta = lastTime ? Math.min((time - lastTime) / 1000, 0.06) : 0.016;
      lastTime = time;
      const sec = time / 1000;

      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(staticLayer, 0, 0, width, height);

      for (const star of twinkleStars) {
        const alpha = reducedMotion
          ? star.base + star.amp * 0.2
          : star.base + Math.sin(sec * star.speed + star.phase) * star.amp;

        ctx.globalAlpha = clamp(alpha, 0.05, 0.95);
        ctx.fillStyle = star.color;
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
        ctx.fill();
      }

      if (!reducedMotion) {
        for (const star of shootingStars) {
          star.age += delta;
          if (star.age < star.wait) continue;

          const progress = (star.age - star.wait) / star.life;
          if (progress >= 1) {
            resetShooter(star, false);
            continue;
          }

          const headX = star.startX + star.vx * (star.life * progress);
          const headY = star.startY + star.vy * (star.life * progress);
          const dirX = star.vx / Math.hypot(star.vx, star.vy);
          const dirY = star.vy / Math.hypot(star.vx, star.vy);
          const tailX = headX - dirX * star.length;
          const tailY = headY - dirY * star.length;

          const alpha = star.alpha * (1 - progress);
          const gradient = ctx.createLinearGradient(tailX, tailY, headX, headY);
          gradient.addColorStop(0, "rgba(255,255,255,0)");
          gradient.addColorStop(0.65, `rgba(191,219,254,${alpha * 0.65})`);
          gradient.addColorStop(1, `rgba(255,255,255,${alpha})`);

          ctx.globalAlpha = 1;
          ctx.strokeStyle = gradient;
          ctx.lineWidth = mobile ? 1 : 1.2;
          ctx.beginPath();
          ctx.moveTo(tailX, tailY);
          ctx.lineTo(headX, headY);
          ctx.stroke();
        }
      }

      ctx.globalAlpha = 1;
    };

    setupCanvas();
    frame = window.requestAnimationFrame(drawFrame);
    window.addEventListener("resize", setupCanvas, { passive: true });

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", setupCanvas);
    };
  }, [mobile, reducedMotion]);

  return <canvas ref={canvasRef} className={cn("h-full w-full", className)} aria-hidden />;
});

