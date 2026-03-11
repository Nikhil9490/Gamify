/* ═══════════════════════════════════════════════════
   Chef's Kitchen — Game Frontend Logic
   Vanilla JS, no frameworks
═══════════════════════════════════════════════════ */

// ── State ─────────────────────────────────────────
const state = {
  gameId: null,
  locations: [],
  completedLocations: [],  // array of location indices
  scores: [],              // parallel array of correct counts
  dishRatings: [],         // parallel array of rating strings
  burntLocations: [],      // indices where timer expired
  totalCorrect: 0,
  totalQuestions: 0,
  currentLocationIdx: null,
  currentLocationData: null,
  answerResults: [],
  timeRemainingOnSubmit: 0,
};

// ── Kitchen station config ─────────────────────────
const STATION_ICONS  = ['🥬', '🔪', '🍳', '🫕', '🍽️'];
const STATION_LABELS = ['The Pantry', 'Prep Station', 'The Stove', 'The Oven', 'Plating'];

// Dish quality rating thresholds (out of 5 questions)
function getDishRating(correct, total, burnt) {
  if (burnt) {
    return {
      badge: '🔥',
      label: 'Burnt!',
      message: "The kitchen's on fire! Study more.",
      cssClass: 'burnt',
    };
  }
  if (correct === 5 && total === 5) {
    return {
      badge: '⭐⭐⭐',
      label: 'Michelin Star',
      message: 'Perfectly cooked! A masterpiece!',
      cssClass: 'perfect',
    };
  }
  if (correct >= 4) {
    return {
      badge: '⭐⭐',
      label: 'Well Cooked',
      message: 'Delicious! Just a pinch off.',
      cssClass: 'good',
    };
  }
  if (correct >= 3) {
    return {
      badge: '⭐',
      label: 'Decent',
      message: 'Edible, but needs seasoning.',
      cssClass: 'ok',
    };
  }
  return {
    badge: '💧',
    label: 'Bland',
    message: 'Needs more practice, chef.',
    cssClass: 'bad',
  };
}

// ── Timer ─────────────────────────────────────────
let timerInterval      = null;
let ingredientInterval = null;
let timeLeft      = 120;
let timeBurnt     = false;
const TOTAL_TIME  = 120;

const INGREDIENTS = ['🧄', '🧅', '🌿', '🧂', '🫒', '🥕', '🍋', '🌶️', '🫙', '🍃'];

function dropIngredient() {
  if (timeBurnt || timeLeft <= 30) return;
  const stage = document.querySelector('.chef-stage');
  const armR  = document.querySelector('#chef-character .ch-arm-r');
  if (!stage || !armR) return;

  const item = document.createElement('span');
  item.className   = 'ch-ingredient-drop';
  item.textContent = INGREDIENTS[Math.floor(Math.random() * INGREDIENTS.length)];
  stage.appendChild(item);

  armR.classList.add('raising');
  setTimeout(() => {
    item.remove();
    armR.classList.remove('raising');
  }, 1250);
}

function startTimer() {
  timeLeft  = TOTAL_TIME;
  timeBurnt = false;
  document.body.classList.remove('urgent', 'burnt', 'cooking-fresh', 'cooking-mid');
  document.body.classList.add('cooking-fresh');
  updateTimerDisplay();

  // First ingredient drop after 3s, then every 18s
  setTimeout(() => dropIngredient(), 3000);
  ingredientInterval = setInterval(() => dropIngredient(), 18000);

  timerInterval = setInterval(() => {
    timeLeft--;
    updateTimerDisplay();

    if (timeLeft <= 30 && timeLeft > 0) {
      document.body.classList.add('urgent');
    }

    if (timeLeft <= 0) {
      clearInterval(timerInterval);
      timerInterval = null;
      timeBurnt = true;
      document.body.classList.remove('urgent');
      document.body.classList.add('burnt');
      showFireAnimation();
      autoSubmitBurnt();
    }
  }, 1000);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  if (ingredientInterval) {
    clearInterval(ingredientInterval);
    ingredientInterval = null;
  }
  document.body.classList.remove('urgent', 'burnt', 'cooking-fresh', 'cooking-mid');
}

