/**
 * binance.js
 * ------------------------------------------------------------
 * Integração pública (sem autenticação) com endpoints REST da Binance.
 * - Klines
 * - 24h tickers
 *
 * Importante:
 * - Em ambiente real, considere timeouts/retries e backoff.
 */
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function sleep(ms){
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJsonWithRetry(url, opts = {}){
  const retries = Math.max(0, Number(opts.retries ?? 2));
  const timeoutMs = Math.max(1000, Number(opts.timeoutMs ?? 8000));
  const baseDelayMs = Math.max(50, Number(opts.baseDelayMs ?? 250));

  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++){
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new Error('timeout')), timeoutMs);
    try{
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok){
        if (!RETRYABLE_STATUS.has(res.status) || attempt === retries){
          throw new Error(`Binance HTTP ${res.status}`);
        }
        const jitter = Math.floor(Math.random() * 120);
        await sleep(baseDelayMs * (2 ** attempt) + jitter);
        continue;
      }
      return await res.json();
    } catch (err){
      lastErr = err;
      if (attempt === retries) break;
      const jitter = Math.floor(Math.random() * 120);
      await sleep(baseDelayMs * (2 ** attempt) + jitter);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr || new Error('Erro de rede Binance');
}

export async function fetchKlines(symbol, interval, limit){
  const url = `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${encodeURIComponent(limit)}`;
  const data = await fetchJsonWithRetry(url, { retries: 2, timeoutMs: 8000, baseDelayMs: 250 });
  if (!Array.isArray(data)) throw new Error('Resposta inválida de klines');
  return data;
}

export function parseKlines(kl){
  const o=[],h=[],l=[],c=[],v=[],t=[];
  for (const k of kl){
    t.push(Number(k[0]));
    o.push(Number(k[1]));
    h.push(Number(k[2]));
    l.push(Number(k[3]));
    c.push(Number(k[4]));
    v.push(Number(k[5]));
  }
  return {t,o,h,l,c,v};
}

export async function fetch24hTickers(){
  const url = `https://api.binance.com/api/v3/ticker/24hr`;
  const data = await fetchJsonWithRetry(url, { retries: 2, timeoutMs: 8000, baseDelayMs: 250 });
  if (!Array.isArray(data)) throw new Error('Resposta inválida ticker/24hr');
  return data;
}
