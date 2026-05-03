let _nextTimer = null;

/* ── State ── */
const S = {
  words: [],
  queue: [],
  current: null,
  stats: {},
  recognition: null,
  answerProcessed: false,
  mode: 'definition',
  synonymData: {},
  totalItems: 0,
  doneItems: 0,
};

/* ── Phase management ── */
function showPhase(name) {
  document.querySelectorAll('[data-phase]').forEach(el => {
    el.classList.toggle('active', el.dataset.phase === name);
  });
  if (name !== 'quiz') {
    stopRecognition();
    speechSynthesis.cancel();
  }
}

/* ── Image upload ── */
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const analyzeBtn = document.getElementById('analyze-btn');
const previewImg = document.getElementById('preview-img');

let selectedFile = null;

dropZone.addEventListener('click', () => fileInput.click());

dropZone.addEventListener('dragover', e => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));

dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) setFile(file);
});

fileInput.addEventListener('change', e => {
  if (e.target.files[0]) setFile(e.target.files[0]);
});

function setFile(file) {
  selectedFile = file;
  analyzeBtn.disabled = false;
  const reader = new FileReader();
  reader.onload = ev => {
    previewImg.src = ev.target.result;
    previewImg.style.display = 'block';
  };
  reader.readAsDataURL(file);
}

analyzeBtn.addEventListener('click', async () => {
  if (!selectedFile) return;
  showPhase('loading');

  try {
    const formData = new FormData();
    formData.append('image', selectedFile);

    const res = await fetch('/api/analyze', { method: 'POST', body: formData });
    const data = await res.json();

    if (data.error) throw new Error(data.error);

    showWordList(data.pairs);
  } catch (err) {
    alert('분석 실패: ' + err.message);
    showPhase('upload');
  }
});

/* ── Word list ── */
function showWordList(pairs) {
  S.words = pairs;
  document.getElementById('word-count').textContent = pairs.length;

  const ul = document.getElementById('word-list');
  ul.innerHTML = pairs
    .map(p => `<li><strong>${p.word}</strong>: ${p.definition}</li>`)
    .join('');

  showPhase('wordlist');
}

document.getElementById('reupload-btn').addEventListener('click', resetUpload);

function resetUpload() {
  selectedFile = null;
  fileInput.value = '';
  previewImg.style.display = 'none';
  previewImg.src = '';
  analyzeBtn.disabled = true;
  showPhase('upload');
}

/* ── Mode selection ── */
document.getElementById('mode-definition-btn').addEventListener('click', () => {
  startQuiz(S.words, 'definition');
});

document.getElementById('mode-synonym-btn').addEventListener('click', async () => {
  showPhase('loading');
  try {
    await fetchSynonyms(S.words);
    startQuiz(S.words, 'synonym');
  } catch (err) {
    alert('유의어/반의어 로딩 실패: ' + err.message);
    showPhase('mode');
  }
});

