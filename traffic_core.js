(function (global) {

  const WBASE = 13, MAX_ST = 0.40, CAR_L = 22, CAR_W = 13;
  const IDM_A = 0.08, IDM_B = 0.12, IDM_S0 = 6, IDM_T = 2;
  const LOOK = 80, DET_W = 6, PATH_SP = 4, V0_DEF = 2.2;
  const ZONE_APPROACH = 60, ZONE_CROSS_THRESH = CAR_W + 8;
  const WALL_STEER_DIST = CAR_W / 2 + 6;
  const WALL_BRAKE_DIST = CAR_W / 2 + 2;
  const CONE_IMMED_LEN = CAR_L + 4;
  const CONE_LOOK_LEN = 40;
  const CONE_MARGIN = 2;
  const REVERSE_SPD = 0.6, REVERSE_STUCK_THRESH = 80;
  const BLINKER_MIN = 20, BLINKER_TIMEOUT = 120;
  const MOBIL_SAFE_GAP = CAR_L * 1.5;
  const MOBIL_MANEUVER_GAP = CAR_L * 0.5;
  const SPAWN_CLEAR_GAP = Math.max(MOBIL_SAFE_GAP, IDM_S0 + 8);
  const SPAWN_SPACING = CAR_L + SPAWN_CLEAR_GAP;
  const PROJ_MARGIN = 2;
  const PROJ_BROAD_PHASE = 60;
  const PROJ_BROAD_PHASE_SQ = PROJ_BROAD_PHASE * PROJ_BROAD_PHASE;
  const INTERSECT_WIDEN = 1.3;
  const MAIN_LANE_SCALE = 1.10;
  const BRANCH_LANE_SCALE = 1.25;
  const BRANCH_WIDTH_TRANSITION_T = 0.24;
  const SPLIT_WALL_GAP = 4;
  const BRANCH_SAMPLE_COUNT = 60;
  const COMMIT_DIST = 90;
  const BATCH_APPROACH_DIST = COMMIT_DIST + 80;
  const EXIT_CLEARANCE = CAR_L * 2;
  const MAX_BATCH_SIZE = 2;
  const BATCH_HOLD_TICKS = 24;
  const NO_PROGRESS_THRESH = 60;
  const NO_PROGRESS_THRESH_YIELD = 480;
  const PROGRESS_RESUME_THRESH = 20;
  const PROGRESS_EPS = 0.35;
  const LANE_LOAD_LOOKAHEAD = 150;
  const MAX_ACTIVE_MANEUVERS = 4;
  const EARLY_EXIT_SCORE = 0.9;
  const HARD_FOLLOW_GAP = Math.max(IDM_S0, 4);
  const SINGLE_LANE_BASE_LW = 28;
  const CAR_HALF_DIAG = Math.hypot(CAR_L / 2, CAR_W / 2);
  const BRANCH_SPREAD_HEIGHT_RATIO = 1.35;

  const RENDER_THEMES = {
    classic: {
      scene: 'classic',
      canvas: '#06060a',
      roadFill: '#0f0f17',
      roadGuide: '#242438',
      roadDivider: '#181824',
      roadStroke: '#1c1c2a',
      stopGo: '#153015',
      stopStop: '#4a1010',
      stopLightGo: '#22bb22',
      stopLightStop: '#bb1818',
      stopLightRing: '#0e0e16',
      queueText: '#444'
    },
    rioSatellite: {
      scene: 'rio_satellite',
      canvas: '#99d1c7',
      land: '#c9e6c0',
      landShade: '#b7d8ad',
      landWarm: '#e5f0cb',
      water: '#5bafc5',
      waterDeep: '#397f98',
      waterHighlight: 'rgba(232, 250, 255, 0.34)',
      bridgeShadow: 'rgba(21, 47, 61, 0.24)',
      mountain: '#67864d',
      mountainDark: '#45613a',
      mountainRock: '#81886c',
      shore: '#73aa3a',
      shoreDark: '#4f7b27',
      forest: '#2d6e49',
      forestAlt: '#57905d',
      island: '#87aa6f',
      church: '#f3ecdd',
      churchRoof: '#ca775e',
      churchCross: '#705640',
      house: '#f8efe5',
      houseRoof: '#d17d60',
      pool: '#6ccde6',
      roadFill: '#565d65',
      roadGuide: 'rgba(245, 246, 228, 0.34)',
      roadDivider: '#f3f1d6',
      roadStroke: '#2d3740',
      stopGo: '#1f5f49',
      stopStop: '#8c423d',
      stopLightGo: '#5bd79c',
      stopLightStop: '#ea7767',
      stopLightRing: '#2f5059',
      queueText: '#294951'
    }
  };

  function mkRng(s) { s |= 0; return () => { s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; } }

  const V = {
    len: v => Math.hypot(v.x, v.y), dot: (a, b) => a.x * b.x + a.y * b.y, sub: (a, b) => ({ x: a.x - b.x, y: a.y - b.y }),
    add: (a, b) => ({ x: a.x + b.x, y: a.y + b.y }), scale: (v, s) => ({ x: v.x * s, y: v.y * s }),
    norm: v => { const l = Math.hypot(v.x, v.y) || 1; return { x: v.x / l, y: v.y / l }; }
  };

  function idm(v, v0, gap, dv) {
    const ss = IDM_S0 + Math.max(0, v * IDM_T + v * dv / (2 * Math.sqrt(IDM_A * IDM_B)));
    return IDM_A * (1 - Math.pow(v / Math.max(v0, 0.01), 4) - Math.pow(ss / Math.max(gap, 0.1), 2));
  }

  function toLocal(wx, wy, cx, cy, cth) {
    const dx = wx - cx, dy = wy - cy;
    return { fwd: dx * Math.cos(cth) + dy * Math.sin(cth), lat: -dx * Math.sin(cth) + dy * Math.cos(cth) };
  }

  function coneHitsOBB(cx, cy, cth, fwdMin, fwdMax, halfW, ox, oy, oth) {
    const hl = CAR_L / 2, hw = CAR_W / 2;
    const co = Math.cos(oth), so = Math.sin(oth);
    const oCorners = [
      { x: ox + co * hl - so * hw, y: oy + so * hl + co * hw }, { x: ox + co * hl + so * hw, y: oy + so * hl - co * hw },
      { x: ox - co * hl + so * hw, y: oy - so * hl - co * hw }, { x: ox - co * hl - so * hw, y: oy - so * hl + co * hw }
    ];
    for (let i = 0; i < 4; i++) oCorners[i] = toLocal(oCorners[i].x, oCorners[i].y, cx, cy, cth);
    let oMinF = 1e9, oMaxF = -1e9, oMinL = 1e9, oMaxL = -1e9;
    for (const c of oCorners) {
      if (c.fwd < oMinF) oMinF = c.fwd; if (c.fwd > oMaxF) oMaxF = c.fwd;
      if (c.lat < oMinL) oMinL = c.lat; if (c.lat > oMaxL) oMaxL = c.lat;
    }
    return oMaxF >= fwdMin && oMinF <= fwdMax && oMaxL >= -halfW && oMinL <= halfW;
  }

  function coneCheck(c, o) {
    const dist = Math.hypot(o.x - c.x, o.y - c.y);
    if (dist > LOOK + CAR_L) return null;
    const loc = toLocal(o.x, o.y, c.x, c.y, c.th);
    if (loc.fwd < -CAR_L) return null;

    const immedHW = CAR_W / 2 + CONE_MARGIN;
    const lookLen = Math.max(CONE_LOOK_LEN, Math.abs(c.speed) * 18);
    const lookHW = CAR_W / 2 + CONE_MARGIN + Math.abs(c.speed) * 3;

    const imminent = coneHitsOBB(c.x, c.y, c.th, CAR_L / 2, CAR_L / 2 + CONE_IMMED_LEN, immedHW, o.x, o.y, o.th);
    const lookahead = !imminent && coneHitsOBB(c.x, c.y, c.th, CAR_L / 2, CAR_L / 2 + lookLen, lookHW, o.x, o.y, o.th);

    if (!imminent && !lookahead) return null;
    return { imminent, lookahead, fwd: loc.fwd, lat: loc.lat };
  }

  function rearConeCheck(c, o) {
    const loc = toLocal(o.x, o.y, c.x, c.y, c.th);
    if (loc.fwd > CAR_L / 2) return false;
    const rearDist = -loc.fwd - CAR_L / 2;
    if (rearDist < 0 || rearDist > CAR_L * 2) return false;
    return Math.abs(loc.lat) < CAR_W / 2 + CONE_MARGIN;
  }

  function satOverlap(a, b) {
    const corners = (x, y, th) => {
      const c = Math.cos(th), s = Math.sin(th), hl = CAR_L / 2, hw = CAR_W / 2;
      return [{ x: x + c * hl - s * hw, y: y + s * hl + c * hw }, { x: x + c * hl + s * hw, y: y + s * hl - c * hw }, { x: x - c * hl + s * hw, y: y - s * hl - c * hw }, { x: x - c * hl - s * hw, y: y - s * hl + c * hw }];
    };
    const cA = corners(a.x, a.y, a.th), cB = corners(b.x, b.y, b.th);
    const axes = [{ x: Math.cos(a.th), y: Math.sin(a.th) }, { x: -Math.sin(a.th), y: Math.cos(a.th) }, { x: Math.cos(b.th), y: Math.sin(b.th) }, { x: -Math.sin(b.th), y: Math.cos(b.th) }];
    for (const ax of axes) {
      let aMin = 1e9, aMax = -1e9, bMin = 1e9, bMax = -1e9;
      for (const c of cA) { const p = c.x * ax.x + c.y * ax.y; if (p < aMin) aMin = p; if (p > aMax) aMax = p; }
      for (const c of cB) { const p = c.x * ax.x + c.y * ax.y; if (p < bMin) bMin = p; if (p > bMax) bMax = p; }
      if (aMax <= bMin || bMax <= aMin) return false;
    }
    return true;
  }

  function carCorners(x, y, th, margin) {
    const c = Math.cos(th), s = Math.sin(th), hl = CAR_L / 2 + (margin || 0), hw = CAR_W / 2 + (margin || 0);
    return [{ x: x + c * hl - s * hw, y: y + s * hl + c * hw }, { x: x + c * hl + s * hw, y: y + s * hl - c * hw },
    { x: x - c * hl + s * hw, y: y - s * hl - c * hw }, { x: x - c * hl - s * hw, y: y - s * hl + c * hw }];
  }

  function satOverlapMargin(ax, ay, ath, bx, by, bth, margin) {
    const halfDiag = CAR_HALF_DIAG + (margin || 0);
    const dx = ax - bx, dy = ay - by;
    if (dx * dx + dy * dy > (halfDiag * 2) * (halfDiag * 2)) return false;
    const cA = carCorners(ax, ay, ath, margin), cB = carCorners(bx, by, bth, margin);
    const axes = [{ x: Math.cos(ath), y: Math.sin(ath) }, { x: -Math.sin(ath), y: Math.cos(ath) },
    { x: Math.cos(bth), y: Math.sin(bth) }, { x: -Math.sin(bth), y: Math.cos(bth) }];
    for (const ax2 of axes) {
      let aMin = 1e9, aMax = -1e9, bMin = 1e9, bMax = -1e9;
      for (const c of cA) { const p = c.x * ax2.x + c.y * ax2.y; if (p < aMin) aMin = p; if (p > aMax) aMax = p; }
      for (const c of cB) { const p = c.x * ax2.x + c.y * ax2.y; if (p < bMin) bMin = p; if (p > bMax) bMax = p; }
      if (aMax <= bMin || bMax <= aMin) return false;
    }
    return true;
  }

  function pathQuery(path, x, y, hint) {
    const lo = Math.max(0, (hint || 0) - 8), hi = Math.min(path.length - 1, (hint || 0) + 30);
    let bi = hint || 0, bd = 1e9; for (let i = lo; i <= hi; i++) { const d = Math.hypot(path[i].x - x, path[i].y - y); if (d < bd) { bd = d; bi = i; } }
    if (bd > 30) { for (let i = 0; i < path.length; i++) { const d = Math.hypot(path[i].x - x, path[i].y - y); if (d < bd) { bd = d; bi = i; } } }
    let ti; if (bi === 0) ti = 1; else if (bi >= path.length - 1) ti = path.length - 2;
    else ti = Math.hypot(path[bi - 1].x - x, path[bi - 1].y - y) < Math.hypot(path[bi + 1].x - x, path[bi + 1].y - y) ? bi - 1 : bi + 1;
    const a = Math.min(bi, ti), b = Math.max(bi, ti), sx = path[b].x - path[a].x, sy = path[b].y - path[a].y, sl = Math.max(Math.hypot(sx, sy), 0.01);
    const t = Math.max(0, Math.min(1, ((x - path[a].x) * sx + (y - path[a].y) * sy) / (sl * sl)));
    return { px: path[a].x + sx * t, py: path[a].y + sy * t, ang: Math.atan2(sy, sx), idx: bi };
  }

  class Road {
    constructor(n, w, h) {
      this.n = n; this.w = w; this.h = h; this.cx = w / 2;
      this.baseLw = n === 1 ? SINGLE_LANE_BASE_LW : Math.max(22, Math.min(26, (w * 0.92) / Math.max(n, 1)));
      this.mainLw = this.baseLw * MAIN_LANE_SCALE;
      this.branchLw = this.baseLw * BRANCH_LANE_SCALE;
      this.lw = this.mainLw;
      this.forkY = h * 0.50; this.stopY = h * 0.72; this.entryY = h + 90;
      this.mainLen = this.entryY - this.forkY;
      const branchRise = Math.max(this.forkY - 8, this.branchLw * 2);
      const minSpread = Math.max(this.branchLw * (this.n + 0.5), this.mainLw * 2.4);
      const spreadCapByHeight = Math.max(minSpread, branchRise * BRANCH_SPREAD_HEIGHT_RATIO);
      const sp = Math.min(w * 0.44, 200, spreadCapByHeight);
      this.lEnd = { x: this.cx - sp, y: 8 }; this.rEnd = { x: this.cx + sp, y: 8 };
      const baseDist = Math.hypot(sp, this.forkY - 8), cpDist = baseDist * 0.45;
      this.branchCP1 = { x: this.cx, y: this.forkY - cpDist };
      const endAng = Math.atan2(this.lEnd.y - this.branchCP1.y, this.lEnd.x - this.branchCP1.x);
      this.lCP2 = { x: this.lEnd.x - Math.cos(endAng) * cpDist, y: this.lEnd.y - Math.sin(endAng) * cpDist };
      this.rCP2 = { x: this.rEnd.x + Math.cos(endAng) * cpDist, y: this.rEnd.y - Math.sin(endAng) * cpDist };
      this._genPaths(); this._genConflictZones(); this._genBoundary();
    }
    halfW() { return this.n * this.mainLw / 2; }
    izoneTop() { return this.forkY - 20; }
    izoneBot() { return this.forkY + 40; }
    halfWAt(y) { return this.halfW(); }
    laneX(i) { return this.cx + (i - (this.n - 1) / 2) * this.mainLw; }
    branchWidthSettledT() { return BRANCH_WIDTH_TRANSITION_T; }
    laneOffset(i, laneW) { return -((i - (this.n - 1) / 2) * laneW); }
    branchLaneWidthAt(t) {
      if (t <= 0) return this.mainLw;
      if (t >= BRANCH_WIDTH_TRANSITION_T) return this.branchLw;
      const u = Math.max(0, Math.min(1, t / BRANCH_WIDTH_TRANSITION_T));
      const smooth = u * u * (3 - 2 * u);
      return this.mainLw + (this.branchLw - this.mainLw) * smooth;
    }
    branchHalfW(br, t) { return this.n * this.branchLaneWidthAt(t) / 2; }
    bPt(br, t) {
      const e = br === 'left' ? this.lEnd : this.rEnd, c1 = this.branchCP1, c2 = br === 'left' ? this.lCP2 : this.rCP2, u = 1 - t;
      const x = u * u * u * this.cx + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * e.x;
      const y = u * u * u * this.forkY + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * e.y;
      const dx = 3 * u * u * (c1.x - this.cx) + 6 * u * t * (c2.x - c1.x) + 3 * t * t * (e.x - c2.x);
      const dy = 3 * u * u * (c1.y - this.forkY) + 6 * u * t * (c2.y - c1.y) + 3 * t * t * (e.y - c2.y);
      return { x, y, angle: Math.atan2(dy, dx) };
    }
    branchPoint(br, t, offset) {
      const p = this.bPt(br, t), pr = p.angle - Math.PI / 2;
      return { x: p.x + Math.cos(pr) * offset, y: p.y + Math.sin(pr) * offset, angle: p.angle, nx: Math.cos(pr), ny: Math.sin(pr), t };
    }
    branchLanePoint(br, i, t) { return this.branchPoint(br, t, this.laneOffset(i, this.branchLaneWidthAt(t))); }
    branchOuterPoint(br, t) { return this.branchPoint(br, t, br === 'left' ? this.branchHalfW(br, t) : -this.branchHalfW(br, t)); }
    branchInnerPoint(br, t) { return this.branchPoint(br, t, br === 'left' ? -this.branchHalfW(br, t) : this.branchHalfW(br, t)); }
    branchDividerPoint(br, lane, t) { return this.branchPoint(br, t, -this.branchHalfW(br, t) + lane * this.branchLaneWidthAt(t)); }
    splitGapAt(t) { return this.branchInnerPoint('right', t).x - this.branchInnerPoint('left', t).x; }
    sampleMainEdge(side, samples) {
      const pts = [], steps = samples || 20;
      for (let i = 0; i <= steps; i++) {
        const y = this.entryY - (this.entryY - this.forkY) * i / steps;
        pts.push({ x: this.cx + side * this.halfWAt(y), y, t: i / steps });
      }
      return pts;
    }
    sampleBranchEdge(br, edge, samples, fromT) {
      const pts = [], steps = Math.max(2, samples || BRANCH_SAMPLE_COUNT);
      const start = edge === 'inner' ? (fromT !== undefined ? fromT : this.splitWallStartT) : 0;
      if (start >= 1) return pts;
      for (let i = 0; i <= steps; i++) {
        const t = start + (1 - start) * (i / steps);
        pts.push(edge === 'outer' ? this.branchOuterPoint(br, t) : this.branchInnerPoint(br, t));
      }
      return pts;
    }
    sampleBranchDivider(br, lane, samples, fromT, toT) {
      const pts = [], steps = Math.max(2, samples || BRANCH_SAMPLE_COUNT);
      const start = fromT !== undefined ? fromT : this.splitWallStartT;
      const end = toT !== undefined ? toT : 1;
      if (start >= end) return pts;
      for (let i = 0; i <= steps; i++) {
        const t = start + (end - start) * (i / steps);
        pts.push(this.branchDividerPoint(br, lane, t));
      }
      return pts;
    }
    roadClearance(x, y) {
      let best = -1e9;
      if (y >= this.forkY) best = Math.max(best, this.halfW() - Math.abs(x - this.cx));
      for (const br of ['left', 'right']) {
        const path = this.centerPaths[br];
        const pq = pathQuery(path, x, y, Math.floor((path.length - 1) * 0.25));
        const local = toLocal(x, y, pq.px, pq.py, pq.ang);
        if ((pq.idx === 0 && local.fwd < -1) || (pq.idx >= path.length - 1 && local.fwd > 1)) continue;
        const t = pq.idx / (path.length - 1);
        best = Math.max(best, this.branchHalfW(br, t) - Math.abs(local.lat));
      }
      return best;
    }
    _pushBoundaryChain(points, seg, role) {
      for (let i = 0; i < points.length - 1; i++) {
        const a = points[i], b = points[i + 1], dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
        let nx = dy / l, ny = -dx / l;
        const tMid = ((a.t ?? 0) + (b.t ?? 0)) / 2;
        const ref = seg === 'main' ? { x: this.cx, y: (a.y + b.y) / 2 } : this.branchPoint(seg, tMid, 0);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if ((ref.x - mid.x) * nx + (ref.y - mid.y) * ny < 0) { nx = -nx; ny = -ny; }
        this.boundary.push({ a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y }, n: { x: nx, y: ny }, seg, role, t0: a.t ?? 0, t1: b.t ?? 0 });
      }
    }

    _genPaths() {
      this.centerPaths = { left: [], right: [] };
      for (const br of ['left', 'right']) {
        for (let s = 0; s <= BRANCH_SAMPLE_COUNT; s++) {
          this.centerPaths[br].push(this.bPt(br, s / BRANCH_SAMPLE_COUNT));
        }
      }
      this.splitWallStartT = 1;
      for (let s = 0; s <= BRANCH_SAMPLE_COUNT; s++) {
        const t = s / BRANCH_SAMPLE_COUNT;
        if (this.splitGapAt(t) >= SPLIT_WALL_GAP) { this.splitWallStartT = t; break; }
      }
      this.splitWallStartIndex = Math.ceil(this.splitWallStartT * BRANCH_SAMPLE_COUNT);
      this.preSplitInnerBoundarySampleCount = 0;
      this.fullPaths = {}; this.pathKeys = [];
      for (let i = 0; i < this.n; i++) {
        for (const br of ['left', 'right']) {
          const pts = [], lx = this.laneX(i);
          for (let y = this.entryY; y >= this.forkY; y -= PATH_SP)pts.push({ x: lx, y });
          for (let s = 1; s <= BRANCH_SAMPLE_COUNT; s++) {
            const p = this.branchLanePoint(br, i, s / BRANCH_SAMPLE_COUNT);
            pts.push({ x: p.x, y: p.y });
          }
          const key = i + '-' + br; this.fullPaths[key] = pts; this.pathKeys.push(key);
        }
      }
    }

    _genConflictZones() {
      this.conflictZones = []; const rawZones = [];
      for (let a = 0; a < this.pathKeys.length; a++) {
        for (let b = a + 1; b < this.pathKeys.length; b++) {
          const kA = this.pathKeys[a], kB = this.pathKeys[b];
          const lA = parseInt(kA), bA = kA.split('-')[1], lB = parseInt(kB), bB = kB.split('-')[1];
          if (lA === lB || bA === bB) continue;
          const pA = this.fullPaths[kA], pB = this.fullPaths[kB];
          const fi = Math.floor((this.entryY - this.forkY) / PATH_SP);
          const s0 = Math.max(0, fi - 10), s1 = Math.min(Math.min(pA.length, pB.length) - 1, fi + 25);
          let minD = 1e9, bIA = 0, bIB = 0;
          for (let ia = s0; ia <= s1; ia++)for (let ib = s0; ib <= s1; ib++) {
            const d = Math.hypot(pA[ia].x - pB[ib].x, pA[ia].y - pB[ib].y); if (d < minD) { minD = d; bIA = ia; bIB = ib; }
          }
          if (minD < ZONE_CROSS_THRESH) rawZones.push({
            pathA: kA, pathB: kB, idxA: bIA, idxB: bIB,
            x: (pA[bIA].x + pB[bIB].x) / 2, y: (pA[bIA].y + pB[bIB].y) / 2, radius: Math.max(minD / 2 + CAR_L, CAR_L + 4)
          });
        }
      }
      if (!rawZones.length) return;
      const used = new Set();
      for (let i = 0; i < rawZones.length; i++) {
        if (used.has(i)) continue; const group = [rawZones[i]]; used.add(i);
        for (let j = i + 1; j < rawZones.length; j++) {
          if (used.has(j)) continue;
          if (Math.hypot(rawZones[i].x - rawZones[j].x, rawZones[i].y - rawZones[j].y) < 30) { group.push(rawZones[j]); used.add(j); }
        }
        let cx = 0, cy = 0, maxR = 0; const pc = new Map();
        for (const z of group) {
          cx += z.x; cy += z.y; maxR = Math.max(maxR, z.radius);
          if (!pc.has(z.pathA)) pc.set(z.pathA, z.idxA); if (!pc.has(z.pathB)) pc.set(z.pathB, z.idxB);
        }
        this.conflictZones.push({
          x: cx / group.length, y: cy / group.length, radius: maxR + 5, paths: pc, holder: null,
          activeBatchId: null, activeBatchTarget: null, batchMembers: [], batchExpireTick: 0,
          starveTicksLeft: 0, starveTicksRight: 0, downstreamClearanceByTarget: { left: 1e9, right: 1e9 },
          schedulerEnabled: false
        });
      }
    }

    _genBoundary() {
      this.boundary = [];
      this._pushBoundaryChain(this.sampleMainEdge(-1, 20), 'main', 'main_outer');
      this._pushBoundaryChain(this.sampleMainEdge(1, 20), 'main', 'main_outer');
      for (const br of ['left', 'right']) {
        this._pushBoundaryChain(this.sampleBranchEdge(br, 'outer', BRANCH_SAMPLE_COUNT, 0), br, 'branch_outer');
        const innerPts = this.sampleBranchEdge(br, 'inner', BRANCH_SAMPLE_COUNT, this.splitWallStartT);
        this.preSplitInnerBoundarySampleCount += innerPts.filter(p => p.t < this.splitWallStartT - 1e-6).length;
        this._pushBoundaryChain(innerPts, br, 'branch_inner');
        for (let lane = 1; lane < this.n; lane++) {
          const dividerPts = this.sampleBranchDivider(br, lane, BRANCH_SAMPLE_COUNT);
          this.preSplitInnerBoundarySampleCount += dividerPts.filter(p => p.t < this.splitWallStartT - 1e-6).length;
        }
      }
    }
    nearestBoundary(x, y, segFilter) {
      let bd = 1e9, bs = null;
      for (const seg of this.boundary) {
        if (segFilter && seg.seg !== segFilter) continue;
        const dx = seg.b.x - seg.a.x, dy = seg.b.y - seg.a.y, l2 = dx * dx + dy * dy; if (l2 < 0.01) continue;
        let t = ((x - seg.a.x) * dx + (y - seg.a.y) * dy) / l2; t = Math.max(0, Math.min(1, t));
        const d = Math.hypot(x - (seg.a.x + t * dx), y - (seg.a.y + t * dy)); if (d < bd) { bd = d; bs = seg; }
      }
      return { dist: bd, seg: bs };
    }
  }

  class Car {
    constructor(id, x, y, th, lane, target, tb) {
      this.id = id; this.x = x; this.y = y; this.th = th; this.speed = 0; this.steer = 0;
      this.lane = lane; this.target = target; this.done = false; this.seg = 'main';
      this.fixed = false;
      this.tiebreak = tb; this.path = null; this.pathKey = ''; this.pathIdx = 0; this.prevCTE = 0;
      this.trafficMode = 'free'; this.noProgressTicks = 0; this.lastProgress = 0;
      this.blockingKind = 'none'; this.plannerMode = 'nominal';
      this._lastTrafficMode = 'free';
      this.commitUntilFork = false; this.batchId = null; this.batchTarget = ''; this.primaryBlockerId = null;
      this.progressResumeTicks = 0; this.commitLaneChanges = 0;
      this.spillbackTicks = 0; this.spillbackFlag = false;
      this.zoneYielding = false;
      this.blinker = 0; this.blinkerTimer = 0; this.merging = false; this.mobilTimer = 0;
      this.stuckTicks = 0; this.reversing = false;
      this.maneuvering = false; this.maneuverPhase = 0; this.maneuverTimer = 0;
      this.maneuverPerpDir = { x: 0, y: 0 };
      this.prioritySignal = false;
      this.desSpd = 0; this.desSt = 0;
      this._finishLogged = false; this._insideConflictPrev = false; this._illegalConflictLogged = false;
      this.color = target === 'left' ? '#c48828' : '#2888c4';
    }
  }

  class Sim {
    constructor(nL, nC, splitPct, seed) {
      this.nL = nL; this.nC = nC; this.splitPct = splitPct; this.seed = seed;
      this.road = null; this.cars = []; this.ticks = 0;
      this.running = this.started = this.finished = false; this.finishTick = 0; this.satCount = 0;
      this.rng = mkRng(seed ^ 0x5bd1e995);
      this.nextBatchId = 1; this.maxBatchSizeSeen = 0; this.spillbackViolations = 0; this.maxStarveTicks = 0;
      this.maneuverTriggerCount = 0; this.commitOscillationCount = 0; this.plannerIllegalCount = 0;
      this.yieldEntryCount = 0; this.holdExitEntryCount = 0; this.batchEntryCount = 0;
      this._initTestState();
    }
    init(w, h) {
      this.road = new Road(this.nL, w, h); this.cars = []; this.ticks = 0;
      this.running = this.started = this.finished = false; this.finishTick = 0; this.satCount = 0;
      this.rng = mkRng(this.seed ^ 0x5bd1e995);
      this.nextBatchId = 1; this.maxBatchSizeSeen = 0; this.spillbackViolations = 0; this.maxStarveTicks = 0;
      this.maneuverTriggerCount = 0; this.commitOscillationCount = 0; this.plannerIllegalCount = 0;
      this.yieldEntryCount = 0; this.holdExitEntryCount = 0; this.batchEntryCount = 0;
      this._initTestState();
      const R = mkRng(this.seed), n = this.nC, nL = Math.round(n * this.splitPct / 100);
      const tg = []; for (let i = 0; i < n; i++)tg.push(i < nL ? 'left' : 'right');
      for (let i = n - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1));[tg[i], tg[j]] = [tg[j], tg[i]]; }
      const perL = new Array(this.nL).fill(0), rd = this.road;
      const laneStagger = this.nL > 1 ? SPAWN_SPACING / (this.nL + 1) : 0;
      const rowPitch = SPAWN_SPACING + laneStagger * Math.max(0, this.nL - 1);
      for (let i = 0; i < n; i++) {
        const lane = i % this.nL, lx = rd.laneX(lane);
        const row = perL[lane];
        const phase = this.nL > 1 ? lane : 0;
        const yPos = rd.stopY + SPAWN_SPACING + row * rowPitch + phase * laneStagger;
        const c = new Car(i, lx, yPos, -Math.PI / 2, lane, tg[i], (R() - 0.5));
        c.mobilTimer = Math.floor(R() * 20);
        c.pathKey = lane + '-' + c.target; c.path = rd.fullPaths[c.pathKey];
        c.pathIdx = pathQuery(c.path, c.x, c.y, 0).idx;
        c.lastProgress = c.pathIdx * PATH_SP;
        this.cars.push(c); perL[lane]++;
      }
    }
    start() { this.started = this.running = true; }

    _initTestState() {
      this.testEvents = [];
      this.testMetrics = {
        overlapCount: 0,
        wallEscapeCount: 0,
        doneCount: 0,
        finishTimes: {},
        finishOrder: [],
        maneuverEnterCount: 0,
        maneuverEnterReasons: { progress: 0 },
        firstManeuverTick: null,
        firstProgressManeuverTick: null,
        yieldEnterCount: 0,
        holdExitEnterCount: 0,
        batchGrantCount: 0,
        maxBatchSize: 0,
        conflictEnterCount: 0,
        legalConflictEnterCount: 0,
        firstConflictClearanceTick: null,
        maxConflictZoneStallTicks: 0,
        illegalConflictEntryCount: 0,
        illegalBlockedExitAdmissionCount: 0,
        maxBlockedBranchStopTicks: 0,
        mergeAttemptCount: 0,
        mergeAcceptCount: 0,
        mergeRejectUnsafeCount: 0,
        minAcceptedMergeGap: Infinity,
        lateCommitLaneChangeCount: 0,
        maxStarveTicks: 0,
        maxLaneCenterDrift: 0,
        maxYawDrift: 0,
        minBranchRectGap: Infinity,
        maxNoProgressTicks: 0,
        prematureSplitWallContactCount: 0,
        preSplitInnerBoundarySampleCount: 0,
        plannerIllegalCount: 0,
        minRuntimeSameLaneGap: Infinity,
        maxConcurrentManeuverCount: 0
      };
    }

    _event(type, data) {
      if (this.testEvents.length >= 500) this.testEvents.shift();
      this.testEvents.push({ tick: this.ticks, type, ...data });
    }

    _syncTestMetrics() {
      this.testMetrics.doneCount = this.cars.filter(c => c.done && !c.fixed).length;
      this.testMetrics.maneuverEnterCount = this.maneuverTriggerCount;
      this.testMetrics.yieldEnterCount = this.yieldEntryCount;
      this.testMetrics.holdExitEnterCount = this.holdExitEntryCount;
      this.testMetrics.maxBatchSize = this.maxBatchSizeSeen;
      this.testMetrics.maxStarveTicks = this.maxStarveTicks;
      this.testMetrics.lateCommitLaneChangeCount = this.commitOscillationCount;
      this.testMetrics.preSplitInnerBoundarySampleCount = this.road ? this.road.preSplitInnerBoundarySampleCount : 0;
      this.testMetrics.plannerIllegalCount = this.plannerIllegalCount;
    }

    _sameLaneRuntimeGap(a, b) {
      if (a.seg !== b.seg) return Infinity;
      if (a.seg === 'main') {
        if (a.lane !== b.lane) return Infinity;
      } else if (a.pathKey !== b.pathKey) {
        return Infinity;
      }
      const dx = b.x - a.x, dy = b.y - a.y;
      const fwd = dx * Math.cos(a.th) + dy * Math.sin(a.th);
      const lat = Math.abs(-dx * Math.sin(a.th) + dy * Math.cos(a.th));
      if (fwd <= 0 || lat > CAR_W) return Infinity;
      return fwd - CAR_L;
    }

    _updateRuntimeSafetyMetrics(active) {
      let maneuverers = 0;
      for (const c of active) if (c.maneuvering) maneuverers++;
      this.testMetrics.maxConcurrentManeuverCount = Math.max(this.testMetrics.maxConcurrentManeuverCount, maneuverers);
      for (const a of active) {
        for (const b of active) {
          if (a.id === b.id || a.done || b.done) continue;
          const gap = this._sameLaneRuntimeGap(a, b);
          if (gap !== Infinity) this.testMetrics.minRuntimeSameLaneGap = Math.min(this.testMetrics.minRuntimeSameLaneGap, gap);
        }
      }
    }

    tick(dt, P) {
      if (!this.running || this.finished) return;
      const maxStep = 1.0;
      if (dt > maxStep) {
        let remaining = dt;
        while (remaining > 0.01) { const step = Math.min(remaining, maxStep); this._tickStep(step, P); remaining -= step; }
        return;
      }
      this._tickStep(dt, P);
    }

    _tickStep(dt, P) {
      if (!this.running || this.finished) return;
      this.ticks += dt;
      const rd = this.road, active = this.cars.filter(c => !c.done), mains = active.filter(c => c.seg === 'main');
      this._updateRuntimeSafetyMetrics(active);

      for (const c of active) {
        const pq0 = pathQuery(c.path, c.x, c.y, c.pathIdx);
        const progress = pq0.idx * PATH_SP;
        const delta = progress - (c.lastProgress || progress);
        c.pathIdx = pq0.idx; c._pq = pq0;
        c._progress = progress; c._progressDelta = delta;
        c._cachedHasForwardMove = undefined;
        c.stuckTicks = c.noProgressTicks;
        c.batchId = null; c.batchTarget = ''; c.primaryBlockerId = null; c.prioritySignal = false; c.zoneYielding = false;
        c.blockingKind = 'none'; c.plannerMode = 'nominal';
        if (c.seg === 'main') {
          let best = 0, bd = 1e9;
          for (let i = 0; i < this.nL; i++) { const d = Math.abs(c.x - rd.laneX(i)); if (d < bd) { bd = d; best = i; } }
          c.lane = best;
          if (c.y - rd.forkY <= COMMIT_DIST) c.commitUntilFork = true;
          this.testMetrics.maxLaneCenterDrift = Math.max(this.testMetrics.maxLaneCenterDrift, Math.abs(c.x - rd.laneX(c.lane)));
          this.testMetrics.maxYawDrift = Math.max(this.testMetrics.maxYawDrift, Math.abs(c.th - (-Math.PI / 2)));
        } else {
          c.commitUntilFork = false; c.noProgressTicks = 0; c.progressResumeTicks = 0; c.trafficMode = 'free';
          c.maneuvering = false; c.spillbackTicks = 0; c.spillbackFlag = false;
        }
        c.lastProgress = progress;
      }

      if (this.started) {
        for (const c of mains) {
          if (c.fixed || c.merging || c.reversing || c.maneuvering) continue;
          c.mobilTimer -= dt;
          if (c.mobilTimer <= 0) { c.mobilTimer = 14 + this.rng() * 8; this._mobil(c, mains, P); }
        }
        this._updateBatchScheduler(active, rd);
      } else {
        for (const zone of rd.conflictZones) {
          zone.activeBatchId = null; zone.activeBatchTarget = null; zone.batchMembers = []; zone.batchExpireTick = 0;
          zone.downstreamClearanceByTarget.left = 1e9; zone.downstreamClearanceByTarget.right = 1e9;
        }
      }

      for (const c of mains) c.trafficMode = c.commitUntilFork ? 'commit' : 'free';
      for (const zone of rd.conflictZones) this._assignBatchStates(active, zone, rd);

      let activeManeuverCount = active.filter(c => c.maneuvering).length;
      for (const c of mains) {
        if (c.fixed) {
          c.desSpd = 0; c.desSt = 0; c.speed = 0; c.steer = 0;
          continue;
        }
        const blockInfo = this._classifyBlocker(c, active, rd, dt);
        const blocker = blockInfo.blocker;
        const hardFollowBlock =
          blockInfo.kind === 'follow' &&
          blocker &&
          (blocker.fixed || (blockInfo.gap !== null && blockInfo.gap < CAR_L * 0.75));
        c.primaryBlockerId = blocker ? blocker.id : null;
        c.blockingKind = blockInfo.kind;
        c.plannerMode = (blockInfo.kind === 'conflict' || blockInfo.kind === 'wall' || hardFollowBlock || c.maneuvering || c.merging || c.trafficMode === 'yield' || c.trafficMode === 'hold_exit' || c.trafficMode === 'batch') ? 'traffic' : 'nominal';
        const blockedForProgress = blockInfo.kind === 'conflict' || blockInfo.kind === 'wall' || c.trafficMode === 'yield';
        const maneuverProgressThresh = c.trafficMode === 'yield' ? NO_PROGRESS_THRESH_YIELD : NO_PROGRESS_THRESH;
        let shouldAccumulate = this.started && blockedForProgress && c._progressDelta < PROGRESS_EPS && !c.done;
        if (shouldAccumulate && c.trafficMode === 'yield') {
          const batchCarProgressing = active.some(b => b.trafficMode === 'batch' && b.noProgressTicks < NO_PROGRESS_THRESH && !b.done);
          if (batchCarProgressing) shouldAccumulate = false;
        }
        if (shouldAccumulate) c.noProgressTicks += dt;
        else c.noProgressTicks = Math.max(0, c.noProgressTicks - dt * 2);
        this.testMetrics.maxNoProgressTicks = Math.max(this.testMetrics.maxNoProgressTicks, c.noProgressTicks);
        if (c._progressDelta >= PROGRESS_EPS) c.progressResumeTicks += dt;
        else c.progressResumeTicks = 0;

        if (c.trafficMode !== c._lastTrafficMode) {
          if (c.trafficMode === 'yield') { this.yieldEntryCount++; this._event('yield_enter', { carId: c.id }); }
          if (c.trafficMode === 'hold_exit') { this.holdExitEntryCount++; this._event('hold_exit_enter', { carId: c.id }); }
          if (c.trafficMode === 'batch') this.batchEntryCount++;
          c._lastTrafficMode = c.trafficMode;
        }
        c._assignedTrafficMode = c.trafficMode;

        if ((c.trafficMode === 'yield' || c.trafficMode === 'hold_exit') && blocker) {
          const dx = blocker.x - c.x, dy = blocker.y - c.y;
          const lat = -dx * Math.sin(c.th) + dy * Math.cos(c.th);
          const perpAngle = c.th + (lat >= 0 ? -Math.PI / 2 : Math.PI / 2);
          c.maneuverPerpDir = { x: Math.cos(perpAngle), y: Math.sin(perpAngle) };
        } else if (!c.maneuvering) {
          const laneCenter = rd.laneX(c.lane);
          let sign = c.x > laneCenter ? 1 : c.x < laneCenter ? -1 : 0;
          if (sign === 0) {
            if (c.lane === 0) sign = 1;
            else if (c.lane === this.nL - 1) sign = -1;
            else {
              const leftLoad = this._entryLaneLoad(c.target, c.lane - 1, active, rd);
              const rightLoad = this._entryLaneLoad(c.target, c.lane + 1, active, rd);
              sign = rightLoad < leftLoad ? 1 : leftLoad < rightLoad ? -1 : (c.target === 'right' ? 1 : -1);
            }
          }
          const perpAngle = c.th + Math.PI / 2;
          c.maneuverPerpDir = { x: Math.cos(perpAngle) * sign, y: Math.sin(perpAngle) * sign };
        }
        const canEnterManeuver = activeManeuverCount < MAX_ACTIVE_MANEUVERS;
        const shouldProbeForward =
          c.maneuvering ||
          (!c.done && blockedForProgress && c.trafficMode !== 'batch' && c.noProgressTicks >= maneuverProgressThresh && canEnterManeuver);
        const canExitManeuverNow = shouldProbeForward ? this._getCachedForwardProgressMove(c, active, rd, dt) : false;
        if (!c.maneuvering && blockedForProgress && c.noProgressTicks >= maneuverProgressThresh && c.trafficMode !== 'batch' && !c.done && !canExitManeuverNow && canEnterManeuver) {
          c.maneuvering = true; c.trafficMode = 'maneuver'; c.maneuverTimer = 0; c.progressResumeTicks = 0;
          c.plannerMode = 'traffic';
          this.maneuverTriggerCount++;
          activeManeuverCount++;
          this.testMetrics.maneuverEnterReasons.progress++;
          if (this.testMetrics.firstManeuverTick === null) this.testMetrics.firstManeuverTick = this.ticks;
          if (this.testMetrics.firstProgressManeuverTick === null) this.testMetrics.firstProgressManeuverTick = this.ticks;
          this._event('maneuver_enter', { carId: c.id, reason: 'progress' });
        }

        if (c.maneuvering) {
          for (const o of active) {
            if (o.id === c.id || o.maneuvering || o.done) continue;
            if (Math.hypot(c.x - o.x, c.y - o.y) < 80) {
              const dx = o.x - c.x, dy = o.y - c.y;
              const fwd = dx * Math.cos(c.th) + dy * Math.sin(c.th);
              const lat = -dx * Math.sin(c.th) + dy * Math.cos(c.th);
              if (fwd < 0 && Math.abs(lat) < 20) {
                if (o.trafficMode === 'hold_exit') continue;
                if (activeManeuverCount >= MAX_ACTIVE_MANEUVERS) continue;
                if (this._getCachedForwardProgressMove(o, active, rd, dt)) continue;
                o.maneuvering = true;
                o.trafficMode = 'maneuver';
                o.maneuverTimer = 0;
                o.progressResumeTicks = 0;
                o.plannerMode = 'traffic';
                activeManeuverCount++;
                const distToCenter = rd.cx - o.x;
                o.maneuverPerpDir = distToCenter === 0 ? { x: 1, y: 0 } : { x: Math.sign(distToCenter), y: 0 };
                this._event('maneuver_enter', { carId: o.id, reason: 'cascade' });
              }
            }
          }
        }

        if (c.maneuvering) {
          c.maneuverTimer += dt;
          const assignedMode = c._assignedTrafficMode || 'free';
          const pathClear = canExitManeuverNow;
          if (assignedMode !== 'batch' && pathClear) {
            c.maneuvering = false; c.maneuverTimer = 0; c.noProgressTicks = 0; c.progressResumeTicks = 0;
            c.trafficMode = assignedMode;
            activeManeuverCount = Math.max(0, activeManeuverCount - 1);
            this._event('maneuver_exit', { carId: c.id });
            let bestKey = '', bestDist = 1e9;
            for (const key of rd.pathKeys) {
              if (!key.endsWith(c.target)) continue;
              const path = rd.fullPaths[key];
              const pq2 = pathQuery(path, c.x, c.y, 0);
              const d = Math.hypot(pq2.px - c.x, pq2.py - c.y);
              if (d < bestDist) { bestDist = d; bestKey = key; }
            }
            if (bestKey) {
              c.pathKey = bestKey; c.path = rd.fullPaths[bestKey];
              c.pathIdx = pathQuery(c.path, c.x, c.y, 0).idx; c.lastProgress = c.pathIdx * PATH_SP;
              c.lane = parseInt(bestKey);
            }
          } else if (assignedMode === 'hold_exit' && !pathClear) {
            c.maneuvering = false; c.maneuverTimer = 0; c.noProgressTicks = 0; c.progressResumeTicks = 0;
            c.trafficMode = 'hold_exit';
            activeManeuverCount = Math.max(0, activeManeuverCount - 1);
            this._event('maneuver_exit', { carId: c.id });
          } else {
            c.trafficMode = 'maneuver';
          }
        }
      }

      for (const c of active) {
        const pq = pathQuery(c.path, c.x, c.y, c.pathIdx); c.pathIdx = pq.idx; c._pq = pq;
        let hErr = pq.ang - c.th; while (hErr > Math.PI) hErr -= 2 * Math.PI; while (hErr < -Math.PI) hErr += 2 * Math.PI;
        const cte = Math.cos(pq.ang) * (c.y - pq.py) - Math.sin(pq.ang) * (c.x - pq.px);
        const dCTE = cte - c.prevCTE; c.prevCTE = cte;
        const dz = c.seg === 'main' ? 0.8 : 0.3;
        c.desSt = (Math.abs(cte) < dz && Math.abs(hErr) < 0.03) ? 0 : hErr - Math.atan2(0.7 * cte, Math.abs(c.speed) + 1) - 0.3 * dCTE;
      }

      for (const c of active) {
        if (c.fixed) { c._gap = 9999; c.desSpd = 0; c.desSt = 0; continue; }
        let gap = 9999, dv = 0; const ct = Math.cos(c.th), st = Math.sin(c.th);
        for (const o of active) {
          if (o.id === c.id || o.done) continue;
          if (c.seg !== o.seg) continue;
          if (c.seg === 'main' && c.y < rd.forkY + 50 && c.target !== o.target) continue;
          if (c.seg === 'main' && c.y < rd.forkY + 50 && c.target === o.target && c.lane !== o.lane) {
            const ci = Math.min(c.pathIdx + 8, c.path.length - 1), oi = Math.min(o.pathIdx + 8, o.path.length - 1);
            if (Math.hypot(c.path[ci].x - o.path[oi].x, c.path[ci].y - o.path[oi].y) > CAR_W + 4) continue;
          }
          const dx = o.x - c.x, dy = o.y - c.y, fwd = dx * ct + dy * st, lat = -dx * st + dy * ct;
          if (fwd > 0 && fwd < LOOK && Math.abs(lat) < DET_W) { const g = fwd - CAR_L; if (g < gap) { gap = g; dv = c.speed - o.speed; } }
        }
        if (c.seg === 'main' && !this.started) { const sd = c.y - rd.stopY; if (sd > 0 && sd - 4 < gap) { gap = sd - 4; dv = c.speed; } }
        c._gap = gap;
        gap = Math.max(gap, 0.1);
        c.desSpd = c.speed + Math.max(idm(c.speed, this.started ? P.v0 : 0, gap, dv), -IDM_B * 4) * dt;
        c.desSpd = Math.max(0, Math.min(c.desSpd, P.v0 * 1.3));
      }

      for (const c of active) {
        if (c.fixed) continue;
        let coneBrake = 1.0, coneSteer = 0;
        for (const o of active) {
          if (o.id === c.id || o.done) continue;
          if (c.seg !== 'main' && o.seg !== 'main' && c.seg !== o.seg) continue;
          if (c.seg === 'main' && o.seg !== 'main') continue;
          if (c.seg !== 'main' && o.seg === 'main') continue;
          if (Math.abs(c.th - o.th) < 0.5) continue;
          if (c.seg === 'main' && o.seg === 'main') {
            const myLaneCenter = rd.laneX(c.lane);
            const oLeft = o.x - CAR_W / 2, oRight = o.x + CAR_W / 2;
            const myLeft = myLaneCenter - rd.lw / 2, myRight = myLaneCenter + rd.lw / 2;
            if (!(oRight > myLeft && oLeft < myRight)) continue;
          }
          const hit = coneCheck(c, o); if (!hit) continue;
          if (hit.imminent) {
            coneBrake = Math.min(coneBrake, 0.2);
            if (Math.abs(hit.lat) > 0.5) coneSteer += (hit.lat > 0 ? -1 : 1) * 0.08;
          } else if (hit.lookahead) {
            const urgency = 1 - Math.min(hit.fwd / (CONE_LOOK_LEN + CAR_L), 1);
            coneBrake = Math.min(coneBrake, 0.5 + 0.5 * (1 - urgency));
            if (Math.abs(hit.lat) > 1) coneSteer += (hit.lat > 0 ? -1 : 1) * 0.03 * urgency;
          }
        }
        c.desSpd *= coneBrake;
        c.desSt += coneSteer;
      }

      for (const c of active) {
        if (c.fixed) continue;
        const wallSeg = c.seg === 'main' ? 'main' : c.seg;
        const nb = rd.nearestBoundary(c.x, c.y, wallSeg);
        if (nb.dist < WALL_STEER_DIST && nb.seg) {
          if (nb.seg.role === 'branch_inner' && nb.seg.t0 < rd.splitWallStartT - 1e-6) {
            this.testMetrics.prematureSplitWallContactCount++;
            this._event('premature_split_contact', { carId: c.id });
          }
          const wallNx = nb.seg.n.x, wallNy = nb.seg.n.y;
          const wallLat = -wallNx * Math.sin(c.th) + wallNy * Math.cos(c.th);
          const steerAway = wallLat > 0 ? -0.15 : 0.15;
          const blend = 1 - Math.max(0, Math.min(1, (nb.dist - WALL_BRAKE_DIST) / (WALL_STEER_DIST - WALL_BRAKE_DIST)));
          c.desSt += steerAway * blend;
          if (nb.dist < WALL_BRAKE_DIST && c.seg === 'main') {
            c.desSpd *= Math.max(0.1, nb.dist / WALL_BRAKE_DIST);
          }
        }
      }

      for (const c of mains) {
        if (c.fixed) { c._conflictProgress = null; c._targetClearance = 1e9; continue; }
        let conflictProgress = null;
        for (const zone of rd.conflictZones) {
          const zi = zone.paths.get(c.pathKey);
          if (zi === undefined) continue;
          const zoneProgress = zi * PATH_SP;
          if (conflictProgress === null || zoneProgress < conflictProgress) conflictProgress = zoneProgress;
          const dp = (zi - c.pathIdx) * PATH_SP;
          if (c.trafficMode === 'yield' && dp > 0 && dp < BATCH_APPROACH_DIST) {
            const gap = Math.max(dp, 0.1);
            const brakeSpd = c.speed + Math.max(idm(c.speed, 0, gap, c.speed), -IDM_B * 4) * dt;
            c.desSpd = Math.min(c.desSpd, Math.max(0, brakeSpd));
          }
          if (c.trafficMode === 'hold_exit' && dp > 0 && dp < BATCH_APPROACH_DIST) {
            const gap = Math.max(dp - CAR_L * 0.5, 0.1);
            const brakeSpd = c.speed + Math.max(idm(c.speed, 0, gap, c.speed), -IDM_B * 5) * dt;
            c.desSpd = Math.min(c.desSpd, Math.max(0, brakeSpd));
          }
        }
        if (c.trafficMode === 'batch') {
          c.desSpd = Math.max(c.desSpd, Math.min(P.v0, Math.max(c.speed, 0.35)));
        }
        if (c.maneuvering) {
          const perpAngle = Math.atan2(c.maneuverPerpDir.y, c.maneuverPerpDir.x);
          let steerToPerp = perpAngle - c.th;
          while (steerToPerp > Math.PI) steerToPerp -= 2 * Math.PI;
          while (steerToPerp < -Math.PI) steerToPerp += 2 * Math.PI;
          const phase = Math.floor(c.maneuverTimer / 12) % 4;
          const perpSteer = Math.max(-MAX_ST, Math.min(MAX_ST, steerToPerp * 0.8));
          if (phase === 0 || phase === 2) {
            c.desSt = phase === 0 ? perpSteer : -perpSteer;
            c.desSpd = -REVERSE_SPD;
          } else {
            c.desSt = phase === 1 ? -perpSteer : perpSteer;
            c.desSpd = Math.max(0.25, Math.min(c.desSpd, 0.45));
          }
        }
        c._conflictProgress = conflictProgress;
        c._targetClearance = this._managedTargetClearance(c, active, rd);
      }

      const noSchedulerActive = !rd.conflictZones.some(z => z.schedulerEnabled);
      for (const c of active) {
        if (c.seg !== 'main' && c._gap > IDM_S0 && c.desSpd > 0) c.desSpd = Math.max(c.desSpd, P.v0);
        if (c.seg === 'main' && noSchedulerActive && c._gap > IDM_S0 && c.desSpd > 0) c.desSpd = Math.max(c.desSpd, P.v0);
      }

      for (const c of active) {
        if (c.fixed) { c.speed = 0; c.steer = 0; continue; }
        c.desSt = Math.max(-MAX_ST, Math.min(MAX_ST, c.desSt));
        const stRate = 0.06 * dt;
        c.steer += Math.max(-stRate, Math.min(stRate, c.desSt - c.steer));
        c.speed = c.desSpd;
      }

      // Commit only legal next poses. Cars never move into an illegal pose and then revert.
      const moveOrder = [...active].sort((a, b) => this._movementPriority(b) - this._movementPriority(a));
      for (const c of moveOrder) {
        if (c.fixed) { c.speed = 0; c.steer = 0; continue; }
        const pose = this._chooseLegalMove(c, dt, rd, active);
        c.x = pose.x; c.y = pose.y; c.th = pose.th; c.speed = pose.speed; c.steer = pose.steer;
      }

      for (const c of active) {
        if (c.fixed) continue;
        if (Math.abs(c.speed) < 0.5 && c.speed >= 0 && c._pq) {
          let hDiff = c._pq.ang - c.th; while (hDiff > Math.PI) hDiff -= 2 * Math.PI; while (hDiff < -Math.PI) hDiff += 2 * Math.PI;
          c.th += hDiff * 0.03 * dt;
        }
      }

      for (const c of active) {
        if (c.fixed) continue;
        if (c.seg === 'main') {
          let hd = c.th - (-Math.PI / 2); while (hd > Math.PI) hd -= 2 * Math.PI; while (hd < -Math.PI) hd += 2 * Math.PI;
          if (Math.abs(hd) > 0.8) { c.th = -Math.PI / 2 + Math.sign(hd) * 0.8; c.steer *= 0.5; }
        }
      }

      for (const c of active) {
        if (c.pathIdx >= c.path.length - 3 && c.seg !== 'main') c.done = true;
        if (c.seg === 'main' && c.y <= rd.forkY + 5) {
          const entryClearance = this._managedTargetClearance(c, active, rd);
          c._targetClearance = entryClearance;
          if (entryClearance < EXIT_CLEARANCE) {
            c.y = Math.max(c.y, rd.forkY + 6);
            c.speed = 0;
            c.desSpd = 0;
            c.trafficMode = 'hold_exit';
            c.zoneYielding = true;
            continue;
          }
          c.seg = c.target; c.merging = false; c.blinker = 0; c.maneuvering = false;
          c.commitUntilFork = false; c.batchId = null; c.batchTarget = ''; c.trafficMode = 'free';
        }
        if (c.done && !c._finishLogged && !c.fixed) {
          c._finishLogged = true;
          this.testMetrics.finishTimes[c.id] = this.timerSec;
          this.testMetrics.finishOrder.push(c.id);
        }
      }

      for (const c of active) {
        if (c.fixed) continue;
        let insideConflict = false, relevantZone = null;
        for (const zone of rd.conflictZones) {
          const zi = zone.paths.get(c.pathKey);
          if (zi === undefined) continue;
          const dp = (zi - c.pathIdx) * PATH_SP;
          if (dp <= 0 && dp >= -zone.radius) { insideConflict = true; relevantZone = zone; break; }
        }
        const legalConflict = !relevantZone || !relevantZone.schedulerEnabled || !c.zoneYielding;
        if (insideConflict && !c._insideConflictPrev) {
          this.testMetrics.conflictEnterCount++;
          if (legalConflict) this.testMetrics.legalConflictEnterCount++;
          this._event('conflict_enter', { carId: c.id, legal: legalConflict });
        }
        if (!insideConflict && c._insideConflictPrev) {
          if (this.testMetrics.firstConflictClearanceTick === null) this.testMetrics.firstConflictClearanceTick = this.ticks;
          this._event('conflict_exit', { carId: c.id });
        }
        if (insideConflict && !legalConflict && !c._illegalConflictLogged) {
          c._illegalConflictLogged = true;
          this.testMetrics.illegalConflictEntryCount++;
        }
        if (!insideConflict) c._illegalConflictLogged = false;
        c._insideConflictPrev = insideConflict;
        if (insideConflict && Math.abs(c.speed) < 0.1) {
          c.spillbackTicks += dt;
          if (c.spillbackTicks > 10 && !c.spillbackFlag) { c.spillbackFlag = true; this.spillbackViolations++; }
        } else {
          c.spillbackTicks = 0; c.spillbackFlag = false;
        }
        this.testMetrics.maxConflictZoneStallTicks = Math.max(this.testMetrics.maxConflictZoneStallTicks, c.spillbackTicks);
      }

      for (let i = 0; i < active.length; i++) {
        for (let j = i + 1; j < active.length; j++) {
          const a = active[i], b = active[j]; if (a.done || b.done) continue;
          if (Math.hypot(a.x - b.x, a.y - b.y) > CAR_L * 2) continue;
          if (satOverlap(a, b)) { this.satCount++; this.testMetrics.overlapCount++; this._event('overlap', { aId: a.id, bId: b.id }); }
          if (a.seg !== 'main' && b.seg === a.seg) {
            const branchGap = Math.max(0, Math.hypot(a.x - b.x, a.y - b.y) - CAR_L);
            this.testMetrics.minBranchRectGap = Math.min(this.testMetrics.minBranchRectGap, branchGap);
          }
        }
      }

      for (const c of active) {
        if (this._isOutsideRoad(c, rd)) { this.testMetrics.wallEscapeCount++; this._event('wall_escape', { carId: c.id }); }
        if (c.seg !== 'main' && !c.fixed && Math.abs(c.speed) < 0.1) {
          c._branchStopTicks = (c._branchStopTicks || 0) + dt;
        } else {
          c._branchStopTicks = 0;
        }
        this.testMetrics.maxBlockedBranchStopTicks = Math.max(this.testMetrics.maxBlockedBranchStopTicks, c._branchStopTicks || 0);
      }

      for (const c of active) { delete c._pq; delete c._gap; delete c._progress; delete c._progressDelta; delete c._conflictProgress; delete c._targetClearance; }

      this._syncTestMetrics();

      if (this.started && this.cars.every(c => c.done)) { this.finished = true; this.finishTick = this.ticks; this.running = false; }
    }

    _movementPriority(c) {
      let score = 0;
      if (c.trafficMode === 'batch') score += 2000000;
      if (!c.zoneYielding) score += 1000000;
      if (!c.merging) score += 100000;
      if (c.commitUntilFork) score += 50000;
      if (c.trafficMode === 'hold_exit') score -= 250000;
      if (!c.maneuvering) score += 10000;
      score += c.seg === 'main' ? -c.y : c.pathIdx;
      score += c.tiebreak * 0.01;
      return score;
    }

    _pathProgress(c, pose) {
      const p = pose || c;
      return pathQuery(c.path, p.x, p.y, c.pathIdx).idx * PATH_SP;
    }

    _trackingError(c, pose) {
      const p = pose || c;
      const pq = pathQuery(c.path, p.x, p.y, c.pathIdx);
      const cte = Math.cos(pq.ang) * (p.y - pq.py) - Math.sin(pq.ang) * (p.x - pq.px);
      let hErr = pq.ang - p.th;
      while (hErr > Math.PI) hErr -= 2 * Math.PI;
      while (hErr < -Math.PI) hErr += 2 * Math.PI;
      return { cte: Math.abs(cte), hErr: Math.abs(hErr), pq };
    }

    _isParallelNeighbor(a, b) {
      if (a.id === b.id || a.done || b.done) return false;
      if (a.target !== b.target || a.seg !== b.seg) return false;
      if (Math.abs(a.th - b.th) > 0.35) return false;
      if (a.seg === 'main') {
        if (Math.abs(a.lane - b.lane) !== 1) return false;
        return Math.abs(a.y - b.y) < LOOK;
      }
      return Math.abs(a.pathIdx - b.pathIdx) < 18;
    }

    _entryLaneLoad(target, lane, active, rd) {
      let load = 0;
      for (const o of active) {
        if (o.done || o.seg !== 'main' || o.target !== target) continue;
        if (o.y - rd.forkY > LANE_LOAD_LOOKAHEAD) continue;
        let best = 0, bd = 1e9;
        for (let i = 0; i < this.nL; i++) { const d = Math.abs(o.x - rd.laneX(i)); if (d < bd) { bd = d; best = i; } }
        if (best === lane) load++;
      }
      return load;
    }

    _downstreamClearance(target, active, rd) {
      let forkProg = 1e9;
      for (const zone of rd.conflictZones) {
        for (const [key, idx] of zone.paths.entries()) {
          if (key.endsWith(target) && idx < forkProg) forkProg = idx;
        }
      }
      const forkDist = (forkProg === 1e9 ? 0 : forkProg * PATH_SP);
      let best = 1e9;
      for (const c of active) {
        if (c.done || c.seg !== target) continue;
        const delta = this._pathProgress(c) - forkDist - CAR_L;
        if (delta < best) best = delta;
      }
      return best === 1e9 ? 1e9 : best;
    }

    _managedTargetClearance(c, active, rd) {
      let best = 1e9, managed = false;
      for (const zone of rd.conflictZones) {
        if (!zone.schedulerEnabled) continue;
        if (zone.paths.get(c.pathKey) === undefined) continue;
        managed = true;
        best = Math.min(best, zone.downstreamClearanceByTarget[c.target] ?? 1e9);
      }
      return managed ? best : 1e9;
    }

    _canShareBatch(a, b, dt, rd, active) {
      if (!a || !b || a.target !== b.target || a.seg !== 'main' || b.seg !== 'main') return false;
      if (Math.abs(a.y - b.y) < CAR_L * 1.3) return false;
      const aPose = this._candidatePose(a, Math.max(a.speed, Math.max(a.desSpd || 0, 0.4)), a.steer, dt);
      const bPose = this._candidatePose(b, Math.max(b.speed, Math.max(b.desSpd || 0, 0.4)), b.steer, dt);
      return !satOverlapMargin(aPose.x, aPose.y, aPose.th, bPose.x, bPose.y, bPose.th, PROJ_MARGIN);
    }

    _canTrailActiveBatch(c, zone, activeCars) {
      if (!zone.activeBatchId || zone.activeBatchTarget !== c.target || c.seg !== 'main') return false;
      const ownProgress = this._pathProgress(c);
      for (const o of activeCars) {
        if (o.id === c.id || o.done || !zone.batchMembers.includes(o.id)) continue;
        if (o.target !== c.target || o.seg !== 'main') continue;
        if (o.pathKey === c.pathKey) {
          const gap = this._pathProgress(o) - ownProgress;
          if (gap > CAR_L * 1.4) return true;
          continue;
        }
        if (this._canShareBatch(o, c, 1, this.road, activeCars)) return true;
      }
      return false;
    }

    _batchStillOwnsZone(c, zone) {
      if (c.done) return false;
      if (c._insideConflictPrev) return true;
      const zi = zone.paths.get(c.pathKey);
      if (zi === undefined) return false;
      const dp = (zi - c.pathIdx) * PATH_SP;
      if (c.seg === 'main') return dp >= -zone.radius - CAR_L && dp <= BATCH_APPROACH_DIST;
      return false;
    }

    _updateBatchScheduler(active, rd) {
      for (const zone of rd.conflictZones) {
        zone.downstreamClearanceByTarget.left = this._downstreamClearance('left', active, rd);
        zone.downstreamClearanceByTarget.right = this._downstreamClearance('right', active, rd);

        const activeBatchCars = active.filter(c => zone.batchMembers.includes(c.id) && !c.done);
        if (activeBatchCars.length > 0) {
          const stillOwning = activeBatchCars.some(c => this._batchStillOwnsZone(c, zone));
          if (stillOwning) continue;
        }

        const waiting = { left: [], right: [] };
        for (const c of active) {
          if (c.done || c.seg !== 'main') continue;
          const zi = zone.paths.get(c.pathKey);
          if (zi === undefined) continue;
          const dp = (zi - c.pathIdx) * PATH_SP;
          if (dp < 0 || dp > BATCH_APPROACH_DIST) continue;
          waiting[c.target].push({ car: c, eta: c.speed > 0.05 ? dp / Math.max(c.speed, 0.05) : 9999, dp });
        }
        waiting.left.sort((a, b) => a.eta - b.eta || a.car.tiebreak - b.car.tiebreak);
        waiting.right.sort((a, b) => a.eta - b.eta || a.car.tiebreak - b.car.tiebreak);

        zone.schedulerEnabled = waiting.left.length > 0 && waiting.right.length > 0;
        if (!zone.schedulerEnabled) {
          zone.activeBatchId = null; zone.activeBatchTarget = null; zone.batchMembers = []; zone.batchExpireTick = 0;
          zone.starveTicksLeft = 0; zone.starveTicksRight = 0;
          continue;
        }

        const readyLeft = waiting.left.length > 0 && zone.downstreamClearanceByTarget.left >= EXIT_CLEARANCE;
        const readyRight = waiting.right.length > 0 && zone.downstreamClearanceByTarget.right >= EXIT_CLEARANCE;

        let chosenTarget = '';
        if (readyLeft && readyRight) {
          if (zone.starveTicksLeft !== zone.starveTicksRight) chosenTarget = zone.starveTicksLeft > zone.starveTicksRight ? 'left' : 'right';
          else chosenTarget = waiting.left[0].eta <= waiting.right[0].eta ? 'left' : 'right';
        } else if (readyLeft) chosenTarget = 'left';
        else if (readyRight) chosenTarget = 'right';

        if (!chosenTarget) {
          zone.activeBatchId = null; zone.activeBatchTarget = null; zone.batchMembers = []; zone.batchExpireTick = 0;
          if (waiting.left.length) zone.starveTicksLeft++;
          if (waiting.right.length) zone.starveTicksRight++;
          this.maxStarveTicks = Math.max(this.maxStarveTicks, zone.starveTicksLeft, zone.starveTicksRight);
          continue;
        }

        const queue = waiting[chosenTarget];
        const members = [queue[0].car];
        if (queue.length > 1 && this._canShareBatch(queue[0].car, queue[1].car, 1, rd, active)) members.push(queue[1].car);

        zone.activeBatchId = this.nextBatchId++;
        zone.activeBatchTarget = chosenTarget;
        zone.batchMembers = members.map(c => c.id);
        zone.batchExpireTick = this.ticks + BATCH_HOLD_TICKS;
        zone.holder = members[0].id;
        this.maxBatchSizeSeen = Math.max(this.maxBatchSizeSeen, members.length);
        this.testMetrics.batchGrantCount++;
        this._event('batch_grant', { batchId: zone.activeBatchId, target: chosenTarget, members: zone.batchMembers.join(',') });
        if (chosenTarget === 'left') { zone.starveTicksLeft = 0; if (waiting.right.length) zone.starveTicksRight++; }
        else { zone.starveTicksRight = 0; if (waiting.left.length) zone.starveTicksLeft++; }
        this.maxStarveTicks = Math.max(this.maxStarveTicks, zone.starveTicksLeft, zone.starveTicksRight);
      }
    }

    _assignBatchStates(activeCars, zone, rd) {
      for (const c of activeCars) {
        if (c.seg !== 'main' || c.done) continue;
        const zi = zone.paths.get(c.pathKey);
        if (zi === undefined) continue;
        const dp = (zi - c.pathIdx) * PATH_SP;
        const nearFork = dp >= 0 && dp <= BATCH_APPROACH_DIST;
        const isBatchMember = zone.batchMembers.includes(c.id);
        const targetClear = zone.downstreamClearanceByTarget[c.target];
        c.batchId = isBatchMember ? zone.activeBatchId : null;
        c.batchTarget = isBatchMember ? zone.activeBatchTarget : '';
        if (!zone.schedulerEnabled) {
          c.trafficMode = c.commitUntilFork ? 'commit' : 'free';
          c.zoneYielding = false;
          continue;
        }
        if (isBatchMember) {
          c.trafficMode = 'batch'; c.zoneYielding = false;
        } else if (nearFork && this._canTrailActiveBatch(c, zone, activeCars)) {
          c.trafficMode = 'commit'; c.zoneYielding = false;
        } else if (nearFork && targetClear < EXIT_CLEARANCE) {
          c.trafficMode = 'hold_exit'; c.zoneYielding = true;
        } else if (nearFork && zone.activeBatchId !== null) {
          c.trafficMode = 'yield'; c.zoneYielding = true;
        } else if (c.commitUntilFork) {
          c.trafficMode = 'commit'; c.zoneYielding = false;
        } else {
          c.trafficMode = 'free'; c.zoneYielding = false;
        }
      }
    }

    _findPrimaryBlocker(c, active) {
      let best = null, bestScore = 1e9;
      for (const o of active) {
        if (o.id === c.id || o.done) continue;
        if (this._isParallelNeighbor(c, o)) continue;
        if (Math.hypot(o.x - c.x, o.y - c.y) > LOOK + CAR_L) continue;
        const hit = coneCheck(c, o);
        if (hit) {
          const score = (hit.imminent ? 0 : 20) + Math.max(0, hit.fwd);
          if (score < bestScore) { bestScore = score; best = o; }
          continue;
        }
        const sameSeg = c.seg === o.seg && c.target === o.target;
        if (!sameSeg) continue;
        const dx = o.x - c.x, dy = o.y - c.y;
        const fwd = dx * Math.cos(c.th) + dy * Math.sin(c.th);
        const lat = Math.abs(-dx * Math.sin(c.th) + dy * Math.cos(c.th));
        if (fwd > 0 && lat < CAR_W * 1.5 && fwd < bestScore) { bestScore = fwd; best = o; }
      }
      return best;
    }

    _classifyBlocker(c, active, rd, dt) {
      if (c.maneuvering) {
        const blocker = this._findPrimaryBlocker(c, active);
        return { kind: 'wall', blocker };
      }
      if (c.trafficMode === 'hold_exit') {
        return { kind: 'none', blocker: null, gap: null };
      }
      if (c.trafficMode === 'yield' || c.trafficMode === 'batch') {
        const blocker = this._findPrimaryBlocker(c, active);
        return blocker ? { kind: 'conflict', blocker } : { kind: 'none', blocker: null, gap: null };
      }
      const desiredPose = this._candidatePose(c, Math.max(0, c.desSpd), c.desSt, dt);
      if (this._isPoseOutsideRoad(c, desiredPose, rd)) return { kind: 'wall', blocker: null };
      let follow = null, parallel = null;
      for (const o of active) {
        if (o.id === c.id || o.done) continue;
        if (this._isParallelNeighbor(c, o)) { parallel = o; continue; }
        if (c.seg === o.seg && c.target === o.target && c.lane === o.lane) {
          const dx = o.x - c.x, dy = o.y - c.y;
          const fwd = dx * Math.cos(c.th) + dy * Math.sin(c.th);
          if (fwd > 0 && fwd < LOOK && (!follow || fwd < follow.fwd)) follow = { car: o, fwd, gap: fwd - CAR_L };
          continue;
        }
        const hit = coneCheck(c, o);
        if (hit && ((c.target !== o.target) || Math.abs(c.th - o.th) >= 0.5)) {
          if (!hit.imminent && hit.fwd > CONE_IMMED_LEN * 1.5) continue;
          return { kind: 'conflict', blocker: o };
        }
      }
      if (follow) return { kind: 'follow', blocker: follow.car, gap: follow.gap };
      if (parallel) return { kind: 'parallel', blocker: parallel };
      return { kind: 'none', blocker: null, gap: null };
    }

    _candidatePose(c, speed, steer, dt) {
      const pose = { x: c.x + speed * Math.cos(c.th) * dt, y: c.y + speed * Math.sin(c.th) * dt, th: c.th, speed, steer };
      if (Math.abs(speed) > 0.01) pose.th += (speed / WBASE) * Math.tan(steer) * dt;
      while (pose.th > Math.PI) pose.th -= 2 * Math.PI;
      while (pose.th < -Math.PI) pose.th += 2 * Math.PI;
      return pose;
    }

    _relevantNeighbors(c, active, extraRange = 30) {
      const range = PROJ_BROAD_PHASE + extraRange;
      const rangeSq = range * range;
      const neighbors = [];
      for (const o of active) {
        if (o.id === c.id || o.done) continue;
        const dx = c.x - o.x, dy = c.y - o.y;
        if (dx * dx + dy * dy > rangeSq) continue;
        neighbors.push(o);
      }
      return neighbors;
    }

    _relevantLegalNeighbors(c, active, extraRange = 30) {
      const range = PROJ_BROAD_PHASE + extraRange;
      const rangeSq = range * range;
      const overlapNeighbors = [];
      const gapNeighbors = [];
      for (const o of active) {
        if (o.id === c.id || o.done) continue;
        const dx = c.x - o.x, dy = c.y - o.y;
        if (dx * dx + dy * dy > rangeSq) continue;
        overlapNeighbors.push(o);
        if (c.seg !== o.seg) continue;
        if (c.seg === 'main') {
          if (c.lane !== o.lane) continue;
        } else if (c.pathKey !== o.pathKey) {
          continue;
        }
        gapNeighbors.push(o);
      }
      return { overlapNeighbors, gapNeighbors };
    }

    _poseOverlapsCars(c, pose, active, margin = PROJ_MARGIN) {
      for (const o of active) {
        if (o.id === c.id || o.done) continue;
        const dx = pose.x - o.x, dy = pose.y - o.y;
        if (dx * dx + dy * dy > PROJ_BROAD_PHASE_SQ) continue;
        if (satOverlapMargin(pose.x, pose.y, pose.th, o.x, o.y, o.th, margin)) return true;
      }
      return false;
    }

    _poseOverlapsCarsNeighbors(pose, neighbors, margin = PROJ_MARGIN) {
      for (const o of neighbors) {
        const dx = pose.x - o.x, dy = pose.y - o.y;
        if (dx * dx + dy * dy > PROJ_BROAD_PHASE_SQ) continue;
        if (satOverlapMargin(pose.x, pose.y, pose.th, o.x, o.y, o.th, margin)) return true;
      }
      return false;
    }

    _isPoseOutsideRoad(c, pose, rd, margin = PROJ_MARGIN) {
      const M = margin;
      const centerClearance = rd.roadClearance(pose.x, pose.y);
      if (centerClearance < 0) return true;
      if (centerClearance >= CAR_HALF_DIAG + M) return false;
      for (const corner of carCorners(pose.x, pose.y, pose.th, M)) {
        if (rd.roadClearance(corner.x, corner.y) < 0) return true;
      }
      return false;
    }

    _isOutsideRoad(c, rd) {
      return this._isPoseOutsideRoad(c, { x: c.x, y: c.y, th: c.th }, rd);
    }

    _isLegalPose(c, pose, rd, active, margin = PROJ_MARGIN) {
      if (this._isPoseOutsideRoad(c, pose, rd, margin)) return false;
      if (this._poseOverlapsCars(c, pose, active, margin)) return false;
      const poseCar = { ...c, x: pose.x, y: pose.y, th: pose.th };
      for (const o of active) {
        if (o.id === c.id || o.done) continue;
        if (poseCar.seg !== o.seg) continue;
        if (poseCar.seg === 'main') {
          if (poseCar.lane !== o.lane) continue;
        } else if (poseCar.pathKey !== o.pathKey) {
          continue;
        }
        const gap = this._sameLaneRuntimeGap(poseCar, o);
        if (gap !== Infinity && gap < HARD_FOLLOW_GAP) return false;
      }
      return true;
    }

    _isLegalPoseNeighbors(c, pose, rd, neighbors, margin = PROJ_MARGIN) {
      const overlapNeighbors = Array.isArray(neighbors) ? neighbors : neighbors.overlapNeighbors;
      const gapNeighbors = Array.isArray(neighbors) ? neighbors : neighbors.gapNeighbors;
      if (this._isPoseOutsideRoad(c, pose, rd, margin)) return false;
      if (this._poseOverlapsCarsNeighbors(pose, overlapNeighbors, margin)) return false;
      const poseCar = { ...c, x: pose.x, y: pose.y, th: pose.th };
      for (const o of gapNeighbors) {
        const gap = this._sameLaneRuntimeGap(poseCar, o);
        if (gap !== Infinity && gap < HARD_FOLLOW_GAP) return false;
      }
      return true;
    }

    _hasLegalForwardProgressMove(c, active, rd, dt) {
      const desiredSpeed = Math.max(c.desSpd || 0, c.speed || 0, 0.18);
      const desiredSteer = c.desSt || 0;
      const baseProgress = this._pathProgress(c);
      const conflictProgress = c._conflictProgress ?? null;
      const targetClearance = c._targetClearance ?? 1e9;
      const neighbors = this._relevantLegalNeighbors(c, active, 30);
      for (const speed of [desiredSpeed, desiredSpeed * 0.75, desiredSpeed * 0.5, desiredSpeed * 0.25]) {
        if (speed <= 0.05) continue;
        for (const steer of [desiredSteer, desiredSteer * 0.5, 0]) {
          const pose = this._candidatePose(c, speed, steer, dt);
          if (!this._isLegalPoseNeighbors(c, pose, rd, neighbors)) continue;
          const nextProgress = this._pathProgress(c, pose);
          const enterConflict = conflictProgress !== null && nextProgress >= conflictProgress - 2;
          if (enterConflict && c.trafficMode !== 'batch' && targetClearance < EXIT_CLEARANCE) continue;
          if (nextProgress - baseProgress >= PROGRESS_EPS * 0.5) return true;
        }
      }
      return false;
    }

    _getCachedForwardProgressMove(c, active, rd, dt) {
      if (c._cachedHasForwardMove === undefined) {
        c._cachedHasForwardMove = this._hasLegalForwardProgressMove(c, active, rd, dt);
      }
      return c._cachedHasForwardMove;
    }

    _candidateSet(c, trafficContext, dt) {
      const desiredSpeed = trafficContext.desiredSpeed;
      const desiredSteer = trafficContext.desiredSteer;
      const speedSign = desiredSpeed === 0 ? 1 : Math.sign(desiredSpeed);
      const speedMag = Math.abs(desiredSpeed);
      const seen = new Set(), attempts = [];
      const addAttempt = (speed, steer) => {
        const clampedSteer = Math.max(-MAX_ST, Math.min(MAX_ST, steer));
        const key = `${speed.toFixed(3)}|${clampedSteer.toFixed(3)}`;
        if (seen.has(key)) return;
        seen.add(key);
        attempts.push({ speed, steer: clampedSteer });
      };
      addAttempt(desiredSpeed, desiredSteer);
      for (const scale of [0.85, 0.7, 0.55, 0.4, 0.25, 0.1]) addAttempt(desiredSpeed * scale, desiredSteer);
      for (const steer of trafficContext.targetSteers) for (const scale of [0.55, 0.4, 0.25, 0.15]) {
        addAttempt(speedSign * Math.max(speedMag * scale, 0.12), steer);
      }
      if (trafficContext.blockerSteer !== null) {
        for (const scale of [0.4, 0.25, 0.15]) addAttempt(speedSign * Math.max(speedMag * scale, 0.12), trafficContext.blockerSteer);
      }
      if (c.trafficMode === 'maneuver') {
        const maneuverSteers = [];
        const addManeuverSteer = (steer) => {
          if (typeof steer !== 'number' || !Number.isFinite(steer)) return;
          if (maneuverSteers.some((existing) => Math.abs(existing - steer) < 1e-3)) return;
          maneuverSteers.push(steer);
        };
        addManeuverSteer(desiredSteer);
        addManeuverSteer(trafficContext.blockerSteer);
        for (const steer of trafficContext.targetSteers.slice(-3)) addManeuverSteer(steer);
        let widestSteer = null;
        for (const steer of trafficContext.targetSteers) {
          if (widestSteer === null || Math.abs(steer) > Math.abs(widestSteer)) widestSteer = steer;
        }
        addManeuverSteer(widestSteer);
        addManeuverSteer(MAX_ST);
        addManeuverSteer(-MAX_ST);
        for (const steer of maneuverSteers) for (const scale of [0.35, 0.2]) {
          addAttempt(Math.max(speedMag * scale, 0.12), steer);
        }
        for (const revMag of [0.2, 0.35]) {
          const rev = -Math.max(speedMag * revMag, REVERSE_SPD);
          for (const steer of maneuverSteers) addAttempt(rev, steer);
        }
      }
      addAttempt(0, desiredSteer);
      return attempts.map(a => ({ speed: a.speed, steer: a.steer, pose: this._candidatePose(c, a.speed, a.steer, dt) }));
    }

    _ensureCandidatePathData(c, candidate) {
      if (candidate.pathQuery) return candidate.pathQuery;
      const pq = pathQuery(c.path, candidate.pose.x, candidate.pose.y, c.pathIdx);
      candidate.pathQuery = pq;
      candidate.pathProgress = pq.idx * PATH_SP;
      return pq;
    }

    _scoreCandidate(c, candidate, trafficContext) {
      const pq = this._ensureCandidatePathData(c, candidate);
      const progress = candidate.pathProgress - trafficContext.baseProgress;
      let score = progress * (c.trafficMode === 'maneuver' ? (trafficContext.forwardClear ? 12 : 0.5) : 8);
      score -= Math.abs(candidate.steer - trafficContext.desiredSteer) * (c.trafficMode === 'maneuver' ? 0.2 : 0.8);
      score -= Math.abs(candidate.speed - trafficContext.desiredSpeed) * (c.trafficMode === 'maneuver' ? 0.03 : 0.1);
      if (candidate.speed < 0 && c.trafficMode !== 'maneuver') score -= 50;
      if (candidate.speed < 0 && c.trafficMode === 'maneuver') score += 2;
      if (c.trafficMode === 'batch' && progress > 0) score += 20;
      if (c.trafficMode === 'yield' && progress > PROGRESS_EPS) score -= 30;
      if (c.trafficMode === 'hold_exit' && progress > PROGRESS_EPS) score -= 1000;
      if (trafficContext.conflictProgress !== null && candidate.enterConflict && !trafficContext.canEnterConflict) score -= 1000;
      if (candidate.enterConflict && trafficContext.targetClearance < EXIT_CLEARANCE) score -= (EXIT_CLEARANCE - trafficContext.targetClearance) * 4;
      if (c.commitUntilFork && c.trafficMode !== 'maneuver' && Math.abs(candidate.steer) > MAX_ST * 0.85) score -= 2;
      if (trafficContext.blocker) {
        const curDist = Math.hypot(c.x - trafficContext.blocker.x, c.y - trafficContext.blocker.y);
        const newDist = Math.hypot(candidate.pose.x - trafficContext.blocker.x, candidate.pose.y - trafficContext.blocker.y);
        score += (newDist - curDist) * (c.trafficMode === 'maneuver' ? 1.4 : 0.05);
      }
      if (trafficContext.blocker && c.blockingKind === 'follow') {
        const dx = trafficContext.blocker.x - c.x, dy = trafficContext.blocker.y - c.y;
        const ndx = trafficContext.blocker.x - candidate.pose.x, ndy = trafficContext.blocker.y - candidate.pose.y;
        const curLat = Math.abs(-dx * Math.sin(c.th) + dy * Math.cos(c.th));
        const newLat = Math.abs(-ndx * Math.sin(candidate.pose.th) + ndy * Math.cos(candidate.pose.th));
        score += (newLat - curLat) * 3;
        if (candidate.speed > 0 && progress < PROGRESS_EPS) score -= 1;
      }
      if (c.trafficMode === 'maneuver') {
        const lateralMove = (candidate.pose.x - c.x) * c.maneuverPerpDir.x + (candidate.pose.y - c.y) * c.maneuverPerpDir.y;
        score += lateralMove * (trafficContext.forwardClear ? 20 : 90);
        if (lateralMove > 0) score += 1.5;
        if (candidate.speed === 0) score -= 1;
        if (candidate.speed > 0 && progress < PROGRESS_EPS) score -= 1;
        if (trafficContext.forwardClear && progress >= PROGRESS_EPS * 0.5) score += 8;
        if (trafficContext.forwardClear && candidate.speed < 0) score -= 8;
      }
      let hErr = pq.ang - candidate.pose.th; while (hErr > Math.PI) hErr -= 2 * Math.PI; while (hErr < -Math.PI) hErr += 2 * Math.PI;
      score -= Math.abs(hErr) * (c.trafficMode === 'maneuver' ? 0.25 : 1.5);
      return score;
    }

    _chooseNominalMove(c, dt, rd, active) {
      const currentErr = this._trackingError(c, { x: c.x, y: c.y, th: c.th });
      const neighbors = this._relevantLegalNeighbors(c, active, 30);
      const speeds = [1, 0.9, 0.75, 0.6, 0.45, 0.3, 0.15, 0].map(scale => scale === 0 ? 0 : Math.max(0, c.desSpd * scale));
      for (const speed of speeds) {
        const pose = this._candidatePose(c, speed, c.desSt, dt);
        if (!this._isLegalPoseNeighbors(c, pose, rd, neighbors)) continue;
        const err = this._trackingError(c, pose);
        if (err.cte > currentErr.cte + 0.5) continue;
        if (err.hErr > currentErr.hErr + 0.05) continue;
        return { x: pose.x, y: pose.y, th: pose.th, speed, steer: c.desSt };
      }
      return { x: c.x, y: c.y, th: c.th, speed: 0, steer: c.steer };
    }

    _chooseBestLegalCandidate(c, trafficContext, dt) {
      let best = { pose: { x: c.x, y: c.y, th: c.th }, speed: 0, steer: c.steer, score: -1e9 };
      let legalCount = 0;
      const candidates = this._candidateSet(c, trafficContext, dt);
      const neighbors = this._relevantLegalNeighbors(c, trafficContext.active, 30);
      for (const candidate of candidates) {
        if (!this._isLegalPoseNeighbors(c, candidate.pose, trafficContext.rd, neighbors)) continue;
        if (trafficContext.conflictProgress !== null) this._ensureCandidatePathData(c, candidate);
        candidate.enterConflict = trafficContext.conflictProgress !== null && candidate.pathProgress >= trafficContext.conflictProgress - 2;
        if (candidate.enterConflict && trafficContext.targetClearance < EXIT_CLEARANCE && candidate.speed >= 0 && !c.maneuvering) continue;
        legalCount++;
        candidate.score = this._scoreCandidate(c, candidate, trafficContext);
        if (candidate.score > best.score) best = { ...candidate };
        if (best.score >= EARLY_EXIT_SCORE) break;
      }
      if (legalCount === 0) {
        for (const candidate of candidates.slice(0, 20)) {
          if (!this._isLegalPoseNeighbors(c, candidate.pose, trafficContext.rd, neighbors, 0)) continue;
          if (trafficContext.conflictProgress !== null) this._ensureCandidatePathData(c, candidate);
          candidate.enterConflict = trafficContext.conflictProgress !== null && candidate.pathProgress >= trafficContext.conflictProgress - 2;
          if (candidate.enterConflict && trafficContext.targetClearance < EXIT_CLEARANCE && candidate.speed >= 0 && !c.maneuvering) continue;
          legalCount++;
          candidate.score = this._scoreCandidate(c, candidate, trafficContext);
          if (candidate.score > best.score) best = { ...candidate };
        }
      }
      if (legalCount === 0) {
        this.plannerIllegalCount++;
      }
      return { pose: best.pose, speed: best.speed, steer: best.steer };
    }

    _chooseTrafficMove(c, dt, rd, active) {
      const blocker = this._findPrimaryBlocker(c, active);
      c.primaryBlockerId = blocker ? blocker.id : null;
      const forwardClear = c.maneuvering ? this._getCachedForwardProgressMove(c, active, rd, dt) : false;
      const steerBias = Math.sign(c.desSt) || (c.blinker !== 0 ? c.blinker : 1);
      const steerTargets = [
        c.desSt,
        c.desSt + steerBias * 0.08,
        c.desSt - steerBias * 0.08,
        c.desSt + steerBias * 0.16,
        c.desSt - steerBias * 0.16,
        c.desSt + steerBias * 0.24,
        c.desSt - steerBias * 0.24,
        steerBias * MAX_ST,
        -steerBias * MAX_ST,
      ];
      if (c.maneuvering) {
        const perpAngle = Math.atan2(c.maneuverPerpDir.y, c.maneuverPerpDir.x);
        let steerToPerp = perpAngle - c.th;
        while (steerToPerp > Math.PI) steerToPerp -= 2 * Math.PI;
        while (steerToPerp < -Math.PI) steerToPerp += 2 * Math.PI;
        steerTargets.push(steerToPerp, steerToPerp * 0.7, -steerToPerp * 0.5);
      }
      const blockerSteer = blocker ? ((() => {
        const dx = blocker.x - c.x, dy = blocker.y - c.y, lat = -dx * Math.sin(c.th) + dy * Math.cos(c.th);
        return lat >= 0 ? -MAX_ST : MAX_ST;
      })()) : null;
      const trafficContext = {
        active, rd, blocker,
        desiredSpeed: c.desSpd, desiredSteer: c.desSt, targetSteers: steerTargets, blockerSteer,
        baseProgress: this._pathProgress(c), conflictProgress: c._conflictProgress ?? null,
        targetClearance: c._targetClearance ?? 1e9,
        canEnterConflict: c.trafficMode === 'batch',
        forwardClear,
      };
      const best = this._chooseBestLegalCandidate(c, trafficContext, dt);
      return { x: best.pose.x, y: best.pose.y, th: best.pose.th, speed: best.speed, steer: best.steer };
    }

    _chooseLegalMove(c, dt, rd, active) {
      if (c.plannerMode === 'nominal') return this._chooseNominalMove(c, dt, rd, active);
      return this._chooseTrafficMove(c, dt, rd, active);
    }

    _mobil(c, mains, P) {
      if (c.commitUntilFork && !c.maneuvering) return;
      const rd = this.road, acCur = this._idmLane(c, c.lane, mains, P);
      const safeGap = c.maneuvering ? MOBIL_MANEUVER_GAP : MOBIL_SAFE_GAP;
      const curLoad = this._entryLaneLoad(c.target, c.lane, mains, rd);
      let bestLane = c.lane, bestScore = -999;
      for (const cand of [c.lane - 1, c.lane + 1]) {
        if (cand < 0 || cand >= this.nL) continue;
        this.testMetrics.mergeAttemptCount++;
        this._event('merge_attempt', { carId: c.id, fromLane: c.lane, toLane: cand });
        const candLx = rd.laneX(cand);
        let nearestAhead = 9999, nearestBehind = 9999;
        for (const o of mains) {
          if (o.id === c.id) continue;
          if (Math.abs(o.x - candLx) > rd.lw * 0.8) continue;
          const dy = c.y - o.y;
          if (dy > 0) nearestAhead = Math.min(nearestAhead, dy - CAR_L);
          else nearestBehind = Math.min(nearestBehind, -dy - CAR_L);
        }
        const minGap = Math.min(nearestAhead, nearestBehind);
        if (nearestAhead < safeGap || nearestBehind < safeGap) {
          this.testMetrics.mergeRejectUnsafeCount++;
          this._event('merge_reject_unsafe', { carId: c.id, toLane: cand, gap: minGap });
          continue;
        }
        const acCand = this._idmLane(c, cand, mains, P);
        let gain = acCand - acCur;
        let fPain = 0; const fol = this._followerLane(c, cand, mains);
        if (fol) {
          const fAO = this._idmLane(fol, cand, mains, P), fG = Math.hypot(fol.x - c.x, fol.y - c.y) - CAR_L;
          if (fG < safeGap) continue; const fDv = fol.speed - c.speed;
          const fAN = idm(fol.speed, P.v0, Math.max(fG, 0.1), fDv); if (fAN < -0.15) continue; fPain = fAO - fAN;
        }
        const candLoad = this._entryLaneLoad(c.target, cand, mains, rd);
        const demandBias = (curLoad - candLoad) * 0.12;
        const score = gain - 0.3 * fPain + demandBias;
        if (score > 0.015 && score > bestScore) { bestScore = score; bestLane = cand; }
      }
      if (bestLane !== c.lane) {
        if (c.commitUntilFork) { this.commitOscillationCount++; return; }
        const bestLaneX = rd.laneX(bestLane);
        let acceptedGap = 9999;
        for (const o of mains) {
          if (o.id === c.id) continue;
          if (Math.abs(o.x - bestLaneX) > rd.lw * 0.8) continue;
          const dy = Math.abs(c.y - o.y) - CAR_L;
          if (dy < acceptedGap) acceptedGap = dy;
        }
        this.testMetrics.mergeAcceptCount++;
        this.testMetrics.minAcceptedMergeGap = Math.min(this.testMetrics.minAcceptedMergeGap, acceptedGap);
        this._event('merge_accept', { carId: c.id, fromLane: c.lane, toLane: bestLane, gap: acceptedGap });
        c.blinker = bestLane > c.lane ? 1 : -1;
        c.pathKey = bestLane + '-' + c.target; c.path = rd.fullPaths[c.pathKey];
        c.pathIdx = pathQuery(c.path, c.x, c.y, 0).idx;
        c.lastProgress = c.pathIdx * PATH_SP;
        c.lane = bestLane; c.merging = true;
        if (c.commitUntilFork) c.commitLaneChanges++;
      }
    }
    _idmLane(c, lane, mains, P) {
      const lx = this.road.laneX(lane); let gap = 9999, dv = 0;
      for (const o of mains) {
        if (o.id === c.id) continue; if (Math.abs(o.x - lx) > this.road.lw * 0.8) continue;
        const dy = c.y - o.y; if (dy > 0) { const g = dy - CAR_L; if (g < gap) { gap = g; dv = c.speed - o.speed; } }
      }
      return idm(c.speed, this.started ? P.v0 : 0, Math.max(gap, 0.1), dv);
    }
    _followerLane(c, lane, mains) {
      const lx = this.road.laneX(lane); let best = null, bd = 1e9;
      for (const o of mains) {
        if (o.id === c.id) continue; if (Math.abs(o.x - lx) > this.road.lw * 0.8) continue;
        const dy = o.y - c.y; if (dy > 0 && dy < bd) { bd = dy; best = o; }
      } return best;
    }
    get timerSec() { return (this.finished ? this.finishTick : this.ticks) / 60; }
  }

  class Ren {
    constructor(cv, sim, opts) {
      this.cv = cv;
      this.ctx = cv.getContext('2d');
      this.sim = sim;
      this.opts = opts || {};
      this.theme = RENDER_THEMES[this.opts.theme] || RENDER_THEMES.classic;
    }
    _trace(pts) {
      const ctx = this.ctx;
      if (!pts || !pts.length) return;
      pts.forEach((p, i) => { i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
    }
    _roundRectPath(x, y, w, h, r) {
      const ctx = this.ctx;
      const rr = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
      ctx.moveTo(x + rr, y);
      ctx.lineTo(x + w - rr, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
      ctx.lineTo(x + w, y + h - rr);
      ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
      ctx.lineTo(x + rr, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
      ctx.lineTo(x, y + rr);
      ctx.quadraticCurveTo(x, y, x + rr, y);
    }
    _treeCluster(cx, cy, rx, ry, count, base, alt) {
      const ctx = this.ctx;
      for (let i = 0; i < count; i++) {
        const ang = i * 2.399963229728653;
        const ring = 0.35 + 0.6 * ((i % 5) / 4);
        const x = cx + Math.cos(ang) * (rx * ring);
        const y = cy + Math.sin(ang) * (ry * (0.35 + 0.12 * (i % 6)));
        const r = 2.4 + (i % 4) * 0.8;
        ctx.fillStyle = i % 3 === 0 ? alt : base;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    _clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
    _sceneMetrics(rd, w, h) {
      const roadHalf = rd.halfW();
      const branchSpread = Math.abs(rd.rEnd.x - rd.lEnd.x);
      const topT = this._clamp(rd.branchWidthSettledT() + 0.11, 0.24, 0.38);
      const leftWedge = rd.branchOuterPoint('left', topT);
      const rightWedge = rd.branchOuterPoint('right', topT);
      const wedgeWidth = Math.max(48, rightWedge.x - leftWedge.x);
      const wedgeCenterX = (leftWedge.x + rightWedge.x) / 2;
      const topWedgeY = Math.min(leftWedge.y, rightWedge.y);
      const bridgeY = rd.forkY + (rd.stopY - rd.forkY) * 0.56;
      const bridgeHalf = this._clamp(roadHalf * 1.55 + branchSpread * 0.045, 34, w * 0.28);
      const channelInset = this._clamp(rd.mainLw * 0.65, 8, 18);
      const baseScale = this._clamp((roadHalf * 2 + wedgeWidth * 0.55 + branchSpread * 0.22) / 118, 0.92, 1.72);
      const churchScale = this._clamp(baseScale * 1.5, 1.15, 2.1);
      const mountainScale = this._clamp(baseScale * 1.35, 1.05, 1.95);
      const houseScale = this._clamp(baseScale * 1.12, 0.95, 1.7);

      const splitY = rd.bPt('left', rd.splitWallStartT).y;
      const churchY = this._clamp(splitY - 50 * churchScale, 32 * baseScale, splitY - 20);
      const churchHaloY = churchY + 20 * churchScale;
      const islandCx = this._clamp(rd.cx + bridgeHalf + 42 * houseScale, rd.cx + roadHalf * 2.1, w - 60 * houseScale);
      const islandCy = this._clamp(bridgeY + 10 * houseScale, bridgeY - 20 * houseScale, bridgeY + 30 * houseScale);
      const rightBankX = this._clamp(rd.cx + bridgeHalf * 0.72, rd.cx + roadHalf * 1.5, w * 0.72);
      const rightBankY = this._clamp(bridgeY + 44 * baseScale, bridgeY + 28 * baseScale, h - 80 * baseScale);
      return {
        roadHalf, branchSpread, topT, leftWedge, rightWedge, wedgeWidth, wedgeCenterX, topWedgeY,
        bridgeY, bridgeLeftX: rd.cx - bridgeHalf, bridgeRightX: rd.cx + bridgeHalf, channelInset,
        baseScale, churchScale, mountainScale, houseScale, churchY, churchHaloY,
        islandCx, islandCy, rightBankX, rightBankY
      };
    }
    _roadGeometry(rd, h) {
      const takeTo = (pts, tMax) => pts.filter(p => (p.t ?? 0) <= tMax + 1e-6);
      const takeFrom = (pts, tMin) => pts.filter(p => (p.t ?? 0) >= tMin - 1e-6);
      const mainL = rd.sampleMainEdge(-1, 20), mainR = rd.sampleMainEdge(1, 20);
      const splitT = rd.splitWallStartT;
      const leftOuter = rd.sampleBranchEdge('left', 'outer', BRANCH_SAMPLE_COUNT, 0);
      const rightOuter = rd.sampleBranchEdge('right', 'outer', BRANCH_SAMPLE_COUNT, 0);
      const leftInner = rd.sampleBranchEdge('left', 'inner', BRANCH_SAMPLE_COUNT);
      const rightInner = rd.sampleBranchEdge('right', 'inner', BRANCH_SAMPLE_COUNT);
      const surfaces = [
        [mainR, [...mainL].reverse()],
        [takeTo(rightOuter, splitT), [...takeTo(leftOuter, splitT)].reverse()],
        [takeFrom(leftOuter, splitT), [...leftInner].reverse()],
        [takeFrom(rightOuter, splitT), [...rightInner].reverse()]
      ].filter(poly => poly[0].length && poly[1].length);
      return { splitT, mainL, mainR, leftOuter, rightOuter, leftInner, rightInner, surfaces };
    }
    draw() {
      const ctx = this.ctx, dpr = devicePixelRatio || 1, w = this.cv.width / dpr, h = this.cv.height / dpr;
      const rd = this.sim.road;
      if (!rd) return;
      const logicalW = Math.max(rd.w || w, 1);
      const logicalH = Math.max(rd.h || h, 1);
      const scale = Math.min(w / logicalW, h / logicalH);
      const offsetX = (w - logicalW * scale) / 2;
      const offsetY = (h - logicalH * scale) / 2;
      ctx.save();
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = this.theme.canvas;
      ctx.fillRect(0, 0, w, h);
      ctx.translate(offsetX, offsetY);
      ctx.scale(scale, scale);
      if (this.theme.scene === 'rio_satellite') this._scene(rd, logicalW, logicalH);
      this._road(rd, logicalH); this._stop(rd); this._cars(rd, logicalH); ctx.restore();
    }
    _scene(rd, w, h) {
      const ctx = this.ctx, t = this.theme, m = this._sceneMetrics(rd, w, h);
      const houseW = 30 * m.houseScale, houseH = 18 * m.houseScale, poolW = 22 * m.houseScale, poolH = 12 * m.houseScale;
      const churchBodyW = Math.min(m.wedgeWidth * 0.20, 20 * m.churchScale);
      const churchBodyH = Math.min(m.wedgeWidth * 0.72, 52 * m.churchScale);
      const churchArmW = Math.min(m.wedgeWidth * 0.64, 60 * m.churchScale);
      const churchArmH = Math.min(churchBodyH * 0.44, 18 * m.churchScale);
      const towerW = churchBodyW * 0.58;

      // --- River geometry: constant-width band that never pinches ---
      const riverHalf = Math.max(50, h * 0.12);
      const riverTopL = m.bridgeY - riverHalf;   // top edge Y on left
      const riverBotL = m.bridgeY + riverHalf;   // bottom edge Y on left
      const riverTopR = rd.forkY - riverHalf * 1.3; // top edge Y on right (wider)
      const riverBotR = m.bridgeY + riverHalf * 1.6; // bottom edge Y on right (wider)

      // --- Island geometry: derived FROM river bounds so it can never escape ---
      const islandX = this._clamp(m.islandCx, m.bridgeRightX + 60 * m.houseScale, w - 50 * m.houseScale);
      const riverTopAtIsland = riverTopR + (riverTopL - riverTopR) * ((w - islandX) / w);
      const riverBotAtIsland = riverBotR + (riverBotL - riverBotR) * ((w - islandX) / w);
      const islandY = (riverTopAtIsland + riverBotAtIsland) / 2;
      const riverWidthAtIsland = riverBotAtIsland - riverTopAtIsland;
      const islandRx = Math.min(riverWidthAtIsland * 0.38, 55 * m.houseScale);
      const islandRy = Math.min(riverWidthAtIsland * 0.32, 40 * m.houseScale);

      // 1. Base Land
      ctx.fillStyle = t.land;
      ctx.fillRect(0, 0, w, h);

      // 2. River — wide horizontal band, constant width under bridge
      ctx.fillStyle = t.water;
      ctx.beginPath();
      // Top edge: left to right
      ctx.moveTo(0, riverTopL);
      ctx.bezierCurveTo(w * 0.25, riverTopL, w * 0.55, riverTopR + 10, w, riverTopR);
      // Right edge down
      ctx.lineTo(w, riverBotR);
      // Bottom edge: right to left
      ctx.bezierCurveTo(w * 0.55, riverBotR - 10, w * 0.25, riverBotL, 0, riverBotL);
      ctx.closePath();
      ctx.fill();

      // Deep water core (narrower band inside)
      ctx.fillStyle = t.waterDeep;
      const deepInset = riverHalf * 0.3;
      ctx.beginPath();
      ctx.moveTo(0, riverTopL + deepInset);
      ctx.bezierCurveTo(w * 0.25, riverTopL + deepInset, w * 0.55, riverTopR + deepInset + 5, w, riverTopR + deepInset);
      ctx.lineTo(w, riverBotR - deepInset);
      ctx.bezierCurveTo(w * 0.55, riverBotR - deepInset - 5, w * 0.25, riverBotL - deepInset, 0, riverBotL - deepInset);
      ctx.closePath();
      ctx.fill();

      // Water highlights
      ctx.strokeStyle = t.waterHighlight;
      ctx.lineWidth = Math.max(3 * m.baseScale, 2);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(w * 0.05, m.bridgeY - riverHalf * 0.3);
      ctx.bezierCurveTo(w * 0.25, m.bridgeY - riverHalf * 0.25, w * 0.5, m.bridgeY - riverHalf * 0.5, w * 0.75, rd.forkY - riverHalf * 0.6);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(w * 0.15, m.bridgeY + riverHalf * 0.4);
      ctx.bezierCurveTo(w * 0.35, m.bridgeY + riverHalf * 0.35, w * 0.6, m.bridgeY + riverHalf * 0.7, w * 0.85, m.bridgeY + riverHalf);
      ctx.stroke();

      // 3. Mountain (Bottom-Left) — smooth rounded silhouette
      const mtnPeakX = w * 0.12;
      const mtnPeakY = riverBotL - 20 * m.baseScale;
      const mtnBaseR = w * 0.48;
      ctx.fillStyle = t.mountain;
      ctx.beginPath();
      ctx.moveTo(0, h);
      ctx.lineTo(mtnBaseR, h);
      ctx.bezierCurveTo(mtnBaseR - 20 * m.baseScale, h * 0.85, mtnPeakX + 80 * m.baseScale, mtnPeakY + 40 * m.baseScale, mtnPeakX + 40 * m.baseScale, mtnPeakY);
      ctx.bezierCurveTo(mtnPeakX, mtnPeakY - 15 * m.baseScale, mtnPeakX - 20 * m.baseScale, mtnPeakY + 10 * m.baseScale, 0, mtnPeakY + 30 * m.baseScale);
      ctx.closePath();
      ctx.fill();

      // Mountain dark layer (shadow side)
      ctx.fillStyle = t.mountainDark;
      ctx.beginPath();
      ctx.moveTo(0, h);
      ctx.lineTo(mtnBaseR * 0.7, h);
      ctx.bezierCurveTo(mtnBaseR * 0.6, h * 0.9, mtnPeakX + 60 * m.baseScale, mtnPeakY + 60 * m.baseScale, mtnPeakX + 20 * m.baseScale, mtnPeakY + 20 * m.baseScale);
      ctx.bezierCurveTo(mtnPeakX - 5 * m.baseScale, mtnPeakY + 15 * m.baseScale, 0, mtnPeakY + 50 * m.baseScale, 0, mtnPeakY + 50 * m.baseScale);
      ctx.closePath();
      ctx.fill();

      // Rock detail
      ctx.fillStyle = t.mountainRock;
      ctx.beginPath();
      ctx.ellipse(mtnPeakX + 25 * m.baseScale, mtnPeakY + 30 * m.baseScale, 18 * m.mountainScale, 30 * m.mountainScale, 0.2, 0, Math.PI * 2);
      ctx.fill();

      // 4. Shore (Bottom-Right) — smooth rounded
      const shoreTopY = riverBotR + 10 * m.baseScale;
      ctx.fillStyle = t.shore;
      ctx.beginPath();
      ctx.moveTo(w, h);
      ctx.lineTo(w * 0.45, h);
      ctx.bezierCurveTo(w * 0.5, h * 0.9, w * 0.65, shoreTopY + 30 * m.baseScale, w * 0.72, shoreTopY);
      ctx.bezierCurveTo(w * 0.82, shoreTopY - 10 * m.baseScale, w * 0.95, shoreTopY + 15 * m.baseScale, w, shoreTopY + 20 * m.baseScale);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = t.shoreDark;
      ctx.beginPath();
      ctx.moveTo(w, h);
      ctx.lineTo(w * 0.55, h);
      ctx.bezierCurveTo(w * 0.6, h * 0.95, w * 0.75, shoreTopY + 40 * m.baseScale, w * 0.82, shoreTopY + 20 * m.baseScale);
      ctx.bezierCurveTo(w * 0.9, shoreTopY + 10 * m.baseScale, w * 0.97, shoreTopY + 30 * m.baseScale, w, shoreTopY + 35 * m.baseScale);
      ctx.closePath();
      ctx.fill();

      // 5. Island — guaranteed inside river
      ctx.fillStyle = t.island;
      ctx.beginPath();
      ctx.ellipse(islandX, islandY, islandRx, islandRy, -0.12, 0, Math.PI * 2);
      ctx.fill();

      // Trees
      this._treeCluster(islandX, islandY, islandRx * 0.6, islandRy * 0.6, 10, t.forest, t.forestAlt);
      this._treeCluster(mtnPeakX + 30 * m.baseScale, mtnPeakY + 50 * m.baseScale, 25 * m.mountainScale, 30 * m.mountainScale, 12, t.forest, t.forestAlt);
      this._treeCluster(w * 0.75, shoreTopY + 30 * m.baseScale, 18 * m.baseScale, 15 * m.baseScale, 8, t.forest, t.forestAlt);

      // 6. House on island
      ctx.save();
      ctx.translate(islandX, islandY - 3 * m.houseScale);
      ctx.rotate(-0.1);
      ctx.fillStyle = t.house;
      ctx.beginPath();
      this._roundRectPath(-houseW / 2, -houseH / 2, houseW, houseH, 3 * m.houseScale);
      ctx.fill();
      ctx.fillStyle = t.houseRoof;
      ctx.beginPath();
      this._roundRectPath(-houseW * 0.58, -houseH * 0.66, houseW * 1.16, houseH * 0.42, 2 * m.houseScale);
      ctx.fill();
      ctx.translate(houseW * 0.8, 8 * m.houseScale);
      ctx.fillStyle = t.pool;
      ctx.beginPath();
      this._roundRectPath(-poolW / 2, -poolH / 2, poolW, poolH, 3 * m.houseScale);
      ctx.fill();
      ctx.restore();

      // 7. Church — no sand halos, sits directly on land
      ctx.save();
      ctx.translate(m.wedgeCenterX, m.churchY);
      ctx.fillStyle = t.church;
      ctx.beginPath();
      this._roundRectPath(-churchBodyW / 2, -churchBodyH / 2, churchBodyW, churchBodyH, 3 * m.churchScale);
      ctx.fill();
      ctx.beginPath();
      this._roundRectPath(-churchArmW / 2, -churchArmH / 2, churchArmW, churchArmH, 3 * m.churchScale);
      ctx.fill();
      ctx.beginPath();
      this._roundRectPath(-towerW / 2, -churchBodyH * 0.78, towerW, churchBodyH * 0.36, 3 * m.churchScale);
      ctx.fill();
      ctx.fillStyle = t.churchRoof;
      ctx.beginPath();
      this._roundRectPath(-churchBodyW * 0.35, -churchBodyH * 0.34, churchBodyW * 0.7, churchBodyH * 0.68, 2 * m.churchScale);
      ctx.fill();
      ctx.beginPath();
      this._roundRectPath(-churchArmW * 0.36, -churchArmH * 0.28, churchArmW * 0.72, churchArmH * 0.56, 2 * m.churchScale);
      ctx.fill();
      ctx.fillStyle = t.churchCross;
      ctx.fillRect(-1.5 * m.churchScale, -churchBodyH * 0.92, 3 * m.churchScale, 16 * m.churchScale);
      ctx.fillRect(-8 * m.churchScale, -churchBodyH * 0.78, 16 * m.churchScale, 2.6 * m.churchScale);
      ctx.restore();
      // Tree flanks around church
      this._treeCluster(m.wedgeCenterX - 28 * m.baseScale, m.churchY + 10 * m.baseScale, 12 * m.baseScale, 8 * m.baseScale, 5, t.forest, t.forestAlt);
      this._treeCluster(m.wedgeCenterX + 28 * m.baseScale, m.churchY + 10 * m.baseScale, 12 * m.baseScale, 8 * m.baseScale, 5, t.forest, t.forestAlt);
    }
    _road(rd, h) {
      const ctx = this.ctx, hw = rd.halfW();
      const g = this._roadGeometry(rd, h), splitT = g.splitT;
      ctx.save();
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.fillStyle = this.theme.roadFill;

      // Draw continuous outer road perimeter to guarantee zero holes/triangles
      const perimeter = [
        ...g.mainR,
        ...g.rightOuter,
        ...[...g.rightInner].reverse(),
        ...g.leftInner,
        ...[...g.leftOuter].reverse(),
        ...[...g.mainL].reverse()
      ];
      ctx.beginPath();
      this._trace(perimeter);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = this.theme.roadGuide; ctx.lineWidth = 1; ctx.setLineDash([5, 5]);
      for (let i = 1; i < rd.n; i++) { const lx = rd.cx - hw + i * rd.mainLw; ctx.beginPath(); ctx.moveTo(lx, rd.forkY); ctx.lineTo(lx, h + 100); ctx.stroke(); }
      if (rd.n > 1) {
        ctx.save();
        ctx.strokeStyle = this.theme.roadGuide;
        ctx.globalAlpha = 0.55;
        for (const br of ['left', 'right']) {
          for (let lane = 1; lane < rd.n; lane++) {
            const guide = rd.sampleBranchDivider(br, lane, Math.max(10, Math.ceil(BRANCH_SAMPLE_COUNT * Math.max(splitT, 0.12))), 0, splitT);
            if (!guide.length) continue;
            ctx.beginPath(); this._trace(guide); ctx.stroke();
          }
        }
        ctx.restore();
        for (const br of ['left', 'right']) {
          for (let lane = 1; lane < rd.n; lane++) {
            const divider = rd.sampleBranchDivider(br, lane, BRANCH_SAMPLE_COUNT, splitT, 1);
            if (!divider.length) continue;
            ctx.beginPath(); this._trace(divider); ctx.stroke();
          }
        }
      }
      ctx.setLineDash([]); ctx.strokeStyle = this.theme.roadStroke; ctx.lineWidth = this.theme.scene === 'rio_satellite' ? 1.8 : 1.5;
      for (const pts of [g.mainL, g.mainR, g.leftOuter, g.rightOuter]) { ctx.beginPath(); this._trace(pts); ctx.stroke(); }
      for (const pts of [g.leftInner, g.rightInner]) { if (pts.length) { ctx.beginPath(); this._trace(pts); ctx.stroke(); } }
      ctx.restore();
    }
    _stop(rd) {
      const ctx = this.ctx, hw = rd.halfW(), gr = this.sim.started;
      ctx.setLineDash([]); ctx.strokeStyle = gr ? this.theme.stopGo : this.theme.stopStop; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(rd.cx - hw, rd.stopY); ctx.lineTo(rd.cx + hw, rd.stopY); ctx.stroke();
      ctx.beginPath(); ctx.arc(rd.cx - hw - 7, rd.stopY, 4, 0, Math.PI * 2); ctx.fillStyle = gr ? this.theme.stopLightGo : this.theme.stopLightStop; ctx.fill(); ctx.strokeStyle = this.theme.stopLightRing; ctx.lineWidth = 1.5; ctx.stroke();
    }
    _cars(rd, ch) {
      const ctx = this.ctx; let offS = 0; const vis = this.sim.cars.filter(c => !c.done); vis.sort((a, b) => b.y - a.y);
      for (const car of vis) { if (car.y > ch + 10) { offS++; continue; } this._car(car, car.y > ch - 6 ? 0.18 : 1.0); }
      if (offS > 0) { ctx.save(); ctx.globalAlpha = 0.2; ctx.fillStyle = this.theme.queueText; ctx.font = '9px JetBrains Mono'; ctx.textAlign = 'center'; ctx.fillText(`▲ ${offS} queued`, rd.cx, ch - 3); ctx.restore(); }
    }
    _car(car, alpha) {
      const ctx = this.ctx; ctx.save(); ctx.globalAlpha = alpha; ctx.translate(car.x, car.y); ctx.rotate(car.th);
      if (car.speed < 0.06 && car.speed >= 0 && this.sim.started && car.seg === 'main') ctx.globalAlpha = alpha * (0.5 + 0.5 * Math.sin(Date.now() / 200 + car.id * 3));
      const hw = CAR_W / 2, hl = CAR_L / 2, R = 2.5; ctx.beginPath(); ctx.moveTo(-hl + R, -hw); ctx.lineTo(hl - R, -hw);
      ctx.quadraticCurveTo(hl, -hw, hl, -hw + R); ctx.lineTo(hl, hw - R); ctx.quadraticCurveTo(hl, hw, hl - R, hw);
      ctx.lineTo(-hl + R, hw); ctx.quadraticCurveTo(-hl, hw, -hl, hw - R); ctx.lineTo(-hl, -hw + R);
      ctx.quadraticCurveTo(-hl, -hw, -hl + R, -hw); ctx.closePath(); ctx.fillStyle = car.color; ctx.fill();
      if (car.zoneYielding) { ctx.strokeStyle = '#ff4444'; ctx.lineWidth = 0.8; ctx.stroke(); }
      if (car.maneuvering) { ctx.strokeStyle = '#ffaa00'; ctx.lineWidth = 1; ctx.stroke(); }
      if (car.reversing) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 0.8; ctx.stroke(); }
      if (car.blinker !== 0) {
        ctx.fillStyle = '#ffaa00'; ctx.globalAlpha = alpha * (0.5 + 0.5 * Math.sin(Date.now() / 150));
        if (car.blinker < 0) ctx.fillRect(-hl, -hw - 1, 3, 1); else ctx.fillRect(-hl, hw, 3, 1);
      }
      ctx.globalAlpha = alpha * 0.35; ctx.fillStyle = '#fff'; ctx.fillRect(hl - 1.5, -hw + 1, 1.5, 2); ctx.fillRect(hl - 1.5, hw - 3, 1.5, 2);
      if (car.speed < 1.0 && car.speed >= 0 && this.sim.started) { ctx.fillStyle = '#ff1818'; ctx.globalAlpha = alpha * Math.min(0.7, (1 - car.speed) * 0.6); ctx.fillRect(-hl, -hw + 1, 1.5, 2); ctx.fillRect(-hl, hw - 3, 1.5, 2); }
      if (car.speed < -0.01) { ctx.fillStyle = '#ffffff'; ctx.globalAlpha = alpha * 0.5; ctx.fillRect(-hl, -hw + 1, 1.5, 2); ctx.fillRect(-hl, hw - 3, 1.5, 2); }
      ctx.restore();
    }
  }

  function createScenarioSim(spec) {
    const lanes = spec.lanes ?? 1;
    const width = spec.w ?? 220;
    const height = spec.h ?? 760;
    const split = spec.splitPct ?? spec.split ?? 0;
    const sim = new Sim(lanes, spec.nCars ?? 0, split, spec.seed ?? 1);
    sim.init(width, height);
    if (Array.isArray(spec.cars)) {
      sim.cars = [];
      spec.cars.forEach((cfg, i) => {
        const lane = cfg.lane ?? 0;
        const target = cfg.target ?? 'left';
        const pathKey = cfg.pathKey ?? `${Math.max(0, Math.min(lane, lanes - 1))}-${target}`;
        const path = sim.road.fullPaths[pathKey];
        let x = cfg.x, y = cfg.y, th = cfg.th;
        if ((x === undefined || y === undefined) && cfg.pathT !== undefined && path) {
          const idx = Math.max(0, Math.min(path.length - 1, Math.round(cfg.pathT * (path.length - 1))));
          const prev = path[Math.max(0, idx - 1)], next = path[Math.min(path.length - 1, idx + 1)];
          x = path[idx].x + (cfg.dx || 0);
          y = path[idx].y + (cfg.dy || 0);
          if (th === undefined) th = Math.atan2(next.y - prev.y, next.x - prev.x);
        }
        if (x === undefined) x = sim.road.laneX(lane) + (cfg.dx || 0);
        if (y === undefined) y = sim.road.stopY + (i + 1) * SPAWN_SPACING + (cfg.dy || 0);
        if (th === undefined) th = -Math.PI / 2;
        const car = new Car(cfg.id ?? i, x, y, th, lane, target, cfg.tiebreak ?? 0);
        car.pathKey = pathKey;
        car.path = path;
        car.pathIdx = pathQuery(car.path, car.x, car.y, 0).idx;
        car.lastProgress = car.pathIdx * PATH_SP;
        if (cfg.seg !== undefined) car.seg = cfg.seg;
        if (cfg.speed !== undefined) car.speed = cfg.speed;
        if (cfg.steer !== undefined) car.steer = cfg.steer;
        if (cfg.color) car.color = cfg.color;
        if (cfg.fixed) car.fixed = true;
        if (cfg.mobilTimer !== undefined) car.mobilTimer = cfg.mobilTimer;
        if (cfg.blinker !== undefined) car.blinker = cfg.blinker;
        if (cfg.commitUntilFork !== undefined) car.commitUntilFork = cfg.commitUntilFork;
        if (cfg.merging !== undefined) car.merging = cfg.merging;
        if (cfg.maneuvering !== undefined) car.maneuvering = cfg.maneuvering;
        if (cfg.trafficMode !== undefined) car.trafficMode = cfg.trafficMode;
        if (cfg.zoneYielding !== undefined) car.zoneYielding = cfg.zoneYielding;
        if (cfg.noProgressTicks !== undefined) car.noProgressTicks = cfg.noProgressTicks;
        if (cfg.progressResumeTicks !== undefined) car.progressResumeTicks = cfg.progressResumeTicks;
        sim.cars.push(car);
      });
    }
    sim.testConfig = { label: spec.label || '', dt: spec.dt || 1, maxTicks: spec.maxTicks || 0 };
    if (spec.started) sim.start();
    sim._syncTestMetrics();
    return sim;
  }

  global.TrafficCore = {
    WBASE, MAX_ST, CAR_L, CAR_W, IDM_S0, IDM_T, PATH_SP, V0_DEF, PROJ_MARGIN, INTERSECT_WIDEN, MAIN_LANE_SCALE, BRANCH_LANE_SCALE, BRANCH_WIDTH_TRANSITION_T, SPLIT_WALL_GAP, COMMIT_DIST, BATCH_APPROACH_DIST, EXIT_CLEARANCE, PROGRESS_EPS,
    mkRng, V, idm, toLocal, coneCheck, rearConeCheck, satOverlap, carCorners, satOverlapMargin, pathQuery, Road, Car, Sim, Ren, createScenarioSim
  };
})(window);
