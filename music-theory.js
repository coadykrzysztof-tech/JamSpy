// JamSpy - Music Theory, Scales, Chords & Key Matching Engine

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES  = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

// Which keys conventionally read cleanest with flats vs. sharps on a piano
const MAJOR_USES_FLATS = new Set([1, 3, 5, 8, 10]); // Db, Eb, F, Ab, Bb
const MINOR_USES_FLATS = new Set([0, 2, 3, 5, 7, 10]); // Cm, Dm, Ebm, Fm, Gm, Bbm

const MAJOR_SCALE_INTERVALS = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SCALE_INTERVALS = [0, 2, 3, 5, 7, 8, 10]; // Natural minor (standard for pop, rock & country)

// High-contrast empirical key profiles balanced equally between Major and Minor
const POP_MAJOR_PROFILE = [0.232, 0.008, 0.106, 0.009, 0.142, 0.104, 0.009, 0.198, 0.009, 0.090, 0.016, 0.077];
const POP_MINOR_PROFILE = [0.238, 0.008, 0.102, 0.152, 0.010, 0.102, 0.010, 0.192, 0.090, 0.020, 0.100, 0.048];

export function usesFlats(rootPc, mode) {
  return mode === 'minor' ? MINOR_USES_FLATS.has(rootPc) : MAJOR_USES_FLATS.has(rootPc);
}

export function getNoteName(pc, useFlats = false) {
  const idx = ((pc % 12) + 12) % 12;
  return useFlats ? FLAT_NAMES[idx] : SHARP_NAMES[idx];
}

export function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function isBlackKey(pc) {
  const idx = ((pc % 12) + 12) % 12;
  return idx === 1 || idx === 3 || idx === 6 || idx === 8 || idx === 10;
}

export function getKeyDetails(rootPc, mode = 'major') {
  const cleanRoot = ((rootPc % 12) + 12) % 12;
  const flatSpelling = usesFlats(cleanRoot, mode);
  const rootName = getNoteName(cleanRoot, flatSpelling);
  const intervals = mode === 'minor' ? MINOR_SCALE_INTERVALS : MAJOR_SCALE_INTERVALS;

  const scalePitchClasses = intervals.map((step) => (cleanRoot + step) % 12);
  const scaleNoteNames = scalePitchClasses.map((pc) => getNoteName(pc, flatSpelling));

  const relativeRoot = mode === 'minor' ? (cleanRoot + 3) % 12 : (cleanRoot + 9) % 12;
  const relativeMode = mode === 'minor' ? 'major' : 'minor';
  const relativeFlat = usesFlats(relativeRoot, relativeMode);
  const relativeName = `${getNoteName(relativeRoot, relativeFlat)} ${relativeMode === 'major' ? 'Major' : 'Minor'}`;

  const chords = buildJamChords(cleanRoot, mode, flatSpelling);
  const scalePreviewMidi = [...intervals, 12].map((step) => 60 + cleanRoot + (cleanRoot > 7 ? step - 12 : step));

  return {
    id: `${cleanRoot}-${mode}`,
    rootPc: cleanRoot,
    mode,
    rootName,
    name: `${rootName} ${mode === 'major' ? 'Major' : 'Minor'}`,
    useFlats: flatSpelling,
    scalePitchClasses,
    scaleNoteNames,
    relativeKey: {
      rootPc: relativeRoot,
      mode: relativeMode,
      name: relativeName
    },
    chords,
    scalePreviewMidi
  };
}

function buildJamChords(rootPc, mode, flatSpelling) {
  const chordSpecs = mode === 'major'
    ? [
        [0, 'maj', 'Home Base', '1'],
        [5, 'maj', 'Lift / Chorus', '4'],
        [7, 'maj', 'Drive / Turn', '5'],
        [9, 'min', 'Main Minor', '6m'],
        [2, 'min', 'Smooth Minor', '2m'],
        [4, 'min', 'Color Chord', '3m']
      ]
    : [
        [0, 'min', 'Home Base', '1m'],
        [8, 'maj', 'Big Lift', '6'],
        [3, 'maj', 'Bright Major', '3'],
        [10, 'maj', 'Rock Drive', '7'],
        [5, 'min', 'Minor Lift', '4m'],
        [7, 'min', 'Turnaround', '5m']
      ];

  return chordSpecs.map(([offset, quality, role, numberLabel]) => {
    const chordRootPc = (rootPc + offset) % 12;
    const chordRootName = getNoteName(chordRootPc, flatSpelling);
    const thirdOffset = quality === 'min' ? 3 : 4;
    const fifthOffset = 7;

    let baseMidi = 48 + chordRootPc;
    if (baseMidi < 52) {
      baseMidi += 12;
    }
    if (baseMidi + fifthOffset > 72) {
      baseMidi -= 12;
    }

    const midiNotes = [baseMidi, baseMidi + thirdOffset, baseMidi + fifthOffset];
    const bassMidi = baseMidi - 12;
    const noteNames = midiNotes.map((m) => getNoteName(m % 12, flatSpelling));

    return {
      symbol: quality === 'min' ? `${chordRootName}m` : chordRootName,
      fullName: `${chordRootName} ${quality === 'min' ? 'Minor' : 'Major'}`,
      quality,
      role,
      numberLabel,
      rootPc: chordRootPc,
      midiNotes,
      bassMidi,
      noteNames
    };
  });
}

