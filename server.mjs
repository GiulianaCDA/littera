import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.mjs';
import { schedule, preview } from './srs.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'public');
const PORT = process.env.PORT || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const json = (res, code, data) => {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 1e6) reject(new Error('payload muito grande'));
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('JSON invalido'));
      }
    });
    req.on('error', reject);
  });

// ---------------- queries ----------------
const Q = {
  all: db.prepare('SELECT * FROM cards ORDER BY created DESC'),
  search: db.prepare(
    'SELECT * FROM cards WHERE front LIKE ? OR back LIKE ? OR tag LIKE ? ORDER BY created DESC'
  ),
  byId: db.prepare('SELECT * FROM cards WHERE id = ?'),
  due: db.prepare('SELECT * FROM cards WHERE due <= ? ORDER BY due ASC LIMIT ?'),
  // pratica: cartoes pendentes primeiro, depois o resto, sempre embaralhados
  practice: db.prepare('SELECT * FROM cards ORDER BY (due <= ?) DESC, RANDOM() LIMIT ?'),
  insert: db.prepare(
    'INSERT INTO cards (front, back, example, tag, ipa, due, created) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ),
  update: db.prepare(
    'UPDATE cards SET front = ?, back = ?, example = ?, tag = ?, ipa = ? WHERE id = ?'
  ),
  del: db.prepare('DELETE FROM cards WHERE id = ?'),
  reschedule: db.prepare(
    'UPDATE cards SET ease = ?, interval = ?, reps = ?, lapses = ?, due = ? WHERE id = ?'
  ),
  reset: db.prepare(
    'UPDATE cards SET ease = 2.5, interval = 0, reps = 0, lapses = 0, due = ? WHERE id = ?'
  ),
  setDue: db.prepare('UPDATE cards SET due = ? WHERE id = ?'),
  setIpa: db.prepare('UPDATE cards SET ipa = ?, audio = ? WHERE id = ?'),
  semIpa: db.prepare("SELECT id, front FROM cards WHERE ipa = ''"),
  tagCanon: db.prepare("SELECT tag FROM cards WHERE tag <> '' AND lower(tag) = lower(?) LIMIT 1"),
  logReview: db.prepare('INSERT INTO reviews (card_id, grade, ts) VALUES (?, ?, ?)'),
  delReviews: db.prepare('DELETE FROM reviews WHERE card_id = ?'),
};

// Estagio do cartao (mesmos limiares usados em stats()):
// novo = nunca revisado | aprendendo = intervalo < 21 dias | revisao = consolidado
const stageOf = (c) => (c.reps === 0 && c.lapses === 0 ? 'new' : c.interval < 21 ? 'learning' : 'review');
const shape = (c) => ({ ...c, stage: stageOf(c) });

// Categoria: apara espacos e reaproveita a grafia de uma categoria ja existente
// (ignorando maiusculas), para que "Verbo" e "verbo" nao virem duas categorias.
function normalizeTag(raw) {
  const tag = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  if (!tag) return '';
  return Q.tagCanon.get(tag)?.tag ?? tag;
}

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

const isoDay = (d) =>
  d.getFullYear() +
  '-' +
  String(d.getMonth() + 1).padStart(2, '0') +
  '-' +
  String(d.getDate()).padStart(2, '0');

function stats() {
  const now = Date.now();
  const one = (sql, ...args) => db.prepare(sql).get(...args);

  const total = one('SELECT COUNT(*) AS n FROM cards').n;
  const due = one('SELECT COUNT(*) AS n FROM cards WHERE due <= ?', now).n;
  const fresh = one('SELECT COUNT(*) AS n FROM cards WHERE reps = 0').n;
  const learning = one(
    'SELECT COUNT(*) AS n FROM cards WHERE reps > 0 AND interval < 21'
  ).n;
  const mature = one('SELECT COUNT(*) AS n FROM cards WHERE interval >= 21').n;
  const today = one('SELECT COUNT(*) AS n FROM reviews WHERE ts >= ?', startOfToday()).n;
  const acc = one(
    'SELECT COUNT(*) AS total, SUM(CASE WHEN grade > 0 THEN 1 ELSE 0 END) AS ok FROM reviews'
  );

  // streak: dias consecutivos com ao menos uma revisao
  const days = db
    .prepare(
      "SELECT DISTINCT date(ts / 1000, 'unixepoch', 'localtime') AS d FROM reviews ORDER BY d DESC LIMIT 400"
    )
    .all()
    .map((r) => r.d);

  let streak = 0;
  const cursor = new Date();
  if (days.length && days[0] !== isoDay(cursor)) cursor.setDate(cursor.getDate() - 1);
  for (const d of days) {
    if (d === isoDay(cursor)) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    } else break;
  }

  return {
    total,
    due,
    fresh,
    learning,
    mature,
    today,
    streak,
    accuracy: acc.total ? Math.round((acc.ok / acc.total) * 100) : null,
  };
}

