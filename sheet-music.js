// JamSpy - Solo Piano Sheet Music Arranger & Crisp Grand-Staff SVG Renderer

import { getNoteName } from './music-theory.js?v=8';

// Map pitch class (0..11) to [diatonicLetterIndex 0..6 (C..B), accidentalSymbol]
const SHARP_STAFF_MAP = [
  [0, ''],  // C
  [0, '♯'], // C#
  [1, ''],  // D
  [1, '♯'], // D#
  [2, ''],  // E
  [3, ''],  // F
  [3, '♯'], // F#
  [4, ''],  // G
  [4, '♯'], // G#
  [5, ''],  // A
  [5, '♯'], // A#
  [6, '']   // B
];

const FLAT_STAFF_MAP = [
  [0, ''],  // C
  [1, '♭'], // Db
  [1, ''],  // D
  [2, '♭'], // Eb
  [2, ''],  // E
  [3, ''],  // F
  [4, '♭'], // Gb
  [4, ''],  // G
  [5, '♭'], // Ab
  [5, ''],  // A
  [6, '♭'], // Bb
  [6, '']   // B
];

function getStaffPosition(midi, useFlats) {
  const pc = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  const [letterIdx, accidental] = useFlats ? FLAT_STAFF_MAP[pc] : SHARP_STAFF_MAP[pc];
  return {
    absStep: octave * 7 + letterIdx,
    accidental
  };
}

/**
 * Matches a 260ms chroma slice strictly against chords belonging to (or commonly borrowed in)
 * the detected key so "Chords Heard" and left-hand piano chords stay clean and playable.
 */
function matchInKeyChord(sliceChroma, keyDetails) {
  let total = 0;
  for (let i = 0; i < 12; i++) total += sliceChroma[i];
  if (total <= 1e-6) return keyDetails.chords[0];

  const norm = sliceChroma.map((v) => v / total);

  // Candidate pool: the 6 core jam chords of the key + Harmonic Minor V / Rock bVII if strongly heard
  const pool = keyDetails.chords.map((ch, idx) => ({
    symbol: ch.symbol,
    rootPc: ch.rootPc,
    quality: ch.quality,
    priorBonus: idx === 0 ? 0.04 : idx < 4 ? 0.02 : 0
  }));

  if (keyDetails.mode === 'minor') {
    const domRoot = (keyDetails.rootPc + 7) % 12;
    const domName = getNoteName(domRoot, keyDetails.useFlats);
    pool.push({ symbol: domName, rootPc: domRoot, quality: 'maj', priorBonus: 0.01 });
  } else {
    const b7Root = (keyDetails.rootPc + 10) % 12;
    const b7Name = getNoteName(b7Root, true);
    pool.push({ symbol: b7Name, rootPc: b7Root, quality: 'maj', priorBonus: -0.02 });
  }

  let best = pool[0];
  let bestScore = -999;

  for (const cand of pool) {
    const third = (cand.rootPc + (cand.quality === 'min' ? 3 : 4)) % 12;
    const fifth = (cand.rootPc + 7) % 12;
    const score = norm[cand.rootPc] * 1.15 + norm[third] * 1.02 + norm[fifth] * 0.78 + cand.priorBonus;
    if (score > bestScore) {
      bestScore = score;
      best = cand;
    }
  }

  return best;
}

/**
 * Snaps a raw MIDI note into the closest note belonging to the detected key's 7-note scale
 * inside comfortable Treble Clef right-hand reading range (C4 = 60 to F5 = 77).
 */
function snapMidiToScaleTreble(rawMidi, scaleSet, preferredPcs = null) {
  let m = rawMidi;
  while (m < 60) m += 12;
  while (m > 77) m -= 12;

  if (scaleSet.has(m % 12)) return m;

  // Check ±1 or ±2 semitones, favoring chord tones if tied
  let bestMidi = m;
  let bestDist = 99;
  for (let delta = -2; delta <= 2; delta++) {
    const cand = m + delta;
    if (cand < 60 || cand > 77) continue;
    const pc = ((cand % 12) + 12) % 12;
    if (!scaleSet.has(pc)) continue;
    const dist = Math.abs(delta) - (preferredPcs && preferredPcs.has(pc) ? 0.25 : 0);
    if (dist < bestDist) {
      bestDist = dist;
      bestMidi = cand;
    }
  }
  return bestMidi;
}

