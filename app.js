// JamSpy - Main Screen Controller (Live Key Finder, Chords Heard, Solo Piano Sheet Music & Saved Songs)

import {
  getKeyDetails,
  getAllKeysList,
  getNoteName,
  isBlackKey
} from './music-theory.js?v=8';
import { AudioEngine } from './audio-engine.js?v=8';
import {
  buildPianoSketchFromScan,
  buildDefaultSketchForKey,
  renderSheetMusicSVG
} from './sheet-music.js?v=8';

const audio = new AudioEngine();
const STORAGE_KEY = 'jamspy_saved_songs_v1';

// App State
let currentKey = getKeyDetails(7, 'major'); // Default preview: G Major
let currentSketch = buildDefaultSketchForKey(currentKey);
let activeMeasureHighlight = -1;
let selectedChordIndex = null;
let selectedHeardIndex = null;
let keySourceMode = 'preview'; // 'preview' | 'live' | 'saved'
let loadedSavedSongId = null;
let loadedSavedSongTitle = null;
let activeScaleStepMidi = null;
let pendingDeleteId = null;
let pendingDeleteTimer = null;
let savedSongs = loadSavedSongsFromStorage();

// DOM Elements
const manualKeySelect = document.getElementById('manualKeySelect');
const listenBtn = document.getElementById('listenBtn');
const listenBtnLabel = document.getElementById('listenBtnLabel');
const listenBtnSub = document.getElementById('listenBtnSub');
const progressRingFill = document.getElementById('progressRingFill');
const soundMeter = document.getElementById('soundMeter');
const meterBars = Array.from(soundMeter.querySelectorAll('.meter-bar'));
const statusText = document.getElementById('statusText');
const finishEarlyBtn = document.getElementById('finishEarlyBtn');

const keySourceBadge = document.getElementById('keySourceBadge');
const confidenceBadge = document.getElementById('confidenceBadge');
const keyNameDisplay = document.getElementById('keyNameDisplay');
const scaleNotesDisplay = document.getElementById('scaleNotesDisplay');
const playScaleBtn = document.getElementById('playScaleBtn');
const cousinKeyBtn = document.getElementById('cousinKeyBtn');

const saveSongForm = document.getElementById('saveSongForm');
const saveSongInput = document.getElementById('saveSongInput');
const saveSongBtn = document.getElementById('saveSongBtn');

const pianoKeyboard = document.getElementById('pianoKeyboard');
const pianoLegendText = document.getElementById('pianoLegendText');
const clearChordBtn = document.getElementById('clearChordBtn');

const chordsGrid = document.getElementById('chordsGrid');
const chordDetailBanner = document.getElementById('chordDetailBanner');
const chordDetailTitle = document.getElementById('chordDetailTitle');
const chordDetailNotes = document.getElementById('chordDetailNotes');

const heardModeBadge = document.getElementById('heardModeBadge');
const chordsHeardFlow = document.getElementById('chordsHeardFlow');

const playSketchBtn = document.getElementById('playSketchBtn');
const playSketchIcon = document.getElementById('playSketchIcon');
const playSketchLabel = document.getElementById('playSketchLabel');
const printSketchBtn = document.getElementById('printSketchBtn');
const sheetPaperTitle = document.getElementById('sheetPaperTitle');
const sheetPaperMeta = document.getElementById('sheetPaperMeta');
const sheetMusicCanvas = document.getElementById('sheetMusicCanvas');

const savedCountBadge = document.getElementById('savedCountBadge');
const savedEmptyState = document.getElementById('savedEmptyState');
const savedSongsList = document.getElementById('savedSongsList');
const appRefreshBtn = document.getElementById('appRefreshBtn');

const RING_CIRCUMFERENCE = 2 * Math.PI * 68;

const START_MIDI = 48;
const END_MIDI = 72;
const keyElementsByMidi = new Map();

function loadSavedSongsFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function persistSavedSongs() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(savedSongs));
  } catch (_) {
    // Ignore private-browsing quota errors gracefully
  }
}

function formatSavedTimestamp(ts) {
  try {
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
      ' · ' +
      d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  } catch (_) {
    return '';
  }
}

