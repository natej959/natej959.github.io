/* ===== SYNTH AUDIO (WebAudio only, nothing to load) ===== */
function createAudio() {
  let ctx = null, master, eng = {}, noiseBuf, wind, skid, boostN, muted = false, rpmSm = 2200, gearPrev = 0;
  const GEARS = [16, 28, 40, 54, 80];

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = muted ? 0 : 0.55; master.connect(ctx.destination);
    const comp = ctx.createDynamicsCompressor(); comp.connect(master); const out = comp;

    // noise buffer
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const noise = () => { const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true; s.start(); return s; };

    // engine: saw + square sub + whine
    eng.o1 = ctx.createOscillator(); eng.o1.type = 'sawtooth';
    eng.o2 = ctx.createOscillator(); eng.o2.type = 'square';
    eng.o3 = ctx.createOscillator(); eng.o3.type = 'sine';
    eng.f = ctx.createBiquadFilter(); eng.f.type = 'lowpass'; eng.f.Q.value = 3; eng.f.frequency.value = 600;
    eng.g = ctx.createGain(); eng.g.gain.value = 0.0;
    const g1 = ctx.createGain(); g1.gain.value = 0.55; const g2 = ctx.createGain(); g2.gain.value = 0.25;
    eng.wg = ctx.createGain(); eng.wg.gain.value = 0.0;
    eng.o1.connect(g1); eng.o2.connect(g2); g1.connect(eng.f); g2.connect(eng.f); eng.f.connect(eng.g); eng.g.connect(out);
    eng.o3.connect(eng.wg); eng.wg.connect(out);
    eng.o1.start(); eng.o2.start(); eng.o3.start();

    // wind
    wind = { s: noise(), f: ctx.createBiquadFilter(), g: ctx.createGain() };
    wind.f.type = 'bandpass'; wind.f.frequency.value = 700; wind.f.Q.value = 0.6; wind.g.gain.value = 0;
    wind.s.connect(wind.f); wind.f.connect(wind.g); wind.g.connect(out);
    // tyre skid / gravel
    skid = { s: noise(), f: ctx.createBiquadFilter(), g: ctx.createGain() };
    skid.f.type = 'bandpass'; skid.f.frequency.value = 1700; skid.f.Q.value = 1.4; skid.g.gain.value = 0;
    skid.s.connect(skid.f); skid.f.connect(skid.g); skid.g.connect(out);
    // boost roar
    boostN = { s: noise(), f: ctx.createBiquadFilter(), g: ctx.createGain() };
    boostN.f.type = 'lowpass'; boostN.f.frequency.value = 900; boostN.g.gain.value = 0;
    boostN.s.connect(boostN.f); boostN.f.connect(boostN.g); boostN.g.connect(out);
    eng.out = out;
  }

  function update(dt, st) {
    if (!ctx) return;
    const t = ctx.currentTime, v = Math.abs(st.speed);
    // gearbox sim
    let gi = 0; while (gi < GEARS.length - 1 && v > GEARS[gi]) gi++;
    const lo = gi ? GEARS[gi - 1] * 0.62 : 0, hi = GEARS[gi];
    const frac = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
    let target = 1900 + frac * 5600 + st.throttle * 500;
    if (gi !== gearPrev) { if (gi > gearPrev) rpmSm -= 1500; gearPrev = gi; }
    rpmSm += (target - rpmSm) * Math.min(1, dt * 9);
    const f0 = rpmSm / 60 * 2;
    eng.o1.frequency.setTargetAtTime(f0, t, 0.03);
    eng.o2.frequency.setTargetAtTime(f0 * 0.5, t, 0.03);
    eng.o3.frequency.setTargetAtTime(380 + v * 20 + (st.boost ? 160 : 0), t, 0.05);
    eng.f.frequency.setTargetAtTime(500 + st.throttle * 1400 + frac * 900 + (st.boost ? 800 : 0), t, 0.05);
    eng.g.gain.setTargetAtTime(st.paused ? 0 : 0.10 + st.throttle * 0.10 + (st.boost ? 0.05 : 0), t, 0.05);
    eng.wg.gain.setTargetAtTime(st.paused ? 0 : Math.min(0.05, v / 80 * 0.035 + (st.boost ? 0.025 : 0)), t, 0.1);
    wind.g.gain.setTargetAtTime(st.paused ? 0 : Math.pow(v / 70, 1.6) * 0.32, t, 0.1);
    wind.f.frequency.setTargetAtTime(400 + v * 14, t, 0.1);
    skid.g.gain.setTargetAtTime(st.paused ? 0 : st.slip * 0.28 + st.offroad * Math.min(1, v / 25) * 0.1, t, 0.04);
    skid.f.frequency.setTargetAtTime(st.offroad > 0.5 ? 900 : 1500 + st.slip * 500, t, 0.1);
    boostN.g.gain.setTargetAtTime(st.paused ? 0 : (st.boost ? 0.3 : 0), t, st.boost ? 0.05 : 0.2);
    boostN.f.frequency.setTargetAtTime(st.boost ? 1400 : 500, t, 0.2);
  }

  function burst(dur, freq, vol, type) {
    if (!ctx) return;
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type || 'lowpass'; f.frequency.value = freq;
    const g = ctx.createGain(); const t = ctx.currentTime;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(eng.out); s.start(t); s.stop(t + dur + 0.05);
  }
  function tone(freq, dur, vol, type, slideTo) {
    if (!ctx) return;
    const o = ctx.createOscillator(); o.type = type || 'square'; o.frequency.value = freq;
    const g = ctx.createGain(); const t = ctx.currentTime;
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(eng.out); o.start(t); o.stop(t + dur + 0.05);
  }
  return {
    init, update,
    beep(high) { tone(high ? 880 : 440, high ? 0.45 : 0.18, 0.18, 'square'); },
    hit(power) { burst(0.25, 500, Math.min(0.9, 0.25 + power * 0.7)); burst(0.12, 3000, 0.15 * power, 'highpass'); },
    land(power) { burst(0.2, 350, Math.min(0.8, power * 0.6)); },
    boostStart() { burst(0.5, 2000, 0.35, 'bandpass'); tone(200, 0.4, 0.12, 'sawtooth', 700); },
    turbo() { burst(0.4, 3500, 0.3, 'bandpass'); tone(300, 0.35, 0.14, 'sawtooth', 900); },
    driftStart() { burst(0.18, 1800, 0.25, 'bandpass'); },
    boom(p) { burst(0.9, 160 + p * 120, 0.15 + p * 0.65); burst(0.25, 900, 0.12 * p, 'bandpass'); },
    chime() { tone(660, 0.12, 0.15, 'triangle'); setTimeout(() => tone(990, 0.3, 0.15, 'triangle'), 110); },
    best() { [660, 880, 1100, 1320].forEach((f, i) => setTimeout(() => tone(f, 0.25, 0.14, 'triangle'), i * 90)); },
    toggleMute() { muted = !muted; if (master) master.gain.value = muted ? 0 : 0.55; return muted; },
    isMuted: () => muted,
  };
}
