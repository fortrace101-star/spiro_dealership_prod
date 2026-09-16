/**
 * One-command interactive setup for Windows:
 *   node scripts/setup-win.js
 *
 * Prompts for the postgres password (hidden), creates the `spiro` database,
 * writes server/.env, then seeds demo data.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const PG18 = 'C:\\Program Files\\PostgreSQL\\18\\bin';
const PG17 = 'C:\\Program Files\\PostgreSQL\\17\\bin';
const PG_BIN = fs.existsSync(path.join(PG18, 'psql.exe')) ? PG18 : fs.existsSync(path.join(PG17, 'psql.exe')) ? PG17 : null;

if (!PG_BIN) {
  console.error('PostgreSQL not found in C:\\Program Files\\PostgreSQL\\{17,18}. Install PostgreSQL first.');
  process.exit(1);
}

const serverDir = path.join(__dirname, '..');
const envPath = path.join(serverDir, '.env');

function ask(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

function askHidden(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const chars = [];
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', function onData(buf) {
      const s = buf.toString();
      if (s === '\r' || s === '\n') {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(chars.join(''));
      } else if (s === '\u0003') {
        process.exit(1);
      } else if (s === '\u0008' || s === '\u007f') {
        chars.pop();
      } else {
        chars.push(s);
      }
    });
  });
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.on('close', () => {}); // keep process alive manually

(async () => {
  console.log('=== Spiro ERP — one-time setup ===\n');

  const password = await askHidden('Postgres "postgres" user password (hidden): ');
  if (!password) {
    console.error('No password entered.');
    process.exit(1);
  }

  const env = {
    port: '4000',
    dbUrl: `postgresql://postgres:${encodeURIComponent(password)}@localhost:5432/spiro`,
  };

  const psql = (db, sql) =>
    spawnSync(path.join(PG_BIN, 'psql.exe'), ['-U', 'postgres', '-h', 'localhost', '-d', db, '-v', 'ON_ERROR_STOP=1', '-c', sql], {
      env: { ...process.env, PGPASSWORD: password },
      encoding: 'utf8',
    });

  console.log('\n[1/4] Checking connection…');
  const check = psql('postgres', 'SELECT 1');
  if (check.status !== 0) {
    console.error('Connection failed: ' + (check.stderr || '').trim());
    process.exit(1);
  }
  console.log('  ✓ connected');

  console.log('[2/4] Creating database "spiro"…');
  const exists = psql('postgres', "SELECT 1 FROM pg_database WHERE datname='spiro'");
  if (!/1/.test(exists.stdout || '')) {
    const created = spawnSync(path.join(PG_BIN, 'createdb.exe'), ['-U', 'postgres', '-h', 'localhost', 'spiro'], {
      env: { ...process.env, PGPASSWORD: password },
      encoding: 'utf8',
    });
    if (created.status !== 0) {
      console.error('Failed to create db: ' + (created.stderr || '').trim());
      process.exit(1);
    }
    console.log('  ✓ database created');
  } else {
    console.log('  • database already exists');
  }

  console.log('[3/4] Writing server/.env…');
  let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const setEnv = (key, value) => {
    const re = new RegExp(`^${key}=.*$`, 'm');
    if (re.test(envContent)) envContent = envContent.replace(re, `${key}=${value}`);
    else envContent += `\n${key}=${value}`;
  };
  setEnv('PORT', env.port);
  setEnv('DATABASE_URL', env.dbUrl);
  fs.writeFileSync(envPath, envContent.trim() + '\n');
  console.log('  ✓ ' + envPath);

  console.log('[4/4] Seeding demo data…');
  const seed = spawnSync('node', [path.join(serverDir, 'src', 'scripts', 'seed.js')], {
    cwd: serverDir,
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: env.dbUrl },
  });
  if (seed.status !== 0) {
    console.error('Seed failed.');
    process.exit(1);
  }

  console.log('\n✅ Setup complete! Start the stack with:  npm run dev  (in server/, admin/, pos/)');
  rl.close();
  process.exit(0);
})();
