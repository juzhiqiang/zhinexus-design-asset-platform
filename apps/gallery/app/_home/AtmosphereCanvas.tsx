'use client';

import { useEffect, useRef } from 'react';
import { drawAtmosphere, drawAtmosphereStill, type AtmosphereMode } from './atmosphere';

/**
 * 五层氛围背景之一。全部实例共用同一个 requestAnimationFrame 循环，避免五个
 * 定时器互相抢帧；`prefers-reduced-motion: reduce` 时只画一帧静止代表帧
 * （等价于设计稿 `u_speed = 0`）。
 */

type Subscriber = (now: number) => void;

const subscribers = new Set<Subscriber>();
let frame = 0;
let running = false;

function loop(): void {
  const now = performance.now() / 1000;
  for (const subscriber of subscribers) subscriber(now);
  if (subscribers.size > 0) {
    frame = requestAnimationFrame(loop);
  } else {
    running = false;
  }
}

function subscribe(subscriber: Subscriber): () => void {
  subscribers.add(subscriber);
  if (!running) {
    running = true;
    frame = requestAnimationFrame(loop);
  }
  return () => {
    subscribers.delete(subscriber);
    if (subscribers.size === 0 && running) {
      cancelAnimationFrame(frame);
      running = false;
    }
  };
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function AtmosphereCanvas({ mode }: { mode: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const context = canvas.getContext('2d');
    if (!context) return undefined;

    let width = 0;
    let height = 0;
    const render = (time: number): void => {
      drawAtmosphere(context, width, height, mode as AtmosphereMode, time);
    };

    const resize = (): void => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, Math.round(rect.width));
      height = Math.max(1, Math.round(rect.height));
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    resize();

    if (prefersReducedMotion()) {
      drawAtmosphereStill(context, width, height, mode as AtmosphereMode);
    }

    const observer = new ResizeObserver(() => {
      resize();
      if (prefersReducedMotion()) {
        drawAtmosphereStill(context, width, height, mode as AtmosphereMode);
      }
    });
    observer.observe(canvas);

    const unsubscribe = subscribe(render);

    return () => {
      observer.disconnect();
      unsubscribe();
    };
  }, [mode]);

  return <canvas ref={canvasRef} className="home-atmosphere" aria-hidden="true" />;
}