function buildAutoTitle() {
  const now = new Date();
  return 'Spied Song · ' + now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function setSketchPlayButtonState(playing) {
  if (playing) {
    playSketchBtn.classList.add('is-playing');
    playSketchLabel.textContent = 'Stop';
    playSketchIcon.innerHTML = '<rect x="6" y="6" width="12" height="12" rx="1.5" />';
  } else {
    playSketchBtn.classList.remove('is-playing');
    playSketchLabel.textContent = 'Play Sketch';
    playSketchIcon.innerHTML = '<path d="M8 5.14v14l11-7-11-7z" />';
  }
}

function initManualPicker() {
  const allKeys = getAllKeysList();
  manualKeySelect.innerHTML = '';

  const majorGroup = document.createElement('optgroup');
  majorGroup.label = 'Major Keys';
  const minorGroup = document.createElement('optgroup');
  minorGroup.label = 'Minor Keys';

  allKeys.forEach((k) => {
    const opt = document.createElement('option');
    opt.value = `${k.rootPc}:${k.mode}`;
    opt.textContent = k.name;
    if (k.mode === 'major') majorGroup.appendChild(opt);
    else minorGroup.appendChild(opt);
  });

  manualKeySelect.appendChild(majorGroup);
  manualKeySelect.appendChild(minorGroup);
  manualKeySelect.value = `${currentKey.rootPc}:${currentKey.mode}`;

  manualKeySelect.addEventListener('change', () => {
    audio.stopSketchPlayback();
    const [pcStr, mode] = manualKeySelect.value.split(':');
    selectedChordIndex = null;
    selectedHeardIndex = null;
    keySourceMode = 'preview';
    loadedSavedSongId = null;
    loadedSavedSongTitle = null;
    currentKey = getKeyDetails(Number(pcStr), mode);
    currentSketch = buildDefaultSketchForKey(currentKey);
    confidenceBadge.classList.add('hidden');
    renderAll();
    audio.playChord(currentKey.chords[0].midiNotes, currentKey.chords[0].bassMidi);
  });
}

function buildPianoDOM() {
  pianoKeyboard.innerHTML = '';
  keyElementsByMidi.clear();

  const whiteMidis = [];
  for (let m = START_MIDI; m <= END_MIDI; m++) {
    if (!isBlackKey(m % 12)) whiteMidis.push(m);
  }
  const totalWhite = whiteMidis.length;

  let whiteIndex = -1;
  for (let midi = START_MIDI; midi <= END_MIDI; midi++) {
    const pc = midi % 12;
    const black = isBlackKey(pc);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.midi = String(midi);

    const label = document.createElement('span');
    label.className = 'key-note-label';
    btn.appendChild(label);

    if (!black) {
      whiteIndex++;
      btn.className = 'piano-key-white';
    } else {
      btn.className = 'piano-key-black';
      const seamPercent = ((whiteIndex + 1) / totalWhite) * 100;
      btn.style.left = `calc(${seamPercent}% - 2.25%)`;
    }

    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      triggerPianoKeyTap(midi);
    });

    pianoKeyboard.appendChild(btn);
    keyElementsByMidi.set(midi, { el: btn, labelEl: label, pc, black });
  }
}

function triggerPianoKeyTap(midi) {
  audio.playPianoNote(midi, 1.05, 0.8);
  const entry = keyElementsByMidi.get(midi);
  if (!entry) return;
  entry.el.classList.add('is-playing');
  setTimeout(() => entry.el.classList.remove('is-playing'), 180);
}

function flashChordKeys(midiNotes) {
  midiNotes.forEach((m) => {
    // Fold bass/high playback note into visible keyboard octave if needed for visual flash
    let visMidi = m;
    while (visMidi < START_MIDI) visMidi += 12;
    while (visMidi > END_MIDI) visMidi -= 12;
    const entry = keyElementsByMidi.get(visMidi);
    if (!entry) return;
    entry.el.classList.add('is-playing');
    setTimeout(() => entry.el.classList.remove('is-playing'), 220);
  });
}

function buildTriadObjectForRoot(rootPc, quality) {
  const flatSpelling = currentKey.useFlats;
  const rootName = getNoteName(rootPc, flatSpelling);
  const thirdOffset = quality === 'min' ? 3 : 4;
  let baseMidi = 48 + rootPc;
  if (baseMidi < 52) baseMidi += 12;
  if (baseMidi + 7 > 72) baseMidi -= 12;
  const midiNotes = [baseMidi, baseMidi + thirdOffset, baseMidi + 7];
  return {
    symbol: quality === 'min' ? `${rootName}m` : rootName,
    fullName: `${rootName} ${quality === 'min' ? 'Minor' : 'Major'}`,
    midiNotes,
    bassMidi: baseMidi - 12,
    noteNames: midiNotes.map((m) => getNoteName(m % 12, flatSpelling))
  };
}

