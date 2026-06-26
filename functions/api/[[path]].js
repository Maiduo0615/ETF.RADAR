const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store, max-age=0' };
function json(data, status = 200) { return new Response(JSON.stringify(data, null, 2), { status, headers: JSON_HEADERS }); }
function today() { return new Date().toISOString().slice(0, 10); }
function valid(n) { return Number.isFinite(Number(n)) && Number(n) > 0; }
function num(v) { const n = Number(String(v ?? '').replace(/,/g, '').replace(/X/g, '').trim()); return Number.isFinite(n) ? n : null; }
function mean(a) { return a.reduce((x, y) => x + y, 0) / a.length; }
function sma(a, n) { return Array.isArray(a) && a.length >= n ? mean(a.slice(-n)) : null; }
function cleanHtml(html) { return String(html || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#x2F;|&#47;/g, '/').replace(/,/g, '').replace(/\s+/g, ' ').trim(); }
async function fetchText(url, timeoutMs = 10000) { const ctl = new AbortController(); const id = setTimeout(() => ctl.abort(), timeoutMs); try { const res = await fetch(url, { signal: ctl.signal, headers: { 'user-agent': 'Mozilla/5.0 (ETF Radar V3)', 'accept': 'text/html,application/json,text/plain,*/*' } }); const body = await res.text(); if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`); return body; } finally { clearTimeout(id); } }
async function fetchJson(url, timeoutMs = 10000) { return JSON.parse(await fetchText(url, timeoutMs)); }
function normalizeHist(h) { if (!h || !h.closes?.length) return null; const highs = h.highs.slice(-252).filter(valid); const lows = h.lows.slice(-252).filter(valid); const high52 = highs.length ? Math.max(...highs) : null; const low52 = lows.length ? Math.min(...lows) : null; return { price: h.closes.at(-1), high52, low52, yearHigh: high52, yearLow: low52, ma20: sma(h.closes, 20), ma60: sma(h.closes, 60), ma120: sma(h.closes, 120), date: h.date || today(), source: h.source || 'data', sourceUrl: h.sourceUrl || '' }; }
function adjustSplitSeries(h) { const closes = [...h.closes], highs = [...h.highs], lows = [...h.lows]; for (let i = 1; i < closes.length; i++) { const prev = closes[i - 1], cur = closes[i]; if (!valid(prev) || !valid(cur)) continue; const ratio = cur / prev; if (ratio < 0.55 || ratio > 1.8) { for (let j = 0; j < i; j++) { closes[j] *= ratio; highs[j] *= ratio; lows[j] *= ratio; } } } return { ...h, closes, highs, lows, source: `${h.source || ''}/split-adjusted` }; }
async function fetchTwName(symbol) { try { const rows = await fetchJson('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL', 8000); const row = (rows || []).find(r => String(r.Code || r['證券代號'] || r['股票代號'] || '').trim().toUpperCase() === symbol.toUpperCase()); return row ? (row.Name || row['證券名稱'] || row['股票名稱'] || '') : ''; } catch (_) { return ''; } }
async function fetchTwseHistory(symbol) { const closes = [], highs = [], lows = [], dates = []; const now = new Date(); for (let i = 0; i < 15; i++) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}01`; const urls = [`https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY?response=json&date=${date}&stockNo=${encodeURIComponent(symbol)}`, `https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=${date}&stockNo=${encodeURIComponent(symbol)}`]; for (const url of urls) { try { const j = await fetchJson(url, 8000); const rows = Array.isArray(j?.data) ? j.data : []; if (!rows.length) continue; rows.map(r => ({ date: String(r[0] || ''), high: num(r[4]), low: num(r[5]), close: num(r[6]) })).filter(x => valid(x.close)).reverse().forEach(x => { closes.unshift(x.close); highs.unshift(valid(x.high) ? x.high : x.close); lows.unshift(valid(x.low) ? x.low : x.close); dates.unshift(x.date); }); break; } catch (_) {} } } if (!closes.length) return null; return adjustSplitSeries({ closes, highs, lows, dates, date: dates.at(-1) || today(), source: 'TWSE', sourceUrl: 'https://www.twse.com.tw/' }); }
async function fetchWantgooTechnical(symbol) { const url = `https://www.wantgoo.com/stock/etf/${String(symbol).toLowerCase()}/technical-chart`; try { const plain = cleanHtml(await fetchText(url, 10000)); const pick = (labels, min = 1, max = 100000) => { for (const label of labels) { const re = new RegExp(`${label}[^0-9]{0,80}([0-9]{1,6}(?:\\.[0-9]+)?)`, 'i'); const m = plain.match(re); if (m) { const n = Number(m[1]); if (valid(n) && n >= min && n <= max) return n; } } return null; }; const ma = n => pick([`MA\\s*${n}`, `${n}T`, `${n}日均線`]); const out = { source: 'Wantgoo technical', sourceUrl: url, price: pick(['收盤價', '成交價', '現價', '收'], 1, 100000), ma20: ma(20), ma60: ma(60), ma120: ma(120) }; const nameMatch = plain.match(new RegExp(`${symbol}\\s*([^\\s|｜,，。]{2,40})\\s*(?:技術分析|ETF|行情)`, 'i')); if (nameMatch) out.name = nameMatch[1].replace(/技術分析|ETF|行情/g, '').trim(); return Object.values(out).some(valid) ? out : null; } catch (_) { return null; } }
async function fetchTwseEtfPremium(symbol) {
  const sym = String(symbol || '').trim().toUpperCase();
  const url = 'https://mis.twse.com.tw/stock/data/all_etf.txt';
  const takeNumber = (v) => {
    const n = Number(String(v ?? '').replace(/%/g, '').replace(/,/g, '').trim());
    return Number.isFinite(n) && Math.abs(n) < 50 ? n : null;
  };
  const pickCode = (r) => String(r?.a ?? r?.code ?? r?.Code ?? r?.股票代號 ?? r?.ETF代號 ?? r?.['ETF 代號'] ?? r?.證券代號 ?? '').trim().toUpperCase();
  const pickPremium = (r) => takeNumber(r?.g ?? r?.premiumDiscount ?? r?.折溢價 ?? r?.預估折溢價幅度 ?? r?.['預估折溢價幅度'] ?? r?.['折溢價幅度'] ?? r?.PremiumDiscount);
  const pickDate = (r) => normalizeDateString(r?.i ?? r?.date ?? r?.資料日期 ?? r?.['資料日期'] ?? today());
  try {
    const raw = await fetchText(url, 12000);
    const candidates = [];
    function scanArray(arr) {
      for (const r of arr || []) {
        if (!r) continue;
        if (Array.isArray(r)) {
          const code = String(r[0] ?? '').trim().toUpperCase();
          if (code === sym) {
            const n = takeNumber(r[6]);
            if (n !== null) candidates.push({ premiumDiscount: n, nav: num(r[5]), price: num(r[4]), date: normalizeDateString(r[8] || today()), source: 'TWSE ETF即時淨值/折溢價', sourceUrl: url });
          }
        } else if (typeof r === 'object') {
          const code = pickCode(r);
          if (code === sym) {
            const n = pickPremium(r);
            if (n !== null) candidates.push({ premiumDiscount: n, nav: num(r.f ?? r.nav ?? r.預估淨值 ?? r['投信或總代理人預估淨值']), price: num(r.e ?? r.price ?? r.成交價), date: pickDate(r), source: 'TWSE ETF即時淨值/折溢價', sourceUrl: url });
          }
        }
      }
    }
    // Endpoint may return pure JSON, JSONP-like text, or quoted JSON text.
    try {
      let parsed = JSON.parse(raw);
      if (typeof parsed === 'string') parsed = JSON.parse(parsed);
      if (Array.isArray(parsed)) scanArray(parsed);
      else if (parsed && typeof parsed === 'object') scanArray(parsed.data || parsed.result || parsed.items || Object.values(parsed).find(Array.isArray) || []);
    } catch (_) {
      const arrText = raw.match(/\[[\s\S]*\]/)?.[0];
      if (arrText) {
        try { scanArray(JSON.parse(arrText)); } catch (_) {}
      }
    }
    // Last fallback: parse delimited line containing the ETF code.
    if (!candidates.length) {
      for (const line of raw.split(/\r?\n/)) {
        if (!line.toUpperCase().includes(sym)) continue;
        const parts = line.split(/[,\t|]/).map(x => x.replace(/^"|"$/g, '').trim());
        const idx = parts.findIndex(x => x.toUpperCase() === sym);
        if (idx >= 0) {
          const n = takeNumber(parts[idx + 6] ?? parts[6]);
          if (n !== null) candidates.push({ premiumDiscount: n, date: normalizeDateString(parts[idx + 8] || parts[8] || today()), source: 'TWSE ETF即時淨值/折溢價', sourceUrl: url });
        }
      }
    }
    if (candidates.length) return candidates[0];
  } catch (_) {}
  return null;
}

async function fetchWantgooPremium(symbol) { return fetchTwseEtfPremium(symbol); }
async function fetchStooqHistory(symbol) { let s = String(symbol || '').trim().toLowerCase(); if (!s) return null; if (!s.startsWith('^') && !s.endsWith('.us')) s += '.us'; const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(s)}&i=d`; const csv = await fetchText(url, 9000); const closes = [], highs = [], lows = [], dates = []; for (const line of csv.trim().split('\n').slice(1).slice(-280)) { const p = line.split(','); if (p.length < 5) continue; const high = Number(p[2]), low = Number(p[3]), close = Number(p[4]); if (!valid(close)) continue; dates.push(p[0]); highs.push(valid(high) ? high : close); lows.push(valid(low) ? low : close); closes.push(close); } if (!closes.length) return null; return { closes, highs, lows, dates, date: dates.at(-1), source: 'Stooq', sourceUrl: `https://stooq.com/q/d/?s=${encodeURIComponent(s)}` }; }
async function fetchYahooChart(symbol, range = '1y') { const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${encodeURIComponent(range)}&events=history`; const j = await fetchJson(url, 9000); const res = j?.chart?.result?.[0]; const q = res?.indicators?.quote?.[0]; if (!q) return null; const adj = res?.indicators?.adjclose?.[0]?.adjclose || []; const ts = res?.timestamp || []; const closes = [], highs = [], lows = [], dates = []; (q.close || []).forEach((c, i) => { if (typeof c !== 'number') return; const a = typeof adj[i] === 'number' ? adj[i] : null; const ratio = a && c ? a / c : 1; const close = a || c; const high = typeof q.high?.[i] === 'number' ? q.high[i] * ratio : close; const low = typeof q.low?.[i] === 'number' ? q.low[i] * ratio : close; closes.push(close); highs.push(high); lows.push(low); dates.push(ts[i] ? new Date(ts[i] * 1000).toISOString().slice(0, 10) : today()); }); if (!closes.length) return null; return { closes, highs, lows, dates, date: dates.at(-1), source: 'Yahoo', sourceUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}` }; }
async function fetchUSHistory(symbol) { try { const h = await fetchStooqHistory(symbol); if (h?.closes?.length >= 20) return h; } catch (_) {} try { const h = await fetchYahooChart(symbol, '1y'); if (h?.closes?.length >= 20) return h; } catch (_) {} return null; }
function calcKDJ(h, period = 9) { const n = h?.closes?.length || 0; if (n < period) return null; let k = 50, d = 50, j = 50; for (let i = period - 1; i < n; i++) { const hh = Math.max(...h.highs.slice(i - period + 1, i + 1)); const ll = Math.min(...h.lows.slice(i - period + 1, i + 1)); const c = h.closes[i]; const rsv = hh === ll ? 50 : ((c - ll) / (hh - ll)) * 100; k = (2 / 3) * k + (1 / 3) * rsv; d = (2 / 3) * d + (1 / 3) * k; j = 3 * k - 2 * d; } return { k, d, j }; }
async function getEtf(market, symbol) { const m = String(market || '').toUpperCase(); const sym = String(symbol || '').trim().toUpperCase(); if (!sym) throw new Error('symbol required'); if (m === 'TW') { const [hist, tech, name] = await Promise.all([fetchTwseHistory(sym), fetchWantgooTechnical(sym), fetchTwName(sym)]); const out = normalizeHist(hist) || {}; out.kdj = calcKDJ(hist); out.sources = []; if (hist) out.sources.push({ name: 'TWSE', role: 'history', url: 'https://www.twse.com.tw/' }); if (tech) { if (valid(tech.price)) out.price = tech.price; if (valid(tech.ma20)) out.ma20 = tech.ma20; if (valid(tech.ma60)) out.ma60 = tech.ma60; if (valid(tech.ma120)) out.ma120 = tech.ma120; out.source = out.source ? `${out.source} + Wantgoo` : 'Wantgoo'; out.sourceUrl = tech.sourceUrl; if (tech.name && !name) out.name = tech.name; out.sources.unshift({ name: 'Wantgoo 技術分析', role: 'technical', url: tech.sourceUrl }); } out.sources.push({ name: 'Yahoo Finance', role: 'backup', url: `https://finance.yahoo.com/quote/${sym}.TW` }); return { market: 'TW', symbol: sym, name: name || out.name || '', ...out }; }
  const hist = await fetchUSHistory(sym); const out = normalizeHist(hist) || {}; out.kdj = calcKDJ(hist); out.sources = []; if (hist) out.sources.push({ name: hist.source || 'US data', role: 'history', url: hist.sourceUrl || '' }); out.sources.push({ name: 'Yahoo Finance', role: 'backup', url: `https://finance.yahoo.com/quote/${sym}` }); const names = { VOO: 'Vanguard S&P 500 ETF', VTI: 'Vanguard Total Stock Market ETF', VT: 'Vanguard Total World Stock ETF', QQQ: 'Invesco QQQ Trust', SPY: 'SPDR S&P 500 ETF', SCHD: 'Schwab US Dividend Equity ETF', IVV: 'iShares Core S&P 500 ETF', DIA: 'SPDR Dow Jones Industrial Average ETF', SMH: 'VanEck Semiconductor ETF', SOXX: 'iShares Semiconductor ETF' }; return { market: 'US', symbol: sym, name: names[sym] || '', ...out };
}

function normalizeDateString(d) {
  const s = String(d || '').trim().replace(/年|\//g, '-').replace(/月/g, '-').replace(/日/g, '');
  const roc = s.match(/^(\d{2,3})-(\d{1,2})-(\d{1,2})$/);
  if (roc) return `${Number(roc[1]) + 1911}-${String(roc[2]).padStart(2, '0')}-${String(roc[3]).padStart(2, '0')}`;
  const m = s.match(/^(20\d{2})-(\d{1,2})-(\d{1,2})/);
  return m ? `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}` : today();
}
function parseDateFromText(text) {
  const m = String(text || '').match(/20\d{2}[\/-]\d{1,2}[\/-]\d{1,2}|20\d{2}年\d{1,2}月\d{1,2}日|\b\d{2,3}[\/-]\d{1,2}[\/-]\d{1,2}\b/);
  return m ? normalizeDateString(m[0]) : today();
}
function numCandidatesNear(text, anchorWords, maxLen, min, max, decimalsOnly=false) {
  const anchor = String(text || '').search(anchorWords);
  const seg = anchor >= 0 ? String(text).slice(anchor, anchor + maxLen) : String(text).slice(0, maxLen);
  const re = decimalsOnly ? /\b([0-9]{1,3}\.[0-9]{1,2})\b/g : /\b([0-9]{1,3}(?:\.[0-9]{1,2})?)\b/g;
  return [...seg.matchAll(re)].map(m => ({ n: Number(m[1]), idx: m.index || 0, around: seg.slice(Math.max(0, (m.index || 0)-20), (m.index || 0)+25) }))
    .filter(x => Number.isFinite(x.n) && x.n >= min && x.n <= max && !/20\d{2}|年|月|日|:|\//.test(x.around));
}
function firstPriceAfterAnchor(plain, anchors, min=5, max=100) {
  for (const a of anchors) {
    const idx = plain.search(a instanceof RegExp ? a : new RegExp(a, 'i'));
    if (idx < 0) continue;
    const seg = plain.slice(idx, idx + 700).replace(/20\d{2}[\/\-]\d{1,2}[\/\-]\d{1,2}/g, ' ').replace(/\d{1,2}:\d{2}/g, ' ');
    const nums = [...seg.matchAll(/\b(\d{1,3}\.\d{2})\b/g)].map(m => Number(m[1])).filter(n => Number.isFinite(n) && n >= min && n <= max);
    if (nums.length) return nums[0];
  }
  return null;
}
async function fetchWantgooMainNumber(url, kind) {
  const html = await fetchText(url, 12000);
  const plain = cleanHtml(html);
  if (kind === 'vixtwn') {
    const date = parseDateFromText(plain);
    const val = firstPriceAfterAnchor(plain, [/臺指選擇權波動率指數\s*VIXTWN/i, /VIXTWN/i], 5, 100);
    if (val !== null) return { value: val, date, source: '玩股網 VIXTWN 主報價', url };
    const m = plain.match(/VIXTWN[\s\S]{0,500}?([0-9]{1,3}\.[0-9]{2})\s+(?:▲|▼|\+|-)?\s*\d{1,3}(?:\.\d+)?\s+\d{1,3}(?:\.\d+)?%/i);
    if (m) return { value: Number(m[1]), date, source: '玩股網 VIXTWN 主報價', url };
  }
  return null;
}
async function fetchCnnFearGreed() {
  const startDate = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
  const url = `https://production.dataviz.cnn.io/index/fearandgreed/graphdata/${startDate}`;
  const j = await fetchJson(url, 12000);
  const ok = n => Number.isFinite(Number(n)) && Number(n) >= 0 && Number(n) <= 100;
  let value = null, date = today(), rating = '';
  const fg = j?.fear_and_greed || j?.fearGreed || j?.fear_and_greed_now;
  if (fg && typeof fg === 'object') {
    value = Number(fg.score ?? fg.value ?? fg.y);
    rating = String(fg.rating ?? fg.status ?? fg.label ?? '');
    const ts = Number(fg.timestamp ?? fg.x ?? fg.time);
    if (Number.isFinite(ts)) date = new Date(ts > 1e12 ? ts : ts * 1000).toISOString().slice(0, 10);
  }
  const hist = j?.fear_and_greed_historical?.data || j?.fearGreedHistorical?.data || j?.data || [];
  if (!ok(value) && Array.isArray(hist) && hist.length) {
    const last = [...hist].reverse().find(x => ok(x?.y ?? x?.value ?? x?.score));
    if (last) {
      value = Number(last.y ?? last.value ?? last.score);
      const ts = Number(last.x ?? last.timestamp ?? last.time);
      if (Number.isFinite(ts)) date = new Date(ts > 1e12 ? ts : ts * 1000).toISOString().slice(0, 10);
      rating = String(last.rating ?? last.status ?? rating ?? '');
    }
  }
  if (ok(value)) return { value: Math.round(value), date, rating, source: 'CNN Fear & Greed API', url: 'https://www.cnn.com/markets/fear-and-greed' };
  return null;
}
async function fetchFearGreed() {
  try { const fg = await fetchCnnFearGreed(); if (fg) return fg; } catch (_) {}
  return null;
}

async function fetchTaifexVixtwn() {
  const urls = [
    'https://www.taifex.com.tw/cht/7/vixMinNew',
    'https://www.taifex.com.tw/enl/eng7/vixMinNew'
  ];
  for (const url of urls) {
    try {
      const html = await fetchText(url, 12000);
      const plain = cleanHtml(html);
      // TAIFEX page table: 交易日期 臺指選擇權波動率指數, then rows like 2026/06/18 37.86.
      const rows = [...plain.matchAll(/(20\d{2}[\/\-]\d{1,2}[\/\-]\d{1,2})\s+([0-9]{1,3}(?:\.[0-9]{1,2})?)/g)]
        .map(m => ({ date: normalizeDateString(m[1]), value: Number(m[2]) }))
        .filter(x => Number.isFinite(x.value) && x.value >= 5 && x.value <= 100);
      if (rows.length) return { value: rows[0].value, date: rows[0].date, source: 'TAIFEX 臺指選擇權波動率指數', url };
    } catch (_) {}
  }
  return null;
}

function ndcLightLabel(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return '';
  if (n >= 38) return '紅燈';
  if (n >= 32) return '黃紅燈';
  if (n >= 23) return '綠燈';
  if (n >= 17) return '黃藍燈';
  return '藍燈';
}
function ndcMonth(x) {
  const s = String(x || '').replace(/[^0-9]/g, '');
  if (s.length >= 6) return `${s.slice(0,4)}-${s.slice(4,6)}`;
  return today().slice(0,7);
}
async function parseNdcJsonText(text, url) {
  let data = null;
  try { data = JSON.parse(text); } catch (_) {}
  const pools = [];
  const pushArr = a => { if (Array.isArray(a)) pools.push(a); };
  pushArr(data?.line); pushArr(data?.data); pushArr(data?.rows); pushArr(data?.list);
  if (data && typeof data === 'object') {
    for (const v of Object.values(data)) if (Array.isArray(v)) pools.push(v);
  }
  for (const arr of pools) {
    const last = [...arr].reverse().find(x => {
      const vals = Object.values(x || {});
      return vals.some(v => Number.isFinite(Number(String(v).replace(/[^0-9.]/g,''))) && Number(String(v).replace(/[^0-9.]/g,'')) >= 9 && Number(String(v).replace(/[^0-9.]/g,'')) <= 45);
    });
    if (last) {
      const entries = Object.entries(last);
      let value = null;
      for (const [k,v] of entries) {
        const n = Number(String(v).replace(/[^0-9.]/g,''));
        if (Number.isFinite(n) && n >= 9 && n <= 45 && !/year|month|date|time|年月|期間/i.test(k)) { value = n; break; }
      }
      const dateVal = last.x || last.date || last.yyyymm || last.time || last.period || last['年月'] || last['資料年月'];
      if (value !== null) return { value, light: ndcLightLabel(value), date: ndcMonth(dateVal), source: '國發會景氣對策信號 API', url };
    }
  }
  return null;
}
async function fetchNdcNewsFallback() {
  const urls = [
    'https://www.ndc.gov.tw/nc_14813_39873',
    'https://www.ndc.gov.tw/nc_14813_39634',
    'https://www.ndc.gov.tw/nc_14813_39303'
  ];
  for (const url of urls) {
    try {
      const html = await fetchText(url, 12000);
      const plain = cleanHtml(html);
      if (!/景氣燈號|景氣對策信號/.test(plain)) continue;
      const m = plain.match(/(\d{2,3})年(\d{1,2})月景氣對策信號綜合判斷分數為\s*(\d{1,2})分[，,][^。；]*?(紅燈|黃紅燈|綠燈|黃藍燈|藍燈)/);
      if (m) {
        const y = Number(m[1]) + 1911; const mo = String(m[2]).padStart(2,'0'); const value = Number(m[3]);
        return { value, light: m[4], date: `${y}-${mo}`, source: '國發會新聞稿備援', url };
      }
      const m2 = plain.match(/(\d{2,3})年(\d{1,2})月[^。]{0,80}?(紅燈|黃紅燈|綠燈|黃藍燈|藍燈)[^。]{0,80}?分數為\s*(\d{1,2})分/);
      if (m2) {
        const y = Number(m2[1]) + 1911; const mo = String(m2[2]).padStart(2,'0'); const value = Number(m2[4]);
        return { value, light: m2[3], date: `${y}-${mo}`, source: '國發會新聞稿備援', url };
      }
    } catch (_) {}
  }
  return null;
}
async function fetchNdcLightScore() {
  const candidates = [
    { url: 'https://index.ndc.gov.tw/n/json/lightscore', method: 'POST', body: '' },
    { url: 'https://index.ndc.gov.tw/n/json/lightscore', method: 'GET' },
    { url: 'https://index.ndc.gov.tw/n/json/line/lightscore', method: 'GET' },
    { url: 'https://index.ndc.gov.tw/n/json/data/lightscore', method: 'GET' }
  ];
  for (const c of candidates) {
    const ctl = new AbortController();
    const id = setTimeout(() => ctl.abort(), 12000);
    try {
      const res = await fetch(c.url, {
        method: c.method || 'GET',
        signal: ctl.signal,
        headers: {
          'user-agent': 'Mozilla/5.0 (ETF Radar V4)',
          'accept': 'application/json,text/plain,*/*',
          'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'origin': 'https://index.ndc.gov.tw',
          'referer': 'https://index.ndc.gov.tw/n/zh_tw/lightscore#/'
        },
        body: c.body
      });
      const text = await res.text();
      if (res.ok) {
        const parsed = await parseNdcJsonText(text, c.url);
        if (parsed) return parsed;
      }
    } catch (_) {
    } finally { clearTimeout(id); }
  }
  const news = await fetchNdcNewsFallback();
  if (news) return news;
  return null;
}


const MM_BULLBEAR_URL = 'https://www.macromicro.me/collections/46/tw-stock-relative/142684/taiwan-mm-bull-and-bear-indicator';
function bullBearLabel(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  if (n >= 80) return '過熱';
  if (n >= 60) return '多頭';
  if (n >= 40) return '中性';
  if (n >= 20) return '偏空';
  return '極空';
}
async function fetchMacroMicroBullBearRaw() {
  const html = await fetchText(MM_BULLBEAR_URL, 15000);
  const plain = cleanHtml(html);
  return { html, plain };
}
async function fetchMacroMicroBullBear() {
  const { html, plain } = await fetchMacroMicroBullBearRaw();
  const make = (value, date = null, source = 'MacroMicro 台灣-MM牛熊指數') => {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0 && n <= 100) {
      return { value: n, label: bullBearLabel(n), date: date || parseDateFromText(plain), source, url: MM_BULLBEAR_URL };
    }
    return null;
  };

  // MacroMicro sidebar normally renders: 最新數據 台灣-MM牛熊指數(L) 2026-05 62.07 前值: 60.00
  const latestPatterns = [
    /最新數據[\s\S]{0,800}?台灣[-－]?MM牛熊指數\(L\)\s*(\d{4}-\d{1,2})\s*([0-9]{1,3}(?:\.[0-9]+)?)/i,
    /台灣[-－]?MM牛熊指數\(L\)\s*(\d{4}-\d{1,2})\s*([0-9]{1,3}(?:\.[0-9]+)?)/i,
    /台灣[-－]?MM牛熊指數\(L\)[\s\S]{0,120}?([0-9]{1,3}(?:\.[0-9]+)?)[\s\S]{0,60}?前值/i
  ];
  for (const re of latestPatterns) {
    const m = plain.match(re);
    if (m) {
      const date = m[2] ? m[1] : null;
      const value = m[2] || m[1];
      const out = make(value, date);
      if (out) return out;
    }
  }

  // Fallback: scan only numbers near the exact series name, avoid year/month/index axis values.
  const idx = plain.search(/台灣[-－]?MM牛熊指數\(L\)|台灣[-－]?MM牛熊指數|MM牛熊指數/i);
  if (idx >= 0) {
    const zone = plain.slice(idx, idx + 1000);
    const nums = [...zone.matchAll(/(?:^|\s)([0-9]{1,3}(?:\.[0-9]+)?)(?=\s|前值|$)/g)]
      .map(m => Number(m[1]))
      .filter(n => Number.isFinite(n) && n >= 0 && n <= 100);
    // Prefer decimal data point, then the first valid value.
    const decimal = nums.find(n => !Number.isInteger(n));
    const out = make(decimal ?? nums[0]);
    if (out) return out;
  }

  // Some SSR pages embed JSON in __NEXT_DATA__; try to find chart-like values.
  const next = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)?.[1];
  if (next) {
    try {
      const txt = next.replace(/&quot;/g,'"').replace(/&amp;/g,'&');
      const candidates = [...txt.matchAll(/(?:台灣[-－]?MM牛熊指數|bull|bear|142684)[\s\S]{0,500}?([0-9]{1,3}(?:\.[0-9]+)?)/gi)]
        .map(m => Number(m[1])).filter(n => Number.isFinite(n) && n >= 0 && n <= 100);
      const decimal = candidates.find(n => !Number.isInteger(n));
      const out = make(decimal ?? candidates[0]);
      if (out) return out;
    } catch (_) {}
  }
  return null;
}
async function debugMacroMicroBullBear() {
  const { html, plain } = await fetchMacroMicroBullBearRaw();
  const anchors = ['台灣-MM牛熊指數','MM牛熊','牛熊','142684','data:','series','chart','Highcharts','__NEXT_DATA__'];
  const snippets = {};
  for (const a of anchors) {
    const idx = plain.indexOf(a);
    if (idx >= 0) snippets[a] = plain.slice(Math.max(0, idx - 160), idx + 700);
  }
  const htmlSnippets = {};
  for (const a of anchors) {
    const idx = html.indexOf(a);
    if (idx >= 0) htmlSnippets[a] = html.slice(Math.max(0, idx - 160), idx + 700);
  }
  return {
    url: MM_BULLBEAR_URL,
    length: html.length,
    plainLength: plain.length,
    parsed: await fetchMacroMicroBullBear(),
    contains: Object.fromEntries(anchors.map(a => [a, plain.includes(a) || html.includes(a)])),
    snippets,
    htmlSnippets,
    sample: plain.slice(0, 1800)
  };
}

async function debugRaw(target, symbol='009816') {
  let url = 'https://production.dataviz.cnn.io/index/fearandgreed/graphdata/' + new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
  if (target === 'vixtwn') url = 'https://www.taifex.com.tw/cht/7/vixMinNew';
  if (target === 'ndc') url = 'https://index.ndc.gov.tw/n/json/lightscore';
  if (target === 'premium') url = 'https://mis.twse.com.tw/stock/data/all_etf.txt';
  const raw = await fetchText(url, 12000);
  const plain = cleanHtml(raw);
  const anchors = ['fear_and_greed','score','交易日期','臺指選擇權波動率指數','折溢價','預估折溢價幅度',String(symbol).toUpperCase()];
  const snippets = {};
  for (const a of anchors) {
    const idx = plain.indexOf(a);
    if (idx >= 0) snippets[a] = plain.slice(Math.max(0, idx-120), idx+500);
  }
  return { url, length: raw.length, plainLength: plain.length, contains: Object.fromEntries(anchors.map(a => [a, plain.includes(a)])), snippets, sample: plain.slice(0, 1200) };
}
async function fetchUsdTwd() { for (const fn of [async()=> (await fetchJson('https://api.frankfurter.app/latest?from=USD&to=TWD', 7000))?.rates?.TWD, async()=> (await fetchJson('https://open.er-api.com/v6/latest/USD', 7000))?.rates?.TWD]) { try { const n = Number(await fn()); if (n > 20 && n < 45) return n; } catch (_) {} } return null; }
async function fetchTwIndexHistory() { const closes=[], highs=[], lows=[], dates=[]; const now=new Date(); for (let i=0;i<14;i++){ const d=new Date(now.getFullYear(),now.getMonth()-i,1); const date=`${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}01`; for (const url of [`https://www.twse.com.tw/rwd/zh/TAIEX/MI_5MINS_HIST?response=json&date=${date}`,`https://www.twse.com.tw/indicesReport/MI_5MINS_HIST?response=json&date=${date}`]){ try{ const j=await fetchJson(url,7000); const rows=Array.isArray(j?.data)?j.data:[]; if(!rows.length) continue; rows.map(r=>({date:String(r[0]||''), high:num(r[2]), low:num(r[3]), close:num(r[4])})).filter(x=>valid(x.close)).reverse().forEach(x=>{closes.unshift(x.close); highs.unshift(valid(x.high)?x.high:x.close); lows.unshift(valid(x.low)?x.low:x.close); dates.unshift(x.date);}); break; }catch(_){} } } if(!closes.length) return null; return {closes, highs, lows, dates, date:dates.at(-1)||today(), source:'TWSE TAIEX', sourceUrl:'https://www.twse.com.tw/'}; }
async function getMarket(){ const r={updatedAt:new Date().toISOString(), usdTwd:null, twIndex:null, sp500:null, nasdaq:null, vix:null, fearGreed:null}; await Promise.allSettled([ (async()=>{const n=await fetchUsdTwd(); if(valid(n)) r.usdTwd={value:n, source:'Frankfurter / ER API', url:'https://www.frankfurter.app/'};})(), (async()=>{const h=await fetchTwIndexHistory(); if(h) r.twIndex={...normalizeHist(h), label:'台股加權'};})(), (async()=>{let h=null; try{h=await fetchStooqHistory('^spx')}catch(_){} if(!h) try{h=await fetchYahooChart('^GSPC','1y')}catch(_){} if(h) r.sp500={...normalizeHist(h), label:'S&P500'};})(), (async()=>{let h=null; try{h=await fetchYahooChart('^IXIC','1y')}catch(_){} if(!h) try{h=await fetchStooqHistory('^ixic')}catch(_){} if(!h) try{h=await fetchStooqHistory('^ndx')}catch(_){} if(h) r.nasdaq={...normalizeHist(h), label:'NASDAQ'};})(), (async()=>{let h=null; try{h=await fetchStooqHistory('^vix')}catch(_){} if(!h) try{h=await fetchYahooChart('^VIX','1mo')}catch(_){} if(h) r.vix={...normalizeHist(h), label:'VIX'};})(), (async()=>{const fg=await fetchFearGreed(); if(fg && Number.isFinite(Number(fg.value)) && fg.value>=0 && fg.value<=100) r.fearGreed=fg;})() ]); return r; }

function compactTwseDate(d) {
  const s = String(d || '').trim().replace(/-/g, '').replace(/\//g, '');
  return /^20\d{6}$/.test(s) ? s : '';
}
function cleanCell(v) {
  if (Array.isArray(v)) return v.map(cleanCell).filter(Boolean).join(' ');
  return String(v ?? '').replace(/<[^>]+>/g, '').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
}
function firstTable(j, preferWord) {
  const tables = Array.isArray(j?.tables) ? j.tables : [];
  if (tables.length) {
    const hit = tables.find(t => JSON.stringify(t).includes(preferWord || '')) || tables[0];
    return hit;
  }
  return j || {};
}
function normalizeTwseReport(j, fallbackTitle, fallbackUrl, preferWord = '') {
  const t = firstTable(j, preferWord);
  const fields = (t.fields || j?.fields || t.header || j?.header || []).map(cleanCell);
  const rawRows = t.data || j?.data || t.rows || j?.rows || [];
  const rows = (Array.isArray(rawRows) ? rawRows : []).map(r => {
    if (Array.isArray(r)) return r.map(cleanCell);
    if (r && typeof r === 'object') return fields.length ? fields.map(f => cleanCell(r[f] ?? r[f.replace(/\s/g,'')] ?? r[Object.keys(r).find(k => cleanCell(k) === f)] ?? '')) : Object.values(r).map(cleanCell);
    return [cleanCell(r)];
  }).filter(r => r.some(Boolean));
  const title = cleanCell(t.title || j?.title || fallbackTitle);
  const dateText = [title, cleanCell(j?.date || j?.params?.date || j?.subtitle || '')].join(' ');
  return { title: title || fallbackTitle, date: parseDateFromText(dateText), fields, rows, source: 'TWSE', sourceUrl: fallbackUrl, stat: j?.stat || '' };
}
async function fetchFirstOk(urls, preferWord) {
  let lastErr = null;
  for (const url of urls) {
    try {
      const j = await fetchJson(url, 12000);
      const hasRows = Array.isArray(j?.data) || Array.isArray(j?.tables?.[0]?.data) || JSON.stringify(j).includes(preferWord || '');
      if ((j?.stat === 'OK' || hasRows) && !/很抱歉|查無資料|No data/i.test(JSON.stringify(j).slice(0,500))) return { j, url };
    } catch (e) { lastErr = e; }
  }
  if (lastErr) throw lastErr;
  throw new Error('TWSE report not available');
}
async function fetchTwseInstitutionalAmount(dateParam = '') {
  const d = compactTwseDate(dateParam);
  const urls = d ? [
    `https://www.twse.com.tw/rwd/zh/fund/BFI82U?response=json&dayDate=${d}&type=day`,
    `https://www.twse.com.tw/rwd/zh/fund/BFI82U?response=json&date=${d}`,
    `https://www.twse.com.tw/fund/BFI82U?response=json&dayDate=${d}&type=day`
  ] : [
    'https://www.twse.com.tw/rwd/zh/fund/BFI82U?response=json',
    'https://www.twse.com.tw/fund/BFI82U?response=json'
  ];
  const { j, url } = await fetchFirstOk(urls, '買賣差額');
  const rep = normalizeTwseReport(j, '三大法人買賣金額統計表', url, '買賣差額');
  rep.unit = '元';
  return rep;
}
async function fetchTwseMarginBalance(dateParam = '') {
  const d = compactTwseDate(dateParam);
  const urls = d ? [
    `https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?response=json&date=${d}&selectType=MS`,
    `https://www.twse.com.tw/exchangeReport/MI_MARGN?response=json&date=${d}&selectType=MS`
  ] : [
    'https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?response=json&selectType=MS',
    'https://www.twse.com.tw/exchangeReport/MI_MARGN?response=json&selectType=MS'
  ];
  const { j, url } = await fetchFirstOk(urls, '融資');
  const rep = normalizeTwseReport(j, '信用交易統計', url, '項目');
  return rep;
}
async function getTwseFlow(dateParam = '') {
  const d = compactTwseDate(dateParam);
  const [institutions, margin] = await Promise.all([fetchTwseInstitutionalAmount(d), fetchTwseMarginBalance(d)]);
  return { updatedAt: new Date().toISOString(), requestedDate: d || '', date: institutions.date || margin.date || today(), institutions, margin, sources: [institutions.sourceUrl, margin.sourceUrl] };
}

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const path = url.pathname.replace(/^\/api\/?/, '');
  try {
    if (!path || path === 'health') return json({ ok: true, service: 'ETF Radar V4 API', version: 'V4.0.11', time: new Date().toISOString() });
    if (path === 'etf') return json(await getEtf(url.searchParams.get('market'), url.searchParams.get('symbol')));
    if (path === 'market') return json(await getMarket());
    if (path === 'twse-flow') return json(await getTwseFlow(url.searchParams.get('date') || ''));
    if (path === 'debug') {
      const target = url.searchParams.get('target') || 'market';
      const symbol = url.searchParams.get('symbol') || '009816';
      if (target === 'fg') return json(await fetchFearGreed());
      if (target === 'vixtwn' || target === 'ndc') return json(await fetchNdcLightScore());
      if (target === 'premium') return json(await fetchTwseEtfPremium(symbol));
      if (target === 'bullbear') return json(await fetchMacroMicroBullBear());
      if (target === 'rawbullbear') return json(await debugMacroMicroBullBear());
      if (target === 'raw' || target === 'rawfg') return json(await debugRaw('fg', symbol));
      if (target === 'rawvixtwn') return json(await debugRaw('vixtwn', symbol));
      if (target === 'rawndc') return json(await debugRaw('ndc', symbol));
      if (target === 'rawpremium') return json(await debugRaw('premium', symbol));
      return json({ market: await getMarket(), premium: await fetchTwseEtfPremium(symbol), rawFg: await debugRaw('fg', symbol) });
    }
    return json({ error: 'not found', path }, 404);
  } catch (err) {
    return json({ error: err.message || String(err), path }, 500);
  }
}