function pearsonCorrelation(x, y) {
  const n = 12;
  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i++) {
    sumX += x[i];
    sumY += y[i];
  }
  const meanX = sumX / n;
  const meanY = sumY / n;

  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const denom = Math.sqrt(denX * denY);
  return denom < 1e-9 ? 0 : num / denom;
}

/**
 * Classifies a 250ms musical slice:
 * - Only assigns 'maj' or 'min' triad quality if the 3rd is genuinely audible
 *   (prevents single-note bass riffs & rock power chords from falsely voting Major!).
 * - Otherwise returns { kind: 'root', root, clarity } for single-note / power-chord riffs.
 */
export function matchSliceChord(sliceChroma) {
  let total = 0;
  for (let i = 0; i < 12; i++) total += sliceChroma[i];
  if (total <= 1e-6) return null;

  const norm = sliceChroma.map((v) => v / total);

  let maxPc = 0;
  for (let i = 1; i < 12; i++) {
    if (norm[i] > norm[maxPc]) maxPc = i;
  }
  const maj3OfMax = norm[(maxPc + 4) % 12];
  const min3OfMax = norm[(maxPc + 3) % 12];
  const fifthOfMax = norm[(maxPc + 7) % 12];

  if (
    norm[maxPc] + fifthOfMax >= 0.65 &&
    maj3OfMax < Math.max(0.065, norm[maxPc] * 0.15) &&
    min3OfMax < Math.max(0.065, norm[maxPc] * 0.15)
  ) {
    return {
      kind: 'root',
      root: maxPc,
      quality: null,
      clarity: norm[maxPc] + fifthOfMax * 0.5
    };
  }

  let best = null;
  for (let root = 0; root < 12; root++) {
    const majThird = norm[(root + 4) % 12];
    const minThird = norm[(root + 3) % 12];
    const fifth = norm[(root + 7) % 12];

    for (const quality of ['maj', 'min']) {
      const thirdVal = quality === 'min' ? minThird : majThird;
      const oppThirdVal = quality === 'min' ? majThird : minThird;
      if (thirdVal < Math.max(0.065, norm[root] * 0.15)) continue;

      const inChordSum = norm[root] * 1.14 + thirdVal * 1.02 + fifth * 0.78;
      const rawTriadEnergy = norm[root] + thirdVal + fifth;
      const outPenalty = (1 - rawTriadEnergy) * 0.36 + oppThirdVal * 0.25;
      const score = inChordSum - outPenalty;

      if (!best || score > best.score) {
        best = { kind: 'triad', root, quality, score, clarity: rawTriadEnergy };
      }
    }
  }

  if (best && best.clarity >= 0.42) return best;

  if (norm[maxPc] >= 0.35) {
    return { kind: 'root', root: maxPc, quality: null, clarity: norm[maxPc] };
  }
  return null;
}