function getActiveSelectedChord() {
  if (selectedChordIndex !== null) {
    return currentKey.chords[selectedChordIndex];
  }
  if (selectedHeardIndex !== null && currentSketch.chordsHeard[selectedHeardIndex]) {
    const hc = currentSketch.chordsHeard[selectedHeardIndex];
    return buildTriadObjectForRoot(hc.rootPc, hc.quality);
  }
  return null;
}

function renderPianoHighlights() {
  const scaleSet = new Set(currentKey.scalePitchClasses);
  const activeChord = getActiveSelectedChord();
  const chordMidiSet = activeChord ? new Set(activeChord.midiNotes) : null;

  keyElementsByMidi.forEach(({ el, labelEl, pc, black }, midi) => {
    const noteName = getNoteName(pc, currentKey.useFlats);
    const inScale = scaleSet.has(pc);
    const isRoot = pc === currentKey.rootPc;
    const inChord = chordMidiSet ? chordMidiSet.has(midi) : false;

    el.classList.remove('in-scale', 'is-root', 'dimmed-scale', 'in-chord', 'is-playing');

    if (activeChord) {
      if (inChord) {
        el.classList.add('in-chord');
      } else if (inScale) {
        el.classList.add('dimmed-scale');
      }
    } else {
      if (isRoot) el.classList.add('is-root');
      else if (inScale) el.classList.add('in-scale');
    }

    if (activeScaleStepMidi === midi) {
      el.classList.add('in-chord');
    }

    if (inChord || inScale || (!black && pc === 0)) {
      labelEl.textContent = noteName;
    } else {
      labelEl.textContent = '';
    }
  });

  if (activeChord) {
    pianoLegendText.textContent = `Showing ${activeChord.fullName} fingers in teal · Tap any key to play`;
    clearChordBtn.classList.remove('hidden');
  } else {
    pianoLegendText.textContent = 'Lit gold keys are in key · Tap any key to hear it';
    clearChordBtn.classList.add('hidden');
  }
}

function renderChordsGrid() {
  chordsGrid.innerHTML = '';

  currentKey.chords.forEach((chord, idx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chord-btn' + (selectedChordIndex === idx ? ' is-selected' : '');

    const symbolSpan = document.createElement('span');
    symbolSpan.className = 'chord-symbol';
    symbolSpan.textContent = chord.symbol;

    const roleSpan = document.createElement('span');
    roleSpan.className = 'chord-role';
    roleSpan.textContent = chord.role;

    btn.appendChild(symbolSpan);
    btn.appendChild(roleSpan);

    btn.addEventListener('click', () => {
      selectedHeardIndex = null;
      selectedChordIndex = idx;
      renderAll();
      audio.playChord(chord.midiNotes, chord.bassMidi);
      flashChordKeys(chord.midiNotes);
    });

    chordsGrid.appendChild(btn);
  });

  const activeChord = getActiveSelectedChord();
  if (activeChord) {
    chordDetailBanner.classList.remove('hidden');
    chordDetailTitle.textContent = `${activeChord.fullName}:`;
    chordDetailNotes.textContent = `Press ${activeChord.noteNames.join(' – ')}`;
  } else {
    chordDetailBanner.classList.add('hidden');
  }
}

