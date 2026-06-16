const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store, max-age=0'
};

const TEXT_HEADERS = {
  'content-type': 'text/plain; charset=utf-8',
  'cache-control': 'no-store, max-age=0'
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: JSON_HEADERS });
}

function text(data, status = 200) {
  return new Response(String(data), { status, headers: TEXT_HEADERS });
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function valid(n) {
  return Number.isFinite(Number(n)) && Number(n) > 0;
}

function numTW(v) {
  if (v === null || v === undefined) return null;
  const n = Number(String(v).replace(/,/g, '').replace(/X/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

function mean(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function sma(arr, days) {
  if (!Array.isArray(arr) || arr.length < days) return null;
  return mean(arr.slice(-days));
}

function cleanHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x2F;|&#47;/g, '/')
    .replace(/,/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchText(url, timeoutMs = 9000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'user-agent': 'Mozilla/5.0 ETF-Radar-V3',
        'accept': 'text/html,application/json,text/plain,*/*'
      }
    });
    const body = await res.text();
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${url}`);
    }
    return body;
  } finally {
    clearTimeout(id);
  }
}

async function fetchJson(url, timeoutMs = 9000) {
  const t = await fetchText(url, timeoutMs);
  return JSON.parse(t);
}

function adjustSplitSeries(hist) {
  const closes = [...hist.closes];
  const highs = [...hist.highs];
  const lows = [...hist.lows];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1];
    const cur = closes[i];
    if (!valid(prev) || !valid(cur)) continue;
    const ratio = cur / prev;
    if (ratio < 0.55 || ratio > 1.8) {
      for (let j = 0; j < i; j++) {
        closes[j] *= ratio;
        highs[j] *= ratio;
        lows[j] *= ratio;
      }
    }
  }
  return { ...hist, closes, highs, lows, source: `${hist.source || ''}/split-adjusted` };
}

async function fetchTwName(symbol) {
  try {
    const rows = await fetchJson('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL');
    const row = (rows || []).find(r => String(r.Code || r['證券代號'] || r['股票代號'] || '').trim().toUpperCase() === symbol.toUpperCase());
    if (row) return row.Name || row['證券名稱'] || row['股票名稱'] || '';
  } catch (_) {}
  return '';
}

async function fetchTwseHistory(symbol) {
  const closes = [];
  const highs = [];
  const lows = [];
  const dates = [];
  const now = new Date();
  for (let i = 0; i < 15; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}01`;
    const urls = [
      `https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY?response=json&date=${date}&stockNo=${encodeURIComponent(symbol)}`,
      `https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=${date}&stockNo=${encodeURIComponent(symbol)}`
    ];
    let done = false;
    for (const url of urls) {
      if (done) break;
      try {
        const j = await fetchJson(url, 7000);
        if (!j || !Array.isArray(j.data)) continue;
        const monthRows = j.data.map(r => ({
          date: String(r[0] || ''),
          high: numTW(r[4]),
          low: numTW(r[5]),
          close: numTW(r[6])
        })).filter(x => valid(x.close));
        // Unshift in reverse so final series remains chronological.
        monthRows.reverse().forEach(x => {
          closes.unshift(x.close);
          highs.unshift(valid(x.high) ? x.high : x.close);
          lows.unshift(valid(x.low) ? x.low : x.close);
          dates.unshift(x.date);
        });
        done = true;
      } catch (_) {}
    }
  }
  if (!closes.length) return null;
  const hist = { closes, highs, lows, dates, date: dates.at(-1) || today(), source: 'TWSE' };
  return adjustSplitSeries(hist);
}

async function fetchWantgooTechnical(symbol) {
  const url = `https://www.wantgoo.com/stock/etf/${String(symbol).toLowerCase()}/technical-chart`;
  try {
    const html = await fetchText(url, 8000);
    const plain = cleanHtml(html);
    const pickNear = (labels, min = 1, max = 100000) => {
      for (const label of labels) {
        const re = new RegExp(`${label}[^0-9]{0,60}([0-9]{1,6}(?:\\.[0-9]+)?)`, 'i');
        const m = plain.match(re);
        if (m) {
          const n = Number(m[1]);
          if (valid(n) && n >= min && n <= max) return n;
        }
      }
      return null;
    };
    const ma = (n) => pickNear([`MA\\s*${n}`, `${n}T`, `${n}日均線`]);
    const data = {
      source: 'Wantgoo technical',
      price: pickNear(['收盤價', '成交價', '現價', '收'], 1, 100000),
      ma20: ma(20),
      ma60: ma(60),
      ma120: ma(120)
    };
    const nameMatch = plain.match(new RegExp(`${symbol}\\s*([^\\s|｜,，。]{2,40})\\s*(?:技術分析|ETF|行情)`, 'i'));
    if (nameMatch) data.name = nameMatch[1].replace(/技術分析|ETF|行情/g, '').trim();
    return Object.values(data).some(valid) ? data : null;
  } catch (_) {
    return null;
  }
}

async function fetchStooqHistory(symbol) {
  let s = String(symbol || '').trim().toLowerCase();
  if (!s) return null;
  if (!s.startsWith('^') && !s.endsWith('.us')) s += '.us';
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(s)}&i=d`;
  const csv = await fetchText(url, 8000);
  const rows = csv.trim().split('\n').slice(1);
  const closes = [];
  const highs = [];
  const lows = [];
  const dates = [];
  for (const line of rows.slice(-280)) {
    const p = line.split(',');
    if (p.length < 5) continue;
    const high = Number(p[2]);
    const low = Number(p[3]);
    const close = Number(p[4]);
    if (!valid(close)) continue;
    dates.push(p[0]);
    highs.push(valid(high) ? high : close);
    lows.push(valid(low) ? low : close);
    closes.push(close);
  }
  if (!closes.length) return null;
  return { closes, highs, lows, dates, date: dates.at(-1), source: 'Stooq' };
}

async function fetchYahooChart(symbol, range = '1y') {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${encodeURIComponent(range)}&events=history`;
  const j = await fetchJson(url, 8000);
  const res = j?.chart?.result?.[0];
  const q = res?.indicators?.quote?.[0];
  if (!q) return null;
  const adj = res?.indicators?.adjclose?.[0]?.adjclose || [];
  const ts = res?.timestamp || [];
  const closes = [];
  const highs = [];
  const lows = [];
  const dates = [];
  (q.close || []).forEach((c, i) => {
    if (typeof c !== 'number') return;
    const a = typeof adj[i] === 'number' ? adj[i] : null;
    const ratio = a && c ? a / c : 1;
    const close = a || c;
    const high = typeof q.high?.[i] === 'number' ? q.high[i] * ratio : close;
    const low = typeof q.low?.[i] === 'number' ? q.low[i] * ratio : close;
    closes.push(close);
    highs.push(high);
    lows.push(low);
    dates.push(ts[i] ? new Date(ts[i] * 1000).toISOString().slice(0, 10) : today());
  });
  if (!closes.length) return null;
  return { closes, highs, lows, dates, date: dates.at(-1), source: 'Yahoo' };
}

async function fetchUSHistory(symbol) {
  try {
    const stooq = await fetchStooqHistory(symbol);
    if (stooq?.closes?.length >= 20) return stooq;
  } catch (_) {}
  try {
    const yahoo = await fetchYahooChart(symbol, '1y');
    if (yahoo?.closes?.length >= 20) return yahoo;
  } catch (_) {}
  return null;
}

function normalizeHist(hist) {
  if (!hist || !hist.closes?.length) return null;
  return {
    price: hist.closes.at(-1),
    high52: Math.max(...hist.highs.slice(-252)),
    low52: Math.min(...hist.lows.slice(-252)),
    ma20: sma(hist.closes, 20),
    ma60: sma(hist.closes, 60),
    ma120: sma(hist.closes, 120),
    date: hist.date || today(),
    source: hist.source || 'data'
  };
}

async function getEtf(market, symbol) {
  const m = String(market || '').toUpperCase();
  const sym = String(symbol || '').trim().toUpperCase();
  if (!sym) throw new Error('symbol required');
  if (m === 'TW') {
    const [hist, tech, name] = await Promise.all([
      fetchTwseHistory(sym),
      fetchWantgooTechnical(sym),
      fetchTwName(sym)
    ]);
    const out = normalizeHist(hist) || {};
    if (tech) {
      if (valid(tech.price)) out.price = tech.price;
      if (valid(tech.ma20)) out.ma20 = tech.ma20;
      if (valid(tech.ma60)) out.ma60 = tech.ma60;
      if (valid(tech.ma120)) out.ma120 = tech.ma120;
      out.source = `${out.source || ''}${out.source ? ' + ' : ''}Wantgoo`;
      if (tech.name && !name) out.name = tech.name;
    }
    out.name = name || out.name || '';
    return { market: 'TW', symbol: sym, ...out };
  }
  const hist = await fetchUSHistory(sym);
  const out = normalizeHist(hist) || {};
  const names = {
    VOO: 'Vanguard S&P 500 ETF', VTI: 'Vanguard Total Stock Market ETF', VT: 'Vanguard Total World Stock ETF',
    QQQ: 'Invesco QQQ Trust', SPY: 'SPDR S&P 500 ETF', SCHD: 'Schwab US Dividend Equity ETF',
    IVV: 'iShares Core S&P 500 ETF', DIA: 'SPDR Dow Jones Industrial Average ETF', SMH: 'VanEck Semiconductor ETF',
    SOXX: 'iShares Semiconductor ETF'
  };
  return { market: 'US', symbol: sym, name: names[sym] || '', ...out };
}

async function fetchWantgooMainNumber(url, patterns, min, max) {
  const html = await fetchText(url, 8000);
  const plain = cleanHtml(html);
  const text = `${plain} ${String(html).replace(/,/g, ' ')}`;
  for (const pattern of patterns) {
    const re = new RegExp(pattern + '[\\s\\S]{0,240}?([0-9]{1,6}(?:\\.[0-9]+)?)', 'i');
    const m = text.match(re);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n >= min && n <= max) return n;
    }
  }
  const nums = [...plain.matchAll(/\b([0-9]{1,6}(?:\.[0-9]+)?)\b/g)].map(m => Number(m[1])).filter(n => n >= min && n <= max);
  return nums.length ? nums[0] : null;
}

