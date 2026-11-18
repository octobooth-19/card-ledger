const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('./parser.js');

const formats = [
  ['RBC', 'RBC Alert: purchase of CA$1,250.00 at North Market on 2026-03-04 10:15; card ending in 0012; available credit: CA$3,500.00; credit limit: CA$6,000.00', 'debit', '1250.00', 'CAD'],
  ['TD', 'TD Alert: 1 250,45 CAD refund from North Market on 03/04/26 at 6:42 PM; card **0012', 'refund', '1250.45', 'CAD'],
  ['Scotiabank', 'Scotiabank: reversal alert: CAD 24.00 at North Market on Mar 4, 2026 9:05 AM; card ending 0012', 'reversal', '24.00', 'CAD'],
  ['BMO', 'BMO: declined for CAD 45.01 at North Market on 2026/03/04 08:02; card ending 0012', 'declined', '45.01', 'CAD'],
  ['CIBC', 'CIBC: 1.250,45 EUR was charged at North Market on 2026-03-04T08:02:45-05:00; Visa **0012', 'debit', '1250.45', 'EUR']
];
for (const [bank, sms, type, amount, currency] of formats) {
  test(`parses illustrative ${bank} format`, () => {
    const row = P.parseSMS(sms);
    assert.deepEqual([row.kind, row.original, row.bank, row.type, row.amount, row.currency, row.card, row.merchant, row.date],
      ['transaction', sms, bank, type, amount, currency, '0012', 'North Market', '2026-03-04']);
    assert.match(row.time, /^\d{2}:\d{2}/);
    if (bank === 'TD') assert.equal(row.time, '18:42');
    if (bank === 'CIBC') assert.equal(row.timestamp, Date.parse('2026-03-04T13:02:45Z'));
    if (bank === 'RBC') {
      assert.equal(row.available.amount, '3500.00');
      assert.equal(row.limit.amount, '6000.00');
    }
  });
}

test('preserves missing fields and ambiguous dollar amounts without inventing currency', () => {
  const row = P.parseSMS('TD ALERT $25.00 purchase');
  assert.equal(row.amount, '25.00');
  assert.equal(row.marker, '$');
  assert.equal(row.currency, null);
  assert.equal(row.merchant, null);
  assert.equal(row.card, null);
  assert.equal(row.date, undefined);
  assert.equal(row.time, undefined);
  assert.equal(P.cad(row, {}), null);
  assert.equal(P.parseSMS('RBC purchase of CAD 25.00 on 2026-02-31').date, undefined);
  assert.equal(P.parseSMS('TD ALERT 25.00 purchase').currency, null);
});

test('limit-only records are not refunds', () => {
  const row = P.parseSMS('BMO: Available credit: CA$2,889.13; credit limit: CAD 3000');
  assert.equal(row.type, 'limit');
  assert.equal(row.amount, undefined);
  assert.equal(row.available.amount, '2889.13');
  assert.equal(row.limit.amount, '3000');
});

test('converts only with entered rates using exact decimal rounding', () => {
  const row = P.parseSMS('RBC: purchase of US$1.11 at Coffee');
  assert.equal(P.cad(row, {}), null);
  assert.equal(P.cad(row, { USD:'1.50' }), 167n);
  assert.equal(P.cad({ currency:'EUR', amount:'999999999999999.99' }, { EUR:'1' }), 99999999999999999n);
  assert.equal(P.cad(row, { USD:'-1.50' }), null);
});

test('text import keeps noise and unsupported texts with their reasons', () => {
  const text = `${formats[0][1]}\r\n\r\nTD one-time password: 000000\r\n\r\nUnknown bank\nmultiple lines\r\n\r\nBMO has a new message`;
  const imported = P.importMessages([], P.messages(text));
  assert.deepEqual(imported.rows.map(row => row.kind), ['transaction','noise','unparsed','unparsed']);
  assert.equal(imported.rows[2].original, 'Unknown bank\nmultiple lines');
  assert.match(imported.rows[1].reason, /verification/);
  assert.match(imported.rows[3].reason, /No recognized/);
});