function renderChordsHeardAndSheet() {
  const heardList = currentSketch.chordsHeard || [];
  chordsHeardFlow.innerHTML = '';

  if (currentSketch.isLiveSketch) {
    heardModeBadge.textContent = 'Heard in Song';
    heardModeBadge.className = 'badge badge-live';
  } else {
    heardModeBadge.textContent = 'Common Key Loop';
    heardModeBadge.className = 'badge badge-preview';
  }

  heardList.forEach((hc, idx) => {
    if (idx > 0) {
      const arrow = document.createElement('span');
      arrow.className = 'heard-arrow';
      arrow.textContent = '→';
      arrow.setAttribute('aria-hidden', 'true');
      chordsHeardFlow.appendChild(arrow);
    }

    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'heard-chord-pill' + (selectedHeardIndex === idx ? ' is-selected' : '');
    pill.textContent = hc.symbol;

    pill.addEventListener('click', () => {
      // Check if this chord matches one of the 6 main jam chords so both stay in sync
      const mainIdx = currentKey.chords.findIndex((c) => c.symbol === hc.symbol);
      if (mainIdx >= 0) {
        selectedChordIndex = mainIdx;
        selectedHeardIndex = idx;
      } else {
        selectedChordIndex = null;
        selectedHeardIndex = idx;
      }
      const triad = buildTriadObjectForRoot(hc.rootPc, hc.quality);
      renderAll();
      audio.playChord(triad.midiNotes, triad.bassMidi);
      flashChordKeys(triad.midiNotes);
    });

    chordsHeardFlow.appendChild(pill);
  });

  // Update Warm Ivory Music Paper Header & Grand-Staff SVG
  const titleLabel = loadedSavedSongTitle
    ? loadedSavedSongTitle
    : currentSketch.isLiveSketch
      ? `Spied Song in ${currentKey.name}`
      : `${currentKey.name} Solo Piano Sketch`;

  const loopSymbols = heardList.map((c) => c.symbol).join(' – ');
  sheetPaperTitle.textContent = titleLabel;
  sheetPaperMeta.textContent = `Key of ${currentKey.name} · Chords: ${loopSymbols}`;

  renderSheetMusicSVG(sheetMusicCanvas, currentSketch, currentKey, activeMeasureHighlight);
}

function updateActiveMeasureHighlightOnly(measureIdx) {
  activeMeasureHighlight = measureIdx;
  const rects = sheetMusicCanvas.querySelectorAll('.sheet-measure-hl');
  rects.forEach((r) => {
    const idx = Number(r.dataset.measure);
    r.classList.toggle('is-active', idx === measureIdx);
  });
}

function renderKeyCard() {
  keyNameDisplay.textContent = currentKey.name;
  scaleNotesDisplay.textContent = `Notes: ${currentKey.scaleNoteNames.join(' · ')}`;
  cousinKeyBtn.textContent = `Switch to ${currentKey.relativeKey.name} ⇄`;
  manualKeySelect.value = `${currentKey.rootPc}:${currentKey.mode}`;

  if (keySourceMode === 'live') {
    keySourceBadge.textContent = 'Spied from Audio';
    keySourceBadge.className = 'badge badge-live';
  } else if (keySourceMode === 'saved' && loadedSavedSongTitle) {
    keySourceBadge.textContent = `Saved: ${loadedSavedSongTitle}`;
    keySourceBadge.className = 'badge badge-live';
  } else {
    keySourceBadge.textContent = 'Key Guide';
    keySourceBadge.className = 'badge badge-preview';
  }
}

function renderSavedSongs() {
  const count = savedSongs.length;
  savedCountBadge.textContent = `${count} saved`;

  if (count === 0) {
    savedEmptyState.classList.remove('hidden');
    savedSongsList.classList.add('hidden');
    savedSongsList.innerHTML = '';
    return;
  }

  savedEmptyState.classList.add('hidden');
  savedSongsList.classList.remove('hidden');
  savedSongsList.innerHTML = '';

  savedSongs.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'saved-row' + (loadedSavedSongId === item.id ? ' is-active' : '');

    const mainBtn = document.createElement('button');
    mainBtn.type = 'button';
    mainBtn.className = 'saved-row-main';
    mainBtn.title = `Load ${item.title} (${item.keyName})`;

    const infoDiv = document.createElement('div');
    infoDiv.className = 'saved-song-info';

    const titleSpan = document.createElement('span');
    titleSpan.className = 'saved-song-title';
    titleSpan.textContent = item.title;

    const chordSummary = item.sketch && item.sketch.chordsHeard
      ? ' · ' + item.sketch.chordsHeard.map((c) => c.symbol).join('–')
      : '';
    const metaSpan = document.createElement('span');
    metaSpan.className = 'saved-song-meta';
    metaSpan.textContent = formatSavedTimestamp(item.savedAt) + chordSummary;

    infoDiv.appendChild(titleSpan);
    infoDiv.appendChild(metaSpan);

    const keyPill = document.createElement('span');
    keyPill.className = 'saved-key-pill';
    keyPill.textContent = item.keyName;

    mainBtn.appendChild(infoDiv);
    mainBtn.appendChild(keyPill);

    mainBtn.addEventListener('click', () => {
      audio.stopSketchPlayback();
      currentKey = getKeyDetails(item.rootPc, item.mode);
      currentSketch = item.sketch || buildDefaultSketchForKey(currentKey);
      selectedChordIndex = null;
      selectedHeardIndex = null;
      keySourceMode = 'saved';
      loadedSavedSongId = item.id;
      loadedSavedSongTitle = item.title;
      confidenceBadge.classList.add('hidden');
      renderAll();
      audio.playChord(currentKey.chords[0].midiNotes, currentKey.chords[0].bassMidi);
    });

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    const isConfirming = pendingDeleteId === item.id;
    delBtn.className = 'saved-delete-btn' + (isConfirming ? ' confirm-delete' : '');
    delBtn.textContent = isConfirming ? 'Delete?' : '✕';
    delBtn.setAttribute('aria-label', isConfirming ? `Confirm delete ${item.title}` : `Delete ${item.title}`);

    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (pendingDeleteId === item.id) {
        clearTimeout(pendingDeleteTimer);
        pendingDeleteId = null;
        savedSongs = savedSongs.filter((s) => s.id !== item.id);
        if (loadedSavedSongId === item.id) {
          loadedSavedSongId = null;
          loadedSavedSongTitle = null;
          keySourceMode = 'preview';
        }
        persistSavedSongs();
        renderAll();
      } else {
        pendingDeleteId = item.id;
        clearTimeout(pendingDeleteTimer);
        pendingDeleteTimer = setTimeout(() => {
          pendingDeleteId = null;
          renderSavedSongs();
        }, 3500);
        renderSavedSongs();
      }
    });

    row.appendChild(mainBtn);
    row.appendChild(delBtn);
    savedSongsList.appendChild(row);
  });
}

