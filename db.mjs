import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const db = new DatabaseSync(path.join(__dirname, 'data.db'));

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS cards (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    front    TEXT    NOT NULL,
    back     TEXT    NOT NULL,
    example  TEXT    NOT NULL DEFAULT '',
    tag      TEXT    NOT NULL DEFAULT '',
    ease     REAL    NOT NULL DEFAULT 2.5,
    interval REAL    NOT NULL DEFAULT 0,
    reps     INTEGER NOT NULL DEFAULT 0,
    lapses   INTEGER NOT NULL DEFAULT 0,
    due      INTEGER NOT NULL,
    created  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS reviews (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    grade   INTEGER NOT NULL,
    ts      INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_cards_due ON cards(due);
  CREATE INDEX IF NOT EXISTS idx_reviews_ts ON reviews(ts);
`);

// ---- migracoes aditivas (seguras em banco existente) ----
const colunas = db.prepare('PRAGMA table_info(cards)').all().map((c) => c.name);
for (const [nome, ddl] of [
  ['ipa', "ALTER TABLE cards ADD COLUMN ipa TEXT NOT NULL DEFAULT ''"],
  ['audio', "ALTER TABLE cards ADD COLUMN audio TEXT NOT NULL DEFAULT ''"],
]) {
  if (!colunas.includes(nome)) {
    db.exec(ddl);
    console.log(`[db] coluna "${nome}" adicionada`);
  }
}

// ---- seed inicial (so na primeira execucao) ----
const SEED = [
  ['to look forward to', 'aguardar com expectativa, estar ansioso por', "I'm looking forward to your reply.", 'phrasal verb'],
  ['to figure out', 'descobrir, sacar, entender', "I couldn't figure out what went wrong.", 'phrasal verb'],
  ['to come up with', 'criar, inventar, bolar (uma ideia)', 'She came up with a brilliant solution.', 'phrasal verb'],
  ['to run out of', 'ficar sem (algo)', "We've run out of coffee.", 'phrasal verb'],
  ['to put up with', 'tolerar, aguentar', "I can't put up with this noise anymore.", 'phrasal verb'],
  ['to get rid of', 'se livrar de', 'I need to get rid of these old files.', 'phrasal verb'],
  ['to keep track of', 'acompanhar, manter o controle de', 'This app keeps track of your progress.', 'phrasal verb'],
  ['to bring up', 'mencionar, trazer a tona', 'He brought up an interesting point.', 'phrasal verb'],
  ['to work out', 'dar certo; treinar', 'It all worked out in the end.', 'phrasal verb'],
  ['to look into', 'investigar, analisar', "I'll look into the issue tomorrow.", 'phrasal verb'],
  ['reliable', 'confiavel', 'She is a reliable teammate.', 'adjetivo'],
  ['straightforward', 'direto, simples, sem complicacao', 'The setup is pretty straightforward.', 'adjetivo'],
  ['thorough', 'minucioso, detalhado', 'He did a thorough review of the code.', 'adjetivo'],
  ['awkward', 'estranho, desconfortavel, sem jeito', 'There was an awkward silence.', 'adjetivo'],
  ['overwhelming', 'esmagador, avassalador', 'The amount of work was overwhelming.', 'adjetivo'],
  ['reasonable', 'razoavel, sensato', "That's a reasonable request.", 'adjetivo'],
  ['insightful', 'perspicaz, esclarecedor', 'Thanks for the insightful feedback.', 'adjetivo'],
  ['cumbersome', 'trabalhoso, pesado, incomodo', 'The old process was cumbersome.', 'adjetivo'],
  ['to achieve', 'alcancar, conquistar', 'We achieved all our goals.', 'verbo'],
  ['to improve', 'melhorar, aperfeicoar', 'I want to improve my English.', 'verbo'],
  ['to afford', 'poder pagar / permitir-se', "We can't afford to fail.", 'verbo'],
  ['to avoid', 'evitar', 'Try to avoid long sentences.', 'verbo'],
  ['to require', 'exigir, requerer', 'This task requires attention.', 'verbo'],
  ['to reach out', 'entrar em contato', 'Feel free to reach out anytime.', 'verbo'],
  ['to acknowledge', 'reconhecer, confirmar o recebimento', 'She acknowledged the mistake.', 'verbo'],
  ['to struggle', 'ter dificuldade, lutar', 'I struggle with pronunciation.', 'verbo'],
  ['on purpose', 'de proposito', "He did it on purpose.", 'expressao'],
  ['as far as I know', 'pelo que eu sei', "As far as I know, it's still open.", 'expressao'],
  ['no wonder', 'nao e de se admirar', "No wonder you're tired.", 'expressao'],
  ['by the way', 'a proposito, falando nisso', "By the way, did you call her?", 'expressao'],
  ['it turns out', 'acontece que, no fim das contas', 'It turns out he was right.', 'expressao'],
  ['to be worth it', 'valer a pena', 'The effort was worth it.', 'expressao'],
  ['on the other hand', 'por outro lado', "On the other hand, it's cheaper.", 'expressao'],
  ['in a nutshell', 'em resumo, resumindo', "In a nutshell, we're behind schedule.", 'expressao'],
  ['to make sense', 'fazer sentido', "That doesn't make sense to me.", 'expressao'],
  ['to be about to', 'estar a ponto de', 'I was about to leave.', 'expressao'],
  ['likely', 'provavel, provavelmente', "It's likely to rain.", 'adverbio'],
  ['barely', 'quase nao, apenas', 'I barely slept last night.', 'adverbio'],
  ['eventually', 'eventualmente (no fim, mais tarde)', 'She eventually agreed.', 'adverbio'],
  ['actually', 'na verdade, de fato', "Actually, I disagree.", 'adverbio'],
];

const count = db.prepare('SELECT COUNT(*) AS n FROM cards').get().n;
if (count === 0) {
  const now = Date.now();
  const ins = db.prepare(
    'INSERT INTO cards (front, back, example, tag, due, created) VALUES (?, ?, ?, ?, ?, ?)'
  );
  for (const [front, back, example, tag] of SEED) {
    ins.run(front, back, example, tag, now, now);
  }
  console.log(`[db] seed inicial: ${SEED.length} cartoes criados`);
}
