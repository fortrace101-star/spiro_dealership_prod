const fs = require('fs');
const p = 'c:/Users/manue/Desktop/spiro/admin/src/pages/ReordersPage.tsx';
let s = fs.readFileSync(p, 'utf8');

// Fix the detail modal table wrapper and table class
s = s.replace(
  /          <div className="overflow-x-auto card">\n            <table className="w-full">/,
  '          <div className="card">\n            <table className="table-auto min-w-[640px] w-full sm:w-auto">'
);

fs.writeFileSync(p, s, 'utf8');
console.log('FIXED');