async function fetchFearGreed() {
  const url = 'https://www.wantgoo.com/global/macroeconomics/fearandgreed';
  const html = await fetchText(url, 8000);
  const plain = cleanHtml(html);
  const text = `${plain} ${String(html).replace(/,/g, ' ')}`;
  const patterns = [
    /市場即時情緒指標[\s\S]{0,120}?(\d{1,3})(?!\d)/i,
    /恐懼與貪婪指數[\s\S]{0,240}?市場即時情緒指標[\s\S]{0,120}?(\d{1,3})(?!\d)/i,
    /Fear\s*&\s*Greed[\s\S]{0,240}?(\d{1,3})(?!\d)/i
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n >= 0 && n <= 100) return n;
    }
  }
  return null;
}

async function getMarket() {
  const result = {
    updatedAt: new Date().toISOString(),
    twIndex: null, sp500: null, nasdaq: null, vix: null, fearGreed: null, vixtwn: null
  };
  await Promise.allSettled([
    (async () => {
      const h = await fetchYahooChart('^TWII', '1y');
      if (h) result.twIndex = { ...normalizeHist(h), label: '台股加權' };
    })(),
    (async () => {
      const h = await fetchStooqHistory('^spx');
      if (h) result.sp500 = { ...normalizeHist(h), label: 'S&P500' };
    })(),
    (async () => {
      try {
        const h = await fetchYahooChart('^IXIC', '1y');
        if (h) result.nasdaq = { ...normalizeHist(h), label: 'NASDAQ Composite' };
      } catch (_) {
        const h = await fetchStooqHistory('^ndx');
        if (h) result.nasdaq = { ...normalizeHist(h), label: 'NASDAQ 100' };
      }
    })(),
    (async () => {
      const h = await fetchYahooChart('^VIX', '1mo');
      if (h) result.vix = { ...normalizeHist(h), label: 'VIX' };
    })(),
    (async () => {
      const fg = await fetchFearGreed();
      if (fg !== null) result.fearGreed = { value: fg, source: 'Wantgoo', url: 'https://www.wantgoo.com/global/macroeconomics/fearandgreed' };
    })(),
    (async () => {
      const v = await fetchWantgooMainNumber('https://www.wantgoo.com/index/vixtwn', ['VIXTWN', '臺指選擇權波動率指數', '台指選擇權波動率指數'], 1, 100);
      if (valid(v)) result.vixtwn = { value: v, source: 'Wantgoo', url: 'https://www.wantgoo.com/index/vixtwn' };
    })()
  ]);
  return result;
}

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const path = url.pathname.replace(/^\/api\/?/, '');
  try {
    if (!path || path === 'health') return json({ ok: true, service: 'ETF Radar V3 API', time: new Date().toISOString() });
    if (path === 'etf') {
      const market = url.searchParams.get('market');
      const symbol = url.searchParams.get('symbol');
      return json(await getEtf(market, symbol));
    }
    if (path === 'market') {
      return json(await getMarket());
    }
    return json({ error: 'not found', path }, 404);
  } catch (err) {
    return json({ error: err.message || String(err), path }, 500);
  }
}