/**
 * Builds comfortable Left-Hand Bass Clef notes (inside G2 = 43 .. A3 = 57, zero ledger lines!)
 * Beat 1-2: Warm bass root half note; Beat 3-4: Fifth + Root/3rd shell half note.
 */
function buildLeftHandMeasure(rootPc, quality) {
  // Place bass root between G2 (43) and F#3 (54) so it sits right on the Bass Staff
  let rootMidi = 48 + rootPc; // C3..B3
  if (rootMidi > 53) rootMidi -= 12; // F#2..B2 -> 42..47 (keep >= 43 G2; F#2=42 is just 1 step below G2)
  if (rootMidi < 43) rootMidi += 12;

  const thirdOffset = quality === 'min' ? 3 : 4;
  let upperThird = rootMidi + thirdOffset;
  let upperFifth = rootMidi + 7;
  if (upperFifth > 58) {
    upperThird -= 12;
    upperFifth -= 12;
  }
  // Ensure upper dyad stays nicely spaced above or around D3..A3
  const chordMidis = upperThird >= rootMidi + 3
    ? [upperThird, upperFifth]
    : [rootMidi + thirdOffset, Math.min(59, rootMidi + 7)];

  return [
    { beat: 0, durationBeats: 2, midis: [rootMidi] },
    { beat: 2, durationBeats: 2, midis: chordMidis }
  ];
}

/**
 * Merges repeated adjacent quarter-note melody pitches on (Beat 1+2) or (Beat 3+4)
 * into clean, natural Half Notes so the right-hand melody breathes like a real lead sheet.
 */
function groupFourBeatMelody(fourMidis) {
  const notes = [];
  if (fourMidis[0] === fourMidis[1]) {
    notes.push({ beat: 0, durationBeats: 2, midi: fourMidis[0] });
  } else {
    notes.push({ beat: 0, durationBeats: 1, midi: fourMidis[0] });
    notes.push({ beat: 1, durationBeats: 1, midi: fourMidis[1] });
  }

  if (fourMidis[2] === fourMidis[3]) {
    notes.push({ beat: 2, durationBeats: 2, midi: fourMidis[2] });
  } else {
    notes.push({ beat: 2, durationBeats: 1, midi: fourMidis[2] });
    notes.push({ beat: 3, durationBeats: 1, midi: fourMidis[3] });
  }
  return notes;
}

/**
 * Builds a clean Solo Piano Sketch + "Chords Heard" progression directly from
 * the 260ms audio slices & upper-register melody candidates captured during listening!
 */
