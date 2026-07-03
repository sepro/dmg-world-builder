# Music Generator — Options Guide

What every control in `dist/gb-music-generator.html` does, and how the controls
interact. The whole tune is **fully determined by these settings plus the
seed**, so the same settings always reproduce the same music. Export saves only
the settings; the music is regenerated from them on import.

Time is quantized internally to **16th-note steps** (4 steps per quarter note).
`steps per bar = beats × (16 ÷ beat unit)` — e.g. 4/4 = 16 steps, 3/4 = 12, 6/8 = 12, 5/4 = 20.

---

## Composition

### Key
The tonic (home note) of the piece: `C` through `B` (12 chromatic choices).
Sets the pitch everything is transposed to. It does **not** change the *feel* —
that comes from the scale. Changing the key shifts the whole tune up or down.

### Scale / Mode
The set of pitches melodies and chords are built from, measured in semitones
from the key:

| Scale | Feel | Intervals |
|-------|------|-----------|
| Major (Ionian) | bright, happy | 0 2 4 5 7 9 11 |
| Natural Minor | sad, serious | 0 2 3 5 7 8 10 |
| Harmonic Minor | dramatic, exotic | 0 2 3 5 7 8 11 |
| Dorian | cool, folk-minor | 0 2 3 5 7 9 10 |
| Phrygian | dark, Spanish/metal | 0 1 3 5 7 8 10 |
| Lydian | dreamy, floaty | 0 2 4 6 7 9 11 |
| Mixolydian | bluesy, rock | 0 2 4 5 7 9 10 |
| Major Pentatonic | open, cheerful (5 notes) | 0 2 4 7 9 |
| Minor Pentatonic | bluesy, safe (5 notes) | 0 3 5 7 10 |
| Blues | gritty (with "blue" note) | 0 3 5 6 7 10 |
| Melodic Minor | minor with a bright lift | 0 2 3 5 7 9 11 |
| Hungarian Minor | exotic, gypsy/dramatic | 0 2 3 6 7 8 11 |
| Whole Tone | weightless, dreamlike | 0 2 4 6 8 10 |
| Hirajoshi (Japanese) | sparse, Eastern (5 notes) | 0 2 3 7 8 |
| Egyptian (sus pent.) | open, suspended (5 notes) | 0 2 5 7 10 |
| Okinawan (Ryukyu) | sunny, island (5 notes) | 0 4 5 7 11 |
| Chromatic | all 12 notes, atonal | 0…11 |

The scale also feeds chord building: triads are stacked in thirds within the
chosen scale, so a minor scale yields minor chords automatically. Pentatonic
and chromatic scales build chords from the available notes, which can sound
unconventional — that's expected.

### Time signature
Beats per bar and the beat unit: `4/4`, `3/4`, `2/4`, `6/8`, `5/4`. Controls bar
length and where strong beats fall (which in turn drives drum placement and
where the melody lands on chord tones). `3/4` and `6/8` pair naturally with the
**Waltz** pattern.

### Tempo (BPM)
Playback speed in quarter-note beats per minute (40–280). Affects playback and
the exported MIDI tempo; it does **not** change which notes are generated.

### Mood
The biggest "style" lever. Each mood is a profile that nudges the
improvisation. Moods are grouped:

- **Classic** — Happy/Upbeat, Sad/Melancholy, Heroic/Adventure, Spooky/Tense, Calm/Peaceful, Mysterious
- **Battle** — Boss Battle, Chase, Victory Fanfare, Game Over
- **Town** — Town, Shop, Overworld, Cave/Dungeon, Title Screen
- **Scene** — Credits/Ending, Lullaby, Festival, Sea/Sailing, Desert Ruins, Factory, Space Station, Racing

A mood adjusts:

- **Leap** — how often the melody jumps vs. steps to the next note.
- **Rest** — how often a melodic slot is left silent (breathing room).
- **Syncopation** — how often onsets get pushed off the beat.
- **Register** — the centre octave of the lead and the bass.
- **Velocity** — overall loudness/energy.
- **Default progression** and **default drum style**, used when those controls are set to *Auto*.

So *Boss Battle* leaps a lot, rarely rests, syncopates, and is loud; *Calm* steps
gently, rests often, sits quiet, and uses no drums by default.

### Pattern
The **rhythmic engine** — how notes are spaced in time, per channel:

| Pattern | What it does |
|---------|--------------|
| Arpeggio | Harmony & bass break the chord into steady running notes; lead floats above. |
| March | Strong, even on-beat notes; military snare feel. |
| Waltz | 3-feel "oom-pah-pah": bass on beat 1, harmony chords on the later beats. Best in 3/4 or 6/8. |
| Ballad | Slow and sparse — long, sustained notes. |
| Driving 8ths | Constant eighth-note motion in bass & harmony; energetic. |
| Call & Response | Lead plays a phrase, then rests so harmony "answers" in alternating bars. |
| Syncopated / Funk | Off-beat pushes in lead & harmony over a steady quarter-note bass. |
| Galop | Relentless eighths with the bass pumping root–octave; classic action-chiptune drive. |
| Ostinato | Busy repeating accompaniment under a slower, singing lead. |

### Chord progression
The harmonic backbone — a sequence of chords (one per bar, looped). Written as
diatonic scale degrees (Roman numerals):

