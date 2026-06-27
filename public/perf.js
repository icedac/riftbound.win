const sample = {
  fps: 0,
  avgFrameMs: 0,
  p95FrameMs: 0,
  frames: 0,
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
      const avg = deltas.reduce((total, value) => total + value, 0) / deltas.length;
      const sorted = [...deltas].sort((a, b) => a - b);
      sample.avgFrameMs = Math.round(avg);
      sample.p95FrameMs = Math.round(sorted[Math.floor(sorted.length * 0.95)] || 0);
      sample.fps = Math.round(1000 / avg);
      sample.frames += deltas.length;
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
  document.documentElement.dataset.riftboundPerfSource = sample.source || "sampling";
}
