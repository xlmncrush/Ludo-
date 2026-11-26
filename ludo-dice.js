// ============================================================
// ludo-dice.js  -  Dynamic, suspenseful weighted dice for Ludo
// Plain JavaScript, no libraries.
// ============================================================

const LUDO_DICE = {
  useBag: false,              // true = pure shuffle-bag mode
  minW: 0.3,                  // lowest allowed weight (when not blocked)
  maxW: 3.2,                  // highest allowed weight (keeps outcomes varied)

  // --- Capture & Clutch Save Balance ---
  captureBoost: 1.65,         // higher chance to capture, not guaranteed every time
  baitBoost: 1.25,            // mild boost to set up a clash
  clutchSaveBoost: 1.45,      // occasional "lucky save" to escape danger
  clutchSaveChance: 0.35,     // only triggers sometimes so danger still feels real
  safeZoneBoost: 1.0,         // neutral safe-zone weight

  // --- Action Wave (sometimes boosted, sometimes calm) ---
  waveCycleLength: 8,         // total turns in one rhythm cycle
  waveBoostTurns: 4,          // how many turns in the cycle get extra action boost
  waveActionMultiplier: 1.2,  // extra spice during active turns

  // --- Six & Pity Controls ---
  sixPityStep: 0.14,          // per turn without 6 while all tokens in base
  openingTurns: 2,            // first N turns
  openingSixBoost: 1.25,      // mild opening boost
  afterCaptureTurns: 2,       // turns after losing a token
  afterCaptureSixBoost: 1.25,
  tripleSixPenalty: 0.45,     // penalty after two 6s (before hard block)
  blockSixAfter: 2,           // after 2 consecutive 6s, 6 is completely blocked (0)

  // --- Pace & Variety ---
  catchUpBoost: 1.15,         // mild help for trailing player
  leaderBrake: 0.9,           // slight brake for leading player
  homeTension: 0.72,          // tension before entering home
  homeWaitStep: 0.2,          // recovery per missed home-entry turn
  maxHomeFactor: 1.5,         // cap for home-entry boost
  antiRepeat: 0.8,            // dampen immediate repeat
  coldNumberStep: 0.03,       // mild relief for long-unseen numbers
  coldNumberThreshold: 5,     // turns before cold relief starts

  homeSteps: 57               // finished position value
};

// ---------- per-player state ----------
const _diceState = {};

function _createState() {
  return {
    noSix: 0,
    sixStreak: 0,
    last: 0,
    repeat: 0,
    turns: 0,
    afterCapture: 0,
    homeWait: 0,
    sinceLastSeen: [0, 0, 0, 0, 0, 0, 0],
    bag: []
  };
}

function _st(id) {
  if (!_diceState[id]) {
    _diceState[id] = _createState();
  }
  return _diceState[id];
}

// ---------- weighted random pick ----------
function _weightedPick(w) {
  let total = 0;
  for (let i = 1; i <= 6; i++) {
    total += Math.max(0, w[i]);
  }
  if (total <= 0) return 1;

  let r = Math.random() * total;
  for (let i = 1; i <= 6; i++) {
    r -= Math.max(0, w[i]);
    if (r <= 0) return i;
  }
  return 6;
}

// ---------- shuffle bag ----------
function _refillBag() {
  const bag = [1, 2, 3, 4, 5, 6, 1, 2, 3, 4, 5, 6];
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  return bag;
}

function _bagRoll(s) {
  if (!s.bag || s.bag.length === 0) {
    s.bag = _refillBag();
  }
  return s.bag.pop();
}

// ---------- scale factor by strength k ----------
function _applyFactor(weights, n, factor, k) {
  const scaled = 1 + (factor - 1) * k;
  weights[n] *= Math.max(0.05, scaled);
}

// ---------- check if current turn is inside active wave ----------
function _isActionWave(turns, C) {
  if (!C.waveCycleLength || C.waveCycleLength <= 0) return true;
  const posInCycle = turns % C.waveCycleLength;
  return posInCycle < C.waveBoostTurns;
}