const withPreview = (card) => ({ ...shape(card), previews: preview(card) });

// ---------------- pronuncia (dictionaryapi.dev, gratuito e sem chave) ----------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function buscarPronuncia(termo, tentativas = 3) {
  const url =
    'https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(termo);
  for (let i = 0; i < tentativas; i++) {
    let r;
    try {
      r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    } catch {
      await sleep(500 * (i + 1));
      continue;
    }
    if (r.status === 404) return null;            // termo nao existe no dicionario
    if (!r.ok) { await sleep(700 * (i + 1)); continue; }  // 502/429 -> tenta de novo
    let j;
    try { j = await r.json(); } catch { return null; }
    if (!Array.isArray(j)) return null;
    let ipa = '', audio = '';
    for (const e of j) {
      for (const f of e.phonetics || []) {
        if (!ipa && f.text) ipa = f.text;
        if (!audio && f.audio) audio = f.audio;
      }
      if (!ipa && e.phonetic) ipa = e.phonetic;
    }
    return ipa || audio ? { ipa, audio } : null;
  }
  return null;
}

// tenta o termo literal e, se falhar, sem o "to " inicial
async function pronunciaDe(front) {
  let r = await buscarPronuncia(front);
  if (!r) {
    const semTo = front.replace(/^to\s+/i, '');
    if (semTo !== front) r = await buscarPronuncia(semTo);
  }
  return r;
}