function renderAll() {
  renderKeyCard();
  renderPianoHighlights();
  renderChordsGrid();
  renderChordsHeardAndSheet();
  renderSavedSongs();
}

function handleSaveSong(e) {
  e.preventDefault();
  const typed = saveSongInput.value.trim();
  const title = typed || buildAutoTitle();

  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    title,
    rootPc: currentKey.rootPc,
    mode: currentKey.mode,
    keyName: currentKey.name,
    sketch: currentSketch,
    savedAt: Date.now()
  };

  savedSongs.unshift(entry);
  persistSavedSongs();

  loadedSavedSongId = entry.id;
  loadedSavedSongTitle = entry.title;
  keySourceMode = 'saved';
  saveSongInput.value = '';
  saveSongInput.blur();

  saveSongBtn.textContent = 'Saved ✓';
  saveSongBtn.classList.add('is-saved');
  setTimeout(() => {
    saveSongBtn.textContent = 'Save';
    saveSongBtn.classList.remove('is-saved');
  }, 1400);

  renderAll();
}

// Listening UI Helpers
function setRingProgress(progress) {
  const offset = RING_CIRCUMFERENCE * (1 - Math.max(0, Math.min(1, progress)));
  progressRingFill.style.strokeDashoffset = String(offset);
}

function updateSoundMeter(level, active) {
  if (!active) {
    soundMeter.classList.remove('active');
    meterBars.forEach((bar) => { bar.style.height = '4px'; });
    return;
  }
  soundMeter.classList.add('active');
  const weights = [0.45, 0.75, 0.95, 1.0, 0.9, 0.7, 0.45];
  meterBars.forEach((bar, i) => {
    const jitter = 0.85 + Math.random() * 0.3;
    const h = Math.max(4, Math.min(16, Math.round(4 + level * 13 * weights[i] * jitter)));
    bar.style.height = `${h}px`;
  });
}

function handleListeningResult({ tooQuiet, result, windowChromas, windowMelodies }) {
  listenBtn.classList.remove('is-listening');
  listenBtnLabel.textContent = 'Listen Again';
  listenBtnSub.textContent = '12 sec room scan';
  finishEarlyBtn.classList.add('hidden');
  setRingProgress(0);
  updateSoundMeter(0, false);

  if (tooQuiet || !result) {
    statusText.textContent = "Couldn't hear clear music—try turning the song up or holding the mic closer.";
    statusText.classList.add('status-warn');
    return;
  }

  statusText.classList.remove('status-warn');
  statusText.innerHTML = `Locked onto <strong>${result.key.name}</strong>! Scroll down to play the <strong>Solo Piano Sketch</strong> or save it.`;

  currentKey = result.key;
  currentSketch = buildPianoSketchFromScan(currentKey, windowChromas, windowMelodies);
  selectedChordIndex = null;
  selectedHeardIndex = null;
  keySourceMode = 'live';
  loadedSavedSongId = null;
  loadedSavedSongTitle = null;

  confidenceBadge.textContent = `${result.confidenceLabel} (${result.confidence}%)`;
  confidenceBadge.classList.remove('hidden');

  renderAll();
}