async function fetchSynonyms(words) {
  const res = await fetch('/api/synonyms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ words: words.map(w => w.word) }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  S.synonymData = Object.fromEntries(data.data.map(d => [d.word, d]));
}

function buildSynonymQueue(words) {
  const items = [];
  words.forEach(w => {
    const data = S.synonymData[w.word] || { synonyms: [], antonyms: [] };
    (data.synonyms || []).forEach(hint => items.push({ ...w, hint, hintType: 'synonym' }));
    (data.antonyms || []).forEach(hint => items.push({ ...w, hint, hintType: 'antonym' }));
  });
  return shuffle(items);
}

/* ── Quiz ── */
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function startQuiz(words, mode) {
  S.words = words;
  S.mode = mode;
  S.stats = Object.fromEntries(words.map(w => [w.word, { correct: 0, wrong: 0, skipped: false }]));
  S.queue = mode === 'synonym' ? buildSynonymQueue(words) : shuffle([...words]);
  S.totalItems = S.queue.length;
  S.doneItems = 0;
  showPhase('quiz');
  nextQuestion();
}

async function nextQuestion() {
  if (_nextTimer) { clearTimeout(_nextTimer); _nextTimer = null; }
  stopRecognition();
  speechSynthesis.cancel();

  if (S.queue.length === 0) {
    showResults();
    return;
  }

  S.current = S.queue.shift();
  S.answerProcessed = false;

  updateProgress();

  let displayText, speakText;
  if (S.mode === 'synonym') {
    const isAntonym = S.current.hintType === 'antonym';
    displayText = (isAntonym ? '반의어: ' : '유의어: ') + S.current.hint;
    speakText = (isAntonym ? 'An antonym is: ' : 'A synonym is: ') + S.current.hint;
  } else {
    displayText = S.current.definition;
    speakText = S.current.definition;
  }

  setDefinition(displayText);
  clearFeedback();
  clearTranscript();
  setMicState('idle', '읽어드리는 중...');

  await speakDefinition(speakText);

  if (S.current) {
    setMicState('idle', '단어와 스펠링을 말하세요 (마이크 클릭으로 재시도)');
    startListening();
  }
}

function updateProgress() {
  let total, done;
  if (S.mode === 'synonym') {
    total = S.totalItems;
    done = S.doneItems;
  } else {
    total = S.words.length;
    done = S.words.filter(w => S.stats[w.word].correct > 0 || S.stats[w.word].skipped).length;
  }
  document.getElementById('progress-text').textContent = `${done} / ${total}`;
  document.getElementById('progress-fill').style.width = total > 0 ? `${(done / total) * 100}%` : '0%';
}

function setDefinition(text) {
  document.getElementById('definition-text').textContent = text;
}

function clearTranscript() {
  document.getElementById('transcript-box').textContent = '';
}

function clearFeedback() {
  const fb = document.getElementById('feedback-bar');
  fb.className = 'feedback-bar';
  fb.textContent = '';
}

/* ── TTS ── */
function loadVoices() {
  return new Promise(resolve => {
    const voices = speechSynthesis.getVoices();
    if (voices.length) return resolve(voices);
    speechSynthesis.addEventListener('voiceschanged', () => resolve(speechSynthesis.getVoices()), { once: true });
  });
}

async function speakDefinition(text) {
  return new Promise(async resolve => {
    const voices = await loadVoices();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = 0.88;

    const voice =
      voices.find(v => v.lang === 'en-US' && v.name.includes('Samantha')) ||
      voices.find(v => v.lang === 'en-US') ||
      voices.find(v => v.lang.startsWith('en'));
    if (voice) utterance.voice = voice;

    utterance.onend = resolve;
    utterance.onerror = resolve;
    speechSynthesis.speak(utterance);
  });
}

/* ── STT ── */
function startListening() {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) {
    alert('이 브라우저는 음성 인식을 지원하지 않습니다. Chrome을 사용해주세요.');
    return;
  }

  S.recognition = new SpeechRec();
  S.recognition.lang = 'en-US';
  S.recognition.continuous = false;
  S.recognition.interimResults = true;
  S.recognition.maxAlternatives = 3;

  setMicState('listening', '듣는 중...');

  S.recognition.onresult = event => {
    let interim = '';
    let finalText = '';

    for (const result of event.results) {
      if (result.isFinal) {
        for (let i = 0; i < result.length; i++) {
          finalText += result[i].transcript + ' ';
        }
      } else {
        interim += result[0].transcript;
      }
    }

    const display = finalText.trim() || interim;
    document.getElementById('transcript-box').textContent = display ? `"${display}"` : '';

    if (finalText.trim() && !S.answerProcessed) {
      S.answerProcessed = true;
      processAnswer(finalText.trim());
    }
  };

  S.recognition.onerror = e => {
    if (e.error === 'no-speech') {
      setMicState('idle', '음성이 감지되지 않았습니다. 마이크를 클릭해 다시 시도하세요.');
    } else {
      setMicState('idle', '오류 발생: ' + e.error);
    }
    S.recognition = null;
  };

  S.recognition.onend = () => {
    const transcript = document.getElementById('transcript-box').textContent.replace(/^"|"$/g, '').trim();
    if (!S.answerProcessed && transcript && S.current) {
      S.answerProcessed = true;
      processAnswer(transcript);
    }
    if (!S.answerProcessed) {
      setMicState('idle', '마이크를 클릭해 다시 시도하세요.');
    }
    S.recognition = null;
  };

  S.recognition.start();
}