export function buildPianoSketchFromScan(keyDetails, windowChromas = [], windowMelodies = []) {
  if (!windowChromas || windowChromas.length < 4) {
    return buildDefaultSketchForKey(keyDetails);
  }

  const scaleSet = new Set(keyDetails.scalePitchClasses);

  // 1. Match each 260ms slice to an in-key chord
  const sliceChords = windowChromas.map((sc) => matchInKeyChord(sc, keyDetails));

  // Extract deduplicated "Chords Heard" timeline (require >= 2 consecutive slices to ignore blips)
  const chordsHeard = [];
  let run = sliceChords[0];
  let len = 1;
  for (let i = 1; i < sliceChords.length; i++) {
    const c = sliceChords[i];
    if (c.symbol === run.symbol) {
      len++;
    } else {
      if (len >= 2) {
        if (!chordsHeard.length || chordsHeard[chordsHeard.length - 1].symbol !== run.symbol) {
          chordsHeard.push({ symbol: run.symbol, rootPc: run.rootPc, quality: run.quality });
        }
      }
      run = c;
      len = 1;
    }
  }
  if (len >= 2 && (!chordsHeard.length || chordsHeard[chordsHeard.length - 1].symbol !== run.symbol)) {
    chordsHeard.push({ symbol: run.symbol, rootPc: run.rootPc, quality: run.quality });
  }

  if (chordsHeard.length === 0) {
    chordsHeard.push({
      symbol: keyDetails.chords[0].symbol,
      rootPc: keyDetails.chords[0].rootPc,
      quality: keyDetails.chords[0].quality
    });
  }

  // Cap displayed chord timeline to at most 8 clean changes
  const cleanTimeline = chordsHeard.slice(0, 8);

  // 2. Build 4 clean measures (standard 4-bar solo piano phrase)
  // Pick the most representative 4-measure span from the scan
  const numMeasures = 4;
  const totalSlices = windowChromas.length;
  const measures = [];

  for (let mIdx = 0; mIdx < numMeasures; mIdx++) {
    const sliceStart = Math.floor((mIdx * totalSlices) / numMeasures);
    const sliceEnd = Math.max(sliceStart + 1, Math.floor(((mIdx + 1) * totalSlices) / numMeasures));

    // Majority chord in this measure segment (or from cleanTimeline if fewer changes)
    const counts = new Map();
    let measureChord = cleanTimeline[mIdx % cleanTimeline.length];
    let bestCnt = 0;
    for (let s = sliceStart; s < sliceEnd; s++) {
      const ch = sliceChords[s];
      const cnt = (counts.get(ch.symbol) || 0) + 1;
      counts.set(ch.symbol, cnt);
      if (cnt > bestCnt) {
        bestCnt = cnt;
        measureChord = ch;
      }
    }

    const chordToneSet = new Set([
      measureChord.rootPc,
      (measureChord.rootPc + (measureChord.quality === 'min' ? 3 : 4)) % 12,
      (measureChord.rootPc + 7) % 12
    ]);

    // Extract 4 melody beats across [sliceStart..sliceEnd)
    const beatMidis = [];
    let prevMidi = 60 + ((measureChord.rootPc + 7) % 12);
    if (prevMidi < 64) prevMidi += 12;

    for (let b = 0; b < 4; b++) {
      const bStart = sliceStart + Math.floor((b * (sliceEnd - sliceStart)) / 4);
      const bEnd = Math.max(bStart + 1, sliceStart + Math.floor(((b + 1) * (sliceEnd - sliceStart)) / 4));

      let pickedMidi = null;
      let bestSal = 0;

      for (let s = bStart; s < bEnd; s++) {
        const mel = windowMelodies[s];
        if (!mel || !mel.candidates) continue;
        for (const cand of mel.candidates) {
          const pc = ((cand.midi % 12) + 12) % 12;
          const inScaleBonus = scaleSet.has(pc) ? 1.35 : 0.7;
          const chordBonus = (b === 0 || b === 2) && chordToneSet.has(pc) ? 1.2 : 1.0;
          const leapPenalty = Math.abs(cand.midi - prevMidi) > 9 ? 0.72 : 1.0;
          const score = cand.strength * inScaleBonus * chordBonus * leapPenalty;
          if (score > bestSal) {
            bestSal = score;
            pickedMidi = snapMidiToScaleTreble(cand.midi, scaleSet, chordToneSet);
          }
        }
      }

      if (pickedMidi === null) {
        // Fallback musical chord/scale note if that beat had only percussion
        const fallbackOffsets = keyDetails.mode === 'minor' ? [7, 3, 0, 2] : [4, 7, 0, 2];
        const targetPc = (measureChord.rootPc + fallbackOffsets[b]) % 12;
        pickedMidi = snapMidiToScaleTreble(64 + ((targetPc - 4 + 12) % 12), scaleSet, chordToneSet);
      }

      beatMidis.push(pickedMidi);
      prevMidi = pickedMidi;
    }

    measures.push({
      chordSymbol: measureChord.symbol,
      rootPc: measureChord.rootPc,
      quality: measureChord.quality,
      rightHand: groupFourBeatMelody(beatMidis),
      leftHand: buildLeftHandMeasure(measureChord.rootPc, measureChord.quality)
    });
  }

  return {
    isLiveSketch: true,
    bpm: 104,
    chordsHeard: cleanTimeline,
    measures
  };
}

/**
 * Generates a musical 4-measure Solo Piano Preview Sketch for any Major or Minor key
 * (used before the first live scan, when browsing keys manually, or for older saved songs).
 */