function scoreChordFamilyFit(chordHistogram, rootPulseHist, root, mode) {
  let totalVotes = 0;
  for (let i = 0; i < 24; i++) totalVotes += chordHistogram[i];

  let rootPulseTotal = 0;
  for (let i = 0; i < 12; i++) rootPulseTotal += rootPulseHist[i];

  let triadScore = 0;
  if (totalVotes > 1e-6) {
    const w = (offset, qual) => {
      const pc = (root + offset) % 12;
      const idx = qual === 'min' ? 12 + pc : pc;
      return chordHistogram[idx] / totalVotes;
    };

    if (mode === 'major') {
      // Core 4-chord sum: 1.34 + 1.14 + 1.14 + 1.00 = 4.62
      const vShare = w(7, 'maj');
      const viShare = w(9, 'min');
      const iiShare = w(2, 'min');
      const ivShare = w(5, 'maj');
      const iShare = w(0, 'maj');

      // Detect i - bIII - bVII minor loops (like Am - C - G in Blown Away) masquerading as ii - IV - I in Major
      // when Major's own V and vi chords never appear at all!
      const missingDomAndRelPenalty =
        iiShare >= 0.16 && ivShare >= 0.14 && iShare >= 0.18 && vShare < 0.05 && viShare < 0.05
          ? 0.52
          : 0;

      triadScore =
        iShare * 1.34 +  // I
        ivShare * 1.14 + // IV
        vShare * 1.14 +  // V
        viShare * 1.00 + // vi
        iiShare * 0.76 + // ii
        w(4, 'min') * 0.74 + // iii
        w(10, 'maj') * 0.28 - // bVII
        missingDomAndRelPenalty;
    } else {
      // Core 4-chord sum: 1.38 + 1.10 + 1.08 + 1.06 = 4.62 (exact parity with Major)
      const iShare = w(0, 'min');
      const bVIShare = w(8, 'maj');
      const bIIIShare = w(3, 'maj');
      const bVIIShare = w(10, 'maj');
      const domMajShare = w(7, 'maj');
      const harmonicCadenceBonus = (iShare >= 0.08 && domMajShare >= 0.08)
        ? Math.min(iShare, domMajShare) * 0.85
        : 0;
      // Classic 3-chord modern country/rock minor loop: i - bIII - bVII (e.g. Am - C - G in Blown Away, without IV/bVI)
      const aeolianTripletBonus = (iShare >= 0.16 && bIIIShare >= 0.14 && bVIIShare >= 0.18 && bVIShare < 0.08)
        ? 0.36
        : 0;

      triadScore =
        iShare * 1.38 +       // i
        bVIShare * 1.10 +     // bVI
        bVIIShare * 1.10 +    // bVII
        bIIIShare * 1.06 +    // bIII
        w(7, 'min') * 1.08 +  // v (Dominant minor vamp, e.g. Am <-> Em in Losing My Religion)
        w(5, 'min') * 0.94 +  // iv
        domMajShare * 1.12 +  // V (Harmonic minor turnaround, e.g. F# in Hotel California)
        w(5, 'maj') * 0.55 +  // IV (Dorian borrow)
        harmonicCadenceBonus +
        aeolianTripletBonus;
    }
  }

  let riffScore = 0;
  if (rootPulseTotal > 1e-6) {
    const rp = (offset) => rootPulseHist[(root + offset) % 12] / rootPulseTotal;
    if (mode === 'major') {
      riffScore = rp(0) * 1.30 + rp(7) * 0.95 + rp(5) * 0.90 + rp(9) * 0.75 + rp(2) * 0.70 + rp(4) * 0.70;
    } else {
      riffScore = rp(0) * 1.38 + rp(3) * 1.05 + rp(10) * 0.95 + rp(7) * 0.95 + rp(8) * 0.80 + rp(2) * 0.70;
    }
  }

  if (totalVotes > 1e-6 && rootPulseTotal > 1e-6) {
    const triadRatio = totalVotes / (totalVotes + rootPulseTotal);
    return triadScore * triadRatio + riffScore * (1 - triadRatio);
  }
  return totalVotes > 1e-6 ? triadScore : riffScore;
}

/**
 * Scores real chord-to-chord resolutions ("cadences") in the song's progression!
 * Example:
 * - Blown Away plays Am -> C -> G -> Am: G resolves to Am (bVII -> i), while C never gets V->I or IV->I!
 * - Let It Be plays C -> G -> Am -> F -> C: F resolves to C (IV -> I)!
 * - Wagon Wheel plays A -> E -> F#m -> D -> A: D resolves to A (IV -> I)!
 */
