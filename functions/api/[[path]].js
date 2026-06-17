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
async function fetchWantgooPremium(symbol) {
  const url = 'https://www.wantgoo.com/stock/etf/net-value';
  try {
    const raw = await fetchText(url, 12000);
    const plain = cleanHtml(raw);
    const sym = String(symbol).toUpperCase();
    const candidates = [plain, String(raw || '').replace(/,/g, ' ')];
    const takeNumber = (v) => {
      const n = Number(String(v ?? '').replace(/%/g, '').replace(/,/g, '').trim());
      return Number.isFinite(n) && Math.abs(n) < 20 ? n : null;
    };
    const extract = (seg) => {
      const keyed = [
        /折溢價(?:率|幅度|差)?[^-+0-9]{0,80}([-+]?\d{1,3}(?:\.\d+)?)\s*%/i,
        /([-+]?\d{1,3}(?:\.\d+)?)\s*%[^%]{0,80}(?:折溢價|溢價|折價)/i,
        /["'](?:discount|premium|premiumDiscount|discountPremium|spread|g)["']\s*:\s*["']?([-+]?\d{1,3}(?:\.\d+)?)["']?/i
      ];
      for (const re of keyed) {
        const m = seg.match(re);
        const n = m ? takeNumber(m[1]) : null;
        if (n !== null) return n;
      }
      // Fallback: row/table text often places several percentages after the ETF code.
      // Prefer percentages close to words related to NAV; otherwise choose the first plausible small % in the symbol row.
      const pcts = [...seg.matchAll(/([-+]?\d{1,2}(?:\.\d{1,2})?)\s*%/g)]
        .map(m => ({ n: takeNumber(m[1]), i: m.index || 0, ctx: seg.slice(Math.max(0, (m.index||0)-50), (m.index||0)+50) }))
        .filter(x => x.n !== null && Math.abs(x.n) <= 10);
      const navRelated = pcts.find(x => /淨值|折溢價|溢價|折價|NAV|nav/i.test(x.ctx));
      if (navRelated) return navRelated.n;
      return pcts.length ? pcts[0].n : null;
    };
    for (const text of candidates) {
      const idx = text.toUpperCase().indexOf(sym);
      if (idx < 0) continue;
      const seg = text.slice(idx, idx + 1800);
      const n = extract(seg);
      if (n !== null) return { premiumDiscount: n, source: 'Wantgoo ETF NAV', sourceUrl: url };
    }
    return null;
  } catch (_) { return null; }
}
async function fetchStooqHistory(symbol) { let s = String(symbol || '').trim().toLowerCase(); if (!s) return null; if (!s.startsWith('^') && !s.endsWith('.us')) s += '.us'; const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(s)}&i=d`; const csv = await fetchText(url, 9000); const closes = [], highs = [], lows = [], dates = []; for (const line of csv.trim().split('\n').slice(1).slice(-280)) { const p = line.split(','); if (p.length < 5) continue; const high = Number(p[2]), low = Number(p[3]), close = Number(p[4]); if (!valid(close)) continue; dates.push(p[0]); highs.push(valid(high) ? high : close); lows.push(valid(low) ? low : close); closes.push(close); } if (!closes.length) return null; return { closes, highs, lows, dates, date: dates.at(-1), source: 'Stooq', sourceUrl: `https://stooq.com/q/d/?s=${encodeURIComponent(s)}` }; }
async function fetchYahooChart(symbol, range = '1y') { const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${encodeURIComponent(range)}&events=history`; const j = await fetchJson(url, 9000); const res = j?.chart?.result?.[0]; const q = res?.indicators?.quote?.[0]; if (!q) return null; const adj = res?.indicators?.adjclose?.[0]?.adjclose || []; const ts = res?.timestamp || []; const closes = [], highs = [], lows = [], dates = []; (q.close || []).forEach((c, i) => { if (typeof c !== 'number') return; const a = typeof adj[i] === 'number' ? adj[i] : null; const ratio = a && c ? a / c : 1; const close = a || c; const high = typeof q.high?.[i] === 'number' ? q.high[i] * ratio : close; const low = typeof q.low?.[i] === 'number' ? q.low[i] * ratio : close; closes.push(close); highs.push(high); lows.push(low); dates.push(ts[i] ? new Date(ts[i] * 1000).toISOString().slice(0, 10) : today()); }); if (!closes.length) return null; return { closes, highs, lows, dates, date: dates.at(-1), source: 'Yahoo', sourceUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}` }; }
async function fetchUSHistory(symbol) { try { const h = await fetchStooqHistory(symbol); if (h?.closes?.length >= 20) return h; } catch (_) {} try { const h = await fetchYahooChart(symbol, '1y'); if (h?.closes?.length >= 20) return h; } catch (_) {} return null; }
function calcKDJ(h, period = 9) { const n = h?.closes?.length || 0; if (n < period) return null; let k = 50, d = 50, j = 50; for (let i = period - 1; i < n; i++) { const hh = Math.max(...h.highs.slice(i - period + 1, i + 1)); const ll = Math.min(...h.lows.slice(i - period + 1, i + 1)); const c = h.closes[i]; const rsv = hh === ll ? 50 : ((c - ll) / (hh - ll)) * 100; k = (2 / 3) * k + (1 / 3) * rsv; d = (2 / 3) * d + (1 / 3) * k; j = 3 * k - 2 * d; } return { k, d, j }; }
async function getEtf(market, symbol) { const m = String(market || '').toUpperCase(); const sym = String(symbol || '').trim().toUpperCase(); if (!sym) throw new Error('symbol required'); if (m === 'TW') { const [hist, tech, name, premium] = await Promise.all([fetchTwseHistory(sym), fetchWantgooTechnical(sym), fetchTwName(sym), fetchWantgooPremium(sym)]); const out = normalizeHist(hist) || {}; out.kdj = calcKDJ(hist); out.sources = []; if (hist) out.sources.push({ name: 'TWSE', role: 'history', url: 'https://www.twse.com.tw/' }); if (tech) { if (valid(tech.price)) out.price = tech.price; if (valid(tech.ma20)) out.ma20 = tech.ma20; if (valid(tech.ma60)) out.ma60 = tech.ma60; if (valid(tech.ma120)) out.ma120 = tech.ma120; out.source = out.source ? `${out.source} + Wantgoo` : 'Wantgoo'; out.sourceUrl = tech.sourceUrl; if (tech.name && !name) out.name = tech.name; out.sources.unshift({ name: 'Wantgoo 技術分析', role: 'technical', url: tech.sourceUrl }); } if (premium) { out.premiumDiscount = premium.premiumDiscount; out.premiumSource = premium.source; out.sources.push({ name: '玩股網 ETF 淨值折溢價', role: 'premium', url: premium.sourceUrl }); } out.sources.push({ name: 'Yahoo Finance', role: 'backup', url: `https://finance.yahoo.com/quote/${sym}.TW` }); return { market: 'TW', symbol: sym, name: name || out.name || '', ...out }; }
  const hist = await fetchUSHistory(sym); const out = normalizeHist(hist) || {}; out.kdj = calcKDJ(hist); out.sources = []; if (hist) out.sources.push({ name: hist.source || 'US data', role: 'history', url: hist.sourceUrl || '' }); out.sources.push({ name: 'Yahoo Finance', role: 'backup', url: `https://finance.yahoo.com/quote/${sym}` }); const names = { VOO: 'Vanguard S&P 500 ETF', VTI: 'Vanguard Total Stock Market ETF', VT: 'Vanguard Total World Stock ETF', QQQ: 'Invesco QQQ Trust', SPY: 'SPDR S&P 500 ETF', SCHD: 'Schwab US Dividend Equity ETF', IVV: 'iShares Core S&P 500 ETF', DIA: 'SPDR Dow Jones Industrial Average ETF', SMH: 'VanEck Semiconductor ETF', SOXX: 'iShares Semiconductor ETF' }; return { market: 'US', symbol: sym, name: names[sym] || '', ...out };
}