function updateTimerDisplay() {
  const display = $('timer-display');
  const bar     = $('timer-bar');
  if (!display) return;

  const mins = Math.floor(timeLeft / 60);
  const secs = timeLeft % 60;
  display.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;

  // Cooking stage body classes (drive pot liquid/bubble changes)
  document.body.classList.remove('cooking-fresh', 'cooking-mid');
  if (timeLeft > 60) {
    document.body.classList.add('cooking-fresh');
  } else if (timeLeft > 0) {
    document.body.classList.add('cooking-mid');
  }

  // Color state + chef mood
  display.classList.remove('yellow', 'red');
  if (timeLeft <= 0) {
    display.classList.add('red');
    updateChefMood('burnt');
  } else if (timeLeft <= 30) {
    display.classList.add('red');
    updateChefMood('urgent');
  } else if (timeLeft <= 60) {
    display.classList.add('yellow');
    updateChefMood('worried');
  } else {
    updateChefMood('happy');
  }

  // Bar width + color
  if (bar) {
    const pct = (timeLeft / TOTAL_TIME) * 100;
    bar.style.width = `${pct}%`;
    if (timeLeft <= 30) {
      bar.style.background = '#f44336';
    } else if (timeLeft <= 60) {
      bar.style.background = '#ff9800';
    } else {
      bar.style.background = '#4caf50';
    }
  }
}

function showFireAnimation() {
  const fire = $('fire-emoji');
  if (fire) fire.classList.remove('hidden');
}

function hideFireAnimation() {
  const fire = $('fire-emoji');
  if (fire) fire.classList.add('hidden');
}

function updateChefMood(mood) {
  const chef = $('chef-character');
  if (chef) chef.dataset.mood = mood;

  const status = $('timer-status');
  if (!status) return;
  const messages = {
    happy:   "Let's cook! 🍳",
    worried: "Stay focused, Chef! 😟",
    urgent:  "It's burning! Hurry! 😰",
    burnt:   "🔥 TIME'S UP — BURNT!",
  };
  status.textContent = messages[mood] || '';
  status.style.color = mood === 'burnt'  ? '#ff4400'
                     : mood === 'urgent' ? '#ff9800'
                     : mood === 'worried'? '#ffcc44'
                     : '#9a7a5a';
}

// Auto-submit when timer expires — mark unanswered as wrong
async function autoSubmitBurnt() {
  const questions = state.currentLocationData?.questions || [];
  if (!questions.length) return;

  // Disable submit button
  const btn = $('submit-answers-btn');
  if (btn) { btn.disabled = true; btn.textContent = '🔥 Time\'s Up!'; }

  // Show burnt overlay briefly then process
  await new Promise(r => setTimeout(r, 800));

  const answers = [];
  for (let i = 0; i < questions.length; i++) {
    const selected = document.querySelector(`input[name="question-${i}"]:checked`);
    answers.push(selected ? selected.value : '__BURNT__');
  }

  showLoading('Assessing the damage...');

  try {
    const idx     = state.currentLocationIdx;
    const results = [];

    for (let i = 0; i < answers.length; i++) {
      if (answers[i] === '__BURNT__') {
        // Unanswered — count as wrong
        const q = questions[i];
        results.push({
          is_correct:     false,
          player_answer:  '—',
          correct_answer: q.correct,
          explanation:    q.explanation || '',
          question:       q.question,
          was_unanswered: true,
        });
      } else {
        const resp = await fetch(
          `/answer/${state.gameId}/${idx}/${i}?answer=${encodeURIComponent(answers[i])}`,
          { method: 'POST' }
        );
        if (resp.ok) {
          const r = await resp.json();
          results.push(r);
        } else {
          results.push({
            is_correct:    false,
            player_answer: answers[i],
            correct_answer: questions[i].correct,
            explanation:   '',
            question:      questions[i].question,
          });
        }
      }
    }

    state.answerResults = results;
    const correctCount  = results.filter(r => r.is_correct).length;

    const completeResp = await fetch(
      `/complete-location/${state.gameId}/${idx}?correct_count=${correctCount}&burnt=true`,
      { method: 'POST' }
    );

    if (completeResp.ok) {
      const completeData = await completeResp.json();
      state.totalCorrect    = completeData.total_correct;
      state.totalQuestions  = completeData.total_questions;

      if (!state.completedLocations.includes(idx)) {
        state.completedLocations.push(idx);
        state.scores.push(correctCount);
        state.dishRatings.push('burnt');
        state.burntLocations.push(idx);
      }

      state.timeRemainingOnSubmit = 0;
      renderResultScreen(results, correctCount, completeData, true);
      showScreen('result-screen');
    }
  } catch (err) {
    showError('location-error', `Error processing results: ${err.message}`);
  } finally {
    hideLoading();
  }
}

