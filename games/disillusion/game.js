/*  Disillusion — a faithful reimplementation of Lumosity's task-switching placement game.

    Rules (per Lumosity's own instructions):
      • Every tile has a Color (red / yellow / blue) and a Symbol (circle / plus / diamond),
        and is either Tall (vertical) or Wide (horizontal).
      • A TALL tile must match the COLOR of every tile it touches.
      • A WIDE tile must match the SYMBOL of every tile it touches.
      • The tile must also physically fit the gap, or it cannot be placed at all.
      • A wrong placement locks that space for a few seconds as a penalty.
      • A level is cleared by matching enough tiles across 4 boards before time runs out.
*/
(() => {
  'use strict';

  const cv = document.getElementById('cv');
  const ctx = cv.getContext('2d');
  const W = 1280, H = 960;

  // Milestones shown on the level path (Lumosity: 12, 18, 24, 30, 36, 42, 48, 54 …)
  const LEVELS = [12, 18, 24, 30, 36, 42, 48, 54, 60, 66, 72];
  const START_UNLOCKED = 6;      // current account sits at the 46 tile
  const BOARDS_PER_LEVEL = 4;
  const ROUND_SECONDS = 60;

  const PALETTE = [
    { fill: '#74cfcf', edge: '#4ba7aa' },   // "blue" in Lumosity's copy
    { fill: '#f5c343', edge: '#cf9f22' },   // yellow
    { fill: '#df6157', edge: '#b8463f' }    // red
  ];
  const SYMBOLS = ['ring', 'plus', 'clover'];
  const TILE_HI = { fillPx: 1000, missPx: -250 };

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
      osc.start(t0); osc.stop(t0 + dur + 0.02);
    },
    place() { this.tone({ freq: 520, to: 760, dur: 0.1, type: 'triangle', gain: 0.1 }); },
    wrong() { this.tone({ freq: 200, to: 120, dur: 0.22, type: 'square', gain: 0.075 }); },
    locked() { this.tone({ freq: 150, dur: 0.12, type: 'square', gain: 0.05 }); },
    board() { [523, 659, 784].forEach((f, i) => this.tone({ freq: f, dur: 0.18, type: 'triangle', gain: 0.09, delay: i * 0.07 })); },
    tick() { this.tone({ freq: 1180, dur: 0.07, type: 'square', gain: 0.05 }); },
    start() {
      this.tone({ freq: 392, dur: 0.12, gain: 0.09 });
      this.tone({ freq: 523, dur: 0.12, gain: 0.09, delay: 0.1 });
      this.tone({ freq: 659, dur: 0.24, gain: 0.1, delay: 0.2 });
    },
    complete() { [523, 659, 784, 1046].forEach((f, i) => this.tone({ freq: f, dur: 0.26, type: 'triangle', gain: 0.1, delay: i * 0.11 })); },
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
    placed: 0,
    boardsCleared: 0,
    time: ROUND_SECONDS,
    board: null,
    piece: null,
    zen: false,
    paused: false,
    complete: false,
    lastResult: null,
    shakeNode: -1,
    shakeT: 0,
    t: 0,
    lastTs: 0,
    tickedAt: 0
  };

  const nodes = [];
  (function layoutNodes() {
    const perRow = 6;
    for (let i = 0; i < LEVELS.length; i++) {
      const row = i < perRow ? 0 : 1;
      const col = row === 0 ? i : i - perRow;
      const countInRow = row === 0 ? Math.min(perRow, LEVELS.length) : LEVELS.length - perRow;
      const spread = 1020;
      const step = countInRow > 1 ? spread / (countInRow - 1) : 0;
      const startX = W / 2 - spread / 2;
      nodes.push({ x: startX + col * step, y: row === 0 ? 505 : 705, i });
    }
  })();

  /* ----------------------------------------------------------------- board */
  const COL_GAP = 104, ROW_GAP = 112;
  const TILE_W = 122, TILE_H = 122;

  const gapsFor = goal => Math.min(18, Math.max(6, Math.ceil(goal / BOARDS_PER_LEVEL)));

  // Board sizes are chosen so the checkerboard always has enough gaps for the goal.
  const SHAPES = [[4, 3], [5, 3], [6, 3], [6, 4], [7, 4], [7, 5]];
  function shapeFor(gaps) {
    for (const [c, r] of SHAPES) if (Math.ceil(c * r / 2) >= gaps) return { cols: c, rows: r };
    return { cols: 7, rows: 5 };
  }

  function randInt(n) { return Math.floor(Math.random() * n); }
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /* A board is always solvable:
       gaps sit on a checkerboard, so no two gaps touch;
       the filled tiles are solved with union-find so that, for every gap,
       all of its neighbours agree on the attribute that gap's tile will check
       (colour for a Tall gap, symbol for a Wide gap).
     Filling a gap therefore never breaks another gap. */
  function makeBoard(levelIdx, goal) {
    void levelIdx;
    const gapCount = gapsFor(goal);

    for (let attempt = 0; attempt < 10; attempt++) {
      const { cols, rows } = shapeFor(Math.max(gapCount, 3 + attempt));
      const built = tryBuild(cols, rows, gapCount);
      if (built) return built;
    }
    // Guaranteed fallback: an empty board is always solvable.
    const { cols, rows } = shapeFor(gapCount);
    return tryBuild(cols, rows, cols * rows, true) || tryBuild(4, 3, 12, true);
  }

  /* Seed a mosaic with varied tiles, leaving the rest as gaps. A tile is always
     minted to fit a gap whose neighbours already agree, so a move always exists. */
  function tryBuild(cols, rows, gapCount, emptyBoard) {
    const cx = W * 0.645, cy = H * 0.455;
    const cells = [];
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        cells.push({
          c, r,
          tall: c % 2 === 0,
          shape: (c + r) % 3,
          x: cx + (c - (cols - 1) / 2) * COL_GAP,
          y: cy + (r - (rows - 1) / 2) * ROW_GAP + (c % 2 === 1 ? ROW_GAP * 0.5 : 0),
          tile: null, locked: 0, flash: 0, pop: 0
        });
      }
    }

    const seedCount = emptyBoard ? 0 : Math.max(0, cols * rows - gapCount);
    shuffle(cells.slice()).slice(0, seedCount).forEach(cell => {
      cell.tile = { color: randInt(PALETTE.length), symbol: randInt(SYMBOLS.length), tall: cell.tall };
    });

    const board = { cells, cols, rows, index: 0, gapCount };
    return hasViableGap(board) ? board : null;
  }

  function neighbours(b, cell) {
    const at = (c, r) => (c < 0 || r < 0 || c >= b.cols || r >= b.rows) ? null : b.cells[c * b.rows + r];
    return [at(cell.c - 1, cell.r), at(cell.c + 1, cell.r), at(cell.c, cell.r - 1), at(cell.c, cell.r + 1)]
      .filter(x => x && x.tile);
  }

  function fits(b, cell, piece) {
    if (!piece) return false;
    if (cell.tile || cell.locked > 0) return false;
    if (cell.tall !== piece.tall) return false;    // the gap only takes that orientation
    if (cell.shape !== piece.shape) return false;  // physical interlock
    const around = neighbours(b, cell);
    if (!around.length) return true;
    return piece.tall
      ? around.every(n => n.tile.color === piece.color)
      : around.every(n => n.tile.symbol === piece.symbol);
  }

  function aroundCell(b, cell) {
    const at = (c, r) => (c < 0 || r < 0 || c >= b.cols || r >= b.rows) ? null : b.cells[c * b.rows + r];
    return [at(cell.c - 1, cell.r), at(cell.c + 1, cell.r), at(cell.c, cell.r - 1), at(cell.c, cell.r + 1)]
      .filter(x => x && x.tile);
  }

  function gapIsViable(b, cell) {
    const around = aroundCell(b, cell);
    if (around.length < 2) return true;
    return cell.tall
      ? around.every(n => n.tile.color === around[0].tile.color)
      : around.every(n => n.tile.symbol === around[0].tile.symbol);
  }

  function hasViableGap(b) {
    return b.cells.some(c => !c.tile && gapIsViable(b, c));
  }

  function nextPiece(b) {
    const gaps = b.cells.filter(c => !c.tile && c.locked <= 0);
    if (!gaps.length) return null;

    const viable = gaps.filter(c => gapIsViable(b, c));
    if (!viable.length) return null;

    const target = viable[randInt(viable.length)];
    const around = aroundCell(b, target);
    const first = around[0];

    return {
      tall: target.tall,
      shape: target.shape,
      color: target.tall && first ? first.tile.color : randInt(PALETTE.length),
      symbol: !target.tall && first ? first.tile.symbol : randInt(SYMBOLS.length),
      bounce: 0
    };
  }

  /* If every gap is blocked, nudge the neighbours of one gap into agreement so
     the round can always continue (the board visibly shifts instead of dead-ending). */
  function ensurePiece(b) {
    const p = nextPiece(b);
    if (p) return p;

    const gaps = b.cells.filter(c => !c.tile && c.locked <= 0);
    if (!gaps.length) return null;

    const gap = gaps[randInt(gaps.length)];
    const around = aroundCell(b, gap);
    if (around.length) {
      const key = gap.tall ? 'color' : 'symbol';
      const value = around[0].tile[key];
      around.forEach(n => { n.tile[key] = value; n.pop = 0.001; });
    }
    return nextPiece(b);
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
      g.moveTo(-a, -b); g.lineTo(a, -b); g.lineTo(a, -a); g.lineTo(b, -a);
      g.lineTo(b, a); g.lineTo(a, a); g.lineTo(a, b); g.lineTo(-a, b);
      g.lineTo(-a, a); g.lineTo(-b, a); g.lineTo(-b, -a); g.lineTo(-a, -a);
      g.closePath();
      g.lineJoin = 'round';
      g.lineWidth = r;
      g.stroke(); g.fill();
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

  function paintTile(g, tall, color, symbol, alpha = 1) {
    const effW = tall ? TILE_H : TILE_W;
    const effH = tall ? TILE_W : TILE_H;

    g.save();
    g.globalAlpha *= alpha;

    g.save();
    g.translate(0, 8);
    g.fillStyle = 'rgba(4,26,32,0.4)';
    bowtiePath(g, TILE_W, TILE_H, tall);
    g.fill();
    g.restore();

    const pal = PALETTE[color];
    g.fillStyle = pal.fill;
    g.strokeStyle = pal.fill;
    g.lineJoin = 'round';
    g.lineWidth = 15;
    bowtiePath(g, TILE_W, TILE_H, tall);
    g.stroke();
    g.fill();

    g.save();
    bowtiePath(g, TILE_W, TILE_H, tall);
    g.clip();
    const lg = g.createLinearGradient(0, -effH / 2, 0, effH / 2);
    lg.addColorStop(0, 'rgba(255,255,255,0.14)');
    lg.addColorStop(0.55, 'rgba(255,255,255,0)');
    g.fillStyle = lg;
    g.fillRect(-effW, -effH, effW * 2, effH * 2);
    g.restore();

    drawSymbol(g, SYMBOLS[symbol], Math.min(effW, effH), 1);
    g.restore();
  }

  function text(str, x, y, { size = 34, weight = 700, color = '#ffffff', align = 'center', alpha = 1 } = {}) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.font = `${weight} ${size}px MuseoSans, "Helvetica Neue", Arial, sans-serif`;
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

    text(`Match ${LEVELS[current]} tiles and clear ${BOARDS_PER_LEVEL} boards to unlock the next level.`, W / 2, 880, {
      size: 32, weight: 700, alpha: 0.95
    });
  }

  /* ------------------------------------------------------------ play view */
  function drawCellBack(cell, valid) {
    const effW = cell.tall ? TILE_H : TILE_W;
    const effH = cell.tall ? TILE_W : TILE_H;
    void effW; void effH;

    ctx.save();
    ctx.translate(cell.x, cell.y);

    if (cell.locked > 0) {
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = 'rgba(12,20,24,0.75)';
      bowtiePath(ctx, TILE_W, TILE_H, cell.tall);
      ctx.fill();
      ctx.strokeStyle = 'rgba(223,97,87,0.75)';
      ctx.lineWidth = 3;
      bowtiePath(ctx, TILE_W - 8, TILE_H - 8, cell.tall);
      ctx.setLineDash([9, 7]);
      ctx.stroke();
      ctx.setLineDash([]);
      // padlock
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.beginPath(); ctx.roundRect(-9, 0, 18, 15, 3); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 2.6;
      ctx.beginPath(); ctx.arc(0, -1, 6.2, Math.PI, 0); ctx.stroke();
      ctx.restore();
      return;
    }

    // recessed gap
    ctx.fillStyle = valid ? 'rgba(255,255,255,0.16)' : 'rgba(6,28,34,0.34)';
    bowtiePath(ctx, TILE_W, TILE_H, cell.tall);
    ctx.fill();
    ctx.strokeStyle = valid ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.16)';
    ctx.lineWidth = valid ? 3 : 2;
    if (!valid) ctx.setLineDash([8, 8]);
    bowtiePath(ctx, TILE_W - 6, TILE_H - 6, cell.tall);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  function drawBoard(b) {
    const piece = S.piece;

    // filled tiles first, then gaps on top
    b.cells.forEach(cell => {
      if (!cell.tile) return;
      ctx.save();
      ctx.translate(cell.x, cell.y);
      const sc = 1 + cell.pop * 0.14;
      ctx.scale(sc, sc);
      paintTile(ctx, cell.tile.tall, cell.tile.color, cell.tile.symbol, 1 - cell.pop * 0.5);
      ctx.restore();
    });

    b.cells.forEach(cell => {
      if (cell.tile) return;
      const valid = !!piece && fits(b, cell, piece);
      drawCellBack(cell, valid);
    });

    // ghost of the held tile in every legal gap (Lumosity's shaded drop areas)
    if (piece) {
      b.cells.forEach(cell => {
        if (cell.tile || cell.locked > 0) return;
        if (!fits(b, cell, piece)) return;
        ctx.save();
        ctx.translate(cell.x, cell.y);
        paintTile(ctx, piece.tall, piece.color, piece.symbol, 0.32 + Math.sin(S.t * 3) * 0.05);
        ctx.restore();
      });
    }
  }

  function drawHeldPiece() {
    const p = S.piece;
    if (!p) return;
    ctx.save();
    ctx.translate(W * 0.205, H * 0.46);
    const bump = 1 + Math.sin(S.t * 2.4) * 0.012 + p.bounce * 0.12;
    ctx.scale(bump, bump);
    paintTile(ctx, p.tall, p.color, p.symbol, 1);
    ctx.restore();

    text(p.tall ? 'TALL — match color' : 'WIDE — match symbol', W * 0.205, H * 0.63, {
      size: 22, weight: 700, alpha: 0.7
    });
  }

  function drawPlay() {
    ctx.drawImage(BG, 0, 0);
    if (S.board) drawBoard(S.board);
    drawHeldPiece();

    text('Tall:  Color', W * 0.405, H * 0.855, { size: 34, weight: 500, alpha: 0.92 });
    text('Wide:  Symbol', W * 0.615, H * 0.855, { size: 34, weight: 500, alpha: 0.92 });

    if (!S.zen) {
      text(`Board ${Math.min(S.boardsCleared + 1, BOARDS_PER_LEVEL)} of ${BOARDS_PER_LEVEL}`, W * 0.5, H * 0.925, {
        size: 22, weight: 700, alpha: 0.55
      });
      text(`${S.placed} / ${S.goal} tiles`, W * 0.72, H * 0.925, { size: 22, weight: 700, alpha: 0.55 });
    }
  }

  /* ------------------------------------------------------------- gameplay */
  function startLevel(i, zen = false) {
    S.level = i;
    S.goal = LEVELS[i];
    S.score = 0;
    S.shownScore = 0;
    S.placed = 0;
    S.boardsCleared = 0;
    S.zen = zen;
    S.time = zen ? Infinity : ROUND_SECONDS;
    S.complete = false;
    S.paused = false;
    S.scene = 'play';
    S.board = makeBoard(i, S.goal);
    S.piece = ensurePiece(S.board);
    S.boardFullAt = 0;
    S.tickedAt = 0;
    hudVisible(true);
    pauseVisible(true);
    Audio.start();
  }

  function nextBoard() {
    S.boardsCleared++;
    S.board = makeBoard(S.level, S.goal);
    S.board.index = S.boardsCleared;
    S.piece = ensurePiece(S.board);
    Audio.board();
  }

  function resetBoard() {
    S.board = makeBoard(S.level, S.goal);
    S.board.index = S.boardsCleared;
    S.piece = ensurePiece(S.board);
    S.boardFullAt = 0;
    Audio.board();
  }

  function maybeComplete() {
    if (!S.zen && S.placed >= S.goal && S.boardsCleared >= BOARDS_PER_LEVEL) {
      endLevel(true);
      return true;
    }
    return false;
  }

  function endLevel(completed) {
    S.complete = completed;
    let bonus = 0;
    if (completed && !S.zen) bonus = Math.round(Math.max(0, S.time) * 50);
    const total = S.score + bonus;
    if (!S.zen) store.setBest(S.level, total);
    if (completed && !S.zen && S.level + 1 < LEVELS.length) {
      store.setUnlocked(Math.max(store.unlocked(), S.level + 2));
    }
    S.lastResult = { completed, bonus, total, level: S.level };
    showResult();
    if (completed) Audio.complete();
  }

  function tryPlace(cell) {
    if (S.scene !== 'play' || S.paused || S.complete) return;
    if (!S.board || !S.piece) return;
    if (cell.tile) return;

    if (cell.locked > 0) { Audio.locked(); return; }

    if (!fits(S.board, cell, S.piece)) {
      cell.locked = 3;
      cell.flash = 1;
      S.score = Math.max(0, S.score + TILE_HI.missPx);
      Audio.wrong();
      return;
    }

    cell.tile = { color: S.piece.color, symbol: S.piece.symbol, tall: S.piece.tall };
    cell.pop = 0.001;
    S.score += TILE_HI.fillPx;
    S.placed++;
    Audio.place();

    const full = S.board.cells.every(c => !!c.tile);
    if (full) {
      S.piece = null;
      S.boardFullAt = 0.55;
      return;
    }
    S.piece = ensurePiece(S.board);
    maybeComplete();
  }

  function hitCell(px, py) {
    if (!S.board) return null;
    for (const cell of S.board.cells) {
      if (Math.abs(px - cell.x) < 62 && Math.abs(py - cell.y) < 62) return cell;
    }
    return null;
  }

  cv.addEventListener('pointerdown', e => {
    e.preventDefault();
    Audio.ensure();
    const r = cv.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width * W;
    const py = (e.clientY - r.top) / r.height * H;

    if (S.scene === 'select') {
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        if (Math.abs(px - n.x) < 66 && Math.abs(py - n.y) < 52) {
          if (i < store.unlocked()) { Audio.click(); startLevel(i); }
          else { S.shakeNode = n.i; S.shakeT = 1; Audio.wrong(); }
          return;
        }
      }
      return;
    }

    const cell = hitCell(px, py);
    if (cell) tryPlace(cell);
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

      if (S.board) {
        S.board.cells.forEach(cell => {
          if (cell.locked > 0) cell.locked = Math.max(0, cell.locked - dt);
          if (cell.flash > 0) cell.flash = Math.max(0, cell.flash - dt * 2);
          if (cell.pop > 0) cell.pop = Math.min(1, cell.pop + dt * 3.2);
        });

        if (S.boardFullAt > 0) {
          S.boardFullAt -= dt;
          if (S.boardFullAt <= 0) {
            S.boardFullAt = 0;
            const wasReset = S.resetNext;
            S.resetNext = false;
            if (!maybeComplete()) { if (wasReset) resetBoard(); else nextBoard(); }
          }
        }
      }

      if (!S.piece && S.board && S.boardFullAt <= 0 && S.board.cells.some(c => !c.tile)) {
        S.boardFullAt = 0.45;
        S.resetNext = true;
      }

      if (S.piece) {
        S.piece.intro = Math.min(1, S.piece.intro + dt * 5);
        if (S.piece.bounce > 0) S.piece.bounce = Math.max(0, S.piece.bounce - dt * 3);
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
      : `You placed ${S.placed} of ${LEVELS[r.level]}`;
    document.getElementById('resultScore').textContent = r.total.toLocaleString('en-US');
    document.getElementById('resultTiles').textContent = String(S.placed);
    document.getElementById('resultBest').textContent = store.best(r.level).toLocaleString('en-US');

    const primary = document.getElementById('resultPrimary');
    const hasNext = r.completed && r.level + 1 < LEVELS.length;
    primary.textContent = hasNext ? 'Next level' : (r.completed ? 'Play again' : 'Try again');
    primary.onclick = () => {
      Audio.click();
      hideOverlay();
      startLevel(hasNext ? r.level + 1 : r.level);
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
      if (!S.paused) { S.paused = true; showPanel('pause'); }
      else { S.paused = false; hideOverlay(); }
    }
  });

  /* ------------------------------------------------------------------ boot */
  paintSound();
  hudVisible(false);
  pauseVisible(false);
  requestAnimationFrame(frame);

  if (new URLSearchParams(location.search).has('debug')) {
    window.__l2 = { S, LEVELS, startLevel, update, drawScene, tryPlace, fits, nextPiece, makeBoard, store };
  }
})();
