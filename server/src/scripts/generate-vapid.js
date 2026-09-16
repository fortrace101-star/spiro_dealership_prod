const webpush = require('web-push');
const fs = require('fs');
const path = require('path');

const { publicKey, privateKey } = webpush.generateVAPIDKeys();

console.log('\nAdd these to server/.env:\n');
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}\n`);

// Convenience: append/update server/.env if it exists
const envPath = path.join(__dirname, '..', '..', '.env');
try {
  let env = fs.readFileSync(envPath, 'utf8');
  env = env
    .replace(/^VAPID_PUBLIC_KEY=.*$/m, `VAPID_PUBLIC_KEY=${publicKey}`)
    .replace(/^VAPID_PRIVATE_KEY=.*$/m, `VAPID_PRIVATE_KEY=${privateKey}`);
  fs.writeFileSync(envPath, env);
  console.log(`(also updated ${envPath})\n`);
  console.log('Restart the server to activate push notifications.');
} catch {
  console.log('(server/.env not found — copy .env.example to .env first)');
}
