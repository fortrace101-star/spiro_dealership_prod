const fs = require('fs');
const s = fs.readFileSync('c:/Users/manue/Desktop/spiro/pos/src/components/ReceivingScreen.tsx', 'utf8');
const L = s.split('\n');
console.log('--- keyword lines ---');
L.forEach((l, i) => {
  if (l.match(/print|Fulfills|prepare|Receive Stock|Received consignment/i)) {
    console.log((i + 1) + ': ' + l.slice(0, 200));
  }
});
console.log('--- done ---');