function scoreCadenceResolutions(chordSequence, root, mode) {
  if (chordSequence.length < 2) return 0;
  const totalTransitions = chordSequence.length - 1;
  let cadenceHits = 0;

  for (let i = 0; i < totalTransitions; i++) {
    const prev = chordSequence[i];
    const next = chordSequence[i + 1];

    if (mode === 'major') {
      // Resolves into Major tonic I (root, 'maj')
      if (next.root === root && next.quality === 'maj') {
        if (prev.root === (root + 7) % 12 && prev.quality === 'maj') cadenceHits += 1.25; // V -> I
        else if (prev.root === (root + 5) % 12 && prev.quality === 'maj') cadenceHits += 1.15; // IV -> I
        else if (prev.root === (root + 10) % 12 && prev.quality === 'maj') cadenceHits += 0.65; // bVII -> I
      }
    } else {
      // Resolves into Minor tonic i (root, 'min')
      if (next.root === root && next.quality === 'min') {
        if (prev.root === (root + 7) % 12 && prev.quality === 'maj') cadenceHits += 1.35; // V -> i (Hotel California)
        else if (prev.root === (root + 10) % 12 && prev.quality === 'maj') cadenceHits += 1.15; // bVII -> i (Blown Away, Jolene)
        else if (prev.root === (root + 7) % 12 && prev.quality === 'min') cadenceHits += 1.15; // v -> i (Losing My Religion)
        else if (prev.root === (root + 8) % 12 && prev.quality === 'maj') cadenceHits += 0.90; // bVI -> i
        else if (prev.root === (root + 5) % 12 && prev.quality === 'min') cadenceHits += 0.80; // iv -> i
      }
    }
  }

  // Bonus if the very first chord heard in the phrase is this tonic chord
  const first = chordSequence[0];
  const startsOnTonic =
    first.root === root &&
    ((mode === 'major' && first.quality === 'maj') || (mode === 'minor' && first.quality === 'min'))
      ? 0.18
      : 0;

  return Math.min(0.65, cadenceHits / totalTransitions) + startsOnTonic;
}

