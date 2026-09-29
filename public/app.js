const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const api = async (url, opts = {}) => {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch { /* corpo vazio ou nao-JSON */ }
  if (!res.ok) throw new Error(data.error || 'erro na requisição');
  return data;
};

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// preferência simples guardada no navegador (tolera storage bloqueado)
const pref = {
  get(k, d) { try { return localStorage.getItem('littera.' + k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('littera.' + k, v); } catch { /* ignora */ } },
};

/* ---------------- toast (com ação opcional, ex.: Desfazer) ---------------- */
let toastTimer;
function toast(msg, { action, onAction, duration = 2600 } = {}) {
  $('#toast-text').textContent = msg;
  const btn = $('#toast-action');
  btn.classList.toggle('hidden', !action);
  btn.textContent = action || '';
  btn.onclick = () => {
    clearTimeout(toastTimer);
    $('#toast').classList.remove('show');
    onAction?.();
  };
  $('#toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').classList.remove('show'), action ? Math.max(duration, 6000) : duration);
}

/* Success sound (Web Audio API) */
let audioCtx;
function playSuccessSound() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const ctx = audioCtx;
    const now = ctx.currentTime;
    [[800, 0, 0.15], [1200, 0.1, 0.25]].forEach(([freq, from, to]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.3, now + from);
      gain.gain.exponentialRampToValueAtTime(0.01, now + to);
      osc.start(now + from);
      osc.stop(now + to);
    });
  } catch {
    // sem áudio disponível
  }
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

  // expr: true remove o "to " de infinitivos ("to arise" -> "arise"); frases ficam intactas
  falar(texto, btn, { expr = false } = {}) {
    if (!texto) return;
    if (!('speechSynthesis' in window))
      return toast('Este navegador não expõe síntese de voz');
    if (!this.pronta) this.escolher(); // tenta de novo: pode ter carregado agora
    speechSynthesis.cancel();
    $$('.speak.playing, .audio-btn.playing').forEach((b) => b.classList.remove('playing'));
    const u = new SpeechSynthesisUtterance(expr ? texto.replace(/^to\s+/i, '') : texto);
    if (this.voz) u.voice = this.voz;
    u.lang = this.voz ? this.voz.lang : 'en-US';
    u.rate = 0.9;
    if (btn) {
      u.onstart = () => btn.classList.add('playing');
      u.onend = u.onerror = () => btn.classList.remove('playing');
    }
    speechSynthesis.speak(u);
  },
};
tts.init();

const SPEAKER_SVG =
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a9 9 0 0 1 0 14"/></svg>';

/* ---------------- estado global ---------------- */
let view = 'study';
let allCards = [];          // cache de todos os cartões (lista, duplicatas, categorias)
const dialogOpen = () => !!document.querySelector('dialog[open]');

const STAGE = {
  new: 'Novo',
  learning: 'Aprendendo',
  review: 'Revisão',
};
const stageChip = (stage) => `<span class="stage stage-${stage}">${STAGE[stage] || ''}</span>`;

// categoria padronizada na exibição: "phrasal verb" -> "Phrasal verb"
const catLabel = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : '');

/* ---------------- navegação (abas com teclado) ---------------- */
function switchView(name, { focusTab = false } = {}) {
  view = name;
  $$('.tab').forEach((t) => {
    const on = t.dataset.view === name;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', on);
    t.tabIndex = on ? 0 : -1;
    if (on && focusTab) t.focus();
  });
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));
  closeMenu();

  if (name === 'cards') loadCards();
  if (name === 'study') {
    if (studyActive && current) refreshBadges();
    else loadQueue();
  }
  if (name === 'practice') {
    if (!(pSession && pSession.idx < pSession.cards.length)) loadPractice();
    else $('#practice-input').focus();
  }
}

$$('.tab').forEach((tab) => tab.addEventListener('click', () => switchView(tab.dataset.view)));
$('nav').addEventListener('keydown', (e) => {
  const tabs = [...$$('.tab')];
  const i = tabs.findIndex((t) => t === document.activeElement);
  if (i < 0) return;
  let n = null;
  if (e.key === 'ArrowRight') n = (i + 1) % tabs.length;
  else if (e.key === 'ArrowLeft') n = (i - 1 + tabs.length) % tabs.length;
  else if (e.key === 'Home') n = 0;
  else if (e.key === 'End') n = tabs.length - 1;
  if (n === null) return;
  e.preventDefault();
  switchView(tabs[n].dataset.view, { focusTab: true });
});

/* ---------------- estatísticas / badges ---------------- */
let lastStats = null;
function renderStats(s) {
  lastStats = s;
  $('#b-due-text').textContent = `${s.due} para revisar`;
  $('#b-today-text').textContent = `${s.today} ${s.today === 1 ? 'revisado' : 'revisados'} hoje`;
  $('#b-streak-text').textContent = `🔥 ${plural(s.streak, 'dia', 'dias')}`;

  // verde = fila normal; laranja/vermelho só quando o acúmulo vira alerta
  const badgeDue = $('#b-due');
  badgeDue.classList.toggle('idle', s.due === 0);
  badgeDue.classList.toggle('warm', s.due > 60 && s.due <= 120);
  badgeDue.classList.toggle('hot', s.due > 120);
  badgeDue.title =
    s.due > 60
      ? 'Muitos cartões acumulados. Revisar um pouco todo dia evita que a fila cresça.'
      : 'Cartões que já venceram e esperam revisão agora';
  $('#b-streak').classList.toggle('idle', s.streak === 0);

  $('#empty-stats').innerHTML = statGrid([
    ['Total', s.total],
    ['Novos', s.fresh],
    ['Aprendendo', s.learning],
    ['Consolidados', s.mature],
    ['Acertos', s.accuracy === null ? '—' : s.accuracy + '%'],
    ['Sequência', plural(s.streak, 'dia', 'dias')],
  ]);
}

const statGrid = (items) =>
  items.map(([label, value]) => `<div class="stat"><b>${value}</b><span>${label}</span></div>`).join('');