function stopRecognition() {
  if (S.recognition) {
    try { S.recognition.abort(); } catch (_) {}
    S.recognition = null;
  }
}

function setMicState(state, hint) {
  const btn = document.getElementById('mic-btn');
  const hintEl = document.getElementById('mic-hint');
  btn.className = 'mic-btn' + (state === 'listening' ? ' listening' : '');
  btn.textContent = state === 'listening' ? '🎙️' : '🎤';
  if (hint) hintEl.textContent = hint;
}

document.getElementById('mic-btn').addEventListener('click', () => {
  if (S.recognition) {
    stopRecognition();
    setMicState('idle', '마이크를 클릭해 다시 시도하세요.');
  } else if (S.current) {
    S.answerProcessed = false;
    clearTranscript();
    clearFeedback();
    startListening();
  }
});

/* ── Answer checking ── */
function normalize(str) {
  return str.toLowerCase().trim();
}

function checkAnswer(transcript, target) {
  const t = normalize(transcript);
  const w = normalize(target);

  if (t === w || t.includes(w)) return true;

  const tWords = t.split(/\s+/);
  if (tWords.includes(w)) return true;

  const letters = t.replace(/[^a-z ]/g, '').trim().split(/\s+/);
  if (letters.every(l => l.length === 1) && letters.join('') === w) return true;

  const hyphenLetters = t.replace(/\s/g, '').split('-');
  if (hyphenLetters.every(l => l.length === 1) && hyphenLetters.join('') === w) return true;

  return false;
}

function processAnswer(transcript) {
  if (!S.current) return;

  const word = S.current;
  const isCorrect = checkAnswer(transcript, word.word);
  const fb = document.getElementById('feedback-bar');

  if (isCorrect) {
    S.stats[word.word].correct++;
    if (S.mode === 'synonym') S.doneItems++;
    fb.className = 'feedback-bar correct';
    fb.textContent = '✓ 정답!';
    S.current = null;
    setMicState('idle', '');
    _nextTimer = setTimeout(nextQuestion, 1400);
  } else {
    S.stats[word.word].wrong++;
    fb.className = 'feedback-bar wrong';
    fb.textContent = `✗ 틀렸습니다 — 정답: "${word.word}"`;

    const pos = S.queue.length < 2 ? S.queue.length : Math.floor(Math.random() * (S.queue.length - 1)) + 1;
    S.queue.splice(pos, 0, word);

    setMicState('idle', '');
    _nextTimer = setTimeout(() => { S.current = null; nextQuestion(); }, 2600);
  }
}

function skipWord() {
  const wordToSkip = S.current;
  if (!wordToSkip) return;

  if (_nextTimer) { clearTimeout(_nextTimer); _nextTimer = null; }
  stopRecognition();
  speechSynthesis.cancel();

  if (S.mode === 'synonym') {
    if (!S.answerProcessed) S.doneItems++;
    const idx = S.queue.findIndex(item => item.word === wordToSkip.word && item.hint === wordToSkip.hint);
    if (idx !== -1) S.queue.splice(idx, 1);
  } else {
    S.stats[wordToSkip.word].skipped = true;
    S.queue = S.queue.filter(item => item.word !== wordToSkip.word);
  }

  S.answerProcessed = true;
  S.current = null;

  const fb = document.getElementById('feedback-bar');
  fb.className = 'feedback-bar skipped';
  fb.textContent = `→ 스킵 — 정답: "${wordToSkip.word}"`;
  setMicState('idle', '');
  _nextTimer = setTimeout(nextQuestion, 1400);
}

document.getElementById('skip-btn').addEventListener('click', skipWord);

/* ── Fanfare ── */
function playFanfare() {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const sequence = [
    { freq: 523.25, start: 0,    dur: 0.12 },
    { freq: 659.25, start: 0.13, dur: 0.12 },
    { freq: 783.99, start: 0.26, dur: 0.12 },
    { freq: 1046.50,start: 0.39, dur: 0.45 },
    { freq: 783.99, start: 0.85, dur: 0.10 },
    { freq: 659.25, start: 0.96, dur: 0.10 },
    { freq: 1046.50,start: 1.07, dur: 0.55 },
  ];
  const t = ctx.currentTime;
  sequence.forEach(({ freq, start, dur }) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'square';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.18, t + start);
    gain.gain.exponentialRampToValueAtTime(0.001, t + start + dur);
    osc.start(t + start);
    osc.stop(t + start + dur + 0.05);
  });
}