export function detectKeyFromChroma(chroma, bassChroma, windowChromas = []) {
  const totalEnergy = chroma.reduce((a, b) => a + b, 0);
  if (totalEnergy <= 1e-6) {
    return null;
  }

  const rawNorm = chroma.map((v) => v / totalEnergy);
  const unmixed = new Array(12);
  let unmixedSum = 0;
  for (let pc = 0; pc < 12; pc++) {
    const fifthBelow = (pc + 5) % 12;
    const val = Math.max(0, rawNorm[pc] - 0.15 * rawNorm[fifthBelow]);
    unmixed[pc] = val;
    unmixedSum += val;
  }
  const pureChroma = unmixedSum > 1e-6 ? unmixed.map((v) => v / unmixedSum) : rawNorm;

  const chordHistogram = new Float64Array(24);
  const rootPulseHist = new Float64Array(12);
  const chordRootDist = new Float64Array(12);
  const rawTriadFrames = [];

  for (const slice of windowChromas) {
    const match = matchSliceChord(slice);
    if (!match) continue;
    chordRootDist[match.root] += match.clarity;
    if (match.kind === 'triad') {
      const idx = match.quality === 'min' ? 12 + match.root : match.root;
      chordHistogram[idx] += match.clarity;
      rawTriadFrames.push({ root: match.root, quality: match.quality });
    } else {
      rootPulseHist[match.root] += match.clarity;
    }
  }

  // Build smoothed chord change sequence (require >= 2 consecutive slices or single isolated bar to suppress 1-frame blips)
  const chordSequence = [];
  let runChord = null;
  let runLen = 0;
  for (const f of rawTriadFrames) {
    if (runChord && runChord.root === f.root && runChord.quality === f.quality) {
      runLen++;
    } else {
      if (runChord && runLen >= 2) {
        const prevCommitted = chordSequence[chordSequence.length - 1];
        if (!prevCommitted || prevCommitted.root !== runChord.root || prevCommitted.quality !== runChord.quality) {
          chordSequence.push(runChord);
        }
      }
      runChord = f;
      runLen = 1;
    }
  }
  if (runChord && runLen >= 2) {
    const prevCommitted = chordSequence[chordSequence.length - 1];
    if (!prevCommitted || prevCommitted.root !== runChord.root || prevCommitted.quality !== runChord.quality) {
      chordSequence.push(runChord);
    }
  }
  // Wrap loop transition if >= 3 distinct chords were heard and start != end (songs loop!)
  const loopedSequence =
    chordSequence.length >= 3 &&
    (chordSequence[0].root !== chordSequence[chordSequence.length - 1].root ||
      chordSequence[0].quality !== chordSequence[chordSequence.length - 1].quality)
      ? [...chordSequence, chordSequence[0]]
      : chordSequence;

  if (windowChromas.length === 0) {
    const single = matchSliceChord(pureChroma);
    if (single) {
      chordRootDist[single.root] = 1;
      if (single.kind === 'triad') {
        const idx = single.quality === 'min' ? 12 + single.root : single.root;
        chordHistogram[idx] = 1;
      } else {
        rootPulseHist[single.root] = 1;
      }
    }
  }

  // Blend 58% pitch chroma + 42% chord-root distribution so shared chord tones
  // (like E inside both Am and Em, or C inside Am, F, and C) don't unfairly double-count!
  let crTotal = 0;
  for (let i = 0; i < 12; i++) crTotal += chordRootDist[i];
  const normChroma = crTotal > 1e-6
    ? pureChroma.map((v, i) => v * 0.58 + (chordRootDist[i] / crTotal) * 0.42)
    : pureChroma;

  const bassTotal = bassChroma.reduce((a, b) => a + b, 0);
  const rawBass = bassTotal > 1e-6
    ? bassChroma.map((v) => v / bassTotal)
    : normChroma;
  // Blend acoustic bass with detected chord roots so tiny speakers rolling off 55-110 Hz still anchor accurately
  const normBass = crTotal > 1e-6
    ? rawBass.map((v, i) => v * 0.55 + (chordRootDist[i] / crTotal) * 0.45)
    : rawBass;

  let totalTriadVotes = 0;
  for (let i = 0; i < 24; i++) totalTriadVotes += chordHistogram[i];

  const candidates = [];

  for (let root = 0; root < 12; root++) {
    const shiftedChroma = new Array(12);
    for (let i = 0; i < 12; i++) {
      shiftedChroma[i] = normChroma[(root + i) % 12];
    }

    let majInScale = 0;
    for (const step of MAJOR_SCALE_INTERVALS) {
      majInScale += pureChroma[(root + step) % 12];
    }

    let minInScale = 0;
    for (const step of MINOR_SCALE_INTERVALS) {
      minInScale += pureChroma[(root + step) % 12];
    }
    minInScale = Math.min(
      1.0,
      minInScale +
        pureChroma[(root + 11) % 12] * 0.72 +
        pureChroma[(root + 9) % 12] * 0.28
    );

    const majCorr = pearsonCorrelation(shiftedChroma, POP_MAJOR_PROFILE);
    const minCorr = pearsonCorrelation(shiftedChroma, POP_MINOR_PROFILE);

    const majChordFit = scoreChordFamilyFit(chordHistogram, rootPulseHist, root, 'major');
    const minChordFit = scoreChordFamilyFit(chordHistogram, rootPulseHist, root, 'minor');

    const majCadence = scoreCadenceResolutions(loopedSequence, root, 'major');
    const minCadence = scoreCadenceResolutions(loopedSequence, root, 'minor');

    const majHomeChord = totalTriadVotes > 1e-6 ? chordHistogram[root] / totalTriadVotes : 0;
    const minHomeChord = totalTriadVotes > 1e-6 ? chordHistogram[12 + root] / totalTriadVotes : 0;

    const bassAnchor = normBass[root] * 0.30 + normBass[(root + 7) % 12] * 0.04;

    const majScore =
      majCorr * 0.36 +
      majInScale * 0.30 +
      majChordFit * 0.30 +
      majCadence * 0.22 +
      majHomeChord * 0.14 +
      bassAnchor;

    const minScore =
      minCorr * 0.36 +
      minInScale * 0.30 +
      minChordFit * 0.30 +
      minCadence * 0.22 +
      minHomeChord * 0.14 +
      bassAnchor;

    candidates.push({
      rootPc: root,
      mode: 'major',
      score: majScore,
      rawCorrelation: majCorr
    });

    candidates.push({
      rootPc: root,
      mode: 'minor',
      score: minScore,
      rawCorrelation: minCorr
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  const winner = candidates[0];

  const relativePc = winner.mode === 'minor' ? (winner.rootPc + 3) % 12 : (winner.rootPc + 9) % 12;
  const relativeMode = winner.mode === 'minor' ? 'major' : 'minor';
  const runnerUp = candidates.find(
    (c) => !(c.rootPc === winner.rootPc && c.mode === winner.mode) &&
           !(c.rootPc === relativePc && c.mode === relativeMode)
  ) || candidates[1];

  const margin = Math.max(0, winner.score - runnerUp.score);
  const rawConf = Math.round(
    Math.min(98, Math.max(54, (winner.rawCorrelation * 55 + 34) + margin * 145))
  );

  let confidenceLabel = 'Solid Match';
  if (rawConf >= 84) confidenceLabel = 'Strong Lock';
  else if (rawConf < 68) confidenceLabel = 'Close Call';

  return {
    key: getKeyDetails(winner.rootPc, winner.mode),
    confidence: rawConf,
    confidenceLabel,
    runnerUpKey: getKeyDetails(runnerUp.rootPc, runnerUp.mode)
  };
}

export function getAllKeysList() {
  const list = [];
  for (let pc = 0; pc < 12; pc++) {
    list.push(getKeyDetails(pc, 'major'));
  }
  for (let pc = 0; pc < 12; pc++) {
    list.push(getKeyDetails(pc, 'minor'));
  }
  return list;
}
