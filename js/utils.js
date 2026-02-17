/**
 * utils.js
 * ------------------------------------------------------------
 * Utilitários pequenos e puros (format, tempo, helpers).
 * - Não deve depender do DOM (exceto helpers explícitos como rafDebounce)
 */
export const now = () => Date.now();
export const uid = () => Math.random().toString(16).slice(2) + '-' + Math.random().toString(16).slice(2);
export const ts = (ms) => new Date(ms).toLocaleTimeString('pt-BR',{hour12:false});
export const fmtUSD = (n) => (Number(n)||0).toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2});
export const fmtPct = (n) => `${(Number(n)||0).toFixed(2)}%`;

export function fmtPx(price){
  const p = Number(price);
  if (!Number.isFinite(p)) return '—';
  if (p >= 1000) return p.toFixed(2);
  if (p >= 100) return p.toFixed(2);
  if (p >= 10) return p.toFixed(3);
  if (p >= 1) return p.toFixed(4);
  if (p >= 0.1) return p.toFixed(5);
  return p.toFixed(6);
}

export function intervalToMs(interval){
  const m = String(interval||'').trim();
  const unit = m.slice(-1);
  const n = Number(m.slice(0,-1));
  if (!Number.isFinite(n) || n <= 0) return 60_000;
  if (unit === 'm') return n * 60_000;
  if (unit === 'h') return n * 3_600_000;
  if (unit === 'd') return n * 86_400_000;
  if (unit === 'w') return n * 7 * 86_400_000;
  if (unit === 'M') return n * 30 * 86_400_000;
  return 60_000;
}


/**
 * Concurrency limiter (estilo p-limit) para evitar estourar rate limits.
 * Uso:
 *   const limit = pLimit(5);
 *   await Promise.all(tasks.map(t => limit(() => t())));
 */
export function pLimit(concurrency){
  const c = Math.max(1, Number(concurrency||1));
  let activeCount = 0;
  const queue = [];
  const next = () => {
    if (activeCount >= c) return;
    const item = queue.shift();
    if (!item) return;
    activeCount++;
    const { fn, resolve, reject } = item;
    Promise.resolve()
      .then(fn)
      .then(resolve, reject)
      .finally(() => {
        activeCount--;
        next();
      });
  };
  return (fn) => new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    next();
  });
}

/**
 * Debounce via requestAnimationFrame para agrupar updates de UI sem travar o loop.
 */
export function rafDebounce(fn){
  let raf = 0;
  return (...args) => {
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      raf = 0;
      fn(...args);
    });
  };
}