// ---------------- avaliacao de frases (IA) ----------------
// Regra de ouro: os campos *_pt vao em portugues; corrected_sentence e
// natural_alternative vao SEMPRE em ingles. Foi a mistura dos dois idiomas
// num unico campo que gerava correcoes como "to O arise problema this surgiu".
const EVAL_SYSTEM = `You are a rigorous but encouraging English tutor for Brazilian Portuguese speakers at an intermediate level.
The student was given a target expression and wrote ONE sentence of their own using it. Evaluate that sentence.

Evaluation rules:
1. COMPLETE SENTENCE REQUIRED. A correct sentence needs a subject and a finite (conjugated) verb. Fragments such as "to achieve our goal" or "to arise this morning" are NOT complete sentences: is_complete_sentence=false and verdict="incorrect". Explain that a full sentence is needed and rewrite it as one.
2. USAGE OF THE EXPRESSION. Check that the expression has the right meaning and structure: transitivity, required prepositions/particles, word order, who is the subject. Example: "arise" is intransitive and its subject is the thing that appears ("A problem arose"), never the person. Wrong usage => used_expression_correctly=false.
3. GRAMMAR AND NATURALNESS. Check tense, conjugation, irregular verbs, articles, agreement, plurals, punctuation and capitalization. Flag wording no native speaker would use as type "naturalness".
4. FORM VARIATION IS FINE. Accept any inflection of the expression (achieve/achieved/achieving; "to look forward to" -> "looking forward to", "I look forward to"). Do not penalize this.
5. Do not invent problems. If the sentence is fine, say so; do not nitpick valid stylistic choices.

Verdicts:
- "correct": complete sentence, expression used correctly, no grammar/meaning/structure problems (a tiny naturalness preference alone still counts as correct).
- "almost": complete sentence and the expression is understood and used essentially right, but there are small grammar or naturalness issues.
- "incorrect": not a complete sentence, OR the expression is used with the wrong meaning/structure, OR there are serious errors.

Output ONLY a JSON object with exactly these keys:
{
  "verdict": "correct" | "almost" | "incorrect",
  "used_expression_correctly": boolean,
  "is_complete_sentence": boolean,
  "issues": [ { "type": "grammar" | "meaning" | "structure" | "naturalness", "explanation_pt": string } ],
  "corrected_sentence": string,
  "natural_alternative": string,
  "tip_pt": string
}

Language rules (very important):
- "explanation_pt" and "tip_pt": Brazilian Portuguese, short and specific to this student's sentence (one or two sentences each). Max 4 issues.
- "corrected_sentence": ENGLISH ONLY. Never include Portuguese. Change the student's sentence as little as possible while making it complete and correct, keep their intended meaning, and keep the target expression in it. If the sentence is already correct, repeat it unchanged.
- "natural_alternative": ENGLISH ONLY. One sentence that a native speaker would naturally say to express the same idea, using the target expression. If the student's sentence is correct, make it a slightly more natural or more advanced version.
- If verdict is "correct", "issues" must be an empty array.

Examples:
Target: "to arise" / Student: "to arise this morning"
{"verdict":"incorrect","used_expression_correctly":false,"is_complete_sentence":false,"issues":[{"type":"structure","explanation_pt":"Isto é só um fragmento: falta uma frase completa com sujeito e verbo conjugado."},{"type":"structure","explanation_pt":"\\"arise\\" é intransitivo e o sujeito é aquilo que surge: \\"A problem arose\\", não alguém que 'surge'."}],"corrected_sentence":"A problem arose this morning.","natural_alternative":"Something came up this morning, so I was late.","tip_pt":"Pense em: o que surgiu? Comece pelo sujeito (A problem…) e conjugue o verbo (arose)."}

Target: "to achieve" / Student: "She achieved her goal last year."
{"verdict":"correct","used_expression_correctly":true,"is_complete_sentence":true,"issues":[],"corrected_sentence":"She achieved her goal last year.","natural_alternative":"She finally achieved the goal she'd been working toward for years.","tip_pt":"Com \\"last year\\" (tempo terminado), o passado simples é a escolha certa."}

Target: "to look forward to" / Student: "I look forward to see you."
{"verdict":"almost","used_expression_correctly":false,"is_complete_sentence":true,"issues":[{"type":"grammar","explanation_pt":"Em \\"look forward to\\", o \\"to\\" é preposição, então o verbo seguinte vai no gerúndio: \\"seeing\\"."}],"corrected_sentence":"I look forward to seeing you.","natural_alternative":"I'm really looking forward to seeing you.","tip_pt":"Teste: dá para trocar por \\"look forward to it\\" (um substantivo)? Então o verbo vai em -ing."}`;

// Portugues nos campos em ingles = sintoma do bug original. Sinais que quase
// nunca aparecem em ingles: letras acentuadas e palavras funcionais do PT.
const PT_SIGNS = /[ãõçáéíóúâêôà]|\b(não|uma|para|que|você|com|por|dos|das|nos|nas|mais|muito|também|foi|nesta|neste)\b/i;
const looksPortuguese = (s) => PT_SIGNS.test(s);

const VERDICTS = ['correct', 'almost', 'incorrect'];
const ISSUE_TYPES = ['grammar', 'meaning', 'structure', 'naturalness'];

function extractJson(text) {
  const raw = String(text || '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  try {
    return JSON.parse(raw);
  } catch {
    const m = /\{[\s\S]*\}/.exec(raw);
    if (!m) throw new Error('sem JSON');
    return JSON.parse(m[0]);
  }
}

