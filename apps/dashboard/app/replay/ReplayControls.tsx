"use client";

import { useState } from "react";
import type { ReplayControl } from "@/lib/data/types";

export function ReplayControls({ control }: { control: ReplayControl }) {
  const [playing, setPlaying] = useState(control.playing);
  const [speed, setSpeed] = useState(control.currentSpeed);

  return (
    <div>
      <div className="controls">
        <button aria-pressed={playing} onClick={() => setPlaying((p) => !p)}>
          {playing ? "Pause" : "Play"}
        </button>
        {control.speeds.map((s) => (
          <button key={s} aria-pressed={s === speed} onClick={() => setSpeed(s)}>
            {s}×
          </button>
        ))}
      </div>
      <p className="muted" style={{ marginTop: 12 }}>
        State: {playing ? "playing" : "paused"} at {speed}×
        {control.cursorMsgId ? ` · cursor ${control.cursorMsgId}` : ""}
      </p>
      <p className="muted" style={{ marginTop: 4, fontSize: 12 }}>
        Controls are a display stub in the headless skeleton — wiring to the replay
        engine lands with the live adapter.
      </p>
    </div>
  );
}