// ── Utility ───────────────────────────────────────
function $(id) { return document.getElementById(id); }

function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = $(screenId);
  if (target) target.classList.add('active');
  window.scrollTo(0, 0);
}

function showLoading(msg) {
  $('loading-text').textContent = msg || 'Heating up the kitchen...';
  $('loading-overlay').classList.add('active');
}

function hideLoading() {
  $('loading-overlay').classList.remove('active');
}

function showError(elementId, msg) {
  const el = $(elementId);
  if (el) { el.textContent = msg; el.classList.add('visible'); }
}

function hideError(elementId) {
  const el = $(elementId);
  if (el) el.classList.remove('visible');
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

  area.addEventListener('dragleave', () => area.classList.remove('dragover'));

  area.addEventListener('drop', (e) => {
    e.preventDefault();
    area.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) {
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

  showLoading('Prepping the kitchen...');
  hideError('upload-error');
  $('start-btn').disabled = true;

  try {
    const formData = new FormData();
    formData.append('file', selectedFile);

    const response = await fetch('/upload', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: 'Upload failed.' }));
      throw new Error(err.detail || `Server error: ${response.status}`);
    }

    const data = await response.json();

    // Initialize state
    state.gameId             = data.game_id;
    state.locations          = data.locations;
    state.completedLocations = [];
    state.scores             = [];
    state.dishRatings        = [];
    state.burntLocations     = [];
    state.totalCorrect       = 0;
    state.totalQuestions     = 0;
    state.currentLocationIdx = null;
    state.currentLocationData = null;
    state.answerResults       = [];

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
  stopTimer();
  document.body.classList.remove('urgent', 'burnt');

  const completed = state.completedLocations.length;
  const total     = state.locations.length;

  $('map-progress-text').textContent = `${completed} / ${total} stations`;
  $('map-progress-bar').style.width  = `${(completed / total) * 100}%`;
  $('map-score-badge').textContent   = `Score: ${state.totalCorrect} / ${state.totalQuestions}`;

  // Restaurant rating
  const ratingEl = $('map-restaurant-rating');
  if (ratingEl && completed > 0) {
    const avg = state.totalCorrect / state.totalQuestions;
    let stars = '';
    if (avg >= 0.9) stars = '⭐⭐⭐ Michelin';
    else if (avg >= 0.7) stars = '⭐⭐ Excellent';
    else if (avg >= 0.5) stars = '⭐ Good';
    else stars = '💧 Needs Work';
    ratingEl.textContent = `· ${stars}`;
  } else if (ratingEl) {
    ratingEl.textContent = '';
  }

  // Render station cards
  const grid = $('kitchen-grid');
  grid.innerHTML = '';

  state.locations.forEach((loc, idx) => {
    const isCompleted = state.completedLocations.includes(idx);
    const isBurnt     = state.burntLocations.includes(idx);
    const isUnlocked  = idx === 0 || state.completedLocations.includes(idx - 1);
    const isLocked    = !isUnlocked && !isCompleted;

    let statusClass = 'locked';
    if (isCompleted) statusClass = 'completed';
    else if (isUnlocked) statusClass = 'unlocked';

    const icon = STATION_ICONS[idx] || '🍴';
    const scoreAtIdx = isCompleted
      ? state.scores[state.completedLocations.indexOf(idx)]
      : null;

    const rating = isCompleted
      ? getDishRating(scoreAtIdx, 5, isBurnt)
      : null;

    let statusHtml = '';
    if (isLocked) {
      statusHtml = '<span>🔒 Locked</span>';
    } else if (isCompleted) {
      statusHtml = `<span>${rating.badge} ${rating.label}</span>`;
    } else {
      statusHtml = '<span>👆 Enter Station</span>';
    }

    const starsHtml = isCompleted
      ? `<div class="station-card-stars">${rating.badge} — ${scoreAtIdx}/5</div>`
      : '';

    const card = document.createElement('div');
    card.className = `station-card ${statusClass}`;
    card.dataset.idx = idx;
    card.innerHTML = `
      <div class="station-card-icon">${icon}</div>
      <div class="station-card-name">${escapeHtml(loc.name)}</div>
      <div class="station-card-desc">${escapeHtml(loc.description)}</div>
      <div class="station-card-status">${statusHtml}</div>
      ${starsHtml}
    `;

    if (!isLocked) {
      card.addEventListener('click', () => startLocation(idx));
    }

    grid.appendChild(card);
  });

  hideError('map-error');
  showScreen('map-screen');
}