export function buildDefaultSketchForKey(keyDetails) {
  // Classic 4-chord progression: I - V - vi - IV (Major) or i - bVI - bIII - bVII (Minor)
  const progIndices = keyDetails.mode === 'major' ? [0, 2, 3, 1] : [0, 1, 2, 3];
  const progChords = progIndices.map((idx) => keyDetails.chords[idx]);
  const scale = keyDetails.scalePitchClasses;

  // Expressive, playable right-hand piano motif across the 4 chords
  const scaleDegPatterns = [
    [4, 2, 0, 0], // Bar 1: 5 - 3 - 1 (held)
    [1, 2, 4, 4], // Bar 2: 2 - 3 - 5 (held)
    [2, 4, 5, 4], // Bar 3: 3 - 5 - 6 - 5
    [3, 2, 1, 1]  // Bar 4: 4 - 3 - 2 (held)
  ];

  const measures = progChords.map((ch, mIdx) => {
    const degs = scaleDegPatterns[mIdx];
    const fourMidis = degs.map((d) => {
      const pc = scale[d % scale.length];
      let m = 60 + pc;
      if (m < 64) m += 12;
      if (m > 76) m -= 12;
      return m;
    });

    return {
      chordSymbol: ch.symbol,
      rootPc: ch.rootPc,
      quality: ch.quality,
      rightHand: groupFourBeatMelody(fourMidis),
      leftHand: buildLeftHandMeasure(ch.rootPc, ch.quality)
    };
  });

  return {
    isLiveSketch: false,
    bpm: 100,
    chordsHeard: progChords.map((c) => ({
      symbol: c.symbol,
      rootPc: c.rootPc,
      quality: c.quality
    })),
    measures
  };
}

/**
 * Renders crisp, authentic Grand Staff Piano Sheet Music (2 measures per system × 2 systems)
 * as scalable vector SVG inside `containerEl`.
 */
