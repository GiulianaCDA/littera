const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const api = async (url, opts = {}) => {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'erro na requisição');
  return data;
};

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

/* ---------------- voz (Web Speech API, nativa do navegador) ---------------- */
const tts = {
  voz: null,
  pronta: false,

  init() {
    if (!('speechSynthesis' in window)) return;
    this.escolher();
    // em vários Chromium as vozes só chegam depois, de forma assíncrona
    speechSynthesis.addEventListener('voiceschanged', () => this.escolher());
  },

  escolher() {
    const todas = speechSynthesis.getVoices();
    const en = todas.filter((v) => /^en([-_]|$)/i.test(v.lang));
    this.total = todas.length;
    if (!en.length) return false;
    this.voz =
      en.find((v) => /en[-_]US/i.test(v.lang)) ||
      en.find((v) => /en[-_]GB/i.test(v.lang)) ||
      en[0];
    this.pronta = true;
    return true;
  },

  falar(texto) {
    if (!texto) return;
    if (!('speechSynthesis' in window))
      return toast('Este navegador não expõe síntese de voz');
    if (!this.pronta) this.escolher(); // tenta de novo: pode ter carregado agora
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(texto.replace(/^to\s+/i, ''));
    if (this.voz) u.voice = this.voz;
    u.lang = this.voz ? this.voz.lang : 'en-US';
    u.rate = 0.9;
    const btn = $('#speak');
    u.onstart = () => btn.classList.add('playing');
    u.onend = u.onerror = () => btn.classList.remove('playing');
    speechSynthesis.speak(u);
  },
};
tts.init();

/* ---------------- estado ---------------- */
let queue = [];
let current = null;
let revealed = false;
let view = 'study';
let practiceCards = [];
let practiceIndex = 0;
let practiceCard = null;

