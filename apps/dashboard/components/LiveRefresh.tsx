"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type ConnectionState = "connecting" | "live" | "offline";

export function LiveRefresh() {
  const router = useRouter();
  const [state, setState] = useState<ConnectionState>("connecting");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const source = new EventSource("/api/desk/events");
    source.addEventListener("state", () => {
      setState("live");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 250);
    });
    source.onerror = () => setState("offline");
    source.onopen = () => setState("live");
    return () => {
      if (timer.current) clearTimeout(timer.current);
      source.close();
    };
  }, [router]);

  return (
    <span className={`live-connection ${state}`} role="status" aria-live="polite">
      <span aria-hidden="true" />
      {state === "live" ? "Live updates" : state === "connecting" ? "Connecting" : "Reconnecting"}
    </span>
  );
}
