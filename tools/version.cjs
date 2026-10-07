const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const modules = fs.readdirSync(path.join(root, 'src')).filter(name => name.endsWith('.js')).sort();
const hash = crypto.createHash('sha256');
for (const module of modules) {
  hash.update(module);
  hash.update('\0');
  hash.update(fs.readFileSync(path.join(root, 'src', module)));
  hash.update('\0');
}
module.exports = `tf-${hash.digest('hex').slice(0, 16)}`;