// Valida o JSON da IA e garante coerencia entre os campos.
function normalizeEvaluation(r, sentence) {
  if (!r || typeof r !== 'object') throw new Error('resposta inválida');
  if (!VERDICTS.includes(r.verdict)) throw new Error('veredito inválido');
  if (typeof r.used_expression_correctly !== 'boolean' || typeof r.is_complete_sentence !== 'boolean')
    throw new Error('campos booleanos ausentes');

  const str = (v, max) => String(v ?? '').trim().slice(0, max);
  let issues = (Array.isArray(r.issues) ? r.issues : [])
    .map((i) => ({ type: ISSUE_TYPES.includes(i?.type) ? i.type : 'grammar', explanation_pt: str(i?.explanation_pt, 400) }))
    .filter((i) => i.explanation_pt)
    .slice(0, 4);

  let corrected = str(r.corrected_sentence, 1000);
  let alternative = str(r.natural_alternative, 1000);
  const tip = str(r.tip_pt, 400);

  // corrected/alternative precisam estar em ingles; se vier PT, descarta e tenta de novo
  if ((corrected && looksPortuguese(corrected)) || (alternative && looksPortuguese(alternative)))
    throw new Error('campo em inglês veio em português');

  // guarda deterministica: menos de 3 palavras nunca e frase completa
  const words = sentence.split(/\s+/).filter(Boolean).length;
  const isComplete = r.is_complete_sentence && words >= 3;

  let verdict = r.verdict;
  if (!isComplete) verdict = 'incorrect';
  else if (verdict === 'correct' && (!r.used_expression_correctly || issues.some((i) => i.type !== 'naturalness')))
    verdict = r.used_expression_correctly ? 'almost' : 'incorrect';

  if (verdict === 'correct') {
    corrected = sentence;
    issues = [];
  } else if (!corrected) {
    throw new Error('correção ausente');
  }

  if (!isComplete && !issues.some((i) => /completa|sujeito|verbo/i.test(i.explanation_pt)))
    issues.unshift({
      type: 'structure',
      explanation_pt: 'É preciso escrever uma frase completa, com sujeito e verbo conjugado.',
    });

  return {
    verdict,
    used_expression_correctly: r.used_expression_correctly,
    is_complete_sentence: isComplete,
    issues,
    corrected_sentence: corrected,
    natural_alternative: alternative,
    tip_pt: tip,
  };
}

async function evaluateSentence(key, target, sentence, card) {
  const context = card
    ? `\nMeaning of the expression (Portuguese): ${card.back}${card.example ? `\nDictionary example: ${card.example}` : ''}`
    : '';
  const user = `Target expression: ${target}${context}\nStudent's sentence: ${sentence}`;

  // O roteador gratuito troca de modelo a cada chamada; alguns são modelos
  // de "reasoning" que consomem o orçamento de tokens pensando (content
  // sai null) e outros ignoram o schema pedido. Tenta algumas vezes antes
  // de desistir, já que uma nova tentativa costuma cair em outro modelo.
  const attempts = 3;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
          'HTTP-Referer': 'http://localhost:3000',
          'X-Title': 'English SRS',
        },
        signal: AbortSignal.timeout(30000),
        body: JSON.stringify({
          model: process.env.OPENROUTER_MODEL || 'openrouter/free',
          messages: [
            { role: 'system', content: EVAL_SYSTEM },
            { role: 'user', content: user },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.2,
          max_tokens: 1500,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        console.error('[ai] avaliação recusada (tentativa', attempt, '):', response.status, payload.error?.code || 'erro');
        continue;
      }
      return normalizeEvaluation(extractJson(payload.choices?.[0]?.message?.content), sentence);
    } catch (error) {
      console.error('[ai] falha na avaliação (tentativa', attempt, '):', error.name === 'Error' ? error.message : error.name);
    }
  }
  return null;
}

// O veredito da pratica so ANTECIPA revisoes; nunca adia e nunca mexe em
// ease/intervalo/repeticoes (isso continua exclusivo do SM-2 em srs.mjs).
//   incorrect -> volta em 10 min | almost -> no maximo 1 dia | correct -> nada
const PRACTICE_PULL = { incorrect: 10 * 60 * 1000, almost: 24 * 60 * 60 * 1000 };