async function refreshBadges() {
  const s = await api('/api/stats');
  renderStats(s);
  return s;
}

/* ================================================================
   ESTUDAR
   ================================================================ */
const SESSION_SIZE = 20;
let queue = [];
let current = null;
let revealed = false;
let studyActive = false;
let reverse = pref.get('reverse', '0') === '1';
let session = { done: 0, total: 0, missed: 0 };

async function loadQueue({ keepSession = false } = {}) {
  try {
    const { cards, stats } = await api('/api/queue?limit=' + SESSION_SIZE);
    queue = cards;
    renderStats(stats);
    if (!keepSession) session = { done: 0, total: cards.length, missed: 0 };
    else session.total += cards.length;
    studyActive = cards.length > 0;
    next();
  } catch (err) {
    toast(err.message);
  }
}

// realça a expressão-alvo no exemplo (aceita flexões: achieve -> achieved / achieving)
const STOP = new Set(['to', 'of', 'a', 'an', 'the', 'it', 'be', 'in', 'on', 'as', 'by', 'at']);
const IRREGULAR = {
  be: 'is|am|are|was|were|been|being', come: 'came|comes|coming', get: 'got|gets|gotten|getting',
  go: 'went|goes|gone|going', run: 'ran|runs|running', make: 'made|makes|making',
  keep: 'kept|keeps|keeping', bring: 'brought|brings|bringing', take: 'took|taken|takes|taking',
  give: 'gave|given|gives|giving', find: 'found|finds|finding', think: 'thought|thinks|thinking',
  put: 'puts|putting', set: 'sets|setting', hold: 'held|holds|holding', know: 'knew|known|knows',
  see: 'saw|seen|sees|seeing', say: 'said|says|saying', do: 'did|done|does|doing',
  have: 'had|has|having', arise: 'arose|arisen|arises|arising', break: 'broke|broken|breaks',
  buy: 'bought|buys', tell: 'told|tells', build: 'built|builds', leave: 'left|leaves',
};
function highlightTarget(text, front) {
  if (!text) return '';
  const words = front.toLowerCase().replace(/^to\s+/, '').split(/\s+/).filter((w) => w && !STOP.has(w));
  const pats = words.map((w) => {
    const clean = w.replace(/[^a-z'-]/g, '');
    if (!clean) return null;
    if (IRREGULAR[clean]) return `\\b(?:${clean}|${IRREGULAR[clean]})\\b`;
    if (clean.length <= 3) return `\\b${clean}\\b`;
    const stem = clean.replace(/(ing|ed|es|e|s)$/, '');
    return `\\b${(stem.length >= 3 ? stem : clean).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\w*`;
  }).filter(Boolean);
  if (!pats.length) return esc(text);
  const marked = text.replace(new RegExp(`(${pats.join('|')})`, 'gi'), '\u0000$1\u0001');
  return esc(marked).replace(/\u0000/g, '<mark>').replace(/\u0001/g, '</mark>');
}

function next() {
  current = queue.shift() || null;
  revealed = false;

  if (!current) return finishStudy();

  $('#card').classList.remove('hidden');
  $('#empty').classList.add('hidden');
  $('#study-done').classList.add('hidden');
  $('#study-bar').classList.remove('hidden');

  // frente/verso conforme a direção escolhida
  const en = current.front;
  const pt = current.back;
  $('#front').textContent = reverse ? pt : en;
  $('#front').lang = reverse ? 'pt-BR' : 'en';
  $('#back').textContent = reverse ? en : pt;
  $('#back').lang = reverse ? 'en' : 'pt-BR';
  $('#example').innerHTML = highlightTarget(current.example || '', en);
  $('#example-row').classList.toggle('hidden', !current.example);
  $('#card-tag').textContent = catLabel(current.tag);
  $('#card-stage').className = `stage stage-${current.stage}`;
  $('#card-stage').textContent = STAGE[current.stage];
  $('#card-stage').title =
    current.stage === 'new' ? 'Você ainda não revisou este cartão'
    : current.stage === 'learning' ? 'Em memorização: os intervalos ainda são curtos (menos de 21 dias)'
    : 'Consolidado: intervalos longos (21 dias ou mais)';
  $('#ipa').textContent = current.ipa && current.ipa !== '—' ? current.ipa : '';

  // no modo PT → EN a pronúncia só aparece junto da resposta em inglês
  const pron = $('#pron');
  if (reverse) $('#answer').insertBefore(pron, $('#example-row'));
  else $('#card').insertBefore(pron, $('#answer'));

  $('#answer').classList.add('hidden');
  $('#grades').classList.add('hidden');
  $('#grades-hint').classList.add('hidden');
  $('#reveal').classList.remove('hidden');
  $('#reveal').focus({ preventScroll: true });

  $$('.grade').forEach((btn, i) => {
    const label = current.previews[i];
    btn.querySelector('.g-int').textContent = label;
    btn.setAttribute('aria-label', `${btn.querySelector('.g-name').textContent}, revisar de novo em ${label}`);
  });
  renderProgress();
}

function renderProgress() {
  const { done, total } = session;
  $('#study-progress-text').textContent = `${done} de ${total}`;
  $('#study-progress-fill').style.width = (total ? (done / total) * 100 : 0) + '%';
  $('.progress').setAttribute('aria-valuenow', total ? Math.round((done / total) * 100) : 0);
}

async function finishStudy() {
  studyActive = false;
  $('#card').classList.add('hidden');
  $('#study-bar').classList.add('hidden');

  if (session.done === 0) {
    $('#empty').classList.remove('hidden');
    $('#study-done').classList.add('hidden');
    return;
  }
  $('#empty').classList.add('hidden');
  const s = lastStats;
  const acc = session.done ? Math.round(((session.done - session.missed) / session.done) * 100) : 0;
  $('#study-done-text').textContent =
    s && s.due > 0
      ? `Ainda há ${plural(s.due, 'cartão pendente', 'cartões pendentes')}. Faça uma pausa ou continue.`
      : 'Fila zerada. Volte mais tarde — os próximos cartões vencem sozinhos.';
  $('#study-done-stats').innerHTML = statGrid([
    ['Revisados', session.done],
    ['Acertos', acc + '%'],
    ['Errei', session.missed],
    ['Ainda pendentes', s ? s.due : '—'],
  ]);
  $('#study-more').classList.toggle('hidden', !(s && s.due > 0));
  $('#study-done').classList.remove('hidden');
  $('#study-done').querySelector('h2').focus?.();
}

function reveal() {
  if (!current || revealed) return;
  revealed = true;
  $('#answer').classList.remove('hidden');
  $('#reveal').classList.add('hidden');
  $('#grades').classList.remove('hidden');
  $('#grades-hint').classList.remove('hidden');
  tts.falar(current.front, $('#speak'), { expr: true }); // ouve a pronúncia junto com a resposta
}

async function grade(g) {
  if (!current || !revealed) return;
  const card = current;
  current = null; // evita duplo envio
  try {
    const { card: updated, stats } = await api(`/api/cards/${card.id}/review`, {
      method: 'POST',
      body: { grade: g },
    });
    renderStats(stats);
    session.done += 1;
    if (g === 0) {
      session.missed += 1;
      // errou -> volta pro fim da fila desta sessão
      session.total += 1;
      queue.push(updated);
    }
  } catch (err) {
    current = card; // deixa tentar de novo
    return toast(err.message);
  }
  next();
}

$('#speak').addEventListener('click', () => current && tts.falar(current.front, $('#speak'), { expr: true }));
$('#speak-example').addEventListener('click', () => current?.example && tts.falar(current.example, $('#speak-example')));
$('#reveal').addEventListener('click', reveal);
$$('.grade').forEach((b) => b.addEventListener('click', () => grade(+b.dataset.grade)));
$('#study-more').addEventListener('click', () => loadQueue());

function setDirection(rev) {
  reverse = rev;
  pref.set('reverse', rev ? '1' : '0');
  $('#dir-fwd').setAttribute('aria-pressed', !rev);
  $('#dir-rev').setAttribute('aria-pressed', rev);
  if (current) {
    // re-renderiza o cartão atual na nova direção (sem consumir da fila)
    queue.unshift(current);
    next();
  }
}
$('#dir-fwd').addEventListener('click', () => setDirection(false));
$('#dir-rev').addEventListener('click', () => setDirection(true));
setDirection(reverse);

document.addEventListener('keydown', (e) => {
  if (view !== 'study' || dialogOpen() || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.matches('input, textarea, select')) return;
  const onControl = e.target.closest('button, a, summary');

  if ((e.key === ' ' || e.key === 'Enter') && !onControl) {
    e.preventDefault();
    revealed ? grade(2) : reveal();
  } else if (['1', '2', '3', '4'].includes(e.key)) {
    e.preventDefault();
    grade(+e.key - 1);
  } else if (e.key === 'p' || e.key === 'P') {
    e.preventDefault();
    if (current) tts.falar(current.front, $('#speak'), { expr: true });
  } else if (e.key === 'e' || e.key === 'E') {
    e.preventDefault();
    if (current && current.example) tts.falar(current.example, $('#speak-example'));
  }
});

/* ================================================================
   PRATICAR
   ================================================================ */
const PRACTICE_SIZE = 10;
let pSession = null; // { cards, idx, results: {cardId: {verdict, sentence, corrected}}, skipped }
let pCard = null;
let pState = 'idle'; // idle | evaluating | result | error
let pToken = 0;      // descarta respostas de avaliações antigas

const IDEAS = [
  'Escreva sobre o seu trabalho ou estudos.',
  'Escreva sobre o que você fez ontem.',
  'Escreva sobre um plano para o fim de semana.',
  'Escreva sobre alguém da sua família ou um amigo.',
  'Escreva sobre a última viagem ou passeio que você fez.',
  'Escreva sobre um problema que você resolveu recentemente.',
  'Escreva sobre algo que você quer aprender ou conquistar.',
  'Escreva sobre a sua rotina de manhã.',
];
let ideaIdx = Math.floor(Math.random() * IDEAS.length);

const VERDICT = {
  correct: {
    label: 'Correta', cls: 'ok', sub: 'Frase completa, com a expressão bem usada.',
    svg: '<polyline points="20 6 9 17 4 12"/>',
  },
  almost: {
    label: 'Quase lá', cls: 'warn', sub: 'Você está perto: falta só um ajuste.',
    svg: '<line x1="12" y1="6" x2="12" y2="13"/><line x1="12" y1="18" x2="12.01" y2="18"/>',
  },
  incorrect: {
    label: 'Precisa de ajuste', cls: 'bad', sub: 'Vamos ajustar isto antes de seguir.',
    svg: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  },
};
const ISSUE_LABEL = { grammar: 'Gramática', meaning: 'Sentido', structure: 'Estrutura', naturalness: 'Naturalidade' };

/* ---- diff por palavras (LCS) entre a frase do usuário e a correção, ambas em inglês ---- */
const TOKEN_RE = /[A-Za-z0-9À-ÿ]+(?:['’-][A-Za-z0-9À-ÿ]+)*|[^\sA-Za-z0-9À-ÿ]/g;
const NO_SPACE_BEFORE = /^[.,;:!?)\]”’%]$/;
const NO_SPACE_AFTER = /^[(\[“‘]$/;

function joinTokens(tokens) {
  let out = '';
  tokens.forEach((t, i) => {
    if (i > 0 && !NO_SPACE_BEFORE.test(t) && !NO_SPACE_AFTER.test(tokens[i - 1])) out += ' ';
    out += t;
  });
  return out;
}

function diffWords(before, after) {
  const a = before.match(TOKEN_RE) || [];
  const b = after.match(TOKEN_RE) || [];
  const n = a.length;
  const m = b.length;
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);

  // percorre o LCS gerando runs consecutivos de eq / del / add
  const runs = [];
  const push = (type, tok) => {
    const last = runs[runs.length - 1];
    if (last && last.type === type) last.tokens.push(tok);
    else runs.push({ type, tokens: [tok] });
  };
  let i = 0;
  let j = 0;
  const dels = [];
  const adds = [];
  const flush = () => {
    dels.splice(0).forEach((t) => push('del', t));
    adds.splice(0).forEach((t) => push('add', t));
  };
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { flush(); push('eq', a[i]); i++; j++; }
    else if (j < m && (i === n || L[i][j + 1] >= L[i + 1][j])) adds.push(b[j++]);
    else dels.push(a[i++]);
  }
  flush();
  return runs;
}

function renderDiff(before, after) {
  const runs = diffWords(before, after);
  return runs
    .map((r, idx) => {
      const text = esc(joinTokens(r.tokens));
      const gap = idx > 0 && !NO_SPACE_BEFORE.test(r.tokens[0]) ? ' ' : '';
      if (r.type === 'del') return `${gap}<del class="diff-del"><span class="sr-only">removido: </span>${text}</del>`;
      if (r.type === 'add') return `${gap}<ins class="diff-add"><span class="sr-only">adicionado: </span>${text}</ins>`;
      return gap + text;
    })
    .join('');
}

/* ---- sessão de prática ---- */
async function loadPractice() {
  try {
    const { cards, dueTotal } = await api(`/api/practice/queue?limit=${PRACTICE_SIZE}`);
    pSession = { cards, idx: 0, results: {}, skipped: 0, dueTotal };
    $('#practice-summary').classList.add('hidden');
    $('#practice-empty').classList.toggle('hidden', cards.length > 0);
    $('#practice-main').classList.toggle('hidden', !cards.length);
    if (cards.length) showPracticeCard();
  } catch (err) { toast(err.message); }
}

function setLocked(locked) {
  const input = $('#practice-input');
  input.readOnly = locked;
  $('#practice-input-group').classList.toggle('locked', locked);
  $('#practice-lock').classList.toggle('hidden', !locked);
}

function resetResultUI() {
  const group = $('#practice-input-group');
  group.classList.remove('state-ok', 'state-warn', 'state-bad');
  $('#practice-result').classList.add('hidden');
  $('#practice-loading').classList.add('hidden');
  $('#practice-error').classList.add('hidden');
  $('#practice-feedback').classList.add('hidden');
  $('#practice-feedback').innerHTML = '';
}

function setPracticeButtons(state) {
  const submit = $('#practice-submit');
  const showSubmit = state === 'idle' || state === 'error' || state === 'evaluating';
  submit.classList.toggle('hidden', !showSubmit);
  submit.classList.toggle('loading', state === 'evaluating');
  submit.disabled = state === 'evaluating' || $('#practice-input').value.trim().length === 0;
  submit.firstChild.textContent = state === 'evaluating' ? 'Avaliando… ' : 'Verificar ';
  $('#practice-skip').classList.toggle('hidden', !(state === 'idle' || state === 'error'));
  $('#practice-retry').classList.toggle('hidden', state !== 'result' || pLastVerdict === 'correct');
  $('#practice-next').classList.toggle('hidden', state !== 'result');
}
let pLastVerdict = null;

function showPracticeCard() {
  const s = pSession;
  if (s.idx >= s.cards.length) return showPracticeSummary();
  pCard = s.cards[s.idx];
  pState = 'idle';
  pLastVerdict = null;
  pToken++;

  $('#practice-front').textContent = pCard.front;
  $('#practice-count').textContent = `Frase ${s.idx + 1} de ${s.cards.length}`;
  $('#practice-input').value = '';
  setLocked(false);
  resetResultUI();

  // ajudas sob demanda
  $('#practice-meaning').classList.add('hidden');
  $('#practice-meaning-btn').textContent = 'Ver significado';
  $('#practice-meaning-btn').setAttribute('aria-expanded', 'false');
  $('#practice-idea').classList.add('hidden');
  $('#practice-idea-btn').setAttribute('aria-expanded', 'false');
  $('#practice-meaning-back').textContent = pCard.back;
  $('#practice-meaning-example').innerHTML = pCard.example
    ? `<em>${highlightTarget(pCard.example, pCard.front)}</em>`
    : '';

  setPracticeButtons('idle');
  $('#practice-input').focus();
}

$('#practice-meaning-btn').addEventListener('click', () => {
  const box = $('#practice-meaning');
  const open = box.classList.toggle('hidden') === false;
  $('#practice-meaning-btn').textContent = open ? 'Ocultar significado' : 'Ver significado';
  $('#practice-meaning-btn').setAttribute('aria-expanded', open);
});

function renderIdea() {
  $('#practice-idea').innerHTML =
    `<span>${esc(IDEAS[ideaIdx])}</span> <button type="button" class="link-btn" id="practice-idea-next">Outra ideia</button>`;
}
$('#practice-idea-btn').addEventListener('click', () => {
  const box = $('#practice-idea');
  const open = box.classList.contains('hidden');
  if (open) renderIdea();
  box.classList.toggle('hidden', !open);
  $('#practice-idea-btn').setAttribute('aria-expanded', open);
});
$('#practice-idea').addEventListener('click', (e) => {
  if (!e.target.closest('#practice-idea-next')) return;
  ideaIdx = (ideaIdx + 1) % IDEAS.length;
  renderIdea();
  $('#practice-idea-next').focus();
});

$('#practice-input').addEventListener('input', () => {
  if (pState === 'idle' || pState === 'error') setPracticeButtons(pState);
});

function feedbackHTML(r, sentence) {
  const v = VERDICT[r.verdict];
  const issues = r.issues.length
    ? `<section class="fb-sec"><h4>O que ajustar</h4><ul class="issues">${r.issues
        .map((i) => `<li><span class="issue-type">${ISSUE_LABEL[i.type]}</span>${esc(i.explanation_pt)}</li>`)
        .join('')}</ul></section>`
    : '';

  const showCorrection = r.verdict !== 'correct' && r.corrected_sentence;
  const corrected = showCorrection
    ? `<section class="fb-sec"><h4>Frase corrigida</h4>
        <p class="diff" lang="en">${renderDiff(sentence, r.corrected_sentence)}</p>
        <p class="diff-legend"><del class="diff-del">removido</del> <ins class="diff-add">adicionado</ins></p>
       </section>`
    : '';

  const alt = r.natural_alternative && r.natural_alternative !== sentence
    ? `<section class="fb-sec"><h4>${r.verdict === 'correct' ? 'Para evoluir: uma versão mais natural' : 'Como um nativo diria'}</h4>
        <p class="alt" lang="en"><span>${esc(r.natural_alternative)}</span>
          <button type="button" class="audio-btn" data-say="${esc(r.natural_alternative)}" aria-label="Ouvir esta frase" title="Ouvir esta frase">${SPEAKER_SVG}</button>
        </p></section>`
    : '';

  const tip = r.tip_pt
    ? `<section class="fb-sec tip"><h4>Dica</h4><p>${esc(r.tip_pt)}</p></section>`
    : '';

  return `<div class="verdict verdict-${v.cls}">
      <div class="verdict-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">${v.svg}</svg></div>
      <div class="verdict-body">
        <h3 class="verdict-title" tabindex="-1">${v.label}</h3>
        <p class="verdict-sub">${v.sub}</p>
        ${issues}${corrected}${alt}${tip}
        <p class="sched-note hidden" id="sched-note"></p>
      </div>
    </div>`;
}

$('#practice-feedback').addEventListener('click', (e) => {
  const btn = e.target.closest('.audio-btn');
  if (btn) tts.falar(btn.dataset.say, btn);
});

$('#practice-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!pCard || pState === 'evaluating' || pState === 'result') return;
  const input = $('#practice-input');
  const sentence = input.value.trim();
  if (!sentence) return;

  const token = ++pToken;
  const card = pCard;
  pState = 'evaluating';
  setLocked(true);
  resetResultUI();
  $('#practice-result').classList.remove('hidden');
  $('#practice-loading').classList.remove('hidden');
  setPracticeButtons('evaluating');

  try {
    const r = await api('/api/practice/evaluate', {
      method: 'POST',
      body: { target: card.front, sentence, cardId: card.id },
    });
    if (token !== pToken) return; // usuário já mudou de cartão
    if (!VERDICT[r.verdict]) throw new Error('resposta inesperada da IA');

    pState = 'result';
    pLastVerdict = r.verdict;
    pSession.results[card.id] = { card, verdict: r.verdict, sentence, corrected: r.corrected_sentence };

    $('#practice-loading').classList.add('hidden');
    const fb = $('#practice-feedback');
    fb.innerHTML = feedbackHTML(r, sentence);
    fb.classList.remove('hidden');
    $('#practice-input-group').classList.add('state-' + VERDICT[r.verdict].cls);
    setPracticeButtons('result');
    $('#practice-next').focus();
    if (r.verdict === 'correct') playSuccessSound();

    // o veredito antecipa a revisão do cartão (só puxa para mais cedo, nunca adia)
    api(`/api/cards/${card.id}/practice`, { method: 'POST', body: { verdict: r.verdict } })
      .then(({ rescheduled, stats }) => {
        renderStats(stats);
        const note = $('#sched-note');
        if (note && rescheduled && token === pToken) {
          note.textContent = r.verdict === 'incorrect'
            ? 'Este cartão volta para a fila de revisão em 10 minutos.'
            : 'Este cartão volta para a fila de revisão em até 1 dia.';
          note.classList.remove('hidden');
        }
      })
      .catch(() => { /* o feedback já foi mostrado; o reagendamento é um extra */ });
  } catch (err) {
    if (token !== pToken) return;
    pState = 'error';
    setLocked(false);
    $('#practice-loading').classList.add('hidden');
    const box = $('#practice-error');
    box.innerHTML = `<strong>Não consegui avaliar sua frase agora.</strong><span>${esc(err.message)}</span><span>Sua frase foi mantida. Clique em “Verificar” para tentar de novo ou pule esta expressão.</span>`;
    box.classList.remove('hidden');
    setPracticeButtons('error');
  }
});

function practiceNext() {
  if (!pSession) return;
  pSession.idx += 1;
  showPracticeCard();
}

$('#practice-next').addEventListener('click', practiceNext);
$('#practice-skip').addEventListener('click', () => {
  pSession.skipped += 1;
  practiceNext();
});
$('#practice-retry').addEventListener('click', () => {
  pState = 'idle';
  pToken++;
  const input = $('#practice-input');
  setLocked(false);
  resetResultUI();
  setPracticeButtons('idle');
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
});

// Enter avança quando a resposta já está na tela (o campo está somente leitura)
document.addEventListener('keydown', (e) => {
  if (view !== 'practice' || pState !== 'result' || dialogOpen()) return;
  if (e.key !== 'Enter' || e.target.closest('button, a')) return;
  e.preventDefault();
  practiceNext();
});

function showPracticeSummary() {
  const r = Object.values(pSession.results);
  const count = (v) => r.filter((x) => x.verdict === v).length;
  $('#practice-main').classList.add('hidden');
  $('#practice-summary').classList.remove('hidden');
  const items = [
    ['Corretas', count('correct')],
    ['Quase lá', count('almost')],
    ['Precisa de ajuste', count('incorrect')],
  ];
  if (pSession.skipped) items.push(['Puladas', pSession.skipped]);
  $('#practice-summary-stats').innerHTML = statGrid(items);

  const toReview = r.filter((x) => x.verdict !== 'correct');
  $('#practice-summary-review').innerHTML = toReview.length
    ? `<h3>Expressões para revisar</h3><ul>${toReview
        .map((x) => `<li><div class="sum-head"><strong lang="en">${esc(x.card.front)}</strong><span class="verdict-chip verdict-${VERDICT[x.verdict].cls}">${VERDICT[x.verdict].label}</span></div>
          <div class="sum-line"><span class="sum-label">Você</span><span lang="en">${esc(x.sentence)}</span></div>
          <div class="sum-line"><span class="sum-label">Correção</span><span lang="en">${esc(x.corrected)}</span></div></li>`)
        .join('')}</ul><p class="muted-p">Esses cartões foram antecipados na fila de revisão.</p>`
    : r.length
      ? '<p class="muted-p">Nada para revisar: todas as frases avaliadas estavam corretas. Ótimo trabalho!</p>'
      : '';
  $('#practice-summary h2').setAttribute('tabindex', '-1');
  $('#practice-summary h2').focus();
}
$('#practice-again').addEventListener('click', loadPractice);

/* ================================================================
   CARTÕES
   ================================================================ */
const dueLabel = (due) => {
  const diff = due - Date.now();
  if (diff <= 0) return 'pendente';
  const min = Math.round(diff / 60000);
  if (min < 60) return `em ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `em ${h} h`;
  const d = Math.round(h / 24);
  return d < 30 ? `em ${d} d` : `em ${Math.round(d / 30)} m`;
};

const listState = { filter: 'all', tag: '', sort: 'recent', q: '' };
const pendingDelete = new Map(); // id -> timeout

async function loadCards() {
  try {
    allCards = (await api('/api/cards')).cards;
    refreshTagOptions();
    renderList();
  } catch (err) { toast(err.message); }
}

function refreshTagOptions() {
  const tags = [...new Set(allCards.map((c) => c.tag).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt'));
  $('#tag-options').innerHTML = tags.map((t) => `<option value="${esc(t)}">`).join('');
  const sel = $('#filter-tag');
  const keep = listState.tag;
  sel.innerHTML =
    '<option value="">Todas as categorias</option>' +
    tags.map((t) => `<option value="${esc(t)}">${esc(catLabel(t))}</option>`).join('');
  sel.value = tags.includes(keep) ? keep : '';
  listState.tag = sel.value;
}

function visibleCards() {
  const now = Date.now();
  const q = listState.q.toLowerCase();
  let cards = allCards.filter((c) => !pendingDelete.has(c.id));
  if (q) cards = cards.filter((c) => `${c.front} ${c.back} ${c.tag}`.toLowerCase().includes(q));
  if (listState.tag) cards = cards.filter((c) => c.tag === listState.tag);
  const f = listState.filter;
  if (f === 'due') cards = cards.filter((c) => c.due <= now);
  else if (f !== 'all') cards = cards.filter((c) => c.stage === f);
  if (listState.sort === 'az') cards.sort((a, b) => a.front.replace(/^to\s+/i, '').localeCompare(b.front.replace(/^to\s+/i, ''), 'en'));
  else if (listState.sort === 'due') cards.sort((a, b) => a.due - b.due);
  else cards.sort((a, b) => b.created - a.created);
  return cards;
}

function renderList() {
  const now = Date.now();
  const cards = visibleCards();
  const base = allCards.filter((c) => !pendingDelete.has(c.id));
  const dueTotal = base.filter((c) => c.due <= now).length;
  const filtered = cards.length !== base.length;
  $('#list-count').textContent = filtered
    ? `${cards.length} de ${plural(base.length, 'cartão', 'cartões')} · ${plural(dueTotal, 'pendente', 'pendentes')} no total`
    : `${plural(base.length, 'cartão', 'cartões')} · ${plural(dueTotal, 'pendente', 'pendentes')}`;

  $('#list').innerHTML =
    cards
      .map(
        (c) => `<div class="row" data-id="${c.id}">
          <button type="button" class="row-open" title="Clique para editar" aria-label="Editar cartão: ${esc(c.front)}">
            <span class="row-main">
              <span class="row-en">${esc(c.front)}</span>
              <span class="row-pt">${esc(c.back)}</span>
              <span class="row-tags">${c.tag ? `<span class="cat">${esc(catLabel(c.tag))}</span>` : ''}${stageChip(c.stage)}${c.ipa && c.ipa !== '—' ? `<span class="row-ipa">${esc(c.ipa)}</span>` : ''}</span>
            </span>
            <span class="row-due ${c.due <= now ? 'now' : ''}">${dueLabel(c.due)}</span>
            <svg class="row-edit" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
          </button>
          <button type="button" class="icon-btn row-more" aria-haspopup="menu" aria-label="Mais ações para ${esc(c.front)}" title="Mais ações">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>
          </button>
        </div>`
      )
      .join('') ||
    `<p class="empty-list">${allCards.length ? 'Nenhum cartão com esses filtros.' : 'Você ainda não tem cartões. Crie o primeiro na aba Adicionar.'}</p>`;
}

let searchTimer;
$('#search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { listState.q = e.target.value.trim(); renderList(); }, 120);
});
$('#stage-filters').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  listState.filter = chip.dataset.filter;
  $$('#stage-filters .chip').forEach((c) => c.setAttribute('aria-pressed', c === chip));
  renderList();
});
$('#filter-tag').addEventListener('change', (e) => { listState.tag = e.target.value; renderList(); });
$('#sort').addEventListener('change', (e) => { listState.sort = e.target.value; renderList(); });

/* ---- menu de ações ---- */
let menuFor = null; // { id, btn }
function closeMenu({ restore = false } = {}) {
  const m = $('#row-menu');
  if (m.classList.contains('hidden')) return;
  m.classList.add('hidden');
  const reset = m.querySelector('[data-action=reset]');
  reset.textContent = 'Reiniciar progresso';
  reset.classList.remove('confirm');
  if (restore && menuFor) menuFor.btn.focus();
  menuFor = null;
}
function openMenu(btn, id) {
  const m = $('#row-menu');
  if (menuFor && menuFor.btn === btn) return closeMenu({ restore: true });
  closeMenu();
  menuFor = { id, btn };
  m.classList.remove('hidden');
  const r = btn.getBoundingClientRect();
  const w = m.offsetWidth;
  m.style.top = Math.min(r.bottom + 4, window.innerHeight - m.offsetHeight - 8) + 'px';
  m.style.left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)) + 'px';
  m.querySelector('button').focus();
}

$('#list').addEventListener('click', (e) => {
  const row = e.target.closest('.row');
  if (!row) return;
  const id = Number(row.dataset.id);
  if (e.target.closest('.row-more')) return openMenu(e.target.closest('.row-more'), id);
  if (e.target.closest('.row-open')) openEdit(id);
});

$('#row-menu').addEventListener('click', async (e) => {
  const item = e.target.closest('[data-action]');
  if (!item || !menuFor) return;
  const { id } = menuFor;
  const action = item.dataset.action;
  if (action === 'edit') { closeMenu(); return openEdit(id); }
  if (action === 'delete') { closeMenu(); return deleteCard(id); }
  if (action === 'reset') {
    // confirmação em dois toques: sem janela nativa, sem clique acidental
    if (!item.classList.contains('confirm')) {
      item.classList.add('confirm');
      item.textContent = 'Confirmar reinício';
      return;
    }
    closeMenu();
    await resetCard(id);
  }
});
$('#row-menu').addEventListener('keydown', (e) => {
  const items = [...$('#row-menu').querySelectorAll('button')];
  const i = items.indexOf(document.activeElement);
  if (e.key === 'Escape') { e.preventDefault(); closeMenu({ restore: true }); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
  else if (e.key === 'Tab') closeMenu();
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('#row-menu, .row-more')) closeMenu();
});
window.addEventListener('resize', () => closeMenu());
window.addEventListener('scroll', () => closeMenu(), { passive: true });

/* ---- excluir com Desfazer: só apaga de verdade depois que o aviso expira ---- */
function deleteCard(id) {
  const card = allCards.find((c) => c.id === id);
  if (!card || pendingDelete.has(id)) return;
  const timer = setTimeout(async () => {
    try {
      await api('/api/cards/' + id, { method: 'DELETE' });
      allCards = allCards.filter((c) => c.id !== id);
      refreshTagOptions();
    } catch (err) { toast(err.message); }
    pendingDelete.delete(id);
    renderList();
    refreshBadges();
  }, 6000);
  pendingDelete.set(id, timer);
  renderList();
  toast(`“${card.front}” excluído`, {
    action: 'Desfazer',
    duration: 6000,
    onAction: () => {
      clearTimeout(timer);
      pendingDelete.delete(id);
      renderList();
    },
  });
}

async function resetCard(id) {
  try {
    const { card } = await api(`/api/cards/${id}/reset`, { method: 'POST' });
    allCards = allCards.map((c) => (c.id === id ? card : c));
    renderList();
    refreshBadges();
    toast('Progresso reiniciado — o cartão voltou a ser novo');
  } catch (err) { toast(err.message); }
}

/* ---- editar cartão ---- */
const editDlg = $('#edit-dialog');
const editForm = $('#edit-form');
let editId = null;

function openEdit(id) {
  const c = allCards.find((x) => x.id === id);
  if (!c) return;
  editId = id;
  editForm.front.value = c.front;
  editForm.back.value = c.back;
  editForm.example.value = c.example;
  editForm.tag.value = c.tag;
  editForm.ipa.value = c.ipa === '—' ? '' : c.ipa;
  $('#edit-error').classList.add('hidden');
  resetEditConfirm();
  editDlg.showModal();
  editForm.front.focus();
}
function resetEditConfirm() {
  const b = $('#edit-reset');
  b.textContent = 'Reiniciar progresso';
  b.classList.remove('confirm');
}
const closeDialogOnBackdrop = (dlg) =>
  dlg.addEventListener('mousedown', (e) => { if (e.target === dlg) dlg.close(); });
closeDialogOnBackdrop(editDlg);

editForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!editForm.reportValidity()) return;
  try {
    const { card } = await api('/api/cards/' + editId, {
      method: 'PUT',
      body: Object.fromEntries(new FormData(editForm)),
    });
    allCards = allCards.map((c) => (c.id === editId ? card : c));
    refreshTagOptions();
    renderList();
    editDlg.close();
    toast('Cartão salvo');
  } catch (err) {
    const box = $('#edit-error');
    box.textContent = err.message;
    box.classList.remove('hidden');
  }
});
$('#edit-cancel').addEventListener('click', () => editDlg.close());
$('#edit-delete').addEventListener('click', () => { const id = editId; editDlg.close(); deleteCard(id); });
$('#edit-reset').addEventListener('click', async (e) => {
  const b = e.currentTarget;
  if (!b.classList.contains('confirm')) {
    b.classList.add('confirm');
    b.textContent = 'Confirmar reinício';
    return;
  }
  editDlg.close();
  await resetCard(editId);
});
$('#edit-listen').addEventListener('click', () => tts.falar(editForm.front.value, $('#edit-listen'), { expr: true }));
$('#edit-fetch-ipa').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.textContent = 'Buscando…';
  try {
    const r = await api('/api/pronuncia', { method: 'POST', body: { id: editId } });
    if (r.card && r.card.ipa && r.card.ipa !== '—') {
      editForm.ipa.value = r.card.ipa;
      allCards = allCards.map((c) => (c.id === editId ? r.card : c));
      renderList();
      toast('Transcrição encontrada');
    } else toast('O dicionário não tem transcrição para este termo');
  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Buscar IPA';
  }
});

/* ================================================================
   ADICIONAR
   ================================================================ */
const formOne = $('#form-one');
const formBulk = $('#form-bulk');

// chave de comparação: "To Achieve " == "achieve"
const dupKey = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim().replace(/^to\s+/, '');
const findDuplicate = (front) => {
  const k = dupKey(front);
  return k ? allCards.find((c) => dupKey(c.front) === k) : null;
};

function renderMiniCard() {
  const f = formOne;
  const front = f.front.value.trim();
  const back = f.back.value.trim();
  const ex = f.example.value.trim();
  const tag = f.tag.value.trim();
  const ipa = f.ipa.value.trim();
  $('#mini-card').innerHTML = `
    <div class="mini-meta">${tag ? `<span class="cat">${esc(catLabel(tag))}</span>` : '<span class="mini-ph">sem categoria</span>'}<span class="stage stage-new">Novo</span></div>
    <div class="mini-front ${front ? '' : 'mini-ph'}" lang="en">${esc(front || 'Expressão em inglês')}</div>
    ${ipa ? `<div class="mini-ipa">${esc(ipa)}</div>` : ''}
    <div class="mini-back ${back ? '' : 'mini-ph'}">${esc(back || 'Significado em português')}</div>
    ${ex ? `<div class="mini-ex" lang="en">${highlightTarget(ex, front)}</div>` : ''}`;
}

function checkDuplicate() {
  const dup = findDuplicate(formOne.front.value);
  const w = $('#dup-warning');
  w.classList.toggle('hidden', !dup);
  if (dup) w.textContent = `Você já tem este cartão: “${dup.front}” — ${dup.back}. Você pode adicionar mesmo assim.`;
  $('#add-submit').textContent = dup ? 'Adicionar mesmo assim' : 'Adicionar cartão';
}

formOne.addEventListener('input', () => { checkDuplicate(); renderMiniCard(); });

formOne.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!formOne.reportValidity()) return;
  const f = new FormData(formOne);
  const btn = $('#add-submit');
  btn.disabled = true;
  try {
    const { card } = await api('/api/cards', {
      method: 'POST',
      body: Object.fromEntries(f),
    });
    allCards.unshift(card);
    refreshTagOptions();
    const tag = card.tag; // mantém a categoria: facilita cadastrar vários da mesma
    formOne.reset();
    formOne.tag.value = tag;
    checkDuplicate();
    renderMiniCard();
    formOne.front.focus();
    toast(`“${card.front}” adicionado`, {
      action: 'Ver na lista',
      onAction: () => {
        listState.q = card.front;
        $('#search').value = card.front;
        switchView('cards');
      },
    });
    refreshBadges();
  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = false;
  }
});

/* ---- importação em lote com prévia/validação ---- */
let bulkRows = [];
function parseBulk(text) {
  const seen = new Set();
  const rows = [];
  text.split('\n').forEach((line, i) => {
    if (!line.trim()) return;
    const parts = line.split(/\s*[|;]\s*|\s+-\s+/).map((s) => s.trim());
    const row = { n: i + 1, front: parts[0] || '', back: parts[1] || '', example: parts[2] || '', status: 'ok', note: '' };
    if (!row.front || !row.back) {
      row.status = 'invalid';
      row.note = row.front ? 'falta o significado (separe com |)' : 'falta a expressão em inglês';
    } else {
      const k = dupKey(row.front);
      if (findDuplicate(row.front)) { row.status = 'dup'; row.note = 'já existe nos seus cartões'; }
      else if (seen.has(k)) { row.status = 'dup'; row.note = 'repetida neste lote'; }
      seen.add(k);
    }
    rows.push(row);
  });
  return rows;
}

const BULK_LABEL = { ok: 'OK', dup: 'Duplicado', invalid: 'Inválida' };
function renderBulkPreview() {
  bulkRows = parseBulk(formBulk.text.value);
  const box = $('#bulk-preview');
  const ok = bulkRows.filter((r) => r.status === 'ok').length;
  const dup = bulkRows.filter((r) => r.status === 'dup').length;
  const bad = bulkRows.filter((r) => r.status === 'invalid').length;
  box.classList.toggle('hidden', !bulkRows.length);
  const submit = $('#bulk-submit');
  submit.disabled = ok === 0;
  submit.textContent = ok ? `Importar ${plural(ok, 'cartão', 'cartões')}` : 'Importar';
  if (!bulkRows.length) return;

  const shown = bulkRows.slice(0, 40);
  box.innerHTML = `
    <p class="bulk-summary"><span class="ok">${ok} pronto${ok === 1 ? '' : 's'}</span>${dup ? ` · <span class="dup">${plural(dup, 'duplicado', 'duplicados')} (serão ignorados)</span>` : ''}${bad ? ` · <span class="bad">${plural(bad, 'inválida', 'inválidas')} (serão ignoradas)</span>` : ''}</p>
    <ul class="bulk-list">${shown
      .map((r) => `<li class="bulk-${r.status}"><span class="bulk-badge">${BULK_LABEL[r.status]}</span>
        <span class="bulk-text"><span lang="en">${esc(r.front) || '—'}</span> <span class="arrow" aria-hidden="true">→</span> ${esc(r.back) || '—'}${r.note ? `<small>linha ${r.n}: ${r.note}</small>` : ''}</span></li>`)
      .join('')}</ul>
    ${bulkRows.length > shown.length ? `<p class="muted-p">…e mais ${bulkRows.length - shown.length} linhas.</p>` : ''}`;
}

let bulkTimer;
formBulk.text.addEventListener('input', () => { clearTimeout(bulkTimer); bulkTimer = setTimeout(renderBulkPreview, 150); });

formBulk.addEventListener('submit', async (e) => {
  e.preventDefault();
  const items = bulkRows.filter((r) => r.status === 'ok').map(({ front, back, example }) => ({ front, back, example }));
  if (!items.length) return;
  const btn = $('#bulk-submit');
  btn.disabled = true;
  try {
    const { created } = await api('/api/cards/bulk', {
      method: 'POST',
      body: { items, tag: formBulk.tag.value },
    });
    formBulk.text.value = '';
    await loadCards();
    renderBulkPreview();
    formBulk.text.focus();
    toast(`${plural(created, 'cartão importado', 'cartões importados')}`);
    refreshBadges();
  } catch (err) {
    toast(err.message);
    btn.disabled = false;
  }
});

/* ================================================================
   CONFIGURAÇÕES
   ================================================================ */
const settingsDlg = $('#settings-dialog');
closeDialogOnBackdrop(settingsDlg);
$('#open-settings').addEventListener('click', () => settingsDlg.showModal());
$('#settings-close').addEventListener('click', () => settingsDlg.close());

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
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.textContent = 'Buscando…';
  try {
    const r = await api('/api/pronuncia', { method: 'POST' });
    toast(
      r.verificados === 0
        ? 'Todos os cartões já foram verificados'
        : `${r.achou} de ${r.verificados} com transcrição`
    );
    loadCards();
  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Buscar IPA de todos os cartões';
  }
});

/* ---------------- início ---------------- */
renderMiniCard();
loadCards();   // cache para duplicatas, categorias e lista
loadQueue();
