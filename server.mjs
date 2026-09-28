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
  setIpa: db.prepare('UPDATE cards SET ipa = ?, audio = ? WHERE id = ?'),
  semIpa: db.prepare("SELECT id, front FROM cards WHERE ipa = ''"),
  logReview: db.prepare('INSERT INTO reviews (card_id, grade, ts) VALUES (?, ?, ?)'),
  delReviews: db.prepare('DELETE FROM reviews WHERE card_id = ?'),
};

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

const withPreview = (card) => ({ ...card, previews: preview(card) });

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

    // O roteador gratuito troca de modelo a cada chamada; alguns são modelos
    // de "reasoning" que consomem o orçamento de tokens pensando (content
    // sai null) e outros ignoram o schema pedido. Tenta algumas vezes antes
    // de desistir, já que uma nova tentativa costuma cair em outro modelo.
    const attempts = 3;
    let lastErrorName = 'erro';
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
              { role: 'system', content: 'Você é um tutor de inglês. Avalie se a frase do estudante está gramaticalmente correta e soa natural, e se usa a expressão-alvo com o sentido apropriado. Responda em português brasileiro, de forma muito breve, sem introdução, exatamente como JSON com as chaves correct (boolean), complexity (uma entre Básica, Intermediária, Avançada), correction (frase corrigida em inglês ou string vazia se a frase estiver correta). Preserve o significado pretendido; corrija também pontuação e capitalização quando necessário.' },
              { role: 'user', content: `Expressão-alvo: ${target}\nFrase do estudante: ${sentence}` },
            ],
            response_format: { type: 'json_object' },
            max_tokens: 800,
          }),
        });
        const payload = await response.json();
        if (!response.ok) {
          console.error('[ai] avaliação recusada (tentativa', attempt, '):', response.status, payload.error?.code || 'erro');
          lastErrorName = `status ${response.status}`;
          continue;
        }
        const output = payload.choices?.[0]?.message?.content;
        const result = JSON.parse(output || '{}');
        if (typeof result.correct !== 'boolean' || !['Básica', 'Intermediária', 'Avançada'].includes(result.complexity)) throw new Error('resposta inválida');
        return json(res, 200, {
          correct: result.correct,
          complexity: result.complexity,
          correction: result.correct ? '' : String(result.correction || sentence).slice(0, 1000),
        });
      } catch (error) {
        lastErrorName = error.name || 'erro';
        console.error('[ai] falha na avaliação (tentativa', attempt, '):', lastErrorName);
      }
    }
    return json(res, 502, { error: 'Falha ao avaliar a frase. Tente novamente.' });
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
    const cards = q ? Q.search.all(like, like, like) : Q.all.all();
    return json(res, 200, { cards });
  }

  if (pathname === '/api/cards' && req.method === 'POST') {
    const b = await readBody(req);
    const front = String(b.front || '').trim();
    const back = String(b.back || '').trim();
    if (!front || !back) return json(res, 400, { error: 'front e back sao obrigatorios' });
    const now = Date.now();
    const r = Q.insert.run(
      front,
      back,
      String(b.example || '').trim(),
      String(b.tag || '').trim(),
      String(b.ipa || '').trim(),
      now,
      now
    );
    return json(res, 201, { card: Q.byId.get(r.lastInsertRowid) });
  }

  if (pathname === '/api/cards/bulk' && req.method === 'POST') {
    const b = await readBody(req);
    const now = Date.now();
    const tag = String(b.tag || '').trim();
    let created = 0;
    for (const line of String(b.text || '').split('\n')) {
      const parts = line.split(/\s*[|;]\s*|\s+-\s+/).map((s) => s.trim());
      if (parts.length < 2 || !parts[0] || !parts[1]) continue;
      Q.insert.run(parts[0], parts[1], parts[2] || '', tag, '', now, now);
      created += 1;
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
      Q.update.run(
        String(b.front ?? card.front).trim(),
        String(b.back ?? card.back).trim(),
        String(b.example ?? card.example).trim(),
        String(b.tag ?? card.tag).trim(),
        String(b.ipa ?? card.ipa).trim(),
        id
      );
      return json(res, 200, { card: Q.byId.get(id) });
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
    return json(res, 200, { card: Q.byId.get(id), stats: stats() });
  }

  hit = /^\/api\/cards\/(\d+)\/reset$/.exec(pathname);
  if (hit && req.method === 'POST') {
    const id = Number(hit[1]);
    if (!Q.byId.get(id)) return json(res, 404, { error: 'cartao nao encontrado' });
    Q.reset.run(Date.now(), id);
    return json(res, 200, { card: Q.byId.get(id) });
  }

  if (pathname === '/api/pronuncia' && req.method === 'POST') {
    const pendentes = Q.semIpa.all();
    let achou = 0;
    for (const c of pendentes) {
      const r = await pronunciaDe(c.front);
      if (r) {
        // sem IPA mas com audio: marca com em-dash pra nao rebuscar toda vez
        Q.setIpa.run(r.ipa || '—', r.audio, c.id);
        if (r.ipa) achou += 1;
      } else {
        Q.setIpa.run('—', '', c.id); // marca como "sem transcricao" pra nao rebuscar
      }
      await sleep(150); // gentileza com a API publica
    }
    return json(res, 200, { verificados: pendentes.length, achou });
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