// ---------------- api ----------------
async function api(req, res, url) {
  const { pathname } = url;

  if (pathname === '/api/practice/evaluate' && req.method === 'POST') {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) return json(res, 503, { error: 'Configure OPENROUTER_API_KEY no ambiente do servidor para usar a avaliação por IA.' });
    const b = await readBody(req);
    const target = String(b.target || '').trim().slice(0, 200);
    const sentence = String(b.sentence || '').trim().slice(0, 1000);
    if (!target || !sentence) return json(res, 400, { error: 'A expressão e sua frase são obrigatórias.' });
    const card = b.cardId ? Q.byId.get(Number(b.cardId)) : null;

    const result = await evaluateSentence(key, target, sentence, card);
    if (!result) return json(res, 502, { error: 'A IA não conseguiu avaliar a frase agora. Tente novamente em instantes.' });
    return json(res, 200, result);
  }

  if (pathname === '/api/practice/queue' && req.method === 'GET') {
    const limit = Math.min(Number(url.searchParams.get('limit')) || 10, 50);
    const cards = Q.practice.all(Date.now(), limit).map(shape);
    const dueTotal = db.prepare('SELECT COUNT(*) AS n FROM cards WHERE due <= ?').get(Date.now()).n;
    return json(res, 200, { cards, dueTotal });
  }

  if (pathname === '/api/stats' && req.method === 'GET') {
    return json(res, 200, stats());
  }

  if (pathname === '/api/queue' && req.method === 'GET') {
    const limit = Math.min(Number(url.searchParams.get('limit')) || 40, 200);
    const cards = Q.due.all(Date.now(), limit).map(withPreview);
    return json(res, 200, { cards, stats: stats() });
  }

  if (pathname === '/api/cards' && req.method === 'GET') {
    const q = (url.searchParams.get('q') || '').trim();
    const like = '%' + q + '%';
    const cards = (q ? Q.search.all(like, like, like) : Q.all.all()).map(shape);
    return json(res, 200, { cards });
  }

  if (pathname === '/api/cards' && req.method === 'POST') {
    const b = await readBody(req);
    const front = String(b.front || '').trim();
    const back = String(b.back || '').trim();
    if (!front || !back) return json(res, 400, { error: 'Inglês e Português são obrigatórios.' });
    const now = Date.now();
    const r = Q.insert.run(
      front,
      back,
      String(b.example || '').trim(),
      normalizeTag(b.tag),
      String(b.ipa || '').trim(),
      now,
      now
    );
    return json(res, 201, { card: shape(Q.byId.get(r.lastInsertRowid)) });
  }

  if (pathname === '/api/cards/bulk' && req.method === 'POST') {
    const b = await readBody(req);
    const now = Date.now();
    const tag = normalizeTag(b.tag);
    let created = 0;

    if (Array.isArray(b.items)) {
      // itens ja validados pela previa do cliente
      for (const it of b.items) {
        const front = String(it?.front || '').trim();
        const back = String(it?.back || '').trim();
        if (!front || !back) continue;
        Q.insert.run(front, back, String(it.example || '').trim(), tag, '', now, now);
        created += 1;
      }
    } else {
      for (const line of String(b.text || '').split('\n')) {
        const parts = line.split(/\s*[|;]\s*|\s+-\s+/).map((s) => s.trim());
        if (parts.length < 2 || !parts[0] || !parts[1]) continue;
        Q.insert.run(parts[0], parts[1], parts[2] || '', tag, '', now, now);
        created += 1;
      }
    }
    return json(res, 201, { created });
  }

  let hit = /^\/api\/cards\/(\d+)$/.exec(pathname);
  if (hit) {
    const id = Number(hit[1]);
    const card = Q.byId.get(id);
    if (!card) return json(res, 404, { error: 'cartao nao encontrado' });

    if (req.method === 'PUT') {
      const b = await readBody(req);
      const front = String(b.front ?? card.front).trim();
      const back = String(b.back ?? card.back).trim();
      if (!front || !back) return json(res, 400, { error: 'Inglês e Português são obrigatórios.' });
      Q.update.run(
        front,
        back,
        String(b.example ?? card.example).trim(),
        b.tag === undefined ? card.tag : normalizeTag(b.tag),
        String(b.ipa ?? card.ipa).trim(),
        id
      );
      return json(res, 200, { card: shape(Q.byId.get(id)) });
    }
    if (req.method === 'DELETE') {
      Q.delReviews.run(id);
      Q.del.run(id);
      return json(res, 200, { ok: true });
    }
  }

  hit = /^\/api\/cards\/(\d+)\/review$/.exec(pathname);
  if (hit && req.method === 'POST') {
    const id = Number(hit[1]);
    const card = Q.byId.get(id);
    if (!card) return json(res, 404, { error: 'cartao nao encontrado' });
    const b = await readBody(req);
    const grade = Number(b.grade);
    if (![0, 1, 2, 3].includes(grade)) return json(res, 400, { error: 'grade invalido' });
    const s = schedule(card, grade);
    Q.reschedule.run(s.ease, s.interval, s.reps, s.lapses, s.due, id);
    Q.logReview.run(id, grade, Date.now());
    return json(res, 200, { card: withPreview(Q.byId.get(id)), stats: stats() });
  }

  hit = /^\/api\/cards\/(\d+)\/practice$/.exec(pathname);
  if (hit && req.method === 'POST') {
    const id = Number(hit[1]);
    const card = Q.byId.get(id);
    if (!card) return json(res, 404, { error: 'cartao nao encontrado' });
    const b = await readBody(req);
    const pull = PRACTICE_PULL[b.verdict];
    if (!VERDICTS.includes(b.verdict)) return json(res, 400, { error: 'veredito invalido' });
    let rescheduled = false;
    if (pull) {
      const target = Date.now() + pull;
      if (card.due > target) {
        Q.setDue.run(target, id);
        rescheduled = true;
      }
    }
    return json(res, 200, { card: shape(Q.byId.get(id)), rescheduled, stats: stats() });
  }

  hit = /^\/api\/cards\/(\d+)\/reset$/.exec(pathname);
  if (hit && req.method === 'POST') {
    const id = Number(hit[1]);
    if (!Q.byId.get(id)) return json(res, 404, { error: 'cartao nao encontrado' });
    Q.reset.run(Date.now(), id);
    return json(res, 200, { card: shape(Q.byId.get(id)) });
  }

  if (pathname === '/api/pronuncia' && req.method === 'POST') {
    const b = await readBody(req);
    // com id: busca so aquele cartao (mesmo que ja tenha IPA); sem id: todos os pendentes
    const single = b.id ? Q.byId.get(Number(b.id)) : null;
    if (b.id && !single) return json(res, 404, { error: 'cartao nao encontrado' });
    const pendentes = single ? [single] : Q.semIpa.all();
    let achou = 0;
    for (const c of pendentes) {
      const r = await pronunciaDe(c.front);
      if (r) {
        // sem IPA mas com audio: marca com em-dash pra nao rebuscar toda vez
        Q.setIpa.run(r.ipa || '—', r.audio, c.id);
        if (r.ipa) achou += 1;
      } else if (!single) {
        Q.setIpa.run('—', '', c.id); // marca como "sem transcricao" pra nao rebuscar
      }
      if (!single) await sleep(150); // gentileza com a API publica
    }
    return json(res, 200, {
      verificados: pendentes.length,
      achou,
      card: single ? shape(Q.byId.get(single.id)) : undefined,
    });
  }

  return json(res, 404, { error: 'rota nao encontrada' });
}

// ---------------- estaticos ----------------
function serveStatic(req, res, url) {
  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).slice(1);
  const file = path.join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, 'http://' + req.headers.host);
    try {
      if (url.pathname.startsWith('/api/')) await api(req, res, url);
      else serveStatic(req, res, url);
    } catch (err) {
      if (!res.headersSent) json(res, 500, { error: err.message });
    }
  })
  .listen(PORT, () => {
    console.log('\n  English SRS  ->  http://localhost:' + PORT + '\n');
  });