export function renderSheetMusicSVG(containerEl, sketch, keyDetails, activeMeasureIdx = -1) {
  const measures = sketch.measures || [];
  const useFlats = keyDetails.useFlats;

  const SVG_W = 680;
  const SYSTEMS = Math.ceil(measures.length / 2);
  const SYS_HEIGHT = 178;
  const TOP_PAD = 18;
  const SVG_H = TOP_PAD + SYSTEMS * SYS_HEIGHT + 8;

  const LINE_SP = 9; // 9px between staff lines => 36px per 5-line staff
  const STAFF_H = LINE_SP * 4; // 36px
  const TREBLE_BASS_GAP = 42;

  const parts = [];
  parts.push(
    `<svg class="sheet-svg" viewBox="0 0 ${SVG_W} ${SVG_H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Solo Piano Sheet Music in ${keyDetails.name}">`
  );

  for (let sys = 0; sys < SYSTEMS; sys++) {
    const sysTop = TOP_PAD + sys * SYS_HEIGHT;
    const trebleTop = sysTop + 26;
    const trebleBottom = trebleTop + STAFF_H;
    const bassTop = trebleBottom + TREBLE_BASS_GAP;
    const bassBottom = bassTop + STAFF_H;

    const leftX = 22;
    const rightX = SVG_W - 16;
    const clefZoneW = sys === 0 ? 68 : 48;
    const measuresStartX = leftX + clefZoneW;
    const measureW = (rightX - measuresStartX) / 2;

    // Measure playback highlight boxes (drawn behind staff lines)
    for (let col = 0; col < 2; col++) {
      const mIdx = sys * 2 + col;
      if (mIdx >= measures.length) continue;
      const mx = measuresStartX + col * measureW;
      const isPlaying = mIdx === activeMeasureIdx;
      parts.push(
        `<rect class="sheet-measure-hl${isPlaying ? ' is-active' : ''}" data-measure="${mIdx}" x="${mx + 2}" y="${sysTop + 4}" width="${measureW - 4}" height="${bassBottom - sysTop + 10}" rx="6" />`
      );
    }

    // 5 horizontal staff lines for Treble & Bass
    for (let l = 0; l < 5; l++) {
      const ty = trebleTop + l * LINE_SP;
      const by = bassTop + l * LINE_SP;
      parts.push(`<line x1="${leftX}" y1="${ty}" x2="${rightX}" y2="${ty}" class="staff-line" />`);
      parts.push(`<line x1="${leftX}" y1="${by}" x2="${rightX}" y2="${by}" class="staff-line" />`);
    }

    // Left Grand Staff connecting barline + curved piano brace
    parts.push(`<line x1="${leftX}" y1="${trebleTop}" x2="${leftX}" y2="${bassBottom}" class="bar-line-bold" />`);
    const midGrandY = (trebleTop + bassBottom) / 2;
    parts.push(
      `<path d="M ${leftX - 3} ${trebleTop} C ${leftX - 13} ${trebleTop + 10}, ${leftX - 6} ${midGrandY - 10}, ${leftX - 14} ${midGrandY} C ${leftX - 6} ${midGrandY + 10}, ${leftX - 13} ${bassBottom - 10}, ${leftX - 3} ${bassBottom}" fill="none" stroke="#18181b" stroke-width="2" stroke-linecap="round" />`
    );

    // Crisp Vector Treble Clef (G Clef)
    const tcX = leftX + 18;
    const tcGLineY = trebleBottom - LINE_SP; // G4 line
    parts.push(
      `<g transform="translate(${tcX}, ${tcGLineY}) scale(0.88)" fill="none" stroke="#18181b" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
        <path d="M 0 14 L 0 -33 C 0 -41, 9 -41, 9 -32 C 9 -21, -11 -12, -11 1 C -11 12, 1 16, 9 9 C 15 3, 12 -9, 2 -9 C -5 -9, -8 -2, -3 3" />
        <circle cx="-2" cy="15" r="2.4" fill="#18181b" stroke="none" />
      </g>`
    );

    // Crisp Vector Bass Clef (F Clef with two dots around F3 4th line)
    const bcX = leftX + 14;
    const bcFLineY = bassTop + LINE_SP; // F3 line
    parts.push(
      `<g transform="translate(${bcX}, ${bcFLineY})">
        <circle cx="0" cy="0" r="3.1" fill="#18181b" />
        <path d="M 0 0 C 0 -8, 13 -9, 13 1 C 13 12, 2 20, -4 24" fill="none" stroke="#18181b" stroke-width="2.6" stroke-linecap="round" />
        <circle cx="17.5" cy="-4" r="1.7" fill="#18181b" />
        <circle cx="17.5" cy="4" r="1.7" fill="#18181b" />
      </g>`
    );

    // 4/4 Time Signature on System 1
    if (sys === 0) {
      const tsX = leftX + 49;
      parts.push(`<text x="${tsX}" y="${trebleTop + 16}" class="time-sig-txt">4</text>`);
      parts.push(`<text x="${tsX}" y="${trebleTop + 34}" class="time-sig-txt">4</text>`);
      parts.push(`<text x="${tsX}" y="${bassTop + 16}" class="time-sig-txt">4</text>`);
      parts.push(`<text x="${tsX}" y="${bassTop + 34}" class="time-sig-txt">4</text>`);
    }

    // Render each measure in this row
    for (let col = 0; col < 2; col++) {
      const mIdx = sys * 2 + col;
      if (mIdx >= measures.length) continue;
      const measure = measures[mIdx];
      const mx = measuresStartX + col * measureW;
      const mEnd = mx + measureW;

      // Measure end barline (double final barline on last measure!)
      const isFinalMeasure = mIdx === measures.length - 1;
      if (isFinalMeasure) {
        parts.push(`<line x1="${mEnd - 4}" y1="${trebleTop}" x2="${mEnd - 4}" y2="${bassBottom}" class="bar-line" />`);
        parts.push(`<line x1="${mEnd}" y1="${trebleTop}" x2="${mEnd}" y2="${bassBottom}" class="bar-line-final" />`);
      } else {
        parts.push(`<line x1="${mEnd}" y1="${trebleTop}" x2="${mEnd}" y2="${bassBottom}" class="bar-line" />`);
      }

      // Chord Symbol cleanly above the Treble Staff
      parts.push(
        `<text x="${mx + 16}" y="${trebleTop - 10}" class="sheet-chord-symbol">${escapeXml(measure.chordSymbol)}</text>`
      );

      const innerPadL = 24;
      const innerW = measureW - innerPadL - 14;
      const beatX = (beat) => mx + innerPadL + (beat / 4) * innerW;

      // Track accidentals already shown in this measure (per staff) so repeats look clean
      const shownTrebleAcc = new Map();
      const shownBassAcc = new Map();

      // Right-Hand Treble Notes
      for (const note of measure.rightHand) {
        const nx = beatX(note.beat);
        const { absStep, accidental } = getStaffPosition(note.midi, useFlats);
        const ny = trebleBottom - (absStep - 30) * (LINE_SP / 2);
        const isHollow = note.durationBeats >= 2;

        // Ledger line for Middle C (absStep 28) or A5 (absStep 40)
        if (absStep <= 28) {
          for (let s = 28; s >= absStep; s -= 2) {
            const ly = trebleBottom - (s - 30) * (LINE_SP / 2);
            parts.push(`<line x1="${nx - 9}" y1="${ly}" x2="${nx + 9}" y2="${ly}" class="ledger-line" />`);
          }
        } else if (absStep >= 40) {
          for (let s = 40; s <= absStep; s += 2) {
            const ly = trebleBottom - (s - 30) * (LINE_SP / 2);
            parts.push(`<line x1="${nx - 9}" y1="${ly}" x2="${nx + 9}" y2="${ly}" class="ledger-line" />`);
          }
        }

        // Stem direction: notes on or above B4 (absStep 34) stem down; below B4 stem up
        const stemUp = absStep < 34;
        const stemX = stemUp ? nx + 4.6 : nx - 4.6;
        const stemY2 = stemUp ? ny - 26 : ny + 26;
        parts.push(`<line x1="${stemX}" y1="${ny}" x2="${stemX}" y2="${stemY2}" class="note-stem" />`);

        // Notehead
        parts.push(
          `<ellipse cx="${nx}" cy="${ny}" rx="5.2" ry="3.8" transform="rotate(-18 ${nx} ${ny})" class="${isHollow ? 'note-head-half' : 'note-head-quarter'}" />`
        );

        // Accidental (♯ / ♭) if black key and not already marked on this step in this measure
        if (accidental && shownTrebleAcc.get(absStep) !== accidental) {
          shownTrebleAcc.set(absStep, accidental);
          parts.push(
            `<text x="${nx - 14}" y="${ny + 4.5}" class="note-accidental">${accidental}</text>`
          );
        }
      }

      // Left-Hand Bass Chords / Roots
      for (const block of measure.leftHand) {
        const nx = beatX(block.beat);
        const isHollow = block.durationBeats >= 2;
        const sortedMidis = [...block.midis].sort((a, b) => a - b);

        const ys = [];
        let prevStep = -999;

        sortedMidis.forEach((m, idx) => {
          const { absStep, accidental } = getStaffPosition(m, useFlats);
          const ny = bassBottom - (absStep - 18) * (LINE_SP / 2);
          // Offset second notehead slightly right if a 2nd interval (adjacent line/space)
          const shiftX = absStep - prevStep === 1 ? 8.5 : 0;
          prevStep = absStep;
          ys.push(ny);

          if (absStep <= 16) {
            const ly = bassBottom - (16 - 18) * (LINE_SP / 2);
            parts.push(`<line x1="${nx - 9}" y1="${ly}" x2="${nx + 9}" y2="${ly}" class="ledger-line" />`);
          } else if (absStep >= 28) {
            const ly = bassBottom - (28 - 18) * (LINE_SP / 2);
            parts.push(`<line x1="${nx - 9}" y1="${ly}" x2="${nx + 9}" y2="${ly}" class="ledger-line" />`);
          }

          parts.push(
            `<ellipse cx="${nx + shiftX}" cy="${ny}" rx="5.2" ry="3.8" transform="rotate(-18 ${nx + shiftX} ${ny})" class="${isHollow ? 'note-head-half' : 'note-head-quarter'}" />`
          );

          if (accidental && shownBassAcc.get(absStep) !== accidental) {
            shownBassAcc.set(absStep, accidental);
            const accX = nx - 14 - (idx % 2) * 7;
            parts.push(`<text x="${accX}" y="${ny + 4.5}" class="note-accidental">${accidental}</text>`);
          }
        });

        // Connect chord noteheads with a single clean stem
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        const avgY = (minY + maxY) / 2;
        const bassMiddleY = bassTop + 2 * LINE_SP; // D3 middle line
        const stemUp = avgY > bassMiddleY;
        const stemX = stemUp ? nx + 4.6 : nx - 4.6;
        const startY = stemUp ? maxY : minY;
        const endY = stemUp ? minY - 25 : maxY + 25;
        parts.push(`<line x1="${stemX}" y1="${startY}" x2="${stemX}" y2="${endY}" class="note-stem" />`);
      }
    }
  }

  parts.push('</svg>');
  containerEl.innerHTML = parts.join('');
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
