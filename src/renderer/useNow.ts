import { useEffect, useState } from "react";

type Subscriber = (now: number) => void;

const buckets = new Map<number, { timer: number; subscribers: Set<Subscriber> }>();

function subscribe(intervalMs: number, fn: Subscriber): () => void {
  let bucket = buckets.get(intervalMs);
  if (!bucket) {
    const subscribers = new Set<Subscriber>();
    const timer = window.setInterval(() => {
      const now = Date.now();
      for (const subscriber of subscribers) subscriber(now);
    }, intervalMs);
    bucket = { timer, subscribers };
    buckets.set(intervalMs, bucket);
  }
  bucket.subscribers.add(fn);
  return () => {
    const current = buckets.get(intervalMs);
    if (!current) return;
    current.subscribers.delete(fn);
    if (current.subscribers.size === 0) {
      window.clearInterval(current.timer);
      buckets.delete(intervalMs);
    }
  };
}

export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => subscribe(intervalMs, setNow), [intervalMs]);
  return now;
}
