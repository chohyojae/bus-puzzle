import type { FrameRate } from '../../storage/save-schema';

/** Render only on display refreshes, carrying fractional frame intervals across callbacks. */
export function startFrameLoop(rate: FrameRate, render: (timestamp: number, elapsedMs: number) => void) {
  const interval = 1000 / rate;
  let previous = performance.now();
  let next = previous + interval;
  let frame = requestAnimationFrame(animate);
  function animate(now: number) {
    // Schedule before rendering so a scene can cancel itself inside the callback.
    frame = requestAnimationFrame(animate);
    const ahead = now + 0.1 - next;
    if (ahead < 0 || now <= previous) return;
    const elapsed = now - previous;
    previous = now;
    next += (Math.floor(ahead / interval) + 1) * interval;
    render(now, elapsed);
  }
  return () => cancelAnimationFrame(frame);
}