| Option | Sequence | Notes |
|--------|----------|-------|
| Auto (from mood) | — | Uses the mood's default progression. |
| I–V–vi–IV (pop) | 1 5 6 4 | The ubiquitous pop loop. |
| I–IV–V | 1 4 5 5 | Classic/folk/rock. |
| I–vi–IV–V (50s) | 1 6 4 5 | Doo-wop. |
| ii–V–I (jazz) | 2 5 1 1 | Jazz cadence. |
| Canon (Pachelbel) | 1 5 6 3 4 1 4 5 | 8-bar, very melodic. |
| i–VI–III–VII | 1 6 3 7 | Common minor/epic loop. |
| i–iv–v | 1 4 5 5 | Minor blues/rock. |
| i–VII–VI–V | 1 7 6 5 | Andalusian cadence (Spanish/dramatic). |
| 12-bar blues | 1 1 1 1 4 4 1 1 5 4 1 5 | 12-bar form; pairs with Blues/Mixolydian. |
| vi–IV–I–V (axis) | 6 4 1 5 | The "axis of awesome" loop, wistful-epic. |
| IV–V–iii–vi (royal road) | 4 5 3 6 | Signature J-pop/anime progression. |
| I–vi–ii–V (turnaround) | 1 6 2 5 | Smooth jazz-standard turnaround. |
| I–VII–IV (rock) | 1 7 4 1 | Modal rock; shines in Mixolydian. |
| i–IV vamp (modal) | 1 4 1 4 | Two-chord vamp; shines in Dorian. |
| i–VI–iv–V (epic) | 1 6 4 5 | Big cinematic minor loop. |
| I–V–IV–V (drift) | 1 5 4 5 | Floating, unresolved motion. |
| i–VII–VI–VII | 1 7 6 7 | Lament-style oscillation. |

The degrees are interpreted *within the chosen scale*, so the same progression
sounds major or minor depending on the scale.

### Structure
How sections are arranged over the length of the tune:

- **Single phrase** — progression simply loops for the chosen number of bars.
- **Loop (resolves)** — same, but the final bar resolves to the tonic (`I`) so it loops seamlessly.
- **Intro + loop** — first two bars are a sparse intro (lead drops out, accompaniment only), then the full arrangement.
- **Verse / Chorus** — alternates blocks of lower density (verse) and higher density (chorus) every four bars.
- **Through-composed** — keeps varying without a repeat scheme.

### Length (bars)
Total number of bars to generate (1–64). The progression cycles to fill them and
the structure envelope is applied across them.

### Swing
0–100%. Delays the off-beat of each beat to create a shuffled, "swung" groove.
0% is straight/mechanical. Baked into note timing so it shows in playback **and**
the exported MIDI.

---

## Channels

The four Game Boy hardware channels, each with a fixed musical role. Every
channel can be toggled on/off.

### Pulse 1 — Lead (melody)
- **Duty** — square-wave timbre: 12.5% (thin/reedy), 25% (round), 50% (full), 75% (nasal).
- **Density** — Sparse / Medium / Busy: how many melodic notes are played.

### Pulse 2 — Harmony
- **Duty** — same timbre options as Pulse 1.
- **Density** — how busy the broken-chord accompaniment is.

The GB channels are monophonic, so "chords" are arpeggiated one note at a time.

### Wave — Bass
- **Waveform** — Triangle (soft, classic GB bass), Sine (pure), Saw (bright/buzzy), Square (hard).
- **Density** — how active the bass line is; it alternates root and fifth on busier settings.

### Noise — Drums
- **Drum style** — Auto (from mood), Rock kit (backbeat with hi-hats), Marching (military snare), Busy / 16ths (dense), Dance / 4-on-floor (kick every beat, off-beat hats), Half-time (spacious backbeat), or Silent. Every style adds a rising snare fill in the last beat of each 4-bar phrase.

Mapped to General MIDI drums on export: kick = 36, snare = 38, hi-hat = 42.

---

## Generation

### Seed
An integer (0–2,147,483,647) that drives the random choices. **Same settings +
same seed = identical tune, every time.** Change only the seed to get a different
"take" of the same style; change a setting to change the style itself. The
🎲 button picks a fresh random seed.

### Generate
Re-runs the generator with the current settings and redraws the score. (Editing
settings does not auto-generate — press Generate to hear changes.)

---

## Transport & views

- **Play / Stop** — Web Audio playback approximating the GB channels. Spacebar also toggles play.
- **Loop** — repeat the tune seamlessly.
- **Piano roll** — grid view: pitch vs. time, one colour per channel, plus a drum lane. A green playhead tracks playback.
- **Staff** — simplified notation: treble staves for the pulse channels, a bass staff for the wave channel, and an ×-notehead line for drums. (Spelling is simplified — black keys are shown as sharps.)

---

## Export / Import

- **Download .json** (`.gbmusic.json`) — saves the settings + seed. This *is* the music, because the tune is fully reproducible from it. Import regenerates the exact same tune.
- **Download .mid** — Standard MIDI File (format 1): one track per pitched channel plus a drum track on MIDI channel 10. For use in a DAW or other tools.
- **Copy JSON** — copies the settings JSON to the clipboard.
- **Import** — load a `.gbmusic.json` file or paste its contents.

---

## Quick recipes

| Want… | Try |
|-------|-----|
| Cheerful overworld theme | Key C, Major, 4/4, mood *Overworld*, pattern *March*, progression *Auto* |
| Tense boss fight | Minor or Harmonic Minor, mood *Boss Battle*, pattern *Driving 8ths*, drums *Busy* |
| Gentle title screen | Major, mood *Title Screen* or *Calm*, pattern *Ballad* or *Arpeggio*, low density, drums *Silent* |
| Bluesy shop tune | Mixolydian or Blues, mood *Shop*, progression *12-bar blues*, some Swing |
| Spooky dungeon | Phrygian or Harmonic Minor, mood *Cave/Dungeon* or *Spooky*, pattern *Arpeggio* |
| A different take, same vibe | Keep everything, change only the **Seed** |
