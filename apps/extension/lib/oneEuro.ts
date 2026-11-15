// One Euro Filter (Casiez et al.): smooths jitter when still, stays responsive when moving.
class LowPass {
  private y: number | null = null;
  filter(x: number, alpha: number) {
    this.y = this.y === null ? x : alpha * x + (1 - alpha) * this.y;
    return this.y;
  }
  last() {
    return this.y;
  }
}

export class OneEuroFilter {
  private x = new LowPass();
  private dx = new LowPass();
  private lastT: number | null = null;

  constructor(private minCutoff = 1.2, private beta = 0.02, private dCutoff = 1.0) {}

  private alpha(cutoff: number, dt: number) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  filter(value: number, tSeconds: number) {
    const dt = this.lastT === null ? 1 / 30 : Math.max(1e-3, tSeconds - this.lastT);
    this.lastT = tSeconds;
    const prev = this.x.last();
    const d = prev === null ? 0 : (value - prev) / dt;
    const edx = this.dx.filter(d, this.alpha(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    return this.x.filter(value, this.alpha(cutoff, dt));
  }
}
