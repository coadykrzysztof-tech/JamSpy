// JamSpy - Main Screen Controller (Live Key Finder, Jam Guide & On-Device Saved Songs)

import {
  getKeyDetails,
  getAllKeysList,
  getNoteName,
  isBlackKey
} from './music-theory.js?v=7';
import { AudioEngine } from './audio-engine.js?v=7';

const audio = new AudioEngine();
const STORAGE_KEY = 'jamspy_saved_songs_v1';

// App State
let currentKey = getKeyDetails(7, 'major'); // Default preview: G Major
let selectedChordIndex = null;
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

const savedCountBadge = document.getElementById('savedCountBadge');
const savedEmptyState = document.getElementById('savedEmptyState');
const savedSongsList = document.getElementById('savedSongsList');
const appRefreshBtn = document.getElementById('appRefreshBtn');

const RING_CIRCUMFERENCE = 2 * Math.PI * 68;

// Build 2-octave keyboard structure once (C3 = MIDI 48 through C5 = MIDI 72)
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
    const [pcStr, mode] = manualKeySelect.value.split(':');
    selectedChordIndex = null;
    keySourceMode = 'preview';
    loadedSavedSongId = null;
    loadedSavedSongTitle = null;
    currentKey = getKeyDetails(Number(pcStr), mode);
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
    const entry = keyElementsByMidi.get(m);
    if (!entry) return;
    entry.el.classList.add('is-playing');
    setTimeout(() => entry.el.classList.remove('is-playing'), 240);
  });
}

function renderPianoHighlights() {
  const scaleSet = new Set(currentKey.scalePitchClasses);
  const activeChord = selectedChordIndex !== null ? currentKey.chords[selectedChordIndex] : null;
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
      if (selectedChordIndex === idx) {
        audio.playChord(chord.midiNotes, chord.bassMidi);
        flashChordKeys(chord.midiNotes);
      } else {
        selectedChordIndex = idx;
        renderAll();
        audio.playChord(chord.midiNotes, chord.bassMidi);
        flashChordKeys(chord.midiNotes);
      }
    });

    chordsGrid.appendChild(btn);
  });

  if (selectedChordIndex !== null) {
    const chord = currentKey.chords[selectedChordIndex];
    chordDetailBanner.classList.remove('hidden');
    chordDetailTitle.textContent = `${chord.fullName}:`;
    chordDetailNotes.textContent = `Press ${chord.noteNames.join(' – ')}`;
  } else {
    chordDetailBanner.classList.add('hidden');
  }
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

    const metaSpan = document.createElement('span');
    metaSpan.className = 'saved-song-meta';
    metaSpan.textContent = formatSavedTimestamp(item.savedAt);

    infoDiv.appendChild(titleSpan);
    infoDiv.appendChild(metaSpan);

    const keyPill = document.createElement('span');
    keyPill.className = 'saved-key-pill';
    keyPill.textContent = item.keyName;

    mainBtn.appendChild(infoDiv);
    mainBtn.appendChild(keyPill);

    mainBtn.addEventListener('click', () => {
      currentKey = getKeyDetails(item.rootPc, item.mode);
      selectedChordIndex = null;
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

function handleListeningResult({ tooQuiet, result }) {
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
  statusText.innerHTML = `Locked onto <strong>${result.key.name}</strong>! Type a note below to <strong>Save</strong> or tap any chord.`;

  currentKey = result.key;
  selectedChordIndex = null;
  keySourceMode = 'live';
  loadedSavedSongId = null;
  loadedSavedSongTitle = null;

  confidenceBadge.textContent = `${result.confidenceLabel} (${result.confidence}%)`;
  confidenceBadge.classList.remove('hidden');

  renderAll();
}

function toggleListening() {
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
  renderAll();
  audio.playScalePreview(currentKey.scalePreviewMidi, (midi) => {
    activeScaleStepMidi = midi;
    renderPianoHighlights();
  });
});

cousinKeyBtn.addEventListener('click', () => {
  const { rootPc, mode } = currentKey.relativeKey;
  currentKey = getKeyDetails(rootPc, mode);
  selectedChordIndex = null;
  if (loadedSavedSongId) {
    // Also update the saved song if user immediately flips its cousin key? Keep non-destructive unless saved!
    keySourceMode = 'preview';
    loadedSavedSongId = null;
    loadedSavedSongTitle = null;
  }
  renderAll();
  audio.playChord(currentKey.chords[0].midiNotes, currentKey.chords[0].bassMidi);
});

clearChordBtn.addEventListener('click', () => {
  selectedChordIndex = null;
  renderAll();
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
