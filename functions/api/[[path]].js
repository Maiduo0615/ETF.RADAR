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
  const sym = String(symbol || '').trim().toUpperCase();
  const takeNumber = (v) => {
    const n = Number(String(v ?? '').replace(/%/g, '').replace(/,/g, '').trim());
    return Number.isFinite(n) && Math.abs(n) < 50 ? n : null;
  };

  // 優先抓個別 ETF 頁面的上方報價列：折溢價 0.91%
  // 這和使用者在玩股網頁面看到的數字一致，比列表頁更不容易抓錯欄位。
  const detailUrl = `https://www.wantgoo.com/stock/etf/${sym.toLowerCase()}`;
  try {
    const raw = await fetchText(detailUrl, 12000);
    const plain = cleanHtml(raw);
    const idx = plain.toUpperCase().indexOf(sym);
    const seg = idx >= 0 ? plain.slice(idx, idx + 2500) : plain.slice(0, 2500);
    const m = seg.match(/折溢價\s*([-+]?\d{1,3}(?:\.\d+)?)\s*%/i);
    if (m) {
      const n = takeNumber(m[1]);
      if (n !== null) return { premiumDiscount: n, source: '玩股網個股頁折溢價', sourceUrl: detailUrl };
    }
  } catch (_) {}

  // 備援：ETF 淨值折溢價列表。
  const url = 'https://www.wantgoo.com/stock/etf/net-value';
  try {
    const raw = await fetchText(url, 12000);
    const plain = cleanHtml(raw);
    const parseRow = (seg) => {
      const row = seg.replace(/\s+/g, ' ').trim();
      // 列格式：代碼 名稱 淨值 淨值漲跌% 市價 市價漲跌% 折溢價 折溢價%
      const re = new RegExp(`${sym}\\s+[^0-9]{1,80}\\s+([0-9]{1,5}(?:\\.[0-9]+)?)\\s+[-+]?\\d{1,3}(?:\\.\\d+)?%\\s+([0-9]{1,5}(?:\\.[0-9]+)?)\\s+[-+]?\\d{1,3}(?:\\.\\d+)?%\\s+([-+]?\\d{1,4}(?:\\.\\d+)?)\\s+([-+]?\\d{1,3}(?:\\.\\d+)?)%`, 'i');
      const m = row.match(re);
      if (m) return takeNumber(m[4]);
      const pct = [...row.matchAll(/([-+]?\d{1,3}(?:\.\d+)?)\s*%/g)].map(x => takeNumber(x[1])).filter(x => x !== null);
      return pct.length >= 3 ? pct[2] : null;
    };
    const idx = plain.toUpperCase().indexOf(sym);
    if (idx >= 0) {
      const nextCode = plain.slice(idx + sym.length).search(/\s\d{4,6}[A-Z]?\s/);
      const seg = plain.slice(idx, nextCode > 0 ? idx + sym.length + nextCode : idx + 700);
      const n = parseRow(seg);
      if (n !== null) return { premiumDiscount: n, source: '玩股網 ETF 淨值折溢價', sourceUrl: url };
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
async function fetchWantgooMainNumber(url, kind) {
  const html = await fetchText(url, 12000);
  const plain = cleanHtml(html);
  if (kind === 'vixtwn') {
    const date = parseDateFromText(plain);
    const okVix = v => Number.isFinite(Number(v)) && Number(v) >= 5 && Number(v) <= 100;

    // 優先鎖定標題列後、開盤欄位前的主報價區。
    const titleIdx = plain.search(/臺指選擇權波動率指數\s*VIXTWN|台指選擇權波動率指數\s*VIXTWN|VIXTWN/i);
    const seg = titleIdx >= 0 ? plain.slice(titleIdx, titleIdx + 900) : plain.slice(0, 900);
    const beforeOpen = seg.split(/開盤|最高|昨收|最低|本益比|股淨比/)[0];

    const patterns = [
      /盤後定價交易\s*([0-9]{1,3}\.\d{2})\s*[-+▲▼]?\s*\d{1,3}(?:\.\d+)?\s+[-+]?\d{1,3}(?:\.\d+)?%/i,
      /一般交易\s*、\s*盤後定價交易\s*([0-9]{1,3}\.\d{2})/i,
      /VIXTWN\s+20\d{2}[\/\-]\d{1,2}[\/\-]\d{1,2}\s+\d{1,2}:\d{2}[\s\S]{0,220}?([0-9]{1,3}\.\d{2})\s*[-+▲▼]?\s*\d{1,3}(?:\.\d+)?\s+[-+]?\d{1,3}(?:\.\d+)?%/i
    ];
    for (const re of patterns) {
      const m = beforeOpen.match(re) || seg.match(re);
      if (m && okVix(Number(m[1]))) return { value: Number(m[1]), date, source: '玩股網 VIXTWN 主報價', url };
    }

    // 備援：主報價區第一個「價格 + 漲跌 + 漲跌幅」組合；排除開盤、昨收、最高、最低等欄位。
    const combo = [...beforeOpen.matchAll(/\b([0-9]{1,3}\.\d{2})\b\s*[-+▲▼]?\s*\d{1,3}(?:\.\d+)?\s+[-+]?\d{1,3}(?:\.\d+)?%/g)]
      .map(x => Number(x[1]))
      .find(okVix);
    if (combo) return { value: combo, date, source: '玩股網 VIXTWN 主報價', url };
  }
  return null;
}
async function fetchFearGreed() {
  const url = 'https://www.wantgoo.com/global/macroeconomics/fearandgreed';
  const html = await fetchText(url, 12000);
  const plain = cleanHtml(html);
  const ok = n => Number.isFinite(Number(n)) && Number(n) >= 0 && Number(n) <= 100;
  const date = parseDateFromText(plain);

  // 先抓「當日」趨勢表。這筆和中央儀表數字一致，且不會抓到 0/25/50/75/100 刻度。
  const todayRow = plain.match(/當日\s+(20\d{2}[\/\-]\d{1,2}[\/\-]\d{1,2})\s+(?:極度恐懼|恐懼|中立|極度貪婪|貪婪)\s+(\d{1,3})/i);
  if (todayRow && ok(Number(todayRow[2]))) return { value: Number(todayRow[2]), date: normalizeDateString(todayRow[1]), source: '玩股網 F&G 當日主值', url };

  // 備援：中央 Gauge 數字通常在「市場即時情緒指標」前方。
  const marker = plain.search(/市場即時情緒指標/i);
  if (marker >= 0) {
    const before = plain.slice(Math.max(0, marker - 350), marker);
    const nums = [...before.matchAll(/\b(\d{1,3})\b/g)].map(m => Number(m[1])).filter(ok);
    for (let i = nums.length - 1; i >= 0; i--) {
      const n = nums[i];
      if (![0,25,50,75,100].includes(n)) return { value: n, date, source: '玩股網 F&G 主儀表', url };
    }
  }
  return null;
}
async function fetchUsdTwd() { for (const fn of [async()=> (await fetchJson('https://api.frankfurter.app/latest?from=USD&to=TWD', 7000))?.rates?.TWD, async()=> (await fetchJson('https://open.er-api.com/v6/latest/USD', 7000))?.rates?.TWD]) { try { const n = Number(await fn()); if (n > 20 && n < 45) return n; } catch (_) {} } return null; }
async function fetchTwIndexHistory() { const closes=[], highs=[], lows=[], dates=[]; const now=new Date(); for (let i=0;i<14;i++){ const d=new Date(now.getFullYear(),now.getMonth()-i,1); const date=`${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}01`; for (const url of [`https://www.twse.com.tw/rwd/zh/TAIEX/MI_5MINS_HIST?response=json&date=${date}`,`https://www.twse.com.tw/indicesReport/MI_5MINS_HIST?response=json&date=${date}`]){ try{ const j=await fetchJson(url,7000); const rows=Array.isArray(j?.data)?j.data:[]; if(!rows.length) continue; rows.map(r=>({date:String(r[0]||''), high:num(r[2]), low:num(r[3]), close:num(r[4])})).filter(x=>valid(x.close)).reverse().forEach(x=>{closes.unshift(x.close); highs.unshift(valid(x.high)?x.high:x.close); lows.unshift(valid(x.low)?x.low:x.close); dates.unshift(x.date);}); break; }catch(_){} } } if(!closes.length) return null; return {closes, highs, lows, dates, date:dates.at(-1)||today(), source:'TWSE TAIEX', sourceUrl:'https://www.twse.com.tw/'}; }
async function getMarket(){ const r={updatedAt:new Date().toISOString(), usdTwd:null, twIndex:null, sp500:null, nasdaq:null, vix:null, fearGreed:null, vixtwn:null}; await Promise.allSettled([ (async()=>{const n=await fetchUsdTwd(); if(valid(n)) r.usdTwd={value:n, source:'Frankfurter / ER API', url:'https://www.frankfurter.app/'};})(), (async()=>{const h=await fetchTwIndexHistory(); if(h) r.twIndex={...normalizeHist(h), label:'台股加權'};})(), (async()=>{let h=null; try{h=await fetchStooqHistory('^spx')}catch(_){} if(!h) try{h=await fetchYahooChart('^GSPC','1y')}catch(_){} if(h) r.sp500={...normalizeHist(h), label:'S&P500'};})(), (async()=>{let h=null; try{h=await fetchYahooChart('^IXIC','1y')}catch(_){} if(!h) try{h=await fetchStooqHistory('^ixic')}catch(_){} if(!h) try{h=await fetchStooqHistory('^ndx')}catch(_){} if(h) r.nasdaq={...normalizeHist(h), label:'NASDAQ'};})(), (async()=>{let h=null; try{h=await fetchStooqHistory('^vix')}catch(_){} if(!h) try{h=await fetchYahooChart('^VIX','1mo')}catch(_){} if(h) r.vix={...normalizeHist(h), label:'VIX'};})(), (async()=>{const fg=await fetchFearGreed(); if(fg && Number.isFinite(Number(fg.value)) && fg.value>=0 && fg.value<=100) r.fearGreed=fg;})(), (async()=>{const v=await fetchWantgooMainNumber('https://www.wantgoo.com/index/vixtwn','vixtwn'); if(v && valid(v.value)) r.vixtwn=v;})() ]); return r; }
export async function onRequest(context){ const url=new URL(context.request.url); const path=url.pathname.replace(/^\/api\/?/,''); try{ if(!path||path==='health') return json({ok:true,service:'ETF Radar V3 API',version:'V3.3.8',time:new Date().toISOString()}); if(path==='etf') return json(await getEtf(url.searchParams.get('market'),url.searchParams.get('symbol'))); if(path==='market') return json(await getMarket()); if(path==='debug') { const target=url.searchParams.get('target')||'market'; const symbol=url.searchParams.get('symbol')||'009816'; if(target==='fg') return json(await fetchFearGreed()); if(target==='vixtwn') return json(await fetchWantgooMainNumber('https://www.wantgoo.com/index/vixtwn','vixtwn')); if(target==='premium') return json(await fetchWantgooPremium(symbol)); return json({market: await getMarket(), premium: await fetchWantgooPremium(symbol)}); } return json({error:'not found',path},404); }catch(err){ return json({error:err.message||String(err),path},500); } }
