/* ═══════════════════════════════════════════════════
   PDF Adventure — Game Frontend Logic
   Vanilla JS, no frameworks
═══════════════════════════════════════════════════ */

// ── State ─────────────────────────────────────────
const state = {
  gameId: null,
  theme: 'pirate',
  locations: [],
  completedLocations: [],
  scores: [],
  totalCorrect: 0,
  totalQuestions: 0,
  currentLocationIdx: null,
  currentLocationData: null,  // { narrative, questions }
  answerResults: [],          // results for current location
};

// ── Theme config ──────────────────────────────────
const THEMES = {
  pirate: {
    bodyClass: 'pirate',
    landingTitle: '☠️ PDF Adventure ☠️',
    landingSubtitle: 'Upload your study material and embark on an epic sea quest!',
    mapTitle: '⚓ Adventure Map',
    mapSubtitle: 'Chart your course, brave sailor',
    startBtn: '⚓ Start Adventure',
    uploadIcon: '📜',
    submitBtn: '⚔️ Submit Answers',
    nextBtn: '⚓ Next Location →',
    victoryIcon: '🏴‍☠️',
    victoryTitle: 'Treasure Found!',
    victorySubtitle: "Ye've conquered all 5 locations, brave pirate!",
    locationIcons: ['🏝️', '⚓', '🌊', '🐉', '💰'],
    lockedText: '🔒 Locked',
    completedText: '✅ Conquered',
    unlockText: '👆 Click to explore',
    loadingUpload: 'Unfurling the treasure map...',
    loadingLocation: 'Sailing to new shores...',
    loadingSubmit: 'The captain reviews your answers...',
    scoreGood: "Shiver me timbers! Outstanding!",
    scoreOk: "A fair haul, sailor!",
    scoreBad: "Back to the books, landlubber!",
  },
  space: {
    bodyClass: 'space',
    landingTitle: '🚀 PDF Space Mission 🚀',
    landingSubtitle: 'Upload your study material and launch into a cosmic adventure!',
    mapTitle: '🌌 Star Map',
    mapSubtitle: 'Select your next mission destination',
    startBtn: '🚀 Launch Mission',
    uploadIcon: '📡',
    submitBtn: '🛸 Transmit Answers',
    nextBtn: '🚀 Next Sector →',
    victoryIcon: '🏆',
    victoryTitle: 'Mission Complete!',
    victorySubtitle: "You've explored all 5 sectors of the cosmos!",
    locationIcons: ['🪐', '⭐', '🌌', '🛸', '🌠'],
    lockedText: '🔒 Locked',
    completedText: '✅ Explored',
    unlockText: '👆 Click to enter',
    loadingUpload: 'Scanning PDF with quantum sensors...',
    loadingLocation: 'Warping to new sector...',
    loadingSubmit: 'AI core processing responses...',
    scoreGood: "Outstanding, Commander! Full marks!",
    scoreOk: "Mission partially successful.",
    scoreBad: "Return to the academy, cadet.",
  }
};

// ── Utility ───────────────────────────────────────
function $(id) { return document.getElementById(id); }

function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = $(screenId);
  if (target) target.classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showLoading(msg) {
  $('loading-text').textContent = msg || 'Loading...';
  $('loading-overlay').classList.add('active');
}

function hideLoading() {
  $('loading-overlay').classList.remove('active');
}

function showError(elementId, msg) {
  const el = $(elementId);
  if (el) {
    el.textContent = msg;
    el.classList.add('visible');
  }
}

function hideError(elementId) {
  const el = $(elementId);
  if (el) el.classList.remove('visible');
}

function applyTheme(theme) {
  const cfg = THEMES[theme] || THEMES.pirate;
  state.theme = theme;

  document.body.className = cfg.bodyClass;

  // Update themed text
  $('landing-title').textContent = cfg.landingTitle;
  $('landing-subtitle').textContent = cfg.landingSubtitle;
  $('upload-icon').textContent = cfg.uploadIcon;
  $('start-btn-text').textContent = cfg.startBtn;
  $('map-title').textContent = cfg.mapTitle;
  $('map-subtitle').textContent = cfg.mapSubtitle;
  $('submit-answers-btn').textContent = cfg.submitBtn;
  $('next-location-btn').textContent = cfg.nextBtn;
  $('victory-icon').textContent = cfg.victoryIcon;
  $('victory-title').textContent = cfg.victoryTitle;
  $('victory-subtitle').textContent = cfg.victorySubtitle;
}