// ── Location / Quiz screen ────────────────────────
async function startLocation(idx) {
  showLoading('The chef is briefing the brigade...');
  hideError('location-error');

  try {
    const response = await fetch(`/start-location/${state.gameId}/${idx}`, {
      method: 'POST',
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: 'Failed to load station.' }));
      throw new Error(err.detail || `Server error: ${response.status}`);
    }

    const data = await response.json();
    state.currentLocationIdx  = idx;
    state.currentLocationData = data;
    state.answerResults       = [];

    renderLocationScreen(data, idx);
    showScreen('location-screen');
    startTimer();

  } catch (err) {
    showError('map-error', `Error: ${err.message}`);
  } finally {
    hideLoading();
  }
}

function renderLocationScreen(data, idx) {
  const loc  = state.locations[idx];
  const icon = STATION_ICONS[idx] || '🍴';

  $('loc-icon').textContent        = icon;
  $('loc-name').textContent        = loc.name;
  $('loc-desc').textContent        = loc.description;
  $('loc-progress-text').textContent = `Course ${idx + 1} of ${state.locations.length}`;
  $('narrative-text').textContent  = data.narrative || '';

  // Reset chef
  document.body.classList.remove('urgent', 'burnt');
  hideFireAnimation();
  updateChefMood('happy');

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
          onchange="markQuestionAnswered(${qIdx})"
        />
        <label class="option-label" for="q${qIdx}-${letter}" id="opt-label-${qIdx}-${letter}">
          <span class="option-letter">${letter}</span>
          <span>${escapeHtml(text)}</span>
        </label>
      </div>
    `).join('');

    block.innerHTML = `
      <div class="question-number">Question ${qIdx + 1} of ${data.questions.length}</div>
      <div class="question-text">${escapeHtml(q.question)}</div>
      <div class="options-grid">${optionsHtml}</div>
    `;
    container.appendChild(block);
  });

  // Reset submit button
  const btn = $('submit-answers-btn');
  btn.disabled = false;
  btn.textContent = '🍽️ Submit Dish';

  hideError('location-error');
}

function markQuestionAnswered(qIdx) {
  const block = $(`question-block-${qIdx}`);
  if (block) block.classList.add('answered');
}

// Allow leaving station (abandon without submitting)
function abandonStation() {
  stopTimer();
  document.body.classList.remove('urgent', 'burnt');
  hideFireAnimation();
  showMap();
}

// ── Submit answers ────────────────────────────────
async function submitAnswers() {
  const questions = state.currentLocationData?.questions || [];

  // Validate all answered
  const answers = [];
  for (let i = 0; i < questions.length; i++) {
    const selected = document.querySelector(`input[name="question-${i}"]:checked`);
    if (!selected) {
      showError('location-error', `Please answer question ${i + 1} before submitting.`);
      // Scroll to unanswered question
      const block = $(`question-block-${i}`);
      if (block) block.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    answers.push(selected.value);
  }

  hideError('location-error');

  // Stop timer and record remaining time
  const savedTimeLeft = timeLeft;
  stopTimer();
  state.timeRemainingOnSubmit = savedTimeLeft;

  showLoading('The head chef is tasting your dish...');
  $('submit-answers-btn').disabled = true;

  try {
    const idx     = state.currentLocationIdx;
    const results = [];

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

      // Flash feedback on option labels
      const selectedLabel = $(`opt-label-${i}-${answers[i]}`);
      if (selectedLabel) {
        selectedLabel.classList.add(result.is_correct ? 'flash-correct' : 'flash-wrong');
      }

      results.push(result);
    }

    state.answerResults = results;
    const correctCount  = results.filter(r => r.is_correct).length;

    const completeResp = await fetch(
      `/complete-location/${state.gameId}/${idx}?correct_count=${correctCount}&burnt=false`,
      { method: 'POST' }
    );

    if (completeResp.ok) {
      const completeData    = await completeResp.json();
      state.totalCorrect    = completeData.total_correct;
      state.totalQuestions  = completeData.total_questions;

      if (!state.completedLocations.includes(idx)) {
        state.completedLocations.push(idx);
        state.scores.push(correctCount);
        const r = getDishRating(correctCount, 5, false);
        state.dishRatings.push(r.cssClass);
      }

      renderResultScreen(results, correctCount, completeData, false);
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
function renderResultScreen(results, correctCount, completeData, burnt) {
  const total  = results.length;
  const rating = getDishRating(correctCount, total, burnt);

  // Dish result card
  $('dish-rating-badge').textContent   = rating.badge;
  $('dish-rating-label').textContent   = rating.label;
  $('dish-rating-message').textContent = rating.message;

  const scoreEl = $('dish-score');
  scoreEl.textContent = `${correctCount} / ${total}`;
  scoreEl.className   = `dish-score ${rating.cssClass}`;

  // Result screen title
  if (burnt) {
    $('result-title').textContent = '🔥 Kitchen Fire!';
  } else if (correctCount === total) {
    $('result-title').textContent = '⭐ Michelin Star!';
  } else if (correctCount >= 4) {
    $('result-title').textContent = '👨‍🍳 Well Cooked!';
  } else if (correctCount >= 3) {
    $('result-title').textContent = '🍽️ Decent Dish';
  } else {
    $('result-title').textContent = '💧 Back to Practice';
  }

  // Time remaining bonus
  const timeBonusEl = $('time-bonus');
  if (timeBonusEl) {
    if (!burnt && state.timeRemainingOnSubmit > 0) {
      const mins = Math.floor(state.timeRemainingOnSubmit / 60);
      const secs = state.timeRemainingOnSubmit % 60;
      timeBonusEl.textContent = `⏱️ Finished with ${mins}:${secs.toString().padStart(2,'0')} to spare!`;
    } else if (burnt) {
      timeBonusEl.textContent = '⏱️ Time expired — the dish is burnt!';
      timeBonusEl.style.color = '#ff6644';
    } else {
      timeBonusEl.textContent = '';
    }
  }

  // Per-question feedback
  const feedbackContainer = $('feedback-container');
  feedbackContainer.innerHTML = '';

  results.forEach((r, i) => {
    const q          = state.currentLocationData.questions[i];
    const isUnanswered = r.was_unanswered;
    let blockClass   = r.is_correct ? 'correct' : (isUnanswered ? 'burnt-wrong' : 'incorrect');

    const feedbackEl = document.createElement('div');
    feedbackEl.className = `feedback-block ${blockClass}`;

    const correctOption = q.options[r.correct_answer] || '';
    const playerOption  = r.was_unanswered
      ? 'Not answered (time expired)'
      : (q.options[r.player_answer] || r.player_answer);

    feedbackEl.innerHTML = `
      <div class="feedback-header">
        <span>${r.is_correct ? '✅' : (isUnanswered ? '🔥' : '❌')}</span>
        <span>Q${i + 1}: ${escapeHtml(r.question)}</span>
      </div>
      ${!r.is_correct ? `
        <p class="feedback-explanation mb-2">
          <strong>Your answer:</strong> ${r.player_answer !== '—' ? r.player_answer + ') ' : ''}${escapeHtml(playerOption)}
        </p>
        <p class="feedback-explanation mb-2">
          <strong>Correct answer:</strong> ${r.correct_answer}) ${escapeHtml(correctOption)}
        </p>
      ` : ''}
      <p class="feedback-explanation">
        <strong>Chef's note:</strong> ${escapeHtml(r.explanation || '')}
      </p>
      ${r.source_quote ? `
        <div class="citation-box">
          <span class="citation-icon">📄</span>
          <div class="citation-content">
            <div class="citation-quote">"${escapeHtml(r.source_quote)}"</div>
            <div class="citation-page">— Page ${r.source_page || '?'}</div>
          </div>
        </div>
      ` : ''}
    `;
    feedbackContainer.appendChild(feedbackEl);
  });

  // Overall progress bar
  const overallPct = state.totalQuestions > 0
    ? (state.totalCorrect / state.totalQuestions) * 100
    : 0;
  $('result-progress-bar').style.width = `${overallPct}%`;
  $('result-total-score').textContent  =
    `Total: ${state.totalCorrect} / ${state.totalQuestions} correct`;

  // Next station button
  const nextBtn = $('next-location-btn');
  if (completeData.game_complete) {
    nextBtn.textContent = '🏆 See Restaurant Rating';
    nextBtn.onclick     = showVictoryScreen;
  } else {
    nextBtn.textContent = 'Next Station →';
    nextBtn.onclick     = nextLocation;
  }

  // Reset body state for result screen
  document.body.classList.remove('urgent');
  if (!burnt) document.body.classList.remove('burnt');
}

// ── Next location ─────────────────────────────────
function nextLocation() {
  if (state.completedLocations.length >= state.locations.length) {
    showVictoryScreen();
    return;
  }
  showMap();
}

// ── Victory screen ────────────────────────────────
function showVictoryScreen() {
  const totalPossible = state.locations.length * 5;
  const pct           = totalPossible > 0 ? state.totalCorrect / totalPossible : 0;

  $('victory-score').textContent = `${state.totalCorrect} / ${totalPossible}`;

  // Overall restaurant rating
  let overallStars, overallMsg;
  if (pct >= 0.95) {
    overallStars = '⭐⭐⭐';
    overallMsg   = "Three Michelin Stars! The culinary world bows to you, Chef!";
  } else if (pct >= 0.80) {
    overallStars = '⭐⭐';
    overallMsg   = "Two Michelin Stars! Exceptional cooking — nearly flawless!";
  } else if (pct >= 0.60) {
    overallStars = '⭐';
    overallMsg   = "One Michelin Star! Solid technique, but keep practicing your craft.";
  } else if (pct >= 0.40) {
    overallStars = '🍽️';
    overallMsg   = "A respectable bistro! Good effort — more time in the kitchen needed.";
  } else {
    overallStars = '💧';
    overallMsg   = "The critics were harsh. Hit the books and return to the kitchen, Chef!";
  }

  $('victory-stars').textContent   = overallStars;
  $('victory-message').textContent = overallMsg;

  // Victory title
  $('victory-title').textContent    = 'Service Complete!';
  $('victory-subtitle').textContent = 'All 5 courses have been served!';

  // Per-station breakdown
  const breakdown = $('victory-breakdown');
  breakdown.innerHTML = `
    <div style="font-size:0.75rem; letter-spacing:2px; text-transform:uppercase; color:#9a7a5a; margin-bottom:12px;">
      Station Report
    </div>
  `;

  state.locations.forEach((loc, idx) => {
    const completedIdx = state.completedLocations.indexOf(idx);
    const score   = completedIdx >= 0 ? state.scores[completedIdx] : 0;
    const isBurnt = state.burntLocations.includes(idx);
    const rating  = getDishRating(score, 5, isBurnt);
    const icon    = STATION_ICONS[idx] || '🍴';

    const row = document.createElement('div');
    row.className = 'victory-station-row';
    row.innerHTML = `
      <span class="victory-station-name">${icon} ${escapeHtml(loc.name)}</span>
      <span class="victory-station-rating">${rating.badge} ${score}/5</span>
    `;
    breakdown.appendChild(row);
  });

  document.body.classList.remove('urgent', 'burnt');
  showScreen('victory-screen');
  launchConfetti();
}

// ── Restart ───────────────────────────────────────
function restartGame() {
  stopTimer();
  $('confetti-container').innerHTML = '';
  document.body.classList.remove('urgent', 'burnt');

  // Reset state
  state.gameId              = null;
  state.locations           = [];
  state.completedLocations  = [];
  state.scores              = [];
  state.dishRatings         = [];
  state.burntLocations      = [];
  state.totalCorrect        = 0;
  state.totalQuestions      = 0;
  state.currentLocationIdx  = null;
  state.currentLocationData = null;
  state.answerResults       = [];

  // Reset form
  selectedFile = null;
  $('pdf-input').value       = '';
  $('upload-filename').textContent = '';
  $('start-btn').disabled    = true;

  showScreen('landing-screen');
}

// ── Confetti ──────────────────────────────────────
function launchConfetti() {
  const container = $('confetti-container');
  container.innerHTML = '';

  const colors = ['#ff6b35', '#ffaa50', '#ffd700', '#f5e6d3', '#ff8c5a', '#cc4a15', '#fff'];

  for (let i = 0; i < 90; i++) {
    const piece    = document.createElement('div');
    piece.className = 'confetti-piece';

    const size     = Math.random() * 10 + 5;
    const color    = colors[Math.floor(Math.random() * colors.length)];
    const left     = Math.random() * 100;
    const duration = Math.random() * 2.5 + 2;
    const delay    = Math.random() * 2;
    const isCircle = Math.random() > 0.5;

    piece.style.cssText = `
      left: ${left}%;
      width: ${size}px;
      height: ${size * 1.4}px;
      background: ${color};
      animation-duration: ${duration}s;
      animation-delay: ${delay}s;
      border-radius: ${isCircle ? '50%' : '2px'};
    `;
    container.appendChild(piece);
  }

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
  document.body.className = 'chef';
  showScreen('landing-screen');
})();
