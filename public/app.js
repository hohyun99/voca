/* ── State ── */
const S = {
  words: [],
  queue: [],
  current: null,
  stats: {},
  recognition: null,
  answerProcessed: false,
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

document.getElementById('start-btn').addEventListener('click', () => startQuiz(S.words));
document.getElementById('reupload-btn').addEventListener('click', resetUpload);

function resetUpload() {
  selectedFile = null;
  fileInput.value = '';
  previewImg.style.display = 'none';
  previewImg.src = '';
  analyzeBtn.disabled = true;
  showPhase('upload');
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

function startQuiz(words) {
  S.words = words;
  S.queue = shuffle([...words]);
  S.stats = Object.fromEntries(words.map(w => [w.word, { correct: 0, wrong: 0 }]));
  showPhase('quiz');
  nextQuestion();
}

async function nextQuestion() {
  stopRecognition();
  speechSynthesis.cancel();

  if (S.queue.length === 0) {
    showResults();
    return;
  }

  S.current = S.queue.shift();
  S.answerProcessed = false;

  updateProgress();
  setDefinition(S.current.definition);
  clearFeedback();
  clearTranscript();
  setMicState('idle', '읽어드리는 중...');

  await speakDefinition(S.current.definition);

  if (S.current) {
    setMicState('idle', '단어와 스펠링을 말하세요 (마이크 클릭으로 재시도)');
    startListening();
  }
}

function updateProgress() {
  const total = S.words.length;
  const done = S.words.filter(w => S.stats[w.word].correct > 0).length;
  document.getElementById('progress-text').textContent = `${done} / ${total}`;
  document.getElementById('progress-fill').style.width = `${(done / total) * 100}%`;
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

  // Word appears directly in transcript
  if (t === w || t.includes(w)) return true;

  // Handle multi-word targets with minor boundary differences
  const tWords = t.split(/\s+/);
  if (tWords.includes(w)) return true;

  // Spelled-out: "a p p l e" or "A-P-P-L-E" -> "apple"
  const letters = t.replace(/[^a-z ]/g, '').trim().split(/\s+/);
  if (letters.every(l => l.length === 1) && letters.join('') === w) return true;

  // Hyphenated spelling: "a-p-p-l-e"
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
    fb.className = 'feedback-bar correct';
    fb.textContent = '✓ 정답!';
    S.current = null;
    setMicState('idle', '');
    setTimeout(nextQuestion, 1400);
  } else {
    S.stats[word.word].wrong++;
    fb.className = 'feedback-bar wrong';
    fb.textContent = `✗ 틀렸습니다 — 정답: "${word.word}"`;

    // Reinsert word at a random non-immediate position
    const pos = S.queue.length < 2 ? S.queue.length : Math.floor(Math.random() * (S.queue.length - 1)) + 1;
    S.queue.splice(pos, 0, word);

    S.current = null;
    setMicState('idle', '');
    setTimeout(nextQuestion, 2600);
  }
}

/* ── Results ── */
function showResults() {
  const total = S.words.length;
  const totalAttempts = S.words.reduce((s, w) => s + S.stats[w.word].correct + S.stats[w.word].wrong, 0);
  const totalWrong = S.words.reduce((s, w) => s + S.stats[w.word].wrong, 0);
  const accuracy = totalAttempts > 0 ? Math.round((total / totalAttempts) * 100) : 100;

  document.getElementById('res-score').textContent = accuracy + '%';
  document.getElementById('res-desc').textContent =
    accuracy === 100 ? '모든 단어를 한 번에 맞혔습니다!' :
    accuracy >= 80 ? '훌륭합니다!' :
    accuracy >= 60 ? '잘 했어요, 계속 연습하세요!' : '다시 한번 도전해봐요!';
  document.getElementById('res-total').textContent = total;
  document.getElementById('res-attempts').textContent = totalAttempts;
  document.getElementById('res-wrong').textContent = totalWrong;

  const ul = document.getElementById('result-list');
  ul.innerHTML = S.words
    .sort((a, b) => S.stats[b.word].wrong - S.stats[a.word].wrong)
    .map(w => {
      const s = S.stats[w.word];
      const cls = s.wrong === 0 ? 'perfect' : 'struggled';
      const tries = s.wrong === 0 ? '완벽!' : `${s.wrong}번 틀림`;
      return `<li class="${cls}"><span class="word">${w.word}</span><span class="tries">${tries}</span></li>`;
    })
    .join('');

  showPhase('results');
}

document.getElementById('restart-btn').addEventListener('click', () => startQuiz(S.words));
document.getElementById('new-photo-btn').addEventListener('click', resetUpload);