/* ---------------- navegação ---------------- */
$$('.tab').forEach((tab) =>
  tab.addEventListener('click', () => {
    view = tab.dataset.view;
    $$('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + view));
    if (view === 'cards') loadList();
    if (view === 'study') loadQueue();
    if (view === 'practice') loadPractice();
  })
);

/* ---------------- estatísticas ---------------- */
function renderStats(s) {
  $('#b-due-text').textContent = s.due + ' na fila';
  $('#b-today-text').textContent = s.today + ' hoje';
  $('#b-streak-text').textContent = s.streak + 'd seguidos';

  // Indicador de urgência nas badges
  const badgeDue = $('#b-due');
  badgeDue.classList.remove('warm', 'hot');
  if (s.due > 30) {
    badgeDue.classList.add('hot');
  } else if (s.due > 15) {
    badgeDue.classList.add('warm');
  }

  $('#empty-stats').innerHTML = [
    ['Total', s.total],
    ['Novos', s.fresh],
    ['Aprendendo', s.learning],
    ['Consolidados', s.mature],
    ['Acertos', s.accuracy === null ? '—' : s.accuracy + '%'],
    ['Sequência', s.streak + 'd'],
  ]
    .map(([label, value]) => `<div class="stat"><b>${value}</b><span>${label}</span></div>`)
    .join('');
}

/* ---------------- estudo ---------------- */
async function loadQueue() {
  const { cards, stats } = await api('/api/queue');
  queue = cards;
  renderStats(stats);
  next();
}

function next() {
  current = queue.shift() || null;
  revealed = false;

  $('#card').classList.toggle('hidden', !current);
  $('#empty').classList.toggle('hidden', !!current);
  if (!current) return;

  $('#front').textContent = current.front;
  $('#back').textContent = current.back;
  $('#example').textContent = current.example || '';
  $('#card-tag').textContent = current.tag || '';
  $('#ipa').textContent = current.ipa && current.ipa !== '—' ? current.ipa : '';
  $('#card-reps').textContent =
    current.reps === 0 ? 'novo' : `revisão ${current.reps + 1}`;

  $('#answer').classList.add('hidden');
  $('#grades').classList.add('hidden');
  $('#reveal').classList.remove('hidden');

  $$('.grade').forEach((btn, i) => {
    btn.querySelector('small').textContent = current.previews[i];
  });
}

function reveal() {
  if (!current || revealed) return;
  revealed = true;
  $('#answer').classList.remove('hidden');
  $('#reveal').classList.add('hidden');
  $('#grades').classList.remove('hidden');
  tts.falar(current.front); // ouve a pronuncia junto com a resposta
}

async function grade(g) {
  if (!current || !revealed) return;
  const id = current.id;
  const card = current;
  current = null; // evita duplo envio
  const { card: updated, stats } = await api(`/api/cards/${id}/review`, {
    method: 'POST',
    body: { grade: g },
  });
  renderStats(stats);

  // errou -> volta pro fim da fila desta sessão
  if (g === 0) queue.push({ ...card, ...updated, previews: card.previews });

  // fila local acabou: busca o próximo lote no servidor
  if (queue.length === 0) return loadQueue();
  next();
}

$('#speak').addEventListener('click', (e) => {
  e.stopPropagation();
  if (current) tts.falar(current.front);
});

$('#reveal').addEventListener('click', reveal);
$$('.grade').forEach((b) => b.addEventListener('click', () => grade(+b.dataset.grade)));

async function loadPractice() {
  try {
    const { cards } = await api('/api/cards');
    practiceCards = cards.sort(() => Math.random() - 0.5);
    practiceIndex = 0;
    $('#practice-empty').classList.toggle('hidden', practiceCards.length > 0);
    $('.practice-card').classList.toggle('hidden', !practiceCards.length);
    if (practiceCards.length) showPracticeCard();
  } catch (err) { toast(err.message); }
}

function showPracticeCard() {
  if (!practiceCards.length) return;
  if (practiceIndex >= practiceCards.length) {
    practiceCards.sort(() => Math.random() - 0.5);
    practiceIndex = 0;
  }
  practiceCard = practiceCards[practiceIndex++];
  $('#practice-front').textContent = practiceCard.front;
  $('#practice-count').textContent = `${practiceIndex} / ${practiceCards.length}`;
  $('#practice-input').value = '';
  $('#practice-result').className = 'practice-result hidden';
  $('#practice-loading').classList.remove('hidden');
  $('#practice-feedback').classList.add('hidden');
  $('#practice-next').classList.add('hidden');
  $('#practice-submit').classList.remove('hidden');
  $('#practice-input').disabled = false;
  $('#practice-input').focus();
}

$('#practice-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!practiceCard) return;
  const input = $('#practice-input');
  const button = $('#practice-submit');
  const result = $('#practice-result');
  const loading = $('#practice-loading');
  const feedback = $('#practice-feedback');
  const errorDiv = $('#practice-error');

  button.disabled = true;
  button.classList.add('loading');
  result.classList.remove('hidden');
  result.className = 'practice-result'; // Reset class
  loading.classList.remove('hidden');
  feedback.classList.add('hidden');
  errorDiv.classList.add('hidden');
  errorDiv.textContent = '';
  $('#practice-next').classList.add('hidden');
  $('#practice-skip').classList.add('hidden');

  try {
    const review = await api('/api/practice/evaluate', {
      method: 'POST',
      body: { target: practiceCard.front, sentence: input.value.trim() },
    });
    result.className = `practice-result ${review.correct ? 'correct' : 'incorrect'}`;

    const icon = $('#result-icon');
    const status = feedback.querySelector('strong');
    const level = $('#result-level');
    const correction = $('#result-correction');

    if (review.correct) {
      icon.textContent = '';
      status.textContent = 'Correta!';
    } else {
      icon.textContent = '';
      status.textContent = 'Precisa de ajuste';
    }

    level.textContent = `Complexidade: ${review.complexity}`;

    if (!review.correct && review.correction) {
      // Create animated correction with strikethrough and fade-in
      const userSentence = input.value.trim();
      const corrected = review.correction.trim();

      // Simple word-by-word comparison to find the incorrect word
      const userWords = userSentence.toLowerCase().split(/\s+/);
      const correctedWords = corrected.toLowerCase().split(/\s+/);

      let html = '';
      const words = corrected.split(/\s+/);
      words.forEach((word, i) => {
        const userWord = userWords[i];
        const isWrong = userWord && userWord !== word.toLowerCase();

        if (isWrong) {
          // Incorrect word with strikethrough
          html += `<span class="strikethrough-word">${esc(userWord)}</span> <span class="correction-text">${esc(word)}</span>`;
        } else {
          html += `<span class="correction-text">${esc(word)}</span>`;
        }
        if (i < words.length - 1) html += ' ';
      });

      correction.innerHTML = html;
      correction.classList.remove('hidden');
    } else {
      correction.classList.add('hidden');
    }

    // Hide loading, show feedback
    loading.classList.add('hidden');
    feedback.classList.remove('hidden');
    button.classList.add('hidden');
    $('#practice-next').classList.remove('hidden');
    $('#practice-skip').classList.remove('hidden');
  } catch (err) {
    loading.classList.add('hidden');
    errorDiv.classList.remove('hidden');
    errorDiv.textContent = `Erro: ${err.message}`;
    result.className = 'practice-result incorrect';
    feedback.classList.add('hidden');
    $('#practice-skip').classList.remove('hidden');
  } finally {
    button.disabled = false;
    button.classList.remove('loading');
  }
});
$('#practice-next').addEventListener('click', showPracticeCard);
$('#practice-skip').addEventListener('click', showPracticeCard);

