function parseAuditLine(line){
  const m = /^\[AUDIT\]\[([A-Z_]+)\]\s*(.*)$/.exec(String(line || ''));
  if (!m) return null;
  const eventType = m[1];
  const payload = {};
  const re = /([a-zA-Z0-9_]+)=([^\s|]+)/g;
  let x;
  while ((x = re.exec(m[2])) !== null){
    payload[x[1]] = x[2];
  }
  return { eventType, payload };
}

export function createAuditClient({ state, getCfg }){
  let timer = null;
  const queue = [];
  let warnedBadEndpoint = false;

  function resolveEndpoint(raw){
    const ep = String(raw || '').trim();
    if (!ep) return null;

    // Em hosts estáticos (ex.: GitHub Pages), endpoint relativo não aponta para Supabase.
    if (ep.startsWith('/') && typeof window !== 'undefined' && /github\.io$/i.test(window.location.hostname)){
      if (!warnedBadEndpoint){
        warnedBadEndpoint = true;
        console.warn('[audit] Endpoint relativo em github.io é inválido. Configure URL completa do Supabase Functions.');
      }
      return null;
    }
    return ep;
  }

  async function flushNow(){
    const cfg = getCfg?.() || {};
    if (!cfg.auditOn || !queue.length) return;
    const endpoint = resolveEndpoint(cfg.auditEndpoint);
    if (!endpoint) return;
    const batch = queue.splice(0, 100);
    const runId = String(state.runId || batch[0]?.runId || '').trim();
    if (!runId){
      queue.unshift(...batch);
      return;
    }
    try{
      const headers = { 'Content-Type': 'application/json' };
      const token = String(cfg.auditToken || '').trim();
      if (token) headers['x-audit-token'] = token;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: 'append',
          params: {
            runId,
            events: batch
          }
        })
      });
      if (!res.ok){
        queue.unshift(...batch);
      }
    } catch(_e){
      queue.unshift(...batch);
    }
  }

  function capture(line){
    const cfg = getCfg?.() || {};
    if (!cfg.auditOn) return;

    const parsed = parseAuditLine(line);
    if (!parsed) return;

    queue.push({
      ts: Date.now(),
      runId: state.runId || null,
      eventType: parsed.eventType,
      payload: parsed.payload,
      raw: String(line || '')
    });
    if (queue.length > 2000) queue.splice(0, queue.length - 2000);
  }

  function start(){
    const cfg = getCfg?.() || {};
    if (timer) clearInterval(timer);
    const flushMs = Math.max(2000, Number(cfg.auditFlushSec || 8) * 1000);
    timer = setInterval(() => { flushNow(); }, flushMs);
  }

  return { capture, flushNow, start };
}
