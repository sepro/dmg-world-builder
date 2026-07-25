export const DENSITY_PROFILES = {
  sparse: {
    hit: 0.42,
    restBonus: 0.16,
    breathChance: 0.78,
    barRest: { lead: 0.12, harmony: 0.24, bass: 0.10 },
  },
  medium: {
    hit: 0.70,
    restBonus: 0.06,
    breathChance: 0.42,
    barRest: { lead: 0.04, harmony: 0.09, bass: 0.04 },
  },
  busy: {
    hit: 0.92,
    restBonus: 0,
    breathChance: 0.16,
    barRest: { lead: 0, harmony: 0.02, bass: 0 },
  },
};

// Articulation is intentionally independent of density. Density decides how
// often notes change; it must not make sparse notes intrinsically shorter.
export const NOTE_GATE = 0.82;

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

// Final repair pass for artifacts that only become visible after all notes in a
// channel exist. It keeps musical values discrete: an adjacent repeated note
// becomes one note exactly twice as long, never an arbitrary stretched value.
export function cleanupPitchedTrack(track, { swing, stepsPerBeat, stepsPerBar, gate = NOTE_GATE }) {
  track.sort((a, b) => a.step - b.step);
  for (let i = 0; i < track.length - 1; i++) {
    const current = track[i];
    const next = track[i + 1];
    const sameBar = Math.floor(current.step / stepsPerBar) === Math.floor(next.step / stepsPerBar);
    const adjacent = next.step === current.step + current.value;
    const sameValue = next.value === current.value;
    if (sameBar && adjacent && sameValue && next.midi === current.midi) {
      current.value *= 2;
      const timing = noteTiming(current.step, current.value, gate, swing, stepsPerBeat);
      current.t = timing.t;
      current.dur = timing.dur;
      current.vel = Math.max(current.vel, next.vel);
      track.splice(i + 1, 1);
    }
  }
  for (let i = track.length - 1; i >= 0; i--) {
    const note = track[i];
    if (!Number.isFinite(note.t) || !Number.isFinite(note.dur) || note.dur < 0.1) track.splice(i, 1);
  }
  enforceMonophony(track);
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