test('CSV parses quoted punctuation, multiline text, sender, timestamp, and incomplete rows', () => {
  const csv = '\uFEFFMessage,Sender,Timestamp\r\n"purchase of CAD 1,029.10 at ""The Cafe""\ncard ending 0012",RBC,2026-03-04T08:00:00Z\r\n,TD,2026-03-04\r\n"Extra message",RBC,2026-03-04,extra';
  const { rows } = P.importMessages([], P.messages(csv, true));
  assert.equal(rows[0].merchant, '"The Cafe"');
  assert.equal(rows[0].amount, '1029.10');
  assert.equal(rows[0].time, '08:00:00');
  assert.equal(rows[0].timezone, 'Z');
  assert.match(rows[1].reason, /no message text/);
  assert.match(rows[2].reason, /column count/);
  assert.throws(() => P.messages('Sender,Date\nRBC,2026-03-04', true), /needs a Message/);
  assert.throws(() => P.messages('Message\n"unfinished', true), /quote/);
});

test('re-import skips overlap without conflating different times, references, or occurrences', () => {
  const charge = time => ({ original:`TD: CAD 45.00 purchase at Coffee on 2026-03-04 ${time}; card ending 0012` });
  const first = charge('10:00'), later = charge('10:07'), secondRef = { original:first.original + '; ref: 154' };
  const initial = P.importMessages([], [first, later, secondRef, first]);
  assert.equal(new Set(initial.rows.map(row => row.id)).size, 4);
  const again = P.importMessages(initial.rows, [first, later, secondRef, first]);
  assert.equal(again.duplicates, 4);
  assert.deepEqual(again.added, []);
  assert.equal(P.importMessages(initial.rows, [first], { keepMatches:true }).added.length, 1);
  const csv = P.importMessages([], [{ original:'TD: CAD 45.00 purchase at Coffee; card ending 0012', date:'2026-03-04 10:00' }]);
  assert.equal(P.importMessages(csv.rows, [{ original:csv.rows[0].original, date:'2026-03-04 10:01' }]).added.length, 1);
});

test('fraud rules flag only purchases strictly above threshold or matching within ten minutes', () => {
  const source = [
    'RBC purchase of CAD 1000.01 at Coffee on 2026-03-04 10:00; card ending 0012',
    'RBC purchase of CAD 1000.00 at Coffee on 2026-03-04 10:00; card ending 0012',
    'RBC purchase of CAD 12.50 at Coffee on 2026-03-04 10:01; card ending 0012',
    'RBC purchase of CAD 12.5 at Coffee on 2026-03-04 10:11; card ending 0012',
    'RBC purchase of CAD 12.50 at Coffee on 2026-03-04 10:21:01; card ending 0012',
    'TD Alert: CAD 12.50 purchase at Coffee on 2026-03-04 10:02; card ending 0012',
    'RBC purchase of USD 12.50 at Coffee on 2026-03-04 10:02; card ending 0012',
    'RBC declined CAD 9999 at Coffee on 2026-03-04 10:05; card ending 0012',
    'RBC refund of CAD 9999 at Coffee on 2026-03-04 10:05; card ending 0012',
    'RBC purchase of CAD 12.50 at Coffee on 2026-03-04; card ending 0012'
  ];
  const { rows } = P.importMessages([], source.map(original => ({ original })));
  const flags = P.fraud(rows, {}, 100000n);
  assert.deepEqual(rows.map(row => flags.get(row.id)), [
    ['threshold'], undefined, ['repeat'], ['repeat'], undefined, undefined, undefined, undefined, undefined, undefined
  ]);
  assert.ok(P.fraud(rows, { USD:'81' }, 100000n).get(rows[6].id).includes('threshold'));
});

test('manual merchant categories apply to future imports ahead of keywords', () => {
  const row = P.parseSMS('RBC purchase of CA$3.14 at HARBOUR   COFFEE');
  assert.equal(P.categorize(row, P.keywords, {}), 'Food');
  assert.equal(P.categorize(row, P.keywords, { 'harbour coffee':'Entertainment' }), 'Entertainment');
});

test('demo covers six months and includes all four noise and three warning examples', () => {
  const { rows } = P.importMessages([], P.dummy(new Date(2026, 2, 4)));
  assert.ok(rows.length >= 290 && rows.length <= 310);
  assert.equal(rows.filter(row => row.kind !== 'transaction').length, 4);
  assert.equal(new Set(rows.flatMap(row => row.date ? [row.date.slice(0,7)] : [])).size, 6);
  assert.equal(rows.filter(row => row.kind === 'transaction' && row.currency && row.currency !== 'CAD').length, 2);
  assert.equal(P.fraud(rows, {}, 100000n).size, 3);
});
