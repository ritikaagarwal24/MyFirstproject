// High-DPI responsive canvas setup and game loop for:
// - Castle scene rendering (towers, walls, flags)
// - Guards patrolling on the walls
// - Horses trotting on the ground
// - Balloon popping minigame with score, particles and sound

(function () {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const scoreEl = document.getElementById('scoreValue');
  const soundToggleBtn = document.getElementById('soundToggle');

  // Sizing and coordinate helpers
  const size = { cssWidth: 0, cssHeight: 0, dpr: Math.max(1, Math.min(window.devicePixelRatio || 1, 2)) };
  function resizeCanvas() {
    const cssWidth = canvas.clientWidth;
    const cssHeight = canvas.clientHeight;
    size.cssWidth = cssWidth;
    size.cssHeight = cssHeight;
    size.dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
    canvas.width = Math.floor(cssWidth * size.dpr);
    canvas.height = Math.floor(cssHeight * size.dpr);
    ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
  }

  // Game state
  const state = {
    startTime: performance.now(),
    lastTime: performance.now(),
    elapsed: 0,
    score: 0,
    mouse: { x: 0, y: 0, overBalloon: false },
    balloons: [],
    particles: [],
    guards: [],
    horses: [],
    soundEnabled: true,
    audio: { ctx: null },
  };

  // Audio helpers (created on first interaction)
  function ensureAudio() {
    if (!state.audio.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        state.audio.ctx = new AudioCtx();
      }
    }
    return state.audio.ctx;
  }

  function playPopSound() {
    if (!state.soundEnabled) return;
    const audioCtx = ensureAudio();
    if (!audioCtx) return;

    const t0 = audioCtx.currentTime;
    // Short noise burst + pitch blip
    const noiseBuffer = audioCtx.createBuffer(1, audioCtx.sampleRate * 0.06, audioCtx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      // Shaped noise (slightly curved) to soften
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 0.6);
    }
    const noiseSrc = audioCtx.createBufferSource();
    noiseSrc.buffer = noiseBuffer;
    const noiseGain = audioCtx.createGain();
    noiseGain.gain.setValueAtTime(0.001, t0);
    noiseGain.gain.exponentialRampToValueAtTime(0.2, t0 + 0.005);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.06);
    noiseSrc.connect(noiseGain).connect(audioCtx.destination);

    const osc = audioCtx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(900, t0);
    osc.frequency.exponentialRampToValueAtTime(200, t0 + 0.08);
    const oscGain = audioCtx.createGain();
    oscGain.gain.setValueAtTime(0.0001, t0);
    oscGain.gain.exponentialRampToValueAtTime(0.25, t0 + 0.008);
    oscGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
    osc.connect(oscGain).connect(audioCtx.destination);

    noiseSrc.start(t0);
    osc.start(t0);
    noiseSrc.stop(t0 + 0.07);
    osc.stop(t0 + 0.14);
  }

  // Scene layout (computed from current canvas size)
  function getLayout() {
    const w = size.cssWidth;
    const h = size.cssHeight;
    const groundY = h * 0.78;
    const wallTop = h * 0.44;
    const wallHeight = Math.max(80, h * 0.12);
    const wallBottom = wallTop + wallHeight;
    const walkwayY = wallTop + wallHeight * 0.32;
    const towerWidth = Math.max(60, w * 0.06);
    const towerHeight = Math.max(160, h * 0.28);
    const towerInset = Math.max(50, w * 0.08);
    const merlonWidth = Math.max(10, w * 0.012);
    const merlonGap = merlonWidth * 0.7;
    return {
      w, h, groundY, wallTop, wallHeight, wallBottom, walkwayY,
      towerWidth, towerHeight, towerInset, merlonWidth, merlonGap,
    };
  }

  // Drawing utilities
  function drawRoundedRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawFlag(x, y, poleH, colorA, colorB, t) {
    // pole
    ctx.fillStyle = '#2b2b2b';
    ctx.fillRect(x - 2, y - poleH, 4, poleH);
    // waving banner
    const wave = Math.sin(t * 2 + x * 0.01) * 6;
    const w = 34;
    const h = 14;
    ctx.beginPath();
    ctx.moveTo(x + 1, y - poleH + 4);
    ctx.quadraticCurveTo(x + w * 0.3, y - poleH + 2 + wave, x + w * 0.6, y - poleH + 4 - wave);
    ctx.lineTo(x + w, y - poleH + 8);
    ctx.lineTo(x + 1, y - poleH + 14);
    ctx.closePath();
    const grad = ctx.createLinearGradient(x, y - poleH + 4, x + w, y - poleH + 10);
    grad.addColorStop(0, colorA);
    grad.addColorStop(1, colorB);
    ctx.fillStyle = grad;
    ctx.fill();
  }

  function drawBackground(layout, t) {
    const { w, h, groundY } = layout;

    // Soft sun
    const sunX = w * 0.14, sunY = h * 0.18, sunR = Math.min(w, h) * 0.08;
    const sunGrad = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, sunR);
    sunGrad.addColorStop(0, 'rgba(255,245,200,0.9)');
    sunGrad.addColorStop(1, 'rgba(255,245,200,0)');
    ctx.fillStyle = sunGrad;
    ctx.beginPath();
    ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2);
    ctx.fill();

    // Distant hills
    ctx.fillStyle = '#9ec0dc';
    ctx.beginPath();
    ctx.moveTo(0, groundY - 120);
    for (let x = 0; x <= w; x += 40) {
      const y = groundY - 120 - Math.sin((x + t * 20) * 0.01) * 6;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fill();

    // Ground
    const groundGrad = ctx.createLinearGradient(0, groundY - 20, 0, h);
    groundGrad.addColorStop(0, '#5a7a4f');
    groundGrad.addColorStop(1, '#3f5a3b');
    ctx.fillStyle = groundGrad;
    ctx.fillRect(0, groundY, w, h - groundY);
  }

  function drawCastle(layout, t) {
    const { w, wallTop, wallHeight, wallBottom, towerWidth, towerHeight, towerInset, merlonWidth, merlonGap } = layout;

    // Main wall base
    ctx.fillStyle = '#cfd5df';
    drawRoundedRect(towerInset, wallTop, w - towerInset * 2, wallHeight, 8);
    ctx.fill();

    // Brick texture lines
    ctx.strokeStyle = 'rgba(0,0,0,0.08)';
    ctx.lineWidth = 1;
    for (let y = wallTop + 8; y < wallBottom - 8; y += 14) {
      ctx.beginPath();
      ctx.moveTo(towerInset + 8, y);
      ctx.lineTo(w - towerInset - 8, y);
      ctx.stroke();
    }

    // Merlons along the top
    const merlonY = wallTop - 12;
    ctx.fillStyle = '#dde3ea';
    for (let x = towerInset + 8; x < w - towerInset - 8; x += merlonWidth + merlonGap) {
      drawRoundedRect(x, merlonY, merlonWidth, 14, 2);
      ctx.fill();
    }

    // Corner towers
    ctx.fillStyle = '#d6dce5';
    const leftX = towerInset - towerWidth * 0.5;
    const rightX = w - towerInset - towerWidth * 0.5;
    drawRoundedRect(leftX, wallTop - (towerHeight - wallHeight), towerWidth, towerHeight, 10);
    ctx.fill();
    drawRoundedRect(rightX, wallTop - (towerHeight - wallHeight), towerWidth, towerHeight, 10);
    ctx.fill();

    // Tower roofs
    function drawRoof(baseX) {
      ctx.fillStyle = '#8a1f2b';
      ctx.beginPath();
      ctx.moveTo(baseX - 6, wallTop - (towerHeight - wallHeight) + 12);
      ctx.lineTo(baseX + towerWidth / 2, wallTop - (towerHeight - wallHeight) - 30);
      ctx.lineTo(baseX + towerWidth + 6, wallTop - (towerHeight - wallHeight) + 12);
      ctx.closePath();
      ctx.fill();
    }
    drawRoof(leftX);
    drawRoof(rightX);

    // Flags
    drawFlag(leftX + towerWidth * 0.5, wallTop - (towerHeight - wallHeight) - 30, 40, '#ffb703', '#fb7185', t);
    drawFlag(rightX + towerWidth * 0.5, wallTop - (towerHeight - wallHeight) - 36, 46, '#34d399', '#60a5fa', t);

    // Gate
    const gateW = Math.max(70, (w - towerInset * 2) * 0.14);
    const gateX = (w - gateW) / 2;
    const gateY = wallBottom - 6;
    ctx.fillStyle = '#a47e5b';
    drawRoundedRect(gateX, gateY - wallHeight * 0.7, gateW, wallHeight * 0.7, 8);
    ctx.fill();
    // Gate arch lines
    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.beginPath();
    ctx.arc(gateX + gateW / 2, gateY - 6, gateW / 2, Math.PI, 0);
    ctx.stroke();
  }

  // Guards on walkway
  function ensureGuards(layout) {
    if (state.guards.length) return;
    const { w, towerInset, wallTop, wallHeight } = { ...layout, towerInset: layout.towerInset };
    const walkwayY = wallTop + wallHeight * 0.32;
    const pathLength = w - towerInset * 2 - 16;
    for (let i = 0; i < 6; i++) {
      state.guards.push({ progress: (i / 6) * pathLength, speed: 30 + Math.random() * 20, dir: Math.random() < 0.5 ? 1 : -1, y: walkwayY });
    }
  }

  function drawGuard(x, y, facing, t) {
    const bob = Math.sin(t * 8 + x * 0.02) * 2;
    // body
    ctx.fillStyle = '#3b82f6';
    drawRoundedRect(x - 5, y - 18 + bob, 10, 18, 3);
    ctx.fill();
    // head
    ctx.fillStyle = '#f3d7b6';
    ctx.beginPath();
    ctx.arc(x, y - 24 + bob, 5, 0, Math.PI * 2);
    ctx.fill();
    // helmet plume
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(x - (facing > 0 ? 0 : 1), y - 32 + bob, facing > 0 ? 8 : 8, 2);
    // spear
    ctx.strokeStyle = '#2f2f2f';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + (facing > 0 ? 6 : -6), y - 12 + bob);
    ctx.lineTo(x + (facing > 0 ? 16 : -16), y - 22 + bob);
    ctx.stroke();
  }

  function updateAndDrawGuards(layout, dt, t) {
    const { w, towerInset, wallTop, wallHeight } = layout;
    const pathStartX = towerInset + 8;
    const pathEndX = w - towerInset - 8;
    const pathLen = pathEndX - pathStartX;
    const walkwayY = wallTop + wallHeight * 0.32;
    for (const g of state.guards) {
      g.progress += g.speed * g.dir * dt;
      if (g.progress <= 0) { g.progress = 0; g.dir = 1; }
      if (g.progress >= pathLen) { g.progress = pathLen; g.dir = -1; }
      const x = pathStartX + g.progress;
      drawGuard(x, walkwayY, g.dir, t);
    }
  }

  // Horses on the ground
  function ensureHorses(layout) {
    if (state.horses.length) return;
    const { w, groundY } = layout;
    for (let i = 0; i < 3; i++) {
      state.horses.push({ x: (i / 3) * w, y: groundY - 8, speed: 40 + Math.random() * 30, dir: Math.random() < 0.5 ? 1 : -1, phase: Math.random() * Math.PI * 2 });
    }
  }

  function drawHorse(x, y, t) {
    const bob = Math.sin(t * 6 + x * 0.01) * 2;
    // body
    ctx.fillStyle = '#7c4a23';
    drawRoundedRect(x - 16, y - 12 + bob, 32, 18, 6);
    ctx.fill();
    // head
    drawRoundedRect(x + 14, y - 16 + bob, 10, 12, 4);
    ctx.fill();
    // legs
    ctx.fillStyle = '#6b3f1e';
    const legPh = t * 10;
    for (let i = -1; i <= 1; i += 2) {
      const legOffset = 8 * i;
      const swing = Math.sin(legPh + i * 0.7) * 2;
      drawRoundedRect(x - 8 + legOffset, y + 4 + bob, 4, 12 + swing, 2);
      ctx.fill();
    }
    // tail
    ctx.strokeStyle = '#4d2b12';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 16, y - 6 + bob);
    ctx.quadraticCurveTo(x - 22, y, x - 18, y + 8 + bob);
    ctx.stroke();
  }

  function updateAndDrawHorses(layout, dt, t) {
    const { w, groundY } = layout;
    for (const h of state.horses) {
      h.x += h.speed * (h.dir > 0 ? 1 : -1) * dt;
      if (h.x < -30) { h.dir = 1; }
      if (h.x > w + 30) { h.dir = -1; }
      drawHorse(h.x, groundY - 6, t);
    }
  }

  // Balloons
  const BALLOON_COLORS = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#f472b6'];

  function spawnBalloon(layout) {
    const { w, h } = layout;
    const radius = 14 + Math.random() * 10;
    const x = Math.random() * (w * 0.9 - w * 0.1) + w * 0.1;
    const y = h + radius + Math.random() * 60;
    const vy = -30 - Math.random() * 20;
    const swayAmp = 14 + Math.random() * 16;
    const swayFreq = 0.6 + Math.random() * 0.8;
    const color = BALLOON_COLORS[(Math.random() * BALLOON_COLORS.length) | 0];
    state.balloons.push({ x, y, r: radius, vy, swayAmp, swayFreq, swayT: Math.random() * Math.PI * 2, color, popped: false });
  }

  function ensureBalloons(layout, t) {
    // Maintain a target count based on width
    const target = Math.max(8, Math.floor(layout.w / 140));
    while (state.balloons.length < target) spawnBalloon(layout);
  }

  function drawBalloon(b) {
    // string
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y + b.r - 2);
    ctx.quadraticCurveTo(b.x - 4, b.y + b.r + 16, b.x + 2, b.y + b.r + 26);
    ctx.stroke();

    // balloon body with highlight
    const grad = ctx.createRadialGradient(b.x - b.r * 0.4, b.y - b.r * 0.4, 2, b.x, b.y, b.r);
    grad.addColorStop(0, '#fff');
    grad.addColorStop(0.08, '#fff');
    grad.addColorStop(0.09, b.color);
    grad.addColorStop(1, shade(b.color, -20));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(b.x, b.y, b.r * 0.9, b.r, 0, 0, Math.PI * 2);
    ctx.fill();

    // knot
    ctx.fillStyle = shade(b.color, -15);
    drawRoundedRect(b.x - 2, b.y + b.r - 4, 4, 4, 1);
    ctx.fill();
  }

  function shade(hex, percent) {
    const f = parseInt(hex.slice(1), 16);
    const t = percent < 0 ? 0 : 255;
    const p = Math.abs(percent) / 100;
    const R = f >> 16, G = (f >> 8) & 0x00FF, B = f & 0x0000FF;
    const newR = Math.round((t - R) * p) + R;
    const newG = Math.round((t - G) * p) + G;
    const newB = Math.round((t - B) * p) + B;
    return `#${(0x1000000 + (newR << 16) + (newG << 8) + newB).toString(16).slice(1)}`;
  }

  function updateAndDrawBalloons(layout, dt, t) {
    const { h } = layout;
    state.mouse.overBalloon = false;
    for (let i = state.balloons.length - 1; i >= 0; i--) {
      const b = state.balloons[i];
      b.swayT += b.swayFreq * dt;
      b.y += b.vy * dt;
      b.x += Math.sin(b.swayT) * b.swayAmp * dt;
      if (!b.popped && distance(state.mouse.x, state.mouse.y, b.x, b.y) < b.r * 0.95) {
        state.mouse.overBalloon = true;
      }
      if (b.y < -b.r - 20) {
        state.balloons.splice(i, 1);
      } else if (!b.popped) {
        drawBalloon(b);
      }
    }
  }

  // Particles for popping effect
  function spawnParticles(x, y, color) {
    const count = 16 + (Math.random() * 12) | 0;
    for (let i = 0; i < count; i++) {
      const ang = (Math.random() * Math.PI * 2);
      const spd = 80 + Math.random() * 120;
      const vx = Math.cos(ang) * spd;
      const vy = Math.sin(ang) * spd;
      state.particles.push({ x, y, vx, vy, life: 0.6 + Math.random() * 0.5, color });
    }
  }

  function updateAndDrawParticles(dt) {
    ctx.globalCompositeOperation = 'lighter';
    for (let i = state.particles.length - 1; i >= 0; i--) {
      const p = state.particles[i];
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 120 * dt; // gravity
      const a = Math.max(0, Math.min(1, p.life));
      ctx.fillStyle = hexWithAlpha(p.color, a * 0.9);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
      if (p.life <= 0) state.particles.splice(i, 1);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  function hexWithAlpha(hex, alpha) {
    const f = parseInt(hex.slice(1), 16);
    const R = (f >> 16) & 0xFF, G = (f >> 8) & 0xFF, B = f & 0xFF;
    return `rgba(${R},${G},${B},${alpha})`;
  }

  // Interaction
  canvas.addEventListener('mousemove', (e) => {
    const pt = eventToCanvasPoint(e);
    state.mouse.x = pt.x;
    state.mouse.y = pt.y;
  });

  function eventToCanvasPoint(e) {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width) / size.dpr;
    const y = (e.clientY - rect.top) * (canvas.height / rect.height) / size.dpr;
    return { x, y };
  }

  canvas.addEventListener('click', (e) => {
    const pt = eventToCanvasPoint(e);
    // Resume audio on first gesture if suspended
    const audioCtx = ensureAudio();
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();

    // Find the top-most unpopped balloon under cursor
    for (let i = state.balloons.length - 1; i >= 0; i--) {
      const b = state.balloons[i];
      if (!b.popped && distance(pt.x, pt.y, b.x, b.y) <= b.r * 1.05) {
        b.popped = true;
        state.balloons.splice(i, 1);
        state.score += 1;
        updateScore();
        spawnParticles(b.x, b.y, b.color);
        playPopSound();
        break;
      }
    }
  });

  function updateScore() {
    if (scoreEl) scoreEl.textContent = String(state.score);
  }

  soundToggleBtn.addEventListener('click', () => {
    state.soundEnabled = !state.soundEnabled;
    soundToggleBtn.textContent = state.soundEnabled ? '🔊' : '🔇';
    soundToggleBtn.setAttribute('aria-pressed', String(!state.soundEnabled));
    const audioCtx = ensureAudio();
    if (audioCtx && audioCtx.state === 'suspended' && state.soundEnabled) audioCtx.resume();
  });

  function distance(x1, y1, x2, y2) {
    const dx = x1 - x2, dy = y1 - y2;
    return Math.hypot(dx, dy);
  }

  function drawCursorFeedback() {
    canvas.style.cursor = state.mouse.overBalloon ? 'pointer' : 'default';
  }

  // Main loop
  function frame(now) {
    const dt = Math.min(0.033, (now - state.lastTime) / 1000);
    state.elapsed = (now - state.startTime) / 1000;
    state.lastTime = now;

    const layout = getLayout();
    ctx.clearRect(0, 0, size.cssWidth, size.cssHeight);

    drawBackground(layout, state.elapsed);
    drawCastle(layout, state.elapsed);
    ensureGuards(layout);
    updateAndDrawGuards(layout, dt, state.elapsed);
    ensureHorses(layout);
    updateAndDrawHorses(layout, dt, state.elapsed);
    ensureBalloons(layout, state.elapsed);
    updateAndDrawBalloons(layout, dt, state.elapsed);
    updateAndDrawParticles(dt);
    drawCursorFeedback();

    requestAnimationFrame(frame);
  }

  // Initialize
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();
  updateScore();
  requestAnimationFrame(frame);
})();

