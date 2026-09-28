// Algoritmo SM-2 (SuperMemo 2) simplificado.
// grade: 0 = errei | 1 = dificil | 2 = bom | 3 = facil

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;

export function schedule(card, grade) {
  let { ease, interval, reps, lapses } = card;
  const now = Date.now();

  if (grade === 0) {
    // errou: volta pra fila de aprendizado em 10 minutos
    lapses += 1;
    reps = 0;
    interval = 0;
    ease = Math.max(1.3, ease - 0.2);
    return { ease, interval, reps, lapses, due: now + 10 * MIN };
  }

  // q do SM-2: 1->3 (dificil), 2->4 (bom), 3->5 (facil)
  const q = grade + 2;
  ease = ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  ease = Math.min(2.8, Math.max(1.3, ease));

  reps += 1;
  if (reps === 1) {
    interval = grade === 1 ? 1 : grade === 2 ? 1 : 3;
  } else if (reps === 2) {
    interval = grade === 1 ? 3 : grade === 2 ? 6 : 10;
  } else {
    const factor = grade === 1 ? 1.2 : grade === 2 ? ease : ease * 1.3;
    interval = Math.max(1, Math.round(interval * factor));
  }
  interval = Math.min(interval, 365);

  return { ease, interval, reps, lapses, due: now + interval * DAY };
}

export const humanInterval = (days) => {
  if (days < 1) return '10 min';
  if (days === 1) return '1 dia';
  if (days < 30) return `${Math.round(days)} dias`;
  if (days < 345) {
    const m = Math.round(days / 30);
    return m === 1 ? '1 mês' : `${m} meses`;
  }
  const y = days / 365;
  return y < 1.5 ? '1 ano' : `${y.toFixed(1)} anos`;
};

// Previa dos intervalos, para mostrar nos botoes
export function preview(card) {
  return [0, 1, 2, 3].map((g) => humanInterval(schedule(card, g).interval));
}
