
    import { fetchKlines, parseKlines } from '../js/binance.js';
    import { experimentalState } from './experimentalState.js';
    import { nearBreakout, scanRank } from './momentumModel.js';
    import { compareModels } from './modelComparator.js';
    import { buildProbabilityDecision } from './probabilityModel.js';
    import { runBacktest, drawEquityCurve } from './visualBacktest.js';
    import { runGridSearch, defaultGrid } from './gridSearch.js';
    import { EdgeEngine } from './edgeEngine.js';
    import { DEFAULT_EXPERIMENTAL_CFG, mergeExperimentalCfg } from './experimentalConfig.js';

    const $ = (id) => document.getElementById(id);
    const fmtUsd = (n) => (Number(n) || 0).toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2});
    const fmtPct = (n) => `${(Number(n) * 100).toFixed(2)}%`;
    const logsPanel = $('logsPanel');
    let lastGridBest = null;
    const logBuffer = [];
    experimentalState.cfg = mergeExperimentalCfg(DEFAULT_EXPERIMENTAL_CFG, experimentalState.cfg || {});

    function flushLogs(){
      if (!logBuffer.length) return;
      for (let i = logBuffer.length - 1; i >= 0; i--){
        experimentalState.logs.unshift(logBuffer[i]);
      }
      logBuffer.length = 0;
      if (experimentalState.logs.length > 300){
        experimentalState.logs.splice(300);
      }
      logsPanel.textContent = experimentalState.logs.join('\n');
    }

    function logInstitutional(payload){
      const fmtNA = (v, digits = 4) => (v == null || !Number.isFinite(Number(v))) ? 'N/A' : Number(v).toFixed(digits);
      const line = [
        `[${new Date().toLocaleTimeString('pt-BR',{hour12:false})}]`,
        `regime=${payload.regime}`,
        `breakout=${payload.breakoutFlag ? 1 : 0}`,
        `atrExp=${payload.atrExp ? 1 : 0}`,
        `volExp=${payload.volExp ? 1 : 0}`,
        `momentum=${fmtNA(payload.momentumScore)}`,
        `prob2R=${fmtNA(payload.probability)}`,
        `rollExp=${fmtNA(payload.rollingNetExpectancy)}`,
        `edgeTrades=${Number(payload.edgeTradesCount || 0)}`,
        `edgeOk=${payload.edgeOk ? 1 : 0}`,
        `decision=${payload.decision || 'HOLD'}`,
        `reason=${payload.reason || 'NA'}`,
        `slippage=${Number(payload.slippageEst || 0).toFixed(6)}`
      ].join(' ');
      logBuffer.push(line);
    }

    async function loadSeries(symbol, interval, limit){
      const kl = await fetchKlines(symbol, interval, limit);
      return parseKlines(kl);
    }

    function renderScanner(rows){
      const tbody = $('scannerTable').querySelector('tbody');
      const fmtNA = (v, digits = 4) => (v == null || !Number.isFinite(Number(v))) ? 'N/A' : Number(v).toFixed(digits);
      tbody.innerHTML = rows.map((r) => `
        <tr>
          <td>${r.symbol}</td>
          <td>${r.regime}</td>
          <td>${r.breakoutFlag ? 'YES' : 'NO'}</td>
          <td>${r.nearBreakout ? 'YES' : 'NO'}</td>
          <td>${Number.isFinite(Number(r.distToBreakoutPct)) ? `${(Number(r.distToBreakoutPct) * 100).toFixed(3)}%` : 'N/A'}</td>
          <td>${r.atrExp ? 'YES' : 'NO'}</td>
          <td>${r.volExp ? 'YES' : 'NO'}</td>
          <td>${Number(r.slopeNorm || 0).toFixed(3)}</td>
          <td>${r.prob2R == null ? 'N/A' : `${(Number(r.prob2R) * 100).toFixed(1)}%`}</td>
          <td>${r.probOcc == null ? 'N/A' : Number(r.probOcc)}</td>
          <td>${r.probSucc == null ? 'N/A' : Number(r.probSucc)}</td>
          <td>${Number(r.edgeTradesCount || 0)}</td>
          <td>${r.edgeOk ? 'YES' : 'NO'}</td>
          <td>${fmtNA(r.momentumScore)}</td>
          <td>${Number(r.rollingNetExpectancy || 0).toFixed(4)}</td>
          <td class="${(r.scanSignal === 'BUY' || r.scanSignal === 'BUY_TEST') ? 'buy' : (r.scanSignal === 'WATCH' ? 'watch' : 'hold')}">${r.scanSignal || r.signal}</td>
        </tr>
      `).join('');
    }

    function renderComparator(rows){
      const tbody = $('comparatorTable').querySelector('tbody');
      const fmtNA = (v, digits = 2) => (v == null || !Number.isFinite(Number(v))) ? 'N/A' : Number(v).toFixed(digits);
      tbody.innerHTML = rows.map((r) => `
        <tr>
          <td>${r.symbol}</td>
          <td>${r.scoreDecision.signal} (${fmtNA(r.scoreDecision.score)})</td>
          <td>${r.momentumDecision.signal} (${fmtNA(r.momentumDecision.score)})</td>
          <td>${r.probDecision.signal} (${r.probDecision.probability == null ? 'N/A' : `${(Number(r.probDecision.probability) * 100).toFixed(1)}%`})</td>
          <td><b>${r.best}</b></td>
        </tr>
      `).join('');
    }

    async function runScanner(){
      const symbols = $('symbolsInput').value.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
      const interval = $('intervalInput').value;
      const limit = Math.max(260, Number($('limitInput').value || 1200));
      const nearPct = Math.max(0.0001, Number($('nearPctInput').value || 0.002));
      const noGates = Boolean($('noGates').checked);
      const disableProbScan = Boolean($('disableProbScan').checked);
      experimentalState.cfg = mergeExperimentalCfg(DEFAULT_EXPERIMENTAL_CFG, experimentalState.cfg || {});

      const scannerRows = [];
      const comparatorRows = [];
      for (const symbol of symbols){
        try{
          const series = await loadSeries(symbol, interval, limit);
          const cmp = compareModels(symbol, series, experimentalState, { noGates, disableProbScan });
          const mom = cmp.momentumDecision;
          const prob2R = cmp.probDecision?.prob2R ?? cmp.probDecision?.probability ?? null;
          const probOcc = cmp.probDecision?.occ ?? cmp.probDecision?.sampleSize ?? null;
          const probSucc = cmp.probDecision?.succ ?? cmp.probDecision?.wins2R ?? null;
          const nb = nearBreakout(series, Number(experimentalState.cfg?.breakoutLookback || 12), nearPct);
          const scanSignal = noGates
            ? 'BUY_TEST'
            : (mom.signal === 'BUY'
              ? 'BUY'
              : (nb.nearBreakout && !mom.breakoutFlag ? 'WATCH' : 'HOLD'));
          scannerRows.push({ ...mom, ...nb, prob2R, probOcc, probSucc, scanSignal });
          comparatorRows.push(cmp);

          const holdReason = mom.regime === 'CHOP'
            ? 'CHOP_BLOCK'
            : (mom.reason === 'NON_BULL_REQUIRES_PROB' ? 'PROB_FAIL' : 'BREAKOUT_FAIL');
          const scanReason = scanSignal === 'WATCH'
            ? `WATCH_NEAR_BREAKOUT + distToBreakoutPct=${Number(nb.distToBreakoutPct || 0).toFixed(6)}`
            : ((scanSignal === 'BUY' || scanSignal === 'BUY_TEST') ? (noGates ? 'NO_GATES_TEST_MODE' : 'MOMENTUM_SETUP') : holdReason);
          logInstitutional({
            regime: mom.regime,
            breakoutFlag: mom.breakoutFlag,
            atrExp: mom.atrExp,
            volExp: mom.volExp,
            momentumScore: mom.momentumScore,
            probability: prob2R,
            rollingNetExpectancy: mom.rollingNetExpectancy,
            edgeTradesCount: mom.edgeTradesCount,
            edgeOk: mom.edgeOk,
            decision: scanSignal,
            reason: scanReason,
            slippageEst: 0.0006
          });
        } catch (err){
          logInstitutional({
            regime: 'ERR',
            breakoutFlag: false,
            atrExp: false,
            volExp: false,
            momentumScore: null,
            probability: null,
            rollingNetExpectancy: null,
            edgeTradesCount: 0,
            edgeOk: false,
            decision: 'HOLD',
            reason: 'SCANNER_ERROR',
            slippageEst: 0
          });
          console.error(`Erro scanner ${symbol}`, err);
        }
      }

      const rankedRows = scanRank(scannerRows);
      experimentalState.scannerRows = rankedRows;
      experimentalState.comparatorRows = comparatorRows;
      renderScanner(rankedRows);
      renderComparator(comparatorRows);
      flushLogs();
    }

    async function runBacktestUI(){
      const symbol = $('btSymbol').value.trim().toUpperCase();
      const interval = $('btInterval').value;
      const modelType = $('btModel').value;
      const limit = Math.max(260, Number($('btLimit').value || 1200));
      const noGates = Boolean($('noGates').checked);

      const series = await loadSeries(symbol, interval, limit);
      const result = runBacktest(symbol, modelType, series, {
        edgeEngine: experimentalState.edgeEngine,
        cfg: mergeExperimentalCfg(DEFAULT_EXPERIMENTAL_CFG, experimentalState.cfg || {}),
        noGates,
        fastMode: false,
        maxTradesPerBacktest: 30
      });
      if (result.error){
        logInstitutional({
          regime: 'BT_ERR',
          breakoutFlag: false,
          atrExp: false,
          volExp: false,
          momentumScore: null,
          probability: null,
          rollingNetExpectancy: null,
          edgeTradesCount: Number(experimentalState.edgeEngine?.tradesCount || 0),
          edgeOk: false,
          decision: 'HOLD',
          reason: result.error,
          slippageEst: 0
        });
        return;
      }
      $('mNet').textContent = fmtUsd(result.netProfit);
      $('mWin').textContent = fmtPct(result.winRate);
      $('mExp').textContent = fmtUsd(result.expectancy);
      $('mDd').textContent = fmtPct(result.maxDD);
      $('mTrades').textContent = String(result.trades || 0);
      const block = (result.trades || 0) > 0
        ? '-'
        : Object.entries(result.blockReasons || {}).sort((a,b)=>b[1]-a[1])[0]?.[0] || 'NO_SIGNAL';
      $('mBlock').textContent = block;
      drawEquityCurve($('equityCanvas'), result.equityCurve);
      logInstitutional({
        regime: 'BACKTEST',
        breakoutFlag: true,
        atrExp: true,
        volExp: true,
        momentumScore: null,
        probability: null,
        rollingNetExpectancy: result.expectancy,
        edgeTradesCount: Number(experimentalState.edgeEngine?.tradesCount || 0),
        edgeOk: true,
        decision: (result.trades || 0) > 0 ? 'RUN_OK' : 'RUN_EMPTY',
        reason: (result.trades || 0) > 0 ? 'TRADES_GENERATED' : `no signals due to ${block}`,
        slippageEst: modelType === 'momentum' ? 0.0006 : (modelType === 'score' ? 0.0007 : 0.0008)
      });
      flushLogs();
    }

    async function runProbOnlySlow(){
      const symbol = $('btSymbol').value.trim().toUpperCase() || 'BTCUSDT';
      const interval = $('intervalInput').value;
      const limit = Math.max(320, Number($('limitInput').value || 1200));
      const series = await loadSeries(symbol, interval, limit);
      const out = buildProbabilityDecision(symbol, series, experimentalState.cfg, { noGates: false, fastMode: false });
      logInstitutional({
        regime: out.regime || 'N/A',
        breakoutFlag: out.breakoutFlag,
        atrExp: out.atrExp,
        volExp: out.volExp,
        momentumScore: null,
        probability: out.prob2R,
        rollingNetExpectancy: null,
        edgeTradesCount: Number(experimentalState.edgeEngine?.tradesCount || 0),
        edgeOk: true,
        decision: out.signal || 'HOLD',
        reason: `PROB_ONLY prob2R=${out.prob2R == null ? 'N/A' : Number(out.prob2R).toFixed(4)} occ=${out.occ ?? 'N/A'} succ=${out.succ ?? 'N/A'}`,
        slippageEst: 0
      });
      flushLogs();
    }

    function renderGridResults(res){
      const tbody = $('gridTable').querySelector('tbody');
      const rows = Array.isArray(res?.top10) ? res.top10 : [];
      tbody.innerHTML = rows.map((r, idx) => `
        <tr>
          <td>${idx + 1}</td>
          <td>${Number(r.params.stopAtrMult).toFixed(2)}</td>
          <td>${Number(r.params.rTarget).toFixed(2)}</td>
          <td>${Number(r.params.breakoutLookback)}</td>
          <td>${Number(r.params.chopSlopeNorm).toFixed(2)}</td>
          <td>${Number(r.params.bullSlopeNorm).toFixed(2)}</td>
          <td>${Number(r.trades || 0)}</td>
          <td>${fmtUsd(r.netProfit || 0)}</td>
          <td>${fmtUsd(r.expectancy || 0)}</td>
          <td>${fmtPct(r.maxDD || 0)}</td>
          <td>${r.rejected ? 'REJECTED' : 'OK'}</td>
        </tr>
      `).join('');
      $('gridSummary').textContent = `Combos: ${res?.totalCombos || 0} · Válidos: ${res?.validCount || 0} · Best: ${res?.best ? 'encontrado' : 'nenhum'}`;
    }

    async function runGridUI(){
      const symbol = $('gsSymbol').value.trim().toUpperCase();
      const interval = $('gsInterval').value;
      const modelType = $('gsModel').value;
      const limit = Math.max(260, Number($('gsLimit').value || 1200));
      const series = await loadSeries(symbol, interval, limit);
      const res = runGridSearch(symbol, series, defaultGrid(), modelType, {
        edgeEngineFactory: () => new EdgeEngine(50)
      });
      lastGridBest = res?.best || null;
      renderGridResults(res);
      if (lastGridBest){
        logInstitutional({
          regime: 'GRID',
          breakoutFlag: true,
          atrExp: true,
          volExp: true,
          momentumScore: null,
          probability: null,
          rollingNetExpectancy: lastGridBest.expectancy,
          edgeTradesCount: Number(lastGridBest.trades || 0),
          edgeOk: true,
          decision: 'GRID_DONE',
          reason: `best expectancy=${Number(lastGridBest.expectancy || 0).toFixed(4)}`,
          slippageEst: 0
        });
      }
    }

    function applyBestParams(){
      if (!lastGridBest?.params) return;
      experimentalState.cfg = mergeExperimentalCfg(experimentalState.cfg, lastGridBest.params);
      $('gridSummary').textContent = `${$('gridSummary').textContent} · Params aplicados ao experimental cfg`;
      logInstitutional({
        regime: 'GRID',
        breakoutFlag: true,
        atrExp: true,
        volExp: true,
        momentumScore: null,
        probability: null,
        rollingNetExpectancy: Number(lastGridBest.expectancy || 0),
        edgeTradesCount: Number(experimentalState.edgeEngine?.tradesCount || 0),
        edgeOk: true,
        decision: 'APPLY_BEST',
        reason: JSON.stringify(lastGridBest.params),
        slippageEst: 0
      });
    }

    $('btnScan').addEventListener('click', runScanner);
    $('btnBacktest').addEventListener('click', runBacktestUI);
    $('btnProbOnly').addEventListener('click', runProbOnlySlow);
    $('btnRunGrid').addEventListener('click', runGridUI);
    $('btnApplyBest').addEventListener('click', applyBestParams);
    setInterval(flushLogs, 250);
    setInterval(() => { $('labClock').textContent = new Date().toLocaleTimeString('pt-BR',{hour12:false}); }, 1000);
    runScanner();
  
