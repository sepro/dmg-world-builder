export const DENSITY_PROFILES = {
  sparse: {
    hit: 0.42,
    gate: 0.58,
    restBonus: 0.16,
    breathChance: 0.78,
    barRest: { lead: 0.12, harmony: 0.24, bass: 0.10 },
  },
  medium: {
    hit: 0.70,
    gate: 0.74,
    restBonus: 0.06,
    breathChance: 0.42,
    barRest: { lead: 0.04, harmony: 0.09, bass: 0.04 },
  },
  busy: {
    hit: 0.92,
    gate: 0.86,
    restBonus: 0,
    breathChance: 0.16,
    barRest: { lead: 0, harmony: 0.02, bass: 0 },
  },
};

export function densityProfile(name) {
  return DENSITY_PROFILES[name] || DENSITY_PROFILES.medium;
}

// Build a rhythm from fixed-size musical slots. A missing slot remains silent:
// durations never stretch across a rejected slot. `gate` is kept separately so
// swing can first establish the true length of the slot, then articulate it.
export function gridRhythm(stepsPerBar, grid, hitChance, gate, rng, syncProb = 0, anchorStart = true) {
  const notes = [];
  for (let slot = 0; slot < stepsPerBar; slot += grid) {
    if (!(anchorStart && slot === 0) && rng() >= hitChance) continue;

    // A one-step push only makes sense when it remains inside this slot.
    const pushed = slot !== 0 && grid > 1 && syncProb > 0 && rng() < syncProb;
    const step = slot + (pushed ? 1 : 0);
    const slotEnd = Math.min(stepsPerBar, slot + grid);
    if (step >= slotEnd) continue;
    notes.push({ step, dur: slotEnd - step, gate });
  }
  return notes;
}

// Sparse arrangements occasionally give an entire part of a phrase to the
// other channels. Phrase openings and cadences stay present for orientation.
export function barShouldPlay(densityName, role, bar, rng) {
  const phrasePos = bar % 4;
  if (phrasePos === 0 || phrasePos === 3) return true;
  const probability = densityProfile(densityName).barRest[role] || 0;
  return rng() >= probability;
}

// Swing is a shared timeline transform. Every channel, including drums, must
// call this for its onset to remain phase-aligned.
export function onsetTime(step, swing, stepsPerBeat) {
  let time = step;
  if (swing > 0 && stepsPerBeat >= 2 &&
      step % stepsPerBeat === Math.round(stepsPerBeat / 2)) {
    time += (swing / 100) * 0.6;
  }
  return Math.max(0, time);
}

// Convert a logical slot into audible timing. Applying gate after swing avoids
// making swung offbeats accidentally much shorter than straight notes.
export function noteTiming(step, dur, gate, swing, stepsPerBeat) {
  const t = onsetTime(step, swing, stepsPerBeat);
  const slotEnd = onsetTime(step + dur, swing, stepsPerBeat);
  return { t, dur: Math.max(0.1, (slotEnd - t) * gate) };
}

export function enforceMonophony(track) {
  track.sort((a, b) => a.t - b.t);
  for (let i = track.length - 2; i >= 0; i--) {
    const cur = track[i];
    const next = track[i + 1];
    if (next.t - cur.t < 0.25 || next.step === cur.step) {
      track.splice(i, 1);
      continue;
    }
    cur.dur = Math.min(cur.dur, next.t - cur.t);
  }
}