function toggleListening() {
  audio.stopSketchPlayback();
  if (audio.isListening) {
    audio.stopListening(handleListeningResult);
    return;
  }

  statusText.classList.remove('status-warn');
  statusText.textContent = 'Listening to the room... hold near the music';
  listenBtn.classList.add('is-listening');
  listenBtnLabel.textContent = 'Listening...';
  listenBtnSub.textContent = '12s left';
  setRingProgress(0);

  audio.startListening({
    durationMs: 12000,
    onProgress: ({ progress, remainingSeconds, level, hearingMusic, liveKeyName }) => {
      setRingProgress(progress);
      listenBtnSub.textContent = `${remainingSeconds}s left`;
      updateSoundMeter(level, true);

      if (liveKeyName) {
        statusText.innerHTML = `Hearing music · Leaning toward <strong>${liveKeyName}</strong>...`;
        finishEarlyBtn.classList.remove('hidden');
      } else if (hearingMusic) {
        statusText.textContent = 'Hearing musical notes... locking onto the key';
      } else {
        statusText.textContent = 'Listening... play a song or instrument nearby';
      }
    },
    onComplete: handleListeningResult,
    onError: (err) => {
      listenBtn.classList.remove('is-listening');
      listenBtnLabel.textContent = 'Tap to Listen';
      listenBtnSub.textContent = '12 sec room scan';
      finishEarlyBtn.classList.add('hidden');
      setRingProgress(0);
      updateSoundMeter(0, false);
      statusText.classList.add('status-warn');
      statusText.textContent =
        err && err.name === 'NotAllowedError'
          ? 'Microphone access was blocked—please allow microphone access in your browser bar and try again.'
          : 'Could not reach the microphone. Check your browser microphone permission and try again.';
    }
  });
}

// Wire Buttons
listenBtn.addEventListener('click', toggleListening);

finishEarlyBtn.addEventListener('click', () => {
  if (audio.isListening) {
    audio.stopListening(handleListeningResult);
  }
});

playScaleBtn.addEventListener('click', () => {
  selectedChordIndex = null;
  selectedHeardIndex = null;
  renderAll();
  audio.playScalePreview(currentKey.scalePreviewMidi, (midi) => {
    activeScaleStepMidi = midi;
    renderPianoHighlights();
  });
});

cousinKeyBtn.addEventListener('click', () => {
  audio.stopSketchPlayback();
  const { rootPc, mode } = currentKey.relativeKey;
  currentKey = getKeyDetails(rootPc, mode);
  currentSketch = buildDefaultSketchForKey(currentKey);
  selectedChordIndex = null;
  selectedHeardIndex = null;
  if (loadedSavedSongId) {
    keySourceMode = 'preview';
    loadedSavedSongId = null;
    loadedSavedSongTitle = null;
  }
  renderAll();
  audio.playChord(currentKey.chords[0].midiNotes, currentKey.chords[0].bassMidi);
});

clearChordBtn.addEventListener('click', () => {
  selectedChordIndex = null;
  selectedHeardIndex = null;
  renderAll();
});

playSketchBtn.addEventListener('click', () => {
  if (audio.isPlayingSketch) {
    audio.stopSketchPlayback();
    return;
  }
  setSketchPlayButtonState(true);
  audio.playSketch(currentSketch, {
    onMeasureChange: (mIdx) => {
      updateActiveMeasureHighlightOnly(mIdx);
    },
    onKeyFlash: (midis) => {
      flashChordKeys(midis);
    },
    onFinish: () => {
      setSketchPlayButtonState(false);
      updateActiveMeasureHighlightOnly(-1);
    }
  });
});

printSketchBtn.addEventListener('click', () => {
  audio.stopSketchPlayback();
  window.print();
});

saveSongForm.addEventListener('submit', handleSaveSong);

appRefreshBtn.addEventListener('click', () => {
  const cleanPath = window.location.pathname;
  window.location.replace(`${cleanPath}?r=${Date.now()}`);
});

// Boot App
initManualPicker();
buildPianoDOM();
renderAll();
