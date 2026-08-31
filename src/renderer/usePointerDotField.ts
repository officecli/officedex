import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";

interface PointerMotion {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  strength: number;
  targetStrength: number;
  activity: number;
}

export function usePointerDotField<T extends HTMLElement>(enabled: boolean) {
  const hostRef = useRef<T>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const motionRef = useRef<PointerMotion>({
    x: 0,
    y: 0,
    targetX: 0,
    targetY: 0,
    strength: 0,
    targetStrength: 0,
    activity: 0,
  });

  const movePointer = useCallback((event: ReactPointerEvent<T>) => {
    const host = hostRef.current;
    if (!enabled || !host || event.pointerType === "touch") return;
    const bounds = host.getBoundingClientRect();
    const motion = motionRef.current;
    const nextX = event.clientX - bounds.left + host.scrollLeft;
    const nextY = event.clientY - bounds.top + host.scrollTop;
    const travel = Math.hypot(nextX - motion.targetX, nextY - motion.targetY);
    motion.targetX = nextX;
    motion.targetY = nextY;
    motion.activity = Math.min(1, Math.max(motion.activity, 0.32 + travel / 24));
    if (motion.strength < 0.01) {
      motion.x = nextX;
      motion.y = nextY;
    }
    motion.targetStrength = 1;
  }, [enabled]);

  const hidePointer = useCallback(() => {
    motionRef.current.targetStrength = 0;
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!enabled || !host || !canvas) return undefined;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const coarsePointer = window.matchMedia("(hover: none), (pointer: coarse)");
    if (reducedMotion.matches || coarsePointer.matches) return undefined;
    const context = canvas.getContext("2d");
    if (!context) return undefined;

    let width = 0;
    let height = 0;
    let pixelRatio = 1;
    let animationFrame = 0;
    let lastFrameTime = 0;
    let animatedPhase = 0;
    const spacing = 28;
    const radius = 230;

    const resize = () => {
      width = Math.max(1, host.clientWidth);
      height = Math.max(1, host.clientHeight, host.scrollHeight);
      pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    };

    const draw = (time: number) => {
      const motion = motionRef.current;
      const elapsed = lastFrameTime === 0 ? 16 : Math.min(40, time - lastFrameTime);
      lastFrameTime = time;
      motion.x += (motion.targetX - motion.x) * 0.42;
      motion.y += (motion.targetY - motion.y) * 0.42;
      motion.strength += (motion.targetStrength - motion.strength) * 0.09;
      animatedPhase += elapsed * motion.activity;
      motion.activity *= 0.76;
      if (motion.activity < 0.006) motion.activity = 0;
      context.clearRect(0, 0, width, height);

      if (motion.strength > 0.008) {
        const minColumn = Math.floor((motion.x - radius) / spacing);
        const maxColumn = Math.ceil((motion.x + radius) / spacing);
        const minRow = Math.floor((motion.y - radius) / spacing);
        const maxRow = Math.ceil((motion.y + radius) / spacing);

        for (let column = minColumn; column <= maxColumn; column += 1) {
          const baseX = column * spacing + 1;
          if (baseX < 0 || baseX > width) continue;
          for (let row = minRow; row <= maxRow; row += 1) {
            const baseY = row * spacing + 1;
            if (baseY < 0 || baseY > height) continue;
            const deltaX = baseX - motion.x;
            const deltaY = baseY - motion.y;
            const distance = Math.hypot(deltaX, deltaY);
            if (distance >= radius) continue;

            const normalized = 1 - distance / radius;
            const influence = normalized * normalized * (3 - 2 * normalized) * motion.strength;
            const safeDistance = Math.max(distance, 0.001);
            const radialX = deltaX / safeDistance;
            const radialY = deltaY / safeDistance;
            const wave = Math.sin(distance * 0.054 - animatedPhase * 0.0046) * 7.2 * influence;
            const crawl = Math.sin(animatedPhase * 0.0024 + column * 0.72 + row * 0.43) * 2.8 * influence;
            const drawX = baseX + radialX * wave - radialY * crawl;
            const drawY = baseY + radialY * wave + radialX * crawl;
            const pulse = (Math.sin(animatedPhase * 0.005 + distance * 0.08) + 1) * 0.16;
            const dotRadius = 0.72 + influence * (0.9 + pulse);
            const alpha = (0.08 + influence * 0.34) * motion.strength;

            context.beginPath();
            context.arc(drawX, drawY, dotRadius, 0, Math.PI * 2);
            context.fillStyle = `rgba(48, 53, 60, ${alpha})`;
            context.fill();
          }
        }
      }
      animationFrame = window.requestAnimationFrame(draw);
    };

    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    Array.from(host.children).forEach((child) => {
      if (child !== canvas) resizeObserver.observe(child);
    });
    animationFrame = window.requestAnimationFrame(draw);
    return () => {
      resizeObserver.disconnect();
      window.cancelAnimationFrame(animationFrame);
    };
  }, [enabled]);

  return { hostRef, canvasRef, movePointer, hidePointer };
}
