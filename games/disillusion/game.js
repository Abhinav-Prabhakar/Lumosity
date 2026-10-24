/*  Disillusion — a faithful reimplementation of the Lumosity task-switching game.
    Rule: the target tile's orientation decides the match — TALL = match color, WIDE = match symbol. */
(() => {
  'use strict';

  const cv = document.getElementById('cv');
  const ctx = cv.getContext('2d');
  const W = 1280, H = 960;

  const LEVELS = [12, 18, 24, 30, 36, 46, 48, 54, 60, 66, 72, 78, 84, 90, 96, 102, 108, 114, 120];
  const START_UNLOCKED = 6;

  const PALETTE = [
    { fill: '#74cfcf', edge: '#4ba7aa' },
    { fill: '#f5c343', edge: '#cf9f22' },
    { fill: '#df6157', edge: '#b8463f' }
  ];
  const SYMBOLS = ['ring', 'plus', 'clover'];

  const KEY = { unlocked: 'l2d_unlocked', best: 'l2d_best_', sound: 'l2d_sound' };

  const store = {
    unlocked() {
      const v = parseInt(localStorage.getItem(KEY.unlocked) || '', 10);
      return Number.isFinite(v) && v >= START_UNLOCKED ? Math.min(v, LEVELS.length) : START_UNLOCKED;
    },
    setUnlocked(v) { localStorage.setItem(KEY.unlocked, String(Math.min(Math.max(v, START_UNLOCKED), LEVELS.length))); },
    best(i) { return parseInt(localStorage.getItem(KEY.best + i) || '0', 10) || 0; },
    setBest(i, v) { if (v > this.best(i)) localStorage.setItem(KEY.best + i, String(v)); }
  };

  /* ---------------------------------------------------------------- audio */
  const Audio = {
    ctx: null,
    enabled: localStorage.getItem(KEY.sound) !== 'off',
    ensure() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        this.ctx = new AC();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    },
    tone({ freq = 440, to = null, dur = 0.14, type = 'sine', gain = 0.13, delay = 0 }) {
      if (!this.enabled) return;
      const ac = this.ensure();
      if (!ac) return;
      const t0 = ac.currentTime + delay;
      const osc = ac.createOscillator();
      const g = ac.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g).connect(ac.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    },
    correct() { this.tone({ freq: 620, to: 930, dur: 0.11, type: 'triangle', gain: 0.1 }); },
    wrong() { this.tone({ freq: 190, to: 120, dur: 0.2, type: 'square', gain: 0.08 }); },
    switchRule() { this.tone({ freq: 420, to: 520, dur: 0.09, type: 'sine', gain: 0.06 }); },
    tick() { this.tone({ freq: 1180, dur: 0.07, type: 'square', gain: 0.05 }); },
    start() {
      this.tone({ freq: 392, dur: 0.12, gain: 0.09 });
      this.tone({ freq: 523, dur: 0.12, gain: 0.09, delay: 0.1 });
      this.tone({ freq: 659, dur: 0.24, gain: 0.1, delay: 0.2 });
    },
    complete() {
      [523, 659, 784, 1046].forEach((f, i) => this.tone({ freq: f, dur: 0.26, type: 'triangle', gain: 0.1, delay: i * 0.11 }));
    },
    click() { this.tone({ freq: 320, dur: 0.06, type: 'sine', gain: 0.06 }); }
  };

  /* ----------------------------------------------------------- background */
  const BG = (() => {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');

    const lg = g.createLinearGradient(0, 0, W * 0.4, H);
    lg.addColorStop(0, '#31646c');
    lg.addColorStop(0.42, '#245159');
    lg.addColorStop(1, '#1b434b');
    g.fillStyle = lg;
    g.fillRect(0, 0, W, H);

    // soft cloudy lights, like the paper texture in the original
    for (let i = 0; i < 26; i++) {
      const x = Math.random() * W * 1.2 - W * 0.1;
      const y = Math.random() * H;
      const r = 90 + Math.random() * 260;
      const rg = g.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, `rgba(255,255,255,${0.012 + Math.random() * 0.03})`);
      rg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = rg;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }

    // fine paper grain
    const noise = document.createElement('canvas');
    noise.width = 320; noise.height = 240;
    const ng = noise.getContext('2d');
    const id = ng.createImageData(320, 240);
    for (let i = 0; i < id.data.length; i += 4) {
      const v = 128 + (Math.random() * 46 - 23);
      id.data[i] = id.data[i + 1] = id.data[i + 2] = v;
      id.data[i + 3] = 16;
    }
    ng.putImageData(id, 0, 0);
    g.globalAlpha = 0.55;
    for (let y = 0; y < H; y += 240) for (let x = 0; x < W; x += 320) g.drawImage(noise, x, y);
    g.globalAlpha = 1;

    const vg = g.createRadialGradient(W / 2, H * 0.46, H * 0.18, W / 2, H * 0.5, H * 0.85);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.4)');
    g.fillStyle = vg;
    g.fillRect(0, 0, W, H);

    return c;
  })();

  /* ---------------------------------------------------------------- state */
  const S = {
    scene: 'select',
    level: Math.min(store.unlocked() - 1, LEVELS.length - 1),
    goal: 0,
    score: 0,
    shownScore: 0,
    matched: 0,
    time: 60,
    tiles: [],
    target: null,
    zen: false,
    paused: false,
    complete: false,
    result: null,
    selectedNode: 0,
    shakeNode: -1,
    shakeT: 0,
    t: 0,
    lastTs: 0,
    tickedAt: 0,
    lastResult: null
  };

  const nodes = [];
  (function layoutNodes() {
    const perRow = 10;
    for (let i = 0; i < LEVELS.length; i++) {
      const row = i < perRow ? 0 : 1;
      const col = row === 0 ? i : i - perRow;
      const countInRow = row === 0 ? Math.min(perRow, LEVELS.length) : LEVELS.length - perRow;
      const spread = 1020;
      const step = countInRow > 1 ? spread / (countInRow - 1) : 0;
      const startX = W / 2 - spread / 2;
      nodes.push({
        x: startX + col * step,
        y: row === 0 ? 505 : 705,
        i
      });
    }
  })();

  /* --------------------------------------------------------------- tiles */
  function randColor() { return Math.floor(Math.random() * PALETTE.length); }
  function randSymbol() { return Math.floor(Math.random() * SYMBOLS.length); }

  function makeTile(tall) {
    return {
      tall,
      color: randColor(),
      symbol: randSymbol(),
      scale: 0,
      alpha: 0,
      pop: 0,
      shake: 0,
      respawn: 0,
      rot: tall ? Math.PI / 2 : 0
    };
  }

  function buildCluster() {
    const tiles = [];
    const colGap = 104, rowGap = 112;
    const cx = W * 0.635, cy = H * 0.455;
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 3; r++) {
        const tall = c % 2 === 0;
        const t = makeTile(tall);
        t.x = cx + (c - 1.5) * colGap;
        t.y = cy + (r - 1) * rowGap + (c % 2 === 1 ? rowGap * 0.5 : 0);
        t.delay = (c * 3 + r) * 0.028;
        tiles.push(t);
      }
    }
    return tiles;
  }

  function newTarget() {
    return {
      tall: Math.random() < 0.5,
      color: randColor(),
      symbol: randSymbol(),
      alpha: 0,
      flip: 0
    };
  }

  function matches(tile) {
    const t = S.target;
    if (!t) return false;
    return t.tall ? tile.color === t.color : tile.symbol === t.symbol;
  }

  function ensureMatchExists() {
    if (S.tiles.some(matches)) return;
    const t = S.tiles[Math.floor(Math.random() * S.tiles.length)];
    if (S.target.tall) t.color = S.target.color;
    else t.symbol = S.target.symbol;
  }

  /* -------------------------------------------------------------- drawing */
  function bowtiePath(g, w, h, tall) {
    const bw = tall ? h : w;
    const bh = tall ? w : h;
    const hw = bw / 2, hh = bh / 2;
    const waist = 0.34;
    g.beginPath();
    g.moveTo(-hw, -hh);
    g.lineTo(hw, -hh);
    g.lineTo(hw, -hh * waist);
    g.lineTo(hw * 0.45, 0);
    g.lineTo(hw, hh * waist);
    g.lineTo(hw, hh);
    g.lineTo(-hw, hh);
    g.lineTo(-hw, hh * waist);
    g.lineTo(-hw * 0.45, 0);
    g.lineTo(-hw, -hh * waist);
    g.closePath();
  }

  function drawSymbol(g, kind, s, alpha) {
    g.save();
    g.globalAlpha *= alpha;
    g.fillStyle = '#ffffff';
    g.strokeStyle = '#ffffff';
    if (kind === 'ring') {
      g.lineWidth = s * 0.13;
      g.beginPath();
      g.arc(0, 0, s * 0.22, 0, Math.PI * 2);
      g.stroke();
    } else if (kind === 'plus') {
      const a = s * 0.115, b = s * 0.325, r = s * 0.05;
      g.beginPath();
      // rounded cross
      g.moveTo(-a, -b); g.lineTo(a, -b); g.lineTo(a, -a); g.lineTo(b, -a);
      g.lineTo(b, a); g.lineTo(a, a); g.lineTo(a, b); g.lineTo(-a, b);
      g.lineTo(-a, a); g.lineTo(-b, a); g.lineTo(-b, -a); g.lineTo(-a, -a);
      g.closePath();
      g.lineJoin = 'round';
      g.lineWidth = r;
      g.stroke();
      g.fill();
    } else {
      const d = s * 0.115, off = s * 0.135;
      [[-off, -off], [off, -off], [-off, off], [off, off]].forEach(([x, y]) => {
        g.beginPath();
        g.moveTo(x, y - d); g.lineTo(x + d, y); g.lineTo(x, y + d); g.lineTo(x - d, y);
        g.closePath();
        g.fill();
      });
    }
    g.restore();
  }

  function drawTile(t, g) {
    // bowtiePath() applies the orientation, so always hand it the wide reference box
    const baseW = 118, baseH = 88;
    const w = t.tall ? baseH : baseW;
    const h = t.tall ? baseW : baseH;

    g.save();
    g.translate(t.x, t.y);

    if (t.shake) {
      const k = Math.sin(t.shake * 42) * 9 * t.shake;
      g.translate(k, 0);
    }
    const sc = t.scale * (1 + t.pop * 0.16);
    g.scale(sc, sc);
    g.globalAlpha = t.alpha * (1 - t.pop * 0.65);

    // shadow
    g.save();
    g.translate(0, 9);
    g.fillStyle = 'rgba(4,26,32,0.42)';
    bowtiePath(g, baseW, baseH, t.tall);
    g.fill();
    g.restore();

    const pal = PALETTE[t.color];
    g.fillStyle = pal.fill;
    g.strokeStyle = pal.fill;
    g.lineJoin = 'round';
    g.lineWidth = 16;
    bowtiePath(g, baseW, baseH, t.tall);
    g.stroke();
    g.fill();

    // subtle top light
    g.save();
    bowtiePath(g, baseW, baseH, t.tall);
    g.clip();
    const lg = g.createLinearGradient(0, -h / 2, 0, h / 2);
    lg.addColorStop(0, 'rgba(255,255,255,0.14)');
    lg.addColorStop(0.55, 'rgba(255,255,255,0)');
    g.fillStyle = lg;
    g.fillRect(-w / 2, -h / 2, w, h);
    g.restore();

    drawSymbol(g, SYMBOLS[t.symbol], Math.min(w, h), 1);
    g.restore();
  }

  function drawTarget(g) {
    const t = S.target;
    if (!t) return;
    const x = W * 0.215, y = H * 0.46;
    const baseW = 128, baseH = 96;
    const w = t.tall ? baseH : baseW;
    const h = t.tall ? baseW : baseH;

    g.save();
    g.translate(x, y);
    const pulse = 1 + Math.sin(S.t * 2.6) * 0.012;
    const sc = pulse * (0.86 + t.alpha * 0.14) * (1 - t.flip * 0.12);
    g.scale(sc, sc);
    g.globalAlpha = 0.55 + t.alpha * 0.45;

    g.save();
    g.translate(0, 10);
    g.fillStyle = 'rgba(4,26,32,0.45)';
    bowtiePath(g, baseW, baseH, t.tall);
    g.fill();
    g.restore();

    const pal = PALETTE[t.color];
    g.fillStyle = pal.fill;
    g.strokeStyle = pal.fill;
    g.lineJoin = 'round';
    g.lineWidth = 16;
    bowtiePath(g, baseW, baseH, t.tall);
    g.stroke();
    g.fill();

    g.save();
    bowtiePath(g, baseW, baseH, t.tall);
    g.clip();
    const lg = g.createLinearGradient(0, -h / 2, 0, h / 2);
    lg.addColorStop(0, 'rgba(255,255,255,0.16)');
    lg.addColorStop(0.6, 'rgba(255,255,255,0)');
    g.fillStyle = lg;
    g.fillRect(-w / 2, -h / 2, w, h);
    g.restore();

    drawSymbol(g, SYMBOLS[t.symbol], Math.min(w, h), 1);
    g.restore();
  }

  function text(str, x, y, { size = 34, weight = 700, color = '#ffffff', align = 'center', alpha = 1, spacing = 0 } = {}) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.font = `${weight} ${size}px MuseoSans, "Helvetica Neue", Arial, sans-serif`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = spacing + 'px';
    ctx.fillText(str, x, y);
    ctx.restore();
  }

  /* --------------------------------------------------------- level select */
  function drawLevelSelect() {
    ctx.drawImage(BG, 0, 0);

    text('Tap the highlighted tile to begin.', W / 2, 300, { size: 40, weight: 700, alpha: 0.96 });

    const unlocked = store.unlocked();
    const current = Math.min(unlocked - 1, LEVELS.length - 1);

    nodes.forEach((n, i) => {
      const isUnlocked = i < unlocked;
      const isCurrent = i === current;
      const jitter = n.i === S.shakeNode ? Math.sin(S.shakeT * 40) * 8 * S.shakeT : 0;

      ctx.save();
      ctx.translate(n.x + jitter, n.y);
      const scale = isCurrent ? 1.16 + Math.sin(S.t * 3) * 0.02 : 1;
      ctx.scale(scale, scale);

      const w = 96, h = 70;

      ctx.save();
      ctx.translate(0, 7);
      ctx.fillStyle = 'rgba(4,26,32,0.42)';
      bowtiePath(ctx, w, h, false);
      ctx.fill();
      ctx.restore();

      ctx.fillStyle = isUnlocked ? 'rgba(232,242,240,0.34)' : 'rgba(232,242,240,0.13)';
      ctx.strokeStyle = isUnlocked ? 'rgba(214,231,229,0.55)' : 'rgba(214,231,229,0.20)';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 5;
      bowtiePath(ctx, w, h, false);
      ctx.fill();
      ctx.stroke();

      if (isCurrent) {
        ctx.strokeStyle = 'rgba(255,255,255,0.95)';
        ctx.lineWidth = 4;
        bowtiePath(ctx, w + 16, h + 16, false);
        ctx.stroke();
      }

      text(String(LEVELS[i]), 0, 0, {
        size: isCurrent ? 30 : 26,
        weight: 700,
        color: isUnlocked ? '#ffffff' : 'rgba(255,255,255,0.40)'
      });
      ctx.restore();
    });

    text(`Match ${LEVELS[current]} tiles to unlock the next level.`, W / 2, 880, {
      size: 34, weight: 700, alpha: 0.95
    });
  }

  /* ------------------------------------------------------------ play view */
  function drawPlay() {
    ctx.drawImage(BG, 0, 0);
    drawTarget(ctx);
    S.tiles.forEach(t => drawTile(t, ctx));
    text('Tall:  Color', W * 0.405, H * 0.855, { size: 34, weight: 500, alpha: 0.92 });
    text('Wide:  Symbol', W * 0.615, H * 0.855, { size: 34, weight: 500, alpha: 0.92 });
  }

  /* ------------------------------------------------------------- gameplay */
  function startLevel(i, zen = false) {
    S.level = i;
    S.goal = LEVELS[i];
    S.score = 0;
    S.shownScore = 0;
    S.matched = 0;
    S.zen = zen;
    S.time = zen ? Infinity : 60;
    S.complete = false;
    S.paused = false;
    S.scene = 'play';
    S.tiles = buildCluster();
    S.tiles.forEach(t => { t.scale = 0; t.alpha = 0; });
    S.target = newTarget();
    S.tickedAt = 0;
    ensureMatchExists();
    hudVisible(true);
    pauseVisible(true);
    Audio.start();
  }

  function endLevel(completed) {
    S.complete = completed;
    let bonus = 0;
    if (completed && !S.zen) bonus = Math.round(Math.max(0, S.time) * 50);
    const total = S.score + bonus;
    if (!S.zen) store.setBest(S.level, total);
    if (completed && !S.zen && S.level + 1 < LEVELS.length) store.setUnlocked(Math.max(store.unlocked(), S.level + 2));

    S.lastResult = { completed, bonus, total, level: S.level };
    showResult();
    if (completed) Audio.complete();
  }

  function hitTest(clientX, clientY) {
    const r = cv.getBoundingClientRect();
    const x = (clientX - r.left) / r.width * W;
    const y = (clientY - r.top) / r.height * H;
    return { x, y };
  }

  function onTap(px, py) {
    Audio.ensure();

    if (S.scene === 'select') {
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        if (Math.abs(px - n.x) < 66 && Math.abs(py - n.y) < 52) {
          if (i < store.unlocked()) { Audio.click(); startLevel(i); }
          else { S.shakeNode = n.i; S.shakeT = 1; Audio.wrong(); S.selectedNode = i; }
          return;
        }
      }
      return;
    }

    if (S.scene !== 'play' || S.paused) return;

    for (const t of S.tiles) {
      if (t.pop > 0 || t.respawn > 0) continue;
      if (Math.abs(px - t.x) < 58 && Math.abs(py - t.y) < 58) {
        if (matches(t)) {
          S.score += 1000;
          S.matched++;
          t.pop = 0.0001;
          Audio.correct();
          if (S.matched >= S.goal) { endLevel(true); return; }
          S.target = newTarget();
          S.target.flip = 0.0001;
          Audio.switchRule();
          ensureMatchExists();
        } else {
          S.score = Math.max(0, S.score - 500);
          t.shake = 0.55;
          Audio.wrong();
        }
        return;
      }
    }
  }

  cv.addEventListener('pointerdown', e => {
    e.preventDefault();
    const p = hitTest(e.clientX, e.clientY);
    Audio.ensure();
    onTap(p.x, p.y);
  }, { passive: false });

  /* --------------------------------------------------------------- update */
  function update(dt) {
    S.t += dt;

    if (S.shakeT > 0) S.shakeT = Math.max(0, S.shakeT - dt * 1.6);

    if (S.scene === 'play' && !S.paused && !S.complete) {
      if (!S.zen) {
        S.time = Math.max(0, S.time - dt);
        const secs = Math.ceil(S.time);
        if (secs <= 5 && secs > 0 && secs !== S.tickedAt) { S.tickedAt = secs; Audio.tick(); }
        if (S.time <= 0) { endLevel(false); return; }
      }
      if (S.target) {
        S.target.alpha = Math.min(1, S.target.alpha + dt * 5);
        if (S.target.flip > 0) S.target.flip = Math.max(0, S.target.flip - dt * 3.2);
      }
      for (const t of S.tiles) {
        t.alpha = Math.min(1, t.alpha + dt * 4.2);
        t.scale = Math.min(1, t.scale + dt * 4.6);
        if (t.pop > 0) {
          t.pop += dt * 3.4;
          if (t.pop >= 1) {
            t.pop = 0;
            t.respawn = 0.14;
          }
        }
        if (t.respawn > 0) {
          t.respawn -= dt;
          if (t.respawn <= 0) {
            t.color = randColor();
            t.symbol = randSymbol();
            t.scale = 0;
            t.alpha = 0;
            t.respawn = 0;
          }
        }
        if (t.shake > 0) t.shake = Math.max(0, t.shake - dt * 2.6);
      }
    }

    S.shownScore += (S.score - S.shownScore) * Math.min(1, dt * 9);
    if (Math.abs(S.score - S.shownScore) < 1) S.shownScore = S.score;

    updateHud();
  }

  function drawScene() {
    if (S.scene === 'select') drawLevelSelect();
    else drawPlay();
  }

  function frame(ts) {
    const dt = Math.min(0.05, (ts - (S.lastTs || ts)) / 1000);
    S.lastTs = ts;
    update(dt);
    drawScene();
    requestAnimationFrame(frame);
  }

  /* ------------------------------------------------------------------ HUD */
  const timeEl = document.getElementById('timeVal');
  const scoreEl = document.getElementById('scoreVal');
  const hud = document.getElementById('hud');
  const pauseBtn = document.getElementById('pauseBtn');

  function fmt(t) {
    if (!Number.isFinite(t)) return '\u221e';
    const s = Math.max(0, Math.ceil(t));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
  function updateHud() {
    if (S.scene !== 'play') { hud.classList.add('is-hidden'); return; }
    hud.classList.remove('is-hidden');
    timeEl.textContent = fmt(S.time);
    scoreEl.textContent = Math.round(S.shownScore).toLocaleString('en-US');
  }
  function hudVisible(v) { hud.classList.toggle('is-hidden', !v); }
  function pauseVisible(v) { pauseBtn.classList.toggle('is-hidden', !v); }

  /* -------------------------------------------------------------- overlays */
  const overlay = document.getElementById('overlay');
  const panels = {
    pause: document.getElementById('pausePanel'),
    how: document.getElementById('howPanel'),
    result: document.getElementById('resultPanel')
  };
  function showPanel(name) {
    overlay.classList.remove('hidden');
    Object.entries(panels).forEach(([k, el]) => el.classList.toggle('hidden', k !== name));
  }
  function hideOverlay() {
    overlay.classList.add('hidden');
    Object.values(panels).forEach(el => el.classList.add('hidden'));
  }

  pauseBtn.addEventListener('click', () => {
    if (S.scene !== 'play') return;
    S.paused = true;
    Audio.click();
    showPanel('pause');
  });

  document.getElementById('pausePanel').addEventListener('click', e => {
    const act = e.target.dataset.act;
    if (!act) return;
    Audio.click();
    if (act === 'resume') { S.paused = false; hideOverlay(); }
    if (act === 'restart') { hideOverlay(); startLevel(S.level, S.zen); }
    if (act === 'levels') { hideOverlay(); toSelect(); }
  });

  document.getElementById('howBtn').addEventListener('click', () => { Audio.ensure(); Audio.click(); showPanel('how'); });
  document.getElementById('howPanel').addEventListener('click', e => {
    if (e.target.dataset.act === 'close') { hideOverlay(); if (S.scene === 'play') S.paused = false; }
  });

  document.getElementById('quitBtn').addEventListener('click', () => { window.location.href = '../../index.html'; });

  function toSelect() {
    S.scene = 'select';
    S.paused = false;
    S.complete = false;
    hudVisible(false);
    pauseVisible(false);
    S.level = Math.min(store.unlocked() - 1, LEVELS.length - 1);
    hideOverlay();
  }

  function showResult() {
    const r = S.lastResult;
    hudVisible(false);
    pauseVisible(false);
    document.getElementById('resultEyebrow').textContent = r.completed ? 'LEVEL COMPLETE' : "TIME'S UP";
    document.getElementById('resultTitle').textContent = r.completed
      ? `Level ${r.level + 1} cleared`
      : `You matched ${S.matched} of ${LEVELS[r.level]}`;
    document.getElementById('resultScore').textContent = r.total.toLocaleString('en-US');
    document.getElementById('resultTiles').textContent = String(S.matched);
    document.getElementById('resultBest').textContent = store.best(r.level).toLocaleString('en-US');

    const primary = document.getElementById('resultPrimary');
    const hasNext = r.completed && r.level + 1 < LEVELS.length;
    primary.textContent = hasNext ? 'Next level' : (r.completed ? 'Play again' : 'Try again');
    primary.dataset.act = hasNext ? 'next' : 'retry';
    primary.onclick = () => {
      Audio.click();
      hideOverlay();
      if (hasNext) startLevel(r.level + 1); else startLevel(r.level);
    };
    showPanel('result');
  }

  document.getElementById('resultSecondary').addEventListener('click', () => { Audio.click(); toSelect(); });

  /* ------------------------------------------------------------- sound ui */
  const sndOn = document.getElementById('sndOn');
  const sndOff = document.getElementById('sndOff');
  const soundBtn = document.getElementById('soundBtn');
  function paintSound() {
    sndOn.classList.toggle('hidden', !Audio.enabled);
    sndOff.classList.toggle('hidden', Audio.enabled);
    soundBtn.title = Audio.enabled ? 'Sound on' : 'Sound off';
  }
  soundBtn.addEventListener('click', () => {
    Audio.enabled = !Audio.enabled;
    localStorage.setItem(KEY.sound, Audio.enabled ? 'on' : 'off');
    paintSound();
    if (Audio.enabled) Audio.click();
  });

  document.getElementById('zenBtn').addEventListener('click', () => {
    Audio.ensure();
    Audio.click();
    startLevel(S.level, true);
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && S.scene === 'play') {
      if (!S.paused) { S.paused = true; showPanel('pause'); } else { S.paused = false; hideOverlay(); }
    }
  });

  /* ------------------------------------------------------------------ boot */
  paintSound();
  hudVisible(false);
  pauseVisible(false);
  requestAnimationFrame(frame);

  // Development hook (opt-in via ?debug=1) — lets tests drive the sim deterministically.
  if (new URLSearchParams(location.search).has('debug')) {
    window.__l2 = { S, LEVELS, startLevel, update, drawScene, onTap, matches, store };
  }
})();