function parseDateFromText(text) {
  const m = String(text || '').match(/20\d{2}[\/-]\d{1,2}[\/-]\d{1,2}|20\d{2}年\d{1,2}月\d{1,2}日/);
  if (!m) return today();
  return m[0].replace(/年|\//g, '-').replace(/月/g, '-').replace(/日/g, '').replace(/-(\d)(?=-|$)/g, '-0$1');
}
function numCandidatesNear(text, anchorWords, maxLen, min, max, decimalsOnly=false) {
  const anchor = String(text || '').search(anchorWords);
  const seg = anchor >= 0 ? String(text).slice(anchor, anchor + maxLen) : String(text).slice(0, maxLen);
  const re = decimalsOnly ? /\b([0-9]{1,3}\.[0-9]{1,2})\b/g : /\b([0-9]{1,3}(?:\.[0-9]{1,2})?)\b/g;
  return [...seg.matchAll(re)].map(m => ({ n: Number(m[1]), idx: m.index || 0, around: seg.slice(Math.max(0, (m.index || 0)-20), (m.index || 0)+25) }))
    .filter(x => Number.isFinite(x.n) && x.n >= min && x.n <= max && !/20\d{2}|年|月|日|:|\//.test(x.around));
}
async function fetchWantgooMainNumber(url, kind) {
  const html = await fetchText(url, 12000);
  const plain = cleanHtml(html);
  const text = `${plain} ${String(html || '').replace(/,/g, ' ')}`;
  if (kind === 'vixtwn') {
    const anchor = /VIXTWN|臺指選擇權波動率指數|台指選擇權波動率指數/i;
    // 優先抓主報價區第一個合理小數，避免抓到日期或百分比說明。
    const direct = numCandidatesNear(text, anchor, 1800, 5, 100, true);
    if (direct.length) return { value: direct[0].n, date: parseDateFromText(text), source: 'Wantgoo', url };
    const fallback = numCandidatesNear(text, anchor, 2200, 5, 100, false);
    if (fallback.length) return { value: fallback[0].n, date: parseDateFromText(text), source: 'Wantgoo', url };
  }
  return null;
}
async function fetchFearGreed() {
  const url = 'https://www.wantgoo.com/global/macroeconomics/fearandgreed';
  const html = await fetchText(url, 12000);
  const plain = cleanHtml(html);
  const text = `${plain} ${String(html || '').replace(/,/g, ' ')}`;
  const date = parseDateFromText(text);
  // 最高優先：玩股網頁面「當日數值」位置，這是目前正確值所在。
  const patterns = [
    /當日數值[^0-9]{0,120}(\d{1,3})(?!\d)/i,
    /當日[^0-9]{0,60}數值[^0-9]{0,120}(\d{1,3})(?!\d)/i,
    /市場即時情緒指標[^0-9]{0,220}(\d{1,3})(?!\d)/i,
    /恐懼與貪婪指數[\s\S]{0,650}?當日數值[^0-9]{0,120}(\d{1,3})(?!\d)/i
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n >= 0 && n <= 100) return { value: n, date, source: 'Wantgoo', url };
    }
  }
  const anchor = text.search(/當日數值|市場即時情緒指標|恐懼與貪婪指數/i);
  if (anchor >= 0) {
    const seg = text.slice(anchor, anchor + 1200);
    const nums = [...seg.matchAll(/\b(\d{1,3})\b/g)]
      .map(m => ({ n: Number(m[1]), idx: m.index || 0, around: seg.slice(Math.max(0, (m.index || 0)-18), (m.index || 0)+24) }))
      .filter(x => x.n >= 0 && x.n <= 100 && !/20\d{2}|年|月|日|:|\//.test(x.around));
    if (nums.length) return { value: nums.sort((a,b)=>a.idx-b.idx)[0].n, date, source: 'Wantgoo', url };
  }
  return null;
}
async function fetchUsdTwd() { for (const fn of [async()=> (await fetchJson('https://api.frankfurter.app/latest?from=USD&to=TWD', 7000))?.rates?.TWD, async()=> (await fetchJson('https://open.er-api.com/v6/latest/USD', 7000))?.rates?.TWD]) { try { const n = Number(await fn()); if (n > 20 && n < 45) return n; } catch (_) {} } return null; }
async function fetchTwIndexHistory() { const closes=[], highs=[], lows=[], dates=[]; const now=new Date(); for (let i=0;i<14;i++){ const d=new Date(now.getFullYear(),now.getMonth()-i,1); const date=`${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}01`; for (const url of [`https://www.twse.com.tw/rwd/zh/TAIEX/MI_5MINS_HIST?response=json&date=${date}`,`https://www.twse.com.tw/indicesReport/MI_5MINS_HIST?response=json&date=${date}`]){ try{ const j=await fetchJson(url,7000); const rows=Array.isArray(j?.data)?j.data:[]; if(!rows.length) continue; rows.map(r=>({date:String(r[0]||''), high:num(r[2]), low:num(r[3]), close:num(r[4])})).filter(x=>valid(x.close)).reverse().forEach(x=>{closes.unshift(x.close); highs.unshift(valid(x.high)?x.high:x.close); lows.unshift(valid(x.low)?x.low:x.close); dates.unshift(x.date);}); break; }catch(_){} } } if(!closes.length) return null; return {closes, highs, lows, dates, date:dates.at(-1)||today(), source:'TWSE TAIEX', sourceUrl:'https://www.twse.com.tw/'}; }
async function getMarket(){ const r={updatedAt:new Date().toISOString(), usdTwd:null, twIndex:null, sp500:null, nasdaq:null, vix:null, fearGreed:null, vixtwn:null}; await Promise.allSettled([ (async()=>{const n=await fetchUsdTwd(); if(valid(n)) r.usdTwd={value:n, source:'Frankfurter / ER API', url:'https://www.frankfurter.app/'};})(), (async()=>{const h=await fetchTwIndexHistory(); if(h) r.twIndex={...normalizeHist(h), label:'台股加權'};})(), (async()=>{let h=null; try{h=await fetchStooqHistory('^spx')}catch(_){} if(!h) try{h=await fetchYahooChart('^GSPC','1y')}catch(_){} if(h) r.sp500={...normalizeHist(h), label:'S&P500'};})(), (async()=>{let h=null; try{h=await fetchYahooChart('^IXIC','1y')}catch(_){} if(!h) try{h=await fetchStooqHistory('^ixic')}catch(_){} if(!h) try{h=await fetchStooqHistory('^ndx')}catch(_){} if(h) r.nasdaq={...normalizeHist(h), label:'NASDAQ'};})(), (async()=>{let h=null; try{h=await fetchStooqHistory('^vix')}catch(_){} if(!h) try{h=await fetchYahooChart('^VIX','1mo')}catch(_){} if(h) r.vix={...normalizeHist(h), label:'VIX'};})(), (async()=>{const fg=await fetchFearGreed(); if(fg && Number.isFinite(Number(fg.value)) && fg.value>=0 && fg.value<=100) r.fearGreed=fg;})(), (async()=>{const v=await fetchWantgooMainNumber('https://www.wantgoo.com/index/vixtwn','vixtwn'); if(v && valid(v.value)) r.vixtwn=v;})() ]); return r; }
export async function onRequest(context){ const url=new URL(context.request.url); const path=url.pathname.replace(/^\/api\/?/,''); try{ if(!path||path==='health') return json({ok:true,service:'ETF Radar V3 API',time:new Date().toISOString()}); if(path==='etf') return json(await getEtf(url.searchParams.get('market'),url.searchParams.get('symbol'))); if(path==='market') return json(await getMarket()); return json({error:'not found',path},404); }catch(err){ return json({error:err.message||String(err),path},500); } }
