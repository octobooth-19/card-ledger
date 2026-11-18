(function () {
  'use strict';

  const categories = ['Food', 'Groceries', 'Travel', 'Shopping', 'Bills', 'Fuel', 'Entertainment', 'Other'];
  const keywords = {
    Food: ['cafe', 'coffee', 'pizza', 'restaurant', 'bakery'],
    Groceries: ['grocery', 'market', 'superstore', 'costco'],
    Travel: ['air canada', 'hotel', 'via rail', 'uber', 'transit'],
    Shopping: ['outfitters', 'amazon', 'apple store', 'bookshop', 'electronics'],
    Bills: ['hydro', 'rogers', 'telus', 'insurance'],
    Fuel: ['petro-canada', 'shell', 'esso'],
    Entertainment: ['cinema', 'spotify', 'netflix', 'museum'],
    Other: []
  };
  const normalize = value => String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
  const codes = 'CAD USD EUR GBP JPY AUD NZD CHF CNY HKD SGD INR MXN BRL SEK NOK DKK PLN CZK ZAR KRW TWD THB IDR VND PHP MYR AED SAR TRY ILS ISK HUF RON COP CLP PEN ARS BHD KWD OMR JOD QAR EGP NGN KES XOF XAF UAH RUB PKR BDT LKR MAD DOP CRC UYU GTQ VES'.split(' ').join('|');
  const money = `(?<![\\w.,])(?:(?:${codes})\\s+)?(?:[+−-]\\s*)?(?:(?:CA|US|C)?\\$\\s*|[€£¥]\\s*)?(?:\\d{1,3}(?:[, .\\u00a0\\u202f]\\d{3})+|\\d+)(?:[.,]\\d{1,6})?(?:\\s+(?:${codes})\\b)?(?!\\w|[.,]\\d)`;
  const status = 'purchase|charged|charge|debit|refund(?:ed)?|credit(?:ed)?|reversal|reversed|declined|decline';
  const banks = {
    RBC: { prefix: /^RBC(?: Royal Bank)?\b/i, pattern: `\\b(${status})\\b\\s*(?:of\\s+|for\\s+|:\\s*)?(${money})`, order: [1, 2] },
    TD: { prefix: /^TD(?: Canada Trust)?\b/i, pattern: `(${money})\\s+(?:card\\s+)?(${status})\\b`, order: [2, 1] },
    Scotiabank: { prefix: /^(?:Scotiabank|Scotia Alert|Scotia)\b/i, pattern: `\\b(${status})\\b\\s*(?:alert\\s*)?[:–-]?\\s*(?:of\\s+)?(${money})`, order: [1, 2] },
    BMO: { prefix: /^BMO(?: Bank of Montreal)?\b/i, pattern: `\\b(${status})\\b\\s*(?:for\\s+|of\\s+|:\\s*)?(${money})`, order: [1, 2] },
    CIBC: { prefix: /^CIBC\b/i, pattern: `(${money})\\s+was\\s+(${status})\\b`, order: [2, 1] }
  };
  const symbols = { 'CA$': 'CAD', 'C$': 'CAD', 'US$': 'USD', '€': 'EUR', '£': 'GBP' };
  const power = places => 10n ** BigInt(places);
  const decimal = value => {
    const text = String(value).trim();
    if (!/^\d{1,15}(?:\.\d{1,12})?$/.test(text)) return null;
    const [whole, fraction = ''] = text.split('.');
    return { units: BigInt(whole + fraction), places: fraction.length };
  };
  const round = (units, divisor) => (units + divisor / 2n) / divisor;
  const cents = value => {
    const amount = decimal(value);
    if (!amount || amount.places > 2) return null;
    return amount.units * power(2 - amount.places);
  };
  function parseMoney(text) {
    let clean = text.trim();
    let currency = null;
    let marker = null;
    const iso = clean.match(new RegExp(`^(${codes})\\s+`, 'i'));
    if (iso) {
      marker = currency = iso[1].toUpperCase();
      clean = clean.slice(iso[0].length);
    }
    clean = clean.replace(/^[+−-]\s*/, '');
    const symbol = clean.match(/^(CA\$|US\$|C\$|[$€£¥])\s*/i);
    if (symbol) {
      marker = symbol[1].toUpperCase();
      if (currency && symbols[marker] && currency !== symbols[marker]) return null;
      currency ||= symbols[marker] || null;
      clean = clean.slice(symbol[0].length);
    }
    const suffix = clean.match(new RegExp(`\\s+(${codes})$`, 'i'));
    if (suffix) {
      const code = suffix[1].toUpperCase();
      if (currency && currency !== code) return null;
      currency = code;
      clean = clean.slice(0, -suffix[0].length);
    }
    clean = clean.replace(/\s+/g, ' ');
    const last = Math.max(clean.lastIndexOf('.'), clean.lastIndexOf(','));
    const fraction = last < 0 ? '' : clean.slice(last + 1);
    const tailIsGroup = /^\d{1,3}(?:,\d{3})+$/.test(clean);
    const isDecimal = last >= 0 && !tailIsGroup && !/^\d{1,3}(?:\.\d{3}){2,}$/.test(clean);
    const whole = isDecimal ? clean.slice(0, last) : clean;
    if (!/^(?:\d+|\d{1,3}([ ,.])\d{3}(?:\1\d{3})*)$/.test(whole)) return null;
    const amount = `${whole.replace(/[ ,.]/g, '')}${isDecimal ? '.' + fraction : ''}`;
    if (!decimal(amount)) return null;
    return { amount, currency, marker };
  }

  const monthNames = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
  const datePattern = /\b(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{4})(?!\d)(?:[T\s]+(?:at\s+)?(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(AM|PM)\b)?(?:\s*(Z|[+-]\d{2}:?\d{2})(?!\d))?)?/i;
  const pad = number => String(number).padStart(2, '0');
  function parseDate(text) {
    const match = String(text || '').match(datePattern);
    if (!match) return {};
    const [, raw, h, m, s, period, zone] = match;
    let year, month, day;
    if (/^[A-Za-z]/.test(raw)) {
      const [name, d, y] = raw.replace(',', '').split(/\s+/);
      [year, month, day] = [+y, monthNames.findIndex(item => item.toLowerCase() === name.slice(0, 3).toLowerCase()) + 1, +d];
    } else {
      const [a, b, c] = raw.split(/[-/]/);
      [year, month, day] = a.length === 4 ? [+a, +b, +c] : [c.length === 2 ? 2000 + +c : +c, +b > 12 ? +a : +a > 12 ? +b : +a, +a > 12 ? +a : +b];
    }
    if (year < 1000 || month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return {};
    const date = `${year}-${pad(month)}-${pad(day)}`;
    if (h === undefined) return { date };
    if (+m > 59 || +(s || 0) > 59 || (period ? +h < 1 || +h > 12 : +h > 23)) return { date };
    const time = `${pad(period ? +h % 12 + (period.toUpperCase() === 'PM' ? 12 : 0) : +h)}:${m}${s ? ':' + s : ''}`;
    const timezone = zone?.toUpperCase().replace(/^([+-]\d{2})(\d{2})$/, '$1:$2') || '';
    const timestamp = Date.parse(`${date}T${time}${timezone || 'Z'}`);
    return Number.isFinite(timestamp) ? { date, time, timezone, timestamp } : { date, time };
  }

  function parseSMS(original, metadata = {}) {
    const sms = String(original ?? '').trim();
    const body = sms.replace(/\s+/g, ' ');
    const bank = Object.keys(banks).find(name => banks[name].prefix.test(body)) ||
      Object.keys(banks).find(name => banks[name].prefix.test(String(metadata.sender || '').trim())) || null;
    const missing = (reason, kind = 'unparsed') => ({ original: sms, bank, reason, kind, sourceDate: metadata.date || '' });
    if (/\b(?:verification code|one[- ]time (?:code|password)|OTP|promo(?:tion)?|special offer|unsubscribe)\b/i.test(body)) {
      return missing('Looks like a verification or promotional message, not a transaction.', 'noise');
    }
    if (!bank) return missing('No supported bank name in the message or CSV sender.');
    const { pattern, order } = banks[bank];
    const availableMatch = body.match(new RegExp(`\\b(?:available (?:credit(?: limit)?|limit)|credit available)\\s*[:=]?\\s*(${money})`, 'i'));
    const limitMatch = body.replace(availableMatch?.[0] || /$^/, '').match(new RegExp(`\\bcredit limit\\s*[:=]?\\s*(${money})`, 'i'));
    const transactionText = body.replace(/\b(?:available credit(?: limit)?|credit available|credit limit)\b/gi, label => ' '.repeat(label.length));
    const match = new RegExp(pattern, 'i').exec(transactionText);
    const available = availableMatch ? parseMoney(availableMatch[1]) : null;
    const limit = limitMatch ? parseMoney(limitMatch[1]) : null;
    const value = match ? parseMoney(match[order[1]]) : null;
    if (!value && !available && !limit) return missing('No recognized transaction amount or credit limit.');
    if (match && !value) return missing('The transaction amount or currency could not be read.');
    const word = match?.[order[0]].toLowerCase() || '';
    const type = /declin/.test(word) ? 'declined' : /revers/.test(word) ? 'reversal' :
      /credit|refund/.test(word) ? 'refund' : value ? 'debit' : 'limit';
    const card = body.match(/\b(?:card\s*(?:ending\s*(?:in\s*)?|[•*x#-]+\s*)?|ending\s+(?:in\s+)?|(?:credit|visa|mastercard)\s+[•*x#-]+\s*)(\d{4})\b/i)?.[1] ||
      body.match(/[*•x]{2,}\s*(\d{4})\b/i)?.[1] || null;
    const merchant = value && body.slice(match.index + match[0].length).match(/\b(?:at\s+|from\s+|merchant\s*[:=]\s*)(.+?)(?=\s+(?:on\s+\d|on\s+[A-Za-z]{3,9}\s+\d|(?:on\s+|using\s+)?(?:your\s+)?card\b|(?:available (?:credit|limit)|credit (?:limit|available))\b|ref(?:erence)?\s*[:#])|[;|]|\s+\d{4}-\d{2}-\d{2}\b|$)/i)?.[1].trim().replace(/[.,]$/, '') || null;
    const inBody = parseDate(body);
    const exported = parseDate(metadata.date);
    const when = inBody.date ? (inBody.date === exported.date && !inBody.time ? exported : inBody) : exported;
    return { kind: 'transaction', original: sms, bank, type, card, merchant, ...value, ...when, available, limit };
  }

  function csvRows(text) {
    const rows = [];
    let row = [], cell = '', quoted = false, closed = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (ch === '"') { quoted = false; closed = true; }
        else cell += ch;
      } else if (ch === '"' && !cell && !closed) {
        quoted = true;
      } else if (ch === ',' || ch === '\n' || ch === '\r') {
        row.push(cell);
        cell = '';
        closed = false;
        if (ch !== ',') {
          rows.push(row);
          row = [];
          if (ch === '\r' && text[i + 1] === '\n') i++;
        }
      } else {
        if (closed || ch === '"') throw new Error('Malformed CSV: check quotation marks around fields.');
        cell += ch;
      }
    }
    if (quoted) throw new Error('Malformed CSV: an opening quote was not closed.');
    if (cell || row.length || closed) rows.push([...row, cell]);
    return rows.filter(fields => fields.some(field => field.trim()));
  }
  function messages(text, isCSV = false) {
    text = String(text).replace(/^\uFEFF/, '');
    if (!isCSV) return text.trim().split(/\r?\n[ \t]*\r?\n(?:[ \t]*\r?\n)*/).filter(Boolean).map(original => ({ original }));
    const [header, ...rows] = csvRows(text);
    if (!header) return [];
    const keys = header.map(normalize);
    const message = keys.findIndex(key => ['message', 'text', 'body', 'sms', 'original sms'].includes(key));
    if (message < 0) throw new Error('CSV needs a Message, Text, Body, SMS, or Original SMS column.');
    const date = keys.findIndex(key => ['date', 'timestamp', 'date/time', 'datetime', 'sent at'].includes(key));
    const sender = keys.findIndex(key => ['sender', 'from', 'bank'].includes(key));
    const time = keys.indexOf('time');
    const zone = keys.indexOf('time zone');
    return rows.map(fields => ({
      original: fields[message]?.trim() ? fields[message] : fields.join(','),
      date: [fields[date], fields[time], fields[zone]].filter(Boolean).join(' '),
      sender: fields[sender],
      reason: !fields[message]?.trim() ? 'CSV row has no message text.' :
        fields.length !== header.length ? 'CSV row does not match the header column count.' : null
    }));
  }

  function canonical(value) {
    const [whole, fraction] = String(value ?? '').split('.');
    const trailing = fraction?.replace(/0+$/, '');
    return (whole.replace(/^0+(?=\d)/, '') || '0') + (trailing ? '.' + trailing : '');
  }
  function signature(row) {
    return JSON.stringify([row.kind, row.bank, row.type, row.currency || row.marker, canonical(row.amount),
      normalize(row.merchant), row.timestamp ?? row.date ?? row.sourceDate, row.timezone || '', row.card, normalize(row.original)]);
  }
  function hash(text) {
    let result = 2166136261;
    for (let i = 0; i < text.length; i++) result = Math.imul(result ^ text.charCodeAt(i), 16777619);
    return (result >>> 0).toString(36);
  }
  function importMessages(existing, items, { keepMatches = false } = {}) {
    const previous = new Map(), incoming = new Map(), used = new Set();
    for (const row of existing) {
      const key = signature(row);
      previous.set(key, (previous.get(key) || 0) + 1);
      used.add(row.id);
    }
    const added = [];
    let duplicates = 0;
    for (const { original, reason, ...metadata } of items) {
      const row = reason ? { kind: 'unparsed', original, reason, sourceDate: metadata.date || '' } : parseSMS(original, metadata);
      const key = signature(row);
      const count = (incoming.get(key) || 0) + 1;
      incoming.set(key, count);
      if (!keepMatches && count <= (previous.get(key) || 0)) { duplicates++; continue; }
      let suffix = count;
      let id = `${hash(key)}-${suffix}`;
      while (used.has(id)) id = `${hash(key)}-${++suffix}`;
      used.add(id);
      added.push({ ...row, id });
    }
    return { rows: [...existing, ...added], added, duplicates };
  }

  function cad(row, rates) {
    const amount = decimal(row.amount ?? '');
    const rate = row.currency === 'CAD' ? { units: 1n, places: 0 } :
      row.currency && Object.hasOwn(rates, row.currency) ? decimal(rates[row.currency]) : null;
    if (!amount || !rate || rate.units <= 0n) return null;
    return round(amount.units * rate.units * 100n, power(amount.places + rate.places));
  }
  function categorize(row, mapping, overrides) {
    const merchant = normalize(row.merchant);
    if (merchant && Object.hasOwn(overrides, merchant)) return overrides[merchant];
    return categories.find(category => (mapping[category] || []).some(word => normalize(word) && merchant.includes(normalize(word)))) || 'Other';
  }
  function fraud(rows, rates, threshold) {
    const reasons = new Map(), groups = new Map();
    const flag = (id, reason) => reasons.set(id, [...(reasons.get(id) || []), reason]);
    for (const row of rows) {
      if (row.type !== 'debit') continue;
      const amount = cad(row, rates);
      if (amount !== null && amount > threshold) flag(row.id, 'threshold');
      if (!row.card || !row.merchant || !row.currency || !Number.isFinite(row.timestamp)) continue;
      const key = JSON.stringify([row.bank, row.card, normalize(row.merchant), row.currency, canonical(row.amount), Boolean(row.timezone)]);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    for (const group of groups.values()) {
      group.sort((a, b) => a.timestamp - b.timestamp);
      for (let i = 0; i < group.length; i++) {
        if ((i > 0 && group[i].timestamp - group[i - 1].timestamp <= 600000) ||
            (i + 1 < group.length && group[i + 1].timestamp - group[i].timestamp <= 600000)) flag(group[i].id, 'repeat');
      }
    }
    return reasons;
  }

  function dummy(now = new Date()) {
    const brands = [
      ['RBC', '4821'], ['TD', '7392'], ['Scotiabank', '3108'], ['BMO', '9054'], ['CIBC', '6627']
    ];
    const merchants = ['Harbour Coffee', 'North Market', 'Via Rail', 'Cedar Outfitters', 'Toronto Hydro',
      'Petro-Canada', 'Park Cinema', 'Juniper Restaurant', 'Fresh Grocery', 'Lakeside Hotel',
      'Indigo Bookshop', 'Rogers', 'Shell', 'City Museum', 'Maple Bakery', 'Metro Transit',
      'West Electronics', 'Community Centre', 'Costco', 'Netflix'];
    const date = (offset, day) => {
      const d = new Date(now.getFullYear(), now.getMonth() - offset, 1);
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(day)}`;
    };
    const example = (index, type, amount, merchant, when, currency = 'CAD') => {
      const [bank, card] = brands[index];
      const value = `${currency} ${amount}`;
      const templates = [
        `RBC Alert: ${type} of ${value}`,
        `TD Alert: ${value} ${type}`,
        `Scotiabank: ${type} alert: ${value}`,
        `BMO: ${type} for ${value}`,
        `CIBC: ${value} was ${{ purchase: 'charged', refund: 'refunded', reversal: 'reversed', declined: 'declined' }[type]}`
      ];
      return `${templates[index]} at ${merchant} on ${when}; card ending in ${card}; available credit: CA$3,500.00; credit limit: CA$6,000.00`;
    };
    let seed = 8723;
    function random(max) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return Math.floor(seed / 4294967296 * max);
    }
    const samples = [];
    for (let month = 5; month >= 0; month--) {
      for (let i = 0; i < 48; i++) {
        const type = i % 23 === 0 ? 'refund' : i === 17 ? 'reversal' : i === 30 ? 'declined' : 'purchase';
        const merchant = random(merchants.length);
        const amount = `${6 + random([68, 153, 302, 196, 124][merchant % 5])}.${pad(random(100))}`;
        const when = `${date(month, 1 + random(month ? 28 : Math.min(now.getDate(), 28)))} ${pad(7 + random(15))}:${pad(random(60))}`;
        samples.push(example(random(5), type, amount, merchants[merchant], when));
      }
    }
    const today = date(0, now.getDate());
    samples.push(example(0, 'purchase', '1,425.00', 'West Electronics', `${today} 10:03`),
      example(1, 'purchase', '38.40', 'Juniper Restaurant', `${today} 11:10`),
      example(1, 'purchase', '38.40', 'Juniper Restaurant', `${today} 11:17`),
      example(2, 'purchase', '64.00', 'Lakeside Hotel', `${today} 13:15`, 'USD'),
      example(4, 'purchase', '19.90', 'City Museum', `${today} 14:36`, 'EUR'),
      'BMO: Available credit: CA$2,889.13; card ending in 9054',
      'TD: Your verification code is 000000. Never share it.',
      'RBC: Special offer: explore rewards in your banking app.',
      'See you at the station at six.',
      'CIBC: Your card activity notification is ready.');
    return samples.map(original => ({ original }));
  }

  const api = { categories, keywords, normalize, cents, parseMoney, parseDate, parseSMS,
    messages, importMessages, cad, categorize, fraud, dummy };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SmsParser = api;
})();