document.addEventListener('keydown', (e) => {
  if (view !== 'study' || e.target.matches('input, textarea')) return;
  if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault();
    revealed ? grade(2) : reveal();
  } else if (['1', '2', '3', '4'].includes(e.key)) {
    e.preventDefault();
    grade(+e.key - 1);
  } else if (e.key === 'p' || e.key === 'P') {
    e.preventDefault();
    if (current) tts.falar(current.front);
  } else if (e.key === 'e' || e.key === 'E') {
    e.preventDefault();
    if (current && current.example) tts.falar(current.example);
  }
});

/* ---------------- lista ---------------- */
const dueLabel = (due) => {
  const diff = due - Date.now();
  if (diff <= 0) return 'agora';
  const min = Math.round(diff / 60000);
  if (min < 60) return `em ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `em ${h} h`;
  const d = Math.round(h / 24);
  return d < 30 ? `em ${d} d` : `em ${Math.round(d / 30)} m`;
};

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function loadList() {
  const q = $('#search').value.trim();
  const { cards } = await api('/api/cards?q=' + encodeURIComponent(q));
  $('#list').innerHTML =
    cards
      .map(
        (c) => `<div class="row" data-id="${c.id}">
          <div class="row-main">
            <div class="row-en">${esc(c.front)}</div>
            <div class="row-pt">${esc(c.back)}</div>
            <div class="row-ipa">${c.ipa && c.ipa !== '—' ? esc(c.ipa) : ''}</div>
          </div>
          <div class="row-due ${c.due <= Date.now() ? 'now' : ''}">${dueLabel(c.due)}</div>
          <button class="icon-btn" title="Excluir">×</button>
        </div>`
      )
      .join('') || '<p class="muted">Nenhum cartão encontrado.</p>';
}

let searchTimer;
$('#search').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadList, 180);
});

$('#list').addEventListener('click', async (e) => {
  const btn = e.target.closest('.icon-btn');
  if (!btn) return;
  const row = btn.closest('.row');
  await api('/api/cards/' + row.dataset.id, { method: 'DELETE' });
  row.remove();
  toast('Cartão excluído');
  refreshBadges();
});

/* ---------------- formulários ---------------- */
$('#form-one').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    await api('/api/cards', {
      method: 'POST',
      body: {
        front: f.get('front'),
        back: f.get('back'),
        example: f.get('example'),
        tag: f.get('tag'),
        ipa: f.get('ipa'),
      },
    });
    const tag = f.get('tag');
    e.target.reset();
    e.target.tag.value = tag; // mantém a categoria para o próximo
    e.target.front.focus();
    toast('Cartão adicionado');
    refreshBadges();
  } catch (err) {
    toast(err.message);
  }
});

$('#form-bulk').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    const { created } = await api('/api/cards/bulk', {
      method: 'POST',
      body: { text: f.get('text'), tag: f.get('tag') },
    });
    e.target.text.value = '';
    toast(created ? `${created} cartões importados` : 'Nenhuma linha válida');
    refreshBadges();
  } catch (err) {
    toast(err.message);
  }
});

$('#test-voice').addEventListener('click', () => {
  if (!('speechSynthesis' in window))
    return toast('Este navegador não expõe síntese de voz');
  tts.escolher();
  const todas = speechSynthesis.getVoices();
  const en = todas.filter((v) => /^en([-_]|$)/i.test(v.lang));
  console.log('[srs] vozes disponíveis:', todas.map((v) => `${v.name} (${v.lang})`));
  if (!en.length) {
    toast(`Nenhuma voz em inglês. ${todas.length} vozes no total — veja o console (F12).`);
    return;
  }
  toast(`${en.length} voz(es) em inglês. Usando: ${tts.voz.name}`);
  tts.falar('Hello. This is a pronunciation test.');
});

$('#fetch-ipa').addEventListener('click', async (e) => {
  const btn = e.target;
  btn.disabled = true;
  btn.textContent = 'Buscando…';
  try {
    const r = await api('/api/pronuncia', { method: 'POST' });
    toast(
      r.verificados === 0
        ? 'Todos os cartoes já foram verificados'
        : `${r.achou} de ${r.verificados} com transcrição`
    );
    loadList();
  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Buscar IPA';
  }
});

async function refreshBadges() {
  renderStats(await api('/api/stats'));
}

loadQueue();
