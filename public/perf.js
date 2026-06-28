const sample = {
  fps: 0,
  avgFrameMs: 0,
  p95FrameMs: 0,
  frames: 0,
  stallFrames: 0,
  maxFrameMs: 0,
  updatedAt: Date.now(),
};

if (typeof window !== "undefined") {
  window.RiftboundPerf = sample;
  publishSample();
  startSampler();
}

function startSampler() {
  const deltas = [];
  let last = 0;

  function tick(now) {
    const stamp = Number(now) || Date.now();
    if (last) deltas.push(stamp - last);
    last = stamp;
    if (deltas.length >= 120) {
      const summary = summarizeFrameDeltas(deltas);
      sample.avgFrameMs = summary.avgFrameMs;
      sample.p95FrameMs = summary.p95FrameMs;
      sample.fps = summary.fps;
      sample.frames += summary.frames;
      sample.stallFrames += summary.stallFrames;
      sample.maxFrameMs = Math.max(sample.maxFrameMs, summary.maxFrameMs);
      sample.updatedAt = Date.now();
      sample.source = typeof window.requestAnimationFrame === "function" ? "requestAnimationFrame" : "setInterval";
      publishSample();
      deltas.length = 0;
    }
    schedule(tick);
  }

  schedule(tick);
}

function schedule(callback) {
  if (typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(callback);
  } else {
    window.setTimeout(() => callback(Date.now()), 16);
  }
}

function publishSample() {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.riftboundFps = String(sample.fps);
  document.documentElement.dataset.riftboundAvgFrameMs = String(sample.avgFrameMs);
  document.documentElement.dataset.riftboundP95FrameMs = String(sample.p95FrameMs);
  document.documentElement.dataset.riftboundFrames = String(sample.frames);
  document.documentElement.dataset.riftboundStallFrames = String(sample.stallFrames);
  document.documentElement.dataset.riftboundMaxFrameMs = String(sample.maxFrameMs);
  document.documentElement.dataset.riftboundPerfSource = sample.source || "sampling";
}

export function summarizeFrameDeltas(deltas, { stallThresholdMs = 250 } = {}) {
  const frames = deltas.length;
  const numeric = deltas.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0);
  const stable = numeric.filter((value) => value <= stallThresholdMs);
  const measured = stable.length > 0 ? stable : numeric;
  const sorted = [...measured].sort((a, b) => a - b);
  const avg = measured.reduce((total, value) => total + value, 0) / Math.max(1, measured.length);

  return {
    fps: avg > 0 ? Math.round(1000 / avg) : 0,
    avgFrameMs: Math.round(avg || 0),
    p95FrameMs: Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] || 0),
    frames,
    stallFrames: numeric.length - stable.length,
    maxFrameMs: Math.round(Math.max(0, ...numeric)),
  };
}
