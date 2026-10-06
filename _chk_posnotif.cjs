// Verify posSaleNotification shares the admin console's copy byte-for-byte
// while keeping the POS-specific routing fields and toast lines.
const p = require('c:/Users/manue/Desktop/spiro/server/src/services/push');

const sale = {
  id: '11111111-2222-3333-4444-555555555555',
  receipt_no: 'SR-20261006-0042',
  client_txn_id: 'txn-abc',
  total: 539120,
  payment_method: 'mobile_money',
};
const revenue = 1234567;

const admin = p.saleNotification(sale);
const pos = p.posSaleNotification(sale, revenue);

let pass = true;
const check = (label, ok) => { console.log((ok ? 'PASS' : 'FAIL') + ': ' + label); if (!ok) pass = false; };

check('title identical to admin console', pos.title === admin.title);
check('body identical to admin console', pos.body === admin.body);
console.log('  title:', pos.title);
console.log('  body :', pos.body);
check("title is '🛵 New Sale'", pos.title === '🛵 New Sale');
check("body has full receipt + amount + method", pos.body === 'SR-20261006-0042 — UGX 539,120 (mobile_money)');
check('kind stays pos_sale (POS poll baseline)', pos.kind === 'pos_sale');
check('url stays /pos', pos.url === '/pos');
check('tag unique per sale', pos.tag === 'pos-sale-' + sale.id);
check('toast line 1 intact', pos.message === `Sale #${sale.receipt_no.slice(-6)} · UGX 539,120`);
check('toast line 2 intact (cumulative)', pos.message2 === "Today's revenue: UGX 1,234,567");
check('revenueToday carried', pos.revenueToday === revenue);
check('saleId carried', pos.saleId === sale.id);

// What persist() stores (title/body/url/tag/kind stripped → payload column):
const extra = { ...pos };
delete extra.title; delete extra.body; delete extra.url; delete extra.tag; delete extra.kind;
const round = JSON.parse(JSON.stringify(extra));
check('payload survives JSON round-trip (message/message2 present)',
  typeof round.message === 'string' && typeof round.message2 === 'string');

console.log(pass ? 'ALL PASS' : 'FAILED');
process.exit(pass ? 0 : 1);
