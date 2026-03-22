import { motion } from "motion/react";
import { memo, useEffect, useMemo, useState } from "react";

import { cn } from "@/lib/utils";

type ShootingStarsProps = {
  className?: string;
  count?: number;
  minDuration?: number;
  maxDuration?: number;
};

type Star = {
  id: string;
  top: number;
  left: number;
  length: number;
  thickness: number;
  distance: number;
  opacity: number;
  blur: number;
  duration: number;
  delay: number;
  repeatDelay: number;
  rotate: number;
};

function random(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

export const ShootingStars = memo(function ShootingStars({
  className,
  count = 30,
  minDuration = 3,
  maxDuration = 8
}: ShootingStarsProps) {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(max-width: 768px)").matches;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(max-width: 768px)");
    const onChange = (event: MediaQueryListEvent) => setIsMobile(event.matches);

    setIsMobile(media.matches);
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    }

    media.addListener(onChange);
    return () => media.removeListener(onChange);
  }, []);

  const starsCount = isMobile ? Math.max(14, Math.floor(count * 0.55)) : count;

  const stars = useMemo<Star[]>(
    () =>
      Array.from({ length: starsCount }, (_, index) => ({
        id: `star_${index}_${Math.round(random(1, 999999))}`,
        top: random(-25, 72),
        left: random(-35, 85),
        length: random(46, 126),
        thickness: random(1, 1.9),
        distance: random(340, 1040),
        opacity: random(0.22, 0.65),
        blur: random(0, 0.9),
        duration: random(minDuration, maxDuration),
        delay: random(0, 10),
        repeatDelay: random(1, 6),
        rotate: random(28, 37)
      })),
    [maxDuration, minDuration, starsCount]
  );

  return (
    <div className={cn("pointer-events-none overflow-hidden", className)} aria-hidden>
      {stars.map((star) => (
        <motion.span
          key={star.id}
          className="absolute block rounded-full"
          style={{
            top: `${star.top}%`,
            left: `${star.left}%`,
            width: `${star.length}px`,
            height: `${star.thickness}px`,
            opacity: 0,
            rotate: `${star.rotate}deg`,
            filter: `blur(${star.blur}px)`,
            background:
              "linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,0.42) 45%, rgba(255,255,255,0.95) 100%)",
            boxShadow: "0 0 12px rgba(255,255,255,0.26)"
          }}
          initial={{
            x: -star.distance * 0.4,
            y: -star.distance * 0.4
          }}
          animate={{
            x: star.distance,
            y: star.distance,
            opacity: [0, star.opacity, 0]
          }}
          transition={{
            duration: star.duration,
            delay: star.delay,
            repeat: Number.POSITIVE_INFINITY,
            repeatDelay: star.repeatDelay,
            ease: "linear"
          }}
        />
      ))}
    </div>
  );
});