// Preview theme on dropdown change (before upload)
function handleThemePreview(value) {
  if (value === 'auto') {
    // Show pirate as default preview
    applyTheme('pirate');
  } else {
    applyTheme(value);
  }
}

// ── File handling ─────────────────────────────────
let selectedFile = null;

function handleFileSelect(event) {
  const file = event.target.files[0];
  if (!file) return;

  if (!file.name.toLowerCase().endsWith('.pdf')) {
    showError('upload-error', 'Please select a PDF file.');
    return;
  }

  selectedFile = file;
  $('upload-filename').textContent = `📄 ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
  $('start-btn').disabled = false;
  hideError('upload-error');
}

// Drag & drop support
(function setupDragDrop() {
  const area = $('upload-area');
  if (!area) return;

  area.addEventListener('dragover', (e) => {
    e.preventDefault();
    area.classList.add('dragover');
  });

  area.addEventListener('dragleave', () => {
    area.classList.remove('dragover');
  });

  area.addEventListener('drop', (e) => {
    e.preventDefault();
    area.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) {
      // Simulate file input change
      const dt = new DataTransfer();
      dt.items.add(file);
      $('pdf-input').files = dt.files;
      handleFileSelect({ target: { files: [file] } });
    }
  });
})();

// ── Upload & init game ────────────────────────────
async function uploadPDF() {
  if (!selectedFile) {
    showError('upload-error', 'Please select a PDF file first.');
    return;
  }

  const themeChoice = $('theme-select').value;
  const cfg = THEMES[themeChoice === 'auto' ? 'pirate' : themeChoice];
  showLoading(cfg.loadingUpload);
  hideError('upload-error');
  $('start-btn').disabled = true;

  try {
    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('theme', themeChoice);

    const response = await fetch(`/upload?theme=${encodeURIComponent(themeChoice)}`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: 'Upload failed.' }));
      throw new Error(err.detail || `Server error: ${response.status}`);
    }

    const data = await response.json();

    // Initialize state
    state.gameId = data.game_id;
    state.locations = data.locations;
    state.completedLocations = [];
    state.scores = [];
    state.totalCorrect = 0;
    state.totalQuestions = 0;
    state.currentLocationIdx = null;
    state.currentLocationData = null;

    // Apply detected theme
    applyTheme(data.theme);
    showMap();

  } catch (err) {
    showError('upload-error', `Error: ${err.message}`);
    $('start-btn').disabled = false;
  } finally {
    hideLoading();
  }
}

// ── Map screen ────────────────────────────────────
function showMap() {
  const completed = state.completedLocations.length;
  const total = state.locations.length;
  const cfg = THEMES[state.theme];

  // Update progress
  $('map-progress-text').textContent = `${completed} / ${total} locations`;
  $('map-progress-bar').style.width = `${(completed / total) * 100}%`;
  $('map-score-badge').textContent = `Score: ${state.totalCorrect} / ${state.totalQuestions}`;

  // Render location nodes
  const container = $('map-path');
  container.innerHTML = '';

  state.locations.forEach((loc, idx) => {
    const isCompleted = state.completedLocations.includes(idx);
    const isUnlocked = idx === 0 || state.completedLocations.includes(idx - 1);
    const isLocked = !isUnlocked;

    let statusClass = 'locked';
    if (isCompleted) statusClass = 'completed';
    else if (isUnlocked) statusClass = 'unlocked';

    let statusText = cfg.lockedText;
    if (isCompleted) {
      const locScore = state.scores[state.completedLocations.indexOf(idx)];
      statusText = `${cfg.completedText} — ${locScore}/3`;
    } else if (isUnlocked) {
      statusText = cfg.unlockText;
    }

    const icon = cfg.locationIcons[idx] || '📍';

    const nodeEl = document.createElement('div');
    nodeEl.className = `location-node ${statusClass}`;
    nodeEl.dataset.idx = idx;
    nodeEl.innerHTML = `
      <div class="location-node-header">
        <span class="location-icon">${icon}</span>
        <span class="location-name">${escapeHtml(loc.name)}</span>
      </div>
      <div class="location-desc">${escapeHtml(loc.description)}</div>
      <div class="location-status">${statusText}</div>
    `;

    if (isUnlocked && !isCompleted) {
      nodeEl.addEventListener('click', () => startLocation(idx));
    } else if (isCompleted) {
      nodeEl.addEventListener('click', () => startLocation(idx)); // Allow replay
    }

    // Connector arrow between nodes (not after last)
    const rowEl = document.createElement('div');
    rowEl.className = 'map-row';
    rowEl.appendChild(nodeEl);

    container.appendChild(rowEl);

    if (idx < state.locations.length - 1) {
      const connector = document.createElement('div');
      connector.className = 'path-connector';
      connector.textContent = '↓';
      container.appendChild(connector);
    }
  });

  hideError('map-error');
  showScreen('map-screen');
}

// ── Location / Quiz screen ────────────────────────
async function startLocation(idx) {
  const cfg = THEMES[state.theme];
  showLoading(cfg.loadingLocation);
  hideError('location-error');

  try {
    const response = await fetch(`/start-location/${state.gameId}/${idx}`, {
      method: 'POST',
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: 'Failed to load location.' }));
      throw new Error(err.detail || `Server error: ${response.status}`);
    }

    const data = await response.json();
    state.currentLocationIdx = idx;
    state.currentLocationData = data;
    state.answerResults = [];

    renderLocationScreen(data, idx);
    showScreen('location-screen');

  } catch (err) {
    showError('map-error', `Error: ${err.message}`);
  } finally {
    hideLoading();
  }
}

function renderLocationScreen(data, idx) {
  const cfg = THEMES[state.theme];
  const loc = state.locations[idx];
  const icon = cfg.locationIcons[idx] || '📍';

  $('loc-icon').textContent = icon;
  $('loc-name').textContent = loc.name;
  $('loc-desc').textContent = loc.description;
  $('loc-progress-text').textContent = `Location ${idx + 1} of ${state.locations.length}`;
  $('narrative-text').textContent = data.narrative || '';

  // Render questions
  const container = $('questions-container');
  container.innerHTML = '';

  (data.questions || []).forEach((q, qIdx) => {
    const block = document.createElement('div');
    block.className = 'question-block';
    block.id = `question-block-${qIdx}`;

    const optionsHtml = Object.entries(q.options || {}).map(([letter, text]) => `
      <div class="option-item">
        <input
          type="radio"
          name="question-${qIdx}"
          id="q${qIdx}-${letter}"
          value="${letter}"
        />
        <label class="option-label" for="q${qIdx}-${letter}">
          <span class="option-letter">${letter}</span>
          <span>${escapeHtml(text)}</span>
        </label>
      </div>
    `).join('');

    block.innerHTML = `
      <div class="question-number">Question ${qIdx + 1} of ${data.questions.length}</div>
      <div class="question-text">${escapeHtml(q.question)}</div>
      <div class="options-grid">
        ${optionsHtml}
      </div>
    `;
    container.appendChild(block);
  });

  // Reset submit button
  $('submit-answers-btn').disabled = false;
  $('submit-answers-btn').textContent = cfg.submitBtn;

  hideError('location-error');
}

// ── Submit answers ────────────────────────────────
async function submitAnswers() {
  const cfg = THEMES[state.theme];
  const questions = state.currentLocationData?.questions || [];

  // Validate all answered
  const answers = [];
  for (let i = 0; i < questions.length; i++) {
    const selected = document.querySelector(`input[name="question-${i}"]:checked`);
    if (!selected) {
      showError('location-error', `Please answer question ${i + 1} before submitting.`);
      return;
    }
    answers.push(selected.value);
  }

  hideError('location-error');
  showLoading(cfg.loadingSubmit);
  $('submit-answers-btn').disabled = true;

  try {
    const idx = state.currentLocationIdx;
    const results = [];

    // Check each answer
    for (let i = 0; i < answers.length; i++) {
      const response = await fetch(
        `/answer/${state.gameId}/${idx}/${i}?answer=${encodeURIComponent(answers[i])}`,
        { method: 'POST' }
      );

      if (!response.ok) {
        const err = await response.json().catch(() => ({ detail: 'Answer check failed.' }));
        throw new Error(err.detail || `Server error: ${response.status}`);
      }

      const result = await response.json();
      results.push(result);
    }

    state.answerResults = results;

    // Count correct
    const correctCount = results.filter(r => r.is_correct).length;

    // Complete location
    const completeResp = await fetch(
      `/complete-location/${state.gameId}/${idx}?correct_count=${correctCount}`,
      { method: 'POST' }
    );

    if (completeResp.ok) {
      const completeData = await completeResp.json();
      state.totalCorrect = completeData.total_correct;
      state.totalQuestions = completeData.total_questions;

      // Update local completed list
      if (!state.completedLocations.includes(idx)) {
        state.completedLocations.push(idx);
        state.scores.push(correctCount);
      }

      // Show results
      renderResultScreen(results, correctCount, completeData);
      showScreen('result-screen');
    }

  } catch (err) {
    showError('location-error', `Error: ${err.message}`);
    $('submit-answers-btn').disabled = false;
  } finally {
    hideLoading();
  }
}

// ── Result screen ─────────────────────────────────
function renderResultScreen(results, correctCount, completeData) {
  const cfg = THEMES[state.theme];
  const total = results.length;

  // Big score
  const scoreBig = $('result-score-big');
  scoreBig.textContent = `${correctCount} / ${total}`;
  scoreBig.className = 'results-score-big';
  if (correctCount === total) {
    scoreBig.classList.add('good');
    $('result-score-label').textContent = cfg.scoreGood;
  } else if (correctCount >= Math.ceil(total / 2)) {
    scoreBig.classList.add('ok');
    $('result-score-label').textContent = cfg.scoreOk;
  } else {
    scoreBig.classList.add('bad');
    $('result-score-label').textContent = cfg.scoreBad;
  }

  // Result title
  $('result-title').textContent = correctCount === total
    ? '🎉 Perfect Score!'
    : correctCount > 0
      ? '📊 Results'
      : '💀 Try Again!';

  // Per-question feedback
  const feedbackContainer = $('feedback-container');
  feedbackContainer.innerHTML = '';

  results.forEach((r, i) => {
    const q = state.currentLocationData.questions[i];
    const feedbackEl = document.createElement('div');
    feedbackEl.className = `feedback-block ${r.is_correct ? 'correct' : 'incorrect'}`;

    const correctOption = q.options[r.correct_answer] || '';
    const playerOption = q.options[r.player_answer] || r.player_answer;

    feedbackEl.innerHTML = `
      <div class="feedback-header">
        <span>${r.is_correct ? '✅' : '❌'}</span>
        <span>Question ${i + 1}: ${escapeHtml(r.question)}</span>
      </div>
      ${!r.is_correct ? `
        <p class="feedback-explanation mb-2">
          <strong>Your answer:</strong> ${r.player_answer}) ${escapeHtml(playerOption)}
        </p>
        <p class="feedback-explanation mb-2">
          <strong>Correct answer:</strong> ${r.correct_answer}) ${escapeHtml(correctOption)}
        </p>
      ` : ''}
      <p class="feedback-explanation">
        <strong>Explanation:</strong> ${escapeHtml(r.explanation || '')}
      </p>
    `;
    feedbackContainer.appendChild(feedbackEl);
  });

  // Overall progress bar
  const overallPct = state.totalQuestions > 0
    ? (state.totalCorrect / state.totalQuestions) * 100
    : 0;
  $('result-progress-bar').style.width = `${overallPct}%`;
  $('result-total-score').textContent =
    `Total: ${state.totalCorrect} / ${state.totalQuestions} correct`;

  // Next location button
  const nextBtn = $('next-location-btn');
  if (completeData.game_complete) {
    nextBtn.textContent = '🏆 See Final Results';
    nextBtn.onclick = showVictoryScreen;
  } else {
    nextBtn.textContent = cfg.nextBtn;
    nextBtn.onclick = nextLocation;
  }
}

// ── Next location ─────────────────────────────────
function nextLocation() {
  // Check if game complete
  if (state.completedLocations.length >= state.locations.length) {
    showVictoryScreen();
    return;
  }
  showMap();
}

// ── Victory screen ────────────────────────────────
function showVictoryScreen() {
  const cfg = THEMES[state.theme];
  const totalPossible = state.locations.length * 3;

  $('victory-score').textContent = `${state.totalCorrect} / ${totalPossible}`;

  // Message based on score
  const pct = state.totalCorrect / totalPossible;
  let msg;
  if (pct === 1) {
    msg = state.theme === 'pirate'
      ? "🏴‍☠️ A perfect treasure haul! Ye are a true legend of the seas!"
      : "🌟 100% mission success! You are a galactic hero!";
  } else if (pct >= 0.8) {
    msg = state.theme === 'pirate'
      ? "⚓ Outstanding sailing! The seas bow to your wisdom!"
      : "🚀 Excellent mission! The cosmos applauds your mastery!";
  } else if (pct >= 0.6) {
    msg = state.theme === 'pirate'
      ? "🌊 A good voyage, but more treasure awaits the studious pirate."
      : "🛸 Decent mission. Keep studying the stars, Commander.";
  } else {
    msg = state.theme === 'pirate'
      ? "📜 The seas were rough. Review your charts and sail again!"
      : "📡 Mission data incomplete. Return to base for more training.";
  }
  $('victory-message').textContent = msg;

  // Per-location breakdown
  const breakdown = $('victory-breakdown');
  breakdown.innerHTML = '<p class="text-sm opacity-70 mb-2">Location Scores:</p>';
  state.locations.forEach((loc, idx) => {
    const score = state.scores[state.completedLocations.indexOf(idx)];
    const icon = cfg.locationIcons[idx] || '📍';
    const div = document.createElement('div');
    div.style.cssText = 'display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(128,128,128,0.2);';
    div.innerHTML = `
      <span>${icon} ${escapeHtml(loc.name)}</span>
      <span class="score-badge">${score !== undefined ? score : 0} / 3</span>
    `;
    breakdown.appendChild(div);
  });

  showScreen('victory-screen');
  launchConfetti();
}

// ── Restart ───────────────────────────────────────
function restartGame() {
  // Clear confetti
  $('confetti-container').innerHTML = '';

  // Reset state
  state.gameId = null;
  state.theme = 'pirate';
  state.locations = [];
  state.completedLocations = [];
  state.scores = [];
  state.totalCorrect = 0;
  state.totalQuestions = 0;
  state.currentLocationIdx = null;
  state.currentLocationData = null;
  state.answerResults = [];

  // Reset form
  selectedFile = null;
  $('pdf-input').value = '';
  $('upload-filename').textContent = '';
  $('start-btn').disabled = true;
  $('theme-select').value = 'auto';

  applyTheme('pirate');
  showScreen('landing-screen');
}

// ── Confetti ──────────────────────────────────────
function launchConfetti() {
  const container = $('confetti-container');
  container.innerHTML = '';

  const colors = state.theme === 'pirate'
    ? ['#c8960c', '#f4e4bc', '#e8b420', '#fff', '#9a6e00']
    : ['#00d4ff', '#9b59b6', '#e0e0ff', '#fff', '#00ffff'];

  for (let i = 0; i < 80; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';

    const size = Math.random() * 10 + 6;
    const color = colors[Math.floor(Math.random() * colors.length)];
    const left = Math.random() * 100;
    const duration = Math.random() * 2.5 + 2;
    const delay = Math.random() * 2;

    piece.style.cssText = `
      left: ${left}%;
      width: ${size}px;
      height: ${size * 1.4}px;
      background: ${color};
      animation-duration: ${duration}s;
      animation-delay: ${delay}s;
      border-radius: ${Math.random() > 0.5 ? '50%' : '2px'};
    `;
    container.appendChild(piece);
  }

  // Clean up after animation
  setTimeout(() => { container.innerHTML = ''; }, 6000);
}

// ── HTML escaping ─────────────────────────────────
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Init ──────────────────────────────────────────
(function init() {
  applyTheme('pirate');
  showScreen('landing-screen');
})();