// ============================================================
// MAIN FUNCTION
// ============================================================
function rollDice(ctx = {}) {
  const C = LUDO_DICE;
  const playerId = ctx.playerId || "default";
  const s = _st(playerId);
  const k = ctx.strength === undefined ? 1 : ctx.strength;

  let value;

  if (C.useBag) {
    value = _bagRoll(s);
  } else {
    const w = [0, 1, 1, 1, 1, 1, 1];
    const tokens = ctx.tokens || [];
    const allInBase = tokens.length > 0 && tokens.every(t => t.pos === -1);
    const activeWave = _isActionWave(s.turns, C);
    const waveMult = activeWave ? C.waveActionMultiplier : 1;

    // 1. Mild opening 6 boost
    if (s.turns < C.openingTurns) {
      _applyFactor(w, 6, C.openingSixBoost, k);
    }

    // 2. Mild comeback 6 boost after capture
    if (s.afterCapture > 0) {
      _applyFactor(w, 6, C.afterCaptureSixBoost, k);
    }

    // 3. Pity boost for 6 when all tokens are in base
    if (allInBase && s.noSix > 0) {
      _applyFactor(w, 6, 1 + s.noSix * C.sixPityStep, k);
    }

    // 4. Penalty after two 6s (before hard block)
    if (s.sixStreak >= 2) {
      _applyFactor(w, 6, C.tripleSixPenalty, k);
    }

    // 5. Capture boost (higher, not guaranteed), clash setup & occasional lucky save
    const triggerClutchSave =
      ctx.inDanger &&
      typeof ctx.escapesDanger === "function" &&
      Math.random() < C.clutchSaveChance;

    for (let n = 1; n <= 6; n++) {
      if (ctx.canCapture && ctx.canCapture(n)) {
        const capFactor = activeWave ? C.captureBoost * waveMult : C.captureBoost;
        _applyFactor(w, n, capFactor, k);
      }
      if (ctx.setsUpCapture && ctx.setsUpCapture(n)) {
        const baitFactor = activeWave ? C.baitBoost * waveMult : C.baitBoost;
        _applyFactor(w, n, baitFactor, k);
      }
      if (triggerClutchSave && ctx.escapesDanger(n)) {
        _applyFactor(w, n, C.clutchSaveBoost, k);
      }
      if (ctx.reachesSafe && ctx.reachesSafe(n)) {
        _applyFactor(w, n, C.safeZoneBoost, k);
      }
    }

    // 6. Catch-up & leader brake
    if (ctx.progress && typeof ctx.progress === "object") {
      const ids = Object.keys(ctx.progress);
      const vals = ids.map(id => ctx.progress[id]);
      if (ids.length > 1 && vals.every(v => typeof v === "number")) {
        const min = Math.min(...vals);
        const max = Math.max(...vals);
        const mine = ctx.progress[playerId];

        if (max !== min && typeof mine === "number") {
          if (mine === min) {
            [4, 5, 6].forEach(n => _applyFactor(w, n, C.catchUpBoost, k));
          }
          if (mine === max) {
            for (let n = 1; n <= 6; n++) {
              const entersHome = tokens.some(
                t => t.pos >= 0 && t.pos < C.homeSteps && (C.homeSteps - t.pos) === n
              );
              const captures = ctx.canCapture && ctx.canCapture(n);
              if (captures || entersHome) {
                _applyFactor(w, n, C.leaderBrake, k);
              }
            }
          }
        }
      }
    }

    // 7. Home stretch tension & recovery
    const needed = [];
    tokens.forEach(t => {
      const left = C.homeSteps - t.pos;
      if (t.pos >= 0 && left >= 1 && left <= 6) {
        needed.push(left);
      }
    });
    if (needed.length > 0) {
      const rawFactor = C.homeTension + s.homeWait * C.homeWaitStep;
      const factor = Math.min(C.maxHomeFactor, rawFactor);
      needed.forEach(n => _applyFactor(w, n, factor, k));
    }

    // 8. Cold number relief
    for (let n = 1; n <= 6; n++) {
      if (s.sinceLastSeen[n] > C.coldNumberThreshold) {
        const extraTurns = s.sinceLastSeen[n] - C.coldNumberThreshold;
        _applyFactor(w, n, 1 + extraTurns * C.coldNumberStep, k);
      }
    }

    // 9. Anti-repeat dampener
    if (s.last && s.repeat >= 1) {
      _applyFactor(w, s.last, C.antiRepeat, k);
    }

    // 10. Clamp weights to safe range
    for (let n = 1; n <= 6; n++) {
      w[n] = Math.max(C.minW, Math.min(C.maxW, w[n]));
    }

    // 11. After 2 sixes in a row, six is completely blocked (0)
    if (C.blockSixAfter > 0 && s.sixStreak >= C.blockSixAfter) {
      w[6] = 0;
    }

    value = _weightedPick(w);

    // Update home-wait counter
    if (needed.length > 0) {
      s.homeWait = needed.includes(value) ? 0 : s.homeWait + 1;
    } else {
      s.homeWait = 0;
    }
  }

  // ---------- update player memory ----------
  const allBaseAfter = tokensSafeCheck(ctx.tokens);
  if (value === 6) {
    s.noSix = 0;
    s.sixStreak++;
  } else {
    s.sixStreak = 0;
    s.noSix = allBaseAfter ? s.noSix + 1 : 0;
  }

  s.repeat = value === s.last ? s.repeat + 1 : 0;
  s.last = value;
  s.turns++;

  for (let n = 1; n <= 6; n++) {
    s.sinceLastSeen[n] = (n === value) ? 0 : s.sinceLastSeen[n] + 1;
  }

  if (s.afterCapture > 0) {
    s.afterCapture--;
  }

  return value;
}

function tokensSafeCheck(tokens) {
  return Array.isArray(tokens) && tokens.length > 0 && tokens.every(t => t.pos === -1);
}

// ============================================================
// EVENTS & UTILITIES
// ============================================================
function onTokenCaptured(victimPlayerId) {
  if (!victimPlayerId) return;
  _st(victimPlayerId).afterCapture = LUDO_DICE.afterCaptureTurns;
}

function resetDice(playerId = null) {
  if (playerId) {
    delete _diceState[playerId];
  } else {
    for (const key in _diceState) {
      delete _diceState[key];
    }
  }
}

function setDiceConfig(partialConfig = {}) {
  Object.assign(LUDO_DICE, partialConfig);
}

function getDiceStats(playerId) {
  const s = _st(playerId);
  return {
    noSix: s.noSix,
    sixStreak: s.sixStreak,
    last: s.last,
    repeat: s.repeat,
    turns: s.turns,
    afterCapture: s.afterCapture,
    homeWait: s.homeWait,
    sinceLastSeen: s.sinceLastSeen.slice(1)
  };
}