/* ── Results ── */
function showResults() {
  playFanfare();

  let accuracy, totalWrong, totalSkippedCount;

  if (S.mode === 'synonym') {
    const totalCorrect = S.words.reduce((acc, w) => acc + S.stats[w.word].correct, 0);
    totalWrong = S.words.reduce((acc, w) => acc + S.stats[w.word].wrong, 0);
    totalSkippedCount = S.doneItems - totalCorrect;
    accuracy = (totalCorrect + totalWrong) > 0 ? Math.round(totalCorrect / (totalCorrect + totalWrong) * 100) : 100;
    document.getElementById('res-total-lbl').textContent = '총 문제';
    document.getElementById('res-attempts-lbl').textContent = '맞은 수';
    document.getElementById('res-total').textContent = S.totalItems;
    document.getElementById('res-attempts').textContent = totalCorrect;

    const ul = document.getElementById('result-list');
    ul.innerHTML = S.words.map(w => {
      const s = S.stats[w.word];
      const cls = s.correct > 0 && s.wrong === 0 ? 'perfect' : s.correct > 0 ? 'struggled' : 'struggled';
      const detail = s.correct > 0
        ? `${s.correct}개 정답${s.wrong > 0 ? ` / ${s.wrong}번 틀림` : ''}`
        : s.wrong > 0 ? `${s.wrong}번 틀림` : '스킵';
      return `<li class="${cls}"><span class="word">${w.word}</span><span class="tries">${detail}</span></li>`;
    }).join('');
  } else {
    const attempted = S.words.filter(w => !S.stats[w.word].skipped);
    const skipped = S.words.filter(w => S.stats[w.word].skipped);
    const totalAttempts = attempted.reduce((s, w) => s + S.stats[w.word].correct + S.stats[w.word].wrong, 0);
    totalWrong = attempted.reduce((s, w) => s + S.stats[w.word].wrong, 0);
    totalSkippedCount = skipped.length;
    accuracy = totalAttempts > 0 ? Math.round(attempted.length / totalAttempts * 100) : 100;
    document.getElementById('res-total-lbl').textContent = '총 단어';
    document.getElementById('res-attempts-lbl').textContent = '총 시도';
    document.getElementById('res-total').textContent = S.words.length;
    document.getElementById('res-attempts').textContent = totalAttempts;

    const ul = document.getElementById('result-list');
    ul.innerHTML = [
      ...attempted.sort((a, b) => S.stats[b.word].wrong - S.stats[a.word].wrong),
      ...skipped,
    ].map(w => {
      const s = S.stats[w.word];
      if (s.skipped) return `<li class="skipped-item"><span class="word">${w.word}</span><span class="tries">스킵</span></li>`;
      const cls = s.wrong === 0 ? 'perfect' : 'struggled';
      const tries = s.wrong === 0 ? '완벽!' : `${s.wrong}번 틀림`;
      return `<li class="${cls}"><span class="word">${w.word}</span><span class="tries">${tries}</span></li>`;
    }).join('');
  }

  document.getElementById('res-score').textContent = accuracy + '%';
  document.getElementById('res-desc').textContent =
    accuracy === 100 && totalSkippedCount === 0 ? '완벽합니다! 모든 문제를 맞혔습니다!' :
    accuracy >= 80 ? '훌륭합니다!' :
    accuracy >= 60 ? '잘 했어요, 계속 연습하세요!' : '다시 한번 도전해봐요!';
  document.getElementById('res-wrong').textContent = totalWrong;
  document.getElementById('res-skipped').textContent = totalSkippedCount;

  showPhase('results');
}

document.getElementById('restart-btn').addEventListener('click', () => startQuiz(S.words, S.mode));
document.getElementById('new-photo-btn').addEventListener('click', resetUpload);
