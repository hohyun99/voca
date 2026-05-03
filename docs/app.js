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

const API_KEY_STORAGE = 'gemini-api-key';

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

function init() {
  const key = localStorage.getItem(API_KEY_STORAGE);
  showPhase(key ? 'upload' : 'apikey');
}

/* ── API Key ── */
document.getElementById('save-key-btn').addEventListener('click', () => {
  const key = document.getElementById('api-key-input').value.trim();
  if (!key.startsWith('AIza')) {
    alert('올바른 Google Gemini API 키를 입력해주세요. (AIza 로 시작)');
    return;
  }
  localStorage.setItem(API_KEY_STORAGE, key);
  showPhase('upload');
});

document.getElementById('api-key-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('save-key-btn').click();
});

document.getElementById('change-key-btn').addEventListener('click', () => {
  document.getElementById('api-key-input').value = localStorage.getItem(API_KEY_STORAGE) || '';
  showPhase('apikey');
});

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
    const pairs = await analyzeImage(selectedFile);
    showWordList(pairs);
  } catch (err) {
    alert('분석 실패: ' + err.message);
    showPhase('upload');
  }
});

/* ── Gemini API (direct browser call) ── */
async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function geminiRequest(prompt, base64Image, mediaType) {
  const apiKey = localStorage.getItem(API_KEY_STORAGE);
  if (!apiKey) throw new Error('API 키가 없습니다.');

  const parts = [];
  if (base64Image) parts.push({ inline_data: { mime_type: mediaType, data: base64Image } });
  parts.push({ text: prompt });

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts }] }),
    }
  );

  const data = await res.json();

  if (data.error) {
    if (data.error.code === 400 || data.error.code === 401 || data.error.code === 403) {
      throw new Error('API 키가 올바르지 않습니다.');
    }
    throw new Error(data.error.message);
  }

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!text) throw new Error('Gemini 응답을 파싱할 수 없습니다.');
  return text;
}

async function analyzeImage(file) {
  const base64 = await fileToBase64(file);
  const mediaType = file.type || 'image/jpeg';

  const text = await geminiRequest(
    `이 이미지에서 영어 단어와 설명/정의 쌍을 모두 추출하세요.
다른 텍스트 없이 아래 형식의 JSON 배열만 반환하세요:
[{"word": "example", "definition": "a representative instance"}, ...]

규칙:
- 이미지에 보이는 모든 단어-정의 쌍을 포함하세요
- 이미지에 나온 그대로 정의를 유지하세요
- word 필드: 단어만 (구두점 제외)
- definition 필드: 전체 설명/정의`,
    base64,
    mediaType
  );

  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('단어 목록 파싱 실패');

  const pairs = JSON.parse(jsonMatch[0]);
  if (!Array.isArray(pairs) || pairs.length === 0) throw new Error('이미지에서 단어를 찾을 수 없습니다.');
  return pairs;
}

async function fetchSynonyms(words) {
  const wordList = words.map(w => w.word).join(', ');

  const text = await geminiRequest(
    `For each of the following English words, provide 1-2 synonyms and 1-2 antonyms (only if they clearly exist).
Return ONLY a JSON array with no other text:
[{"word": "example", "synonyms": ["instance", "sample"], "antonyms": ["counterexample"]}, ...]

Words: ${wordList}`,
    null,
    null
  );

  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('유의어 목록 파싱 실패');

  const parsed = JSON.parse(jsonMatch[0]);
  S.synonymData = Object.fromEntries(parsed.map(d => [d.word, d]));
}

/* ── Word list ── */
function showWordList(pairs) {
  S.words = pairs;
  document.getElementById('word-count').textContent = pairs.length;
  const ul = document.getElementById('word-list');
  ul.innerHTML = pairs.map(p => `<li><strong>${p.word}</strong>: ${p.definition}</li>`).join('');
  showPhase('wordlist');
}

document.getElementById('start-btn').addEventListener('click', () => showPhase('mode'));

document.getElementById('reupload-btn').addEventListener('click', () => {
  selectedFile = null;
  fileInput.value = '';
  previewImg.style.display = 'none';
  previewImg.src = '';
  analyzeBtn.disabled = true;
  showPhase('upload');
});

/* ── Mode selection ── */
document.getElementById('mode-back-btn').addEventListener('click', () => showPhase('wordlist'));

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

  document.getElementById('definition-text').textContent = displayText;
  document.getElementById('transcript-box').textContent = '';
  clearFeedback();
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
    alert('음성 인식은 Chrome 브라우저에서만 지원됩니다.');
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
        for (let i = 0; i < result.length; i++) finalText += result[i].transcript + ' ';
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
    setMicState('idle',
      e.error === 'no-speech'
        ? '음성이 감지되지 않았습니다. 마이크를 클릭해 다시 시도하세요.'
        : '오류 발생: ' + e.error
    );
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
  btn.className = 'mic-btn' + (state === 'listening' ? ' listening' : '');
  btn.textContent = state === 'listening' ? '🎙️' : '🎤';
  if (hint) document.getElementById('mic-hint').textContent = hint;
}

document.getElementById('mic-btn').addEventListener('click', () => {
  if (S.recognition) {
    stopRecognition();
    setMicState('idle', '마이크를 클릭해 다시 시도하세요.');
  } else if (S.current) {
    S.answerProcessed = false;
    document.getElementById('transcript-box').textContent = '';
    clearFeedback();
    startListening();
  }
});

/* ── Answer checking ── */
function checkAnswer(transcript, target) {
  const t = transcript.toLowerCase().trim();
  const w = target.toLowerCase().trim();

  if (t === w || t.includes(w)) return true;
  if (t.split(/\s+/).includes(w)) return true;

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
    setTimeout(nextQuestion, 1400);
  } else {
    S.stats[word.word].wrong++;
    fb.className = 'feedback-bar wrong';
    fb.textContent = `✗ 틀렸습니다 — 정답: "${word.word}"`;

    const pos = S.queue.length < 2 ? S.queue.length : Math.floor(Math.random() * (S.queue.length - 1)) + 1;
    S.queue.splice(pos, 0, word);

    S.current = null;
    setMicState('idle', '');
    setTimeout(nextQuestion, 2600);
  }
}

function skipWord() {
  if (!S.current || S.answerProcessed) return;
  S.answerProcessed = true;
  const word = S.current;

  if (S.mode === 'synonym') {
    S.doneItems++;
  } else {
    S.stats[word.word].skipped = true;
  }

  const fb = document.getElementById('feedback-bar');
  fb.className = 'feedback-bar skipped';
  fb.textContent = `→ 스킵 — 정답: "${word.word}"`;

  S.current = null;
  stopRecognition();
  setMicState('idle', '');
  setTimeout(nextQuestion, 1600);
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
      const cls = s.correct > 0 && s.wrong === 0 ? 'perfect' : 'struggled';
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
document.getElementById('new-photo-btn').addEventListener('click', () => {
  selectedFile = null;
  fileInput.value = '';
  previewImg.style.display = 'none';
  previewImg.src = '';
  analyzeBtn.disabled = true;
  showPhase('upload');
});

/* ── Boot ── */
init();
