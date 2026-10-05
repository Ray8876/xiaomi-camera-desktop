// Collect exact installed runtime dependency notices without rebuilding clients.
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const root = path.join(__dirname, '..');
const output = path.join(root, 'licenses', 'dependencies');
fs.rmSync(output, {recursive: true, force: true});
fs.mkdirSync(output, {recursive: true});
const records = [];
function collect(kind, name, version, dir, license, source) {
  const target = path.join(output, kind, name.replace(/[^a-zA-Z0-9._-]/g, '_') + '@' + version);
  fs.mkdirSync(target, {recursive: true});
  const files = fs.readdirSync(dir).filter(f => /^(licen[sc]e|copying|notice|copyright)(\b|[._-])/i.test(f));
  let texts = files.filter(f => fs.statSync(path.join(dir, f)).isFile());
  if (!texts.length) texts = fs.readdirSync(dir).filter(f => /^readme/i.test(f) && fs.statSync(path.join(dir, f)).isFile() && /Permission is hereby granted|Redistribution and use|Apache License/i.test(fs.readFileSync(path.join(dir, f), 'utf8')));
  if (!texts.length && kind === 'node' && name === 'eastasianwidth' && version === '0.2.0') {
    const notice = 'eastasianwidth-0.2.0-MIT-LICENSE.txt';
    fs.copyFileSync(path.join(root, 'licenses', 'supplemental', notice), path.join(target, notice));
    records.push({kind, name, version, license, source, upstreamNotice: 'https://github.com/komagata/eastasianwidth/blob/1d41951a59d63fb2d77cda021050fc070cae424a/MIT-LICENSE.txt', notices: [path.relative(path.join(root, 'licenses'), path.join(target, notice))]});
    return;
  }
  if (!texts.length) throw new Error(`No license text found for ${name}@${version}`);
  for (const file of texts) fs.copyFileSync(path.join(dir, file), path.join(target, file));
  records.push({kind, name, version, ...(license ? {license} : {}), source, notices: texts.map(f => path.relative(path.join(root, 'licenses'), path.join(target, f)))});
}
const seen = new Set();
function visitNode(name, parent) {
  const resolver = require('node:module').createRequire(path.join(parent, 'package.json'));
  const candidates = resolver.resolve.paths(name + '/package.json').map(base => path.join(base, name));
  let dir = candidates.find(candidate => fs.existsSync(path.join(candidate, 'package.json')));
  if (!dir) throw new Error(`Package metadata missing: ${name}`);
  dir = fs.realpathSync(dir);
  if (dir === root) throw new Error(`Resolved ${name} from ${parent} to project root`);
  if (seen.has(dir)) return; seen.add(dir);
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json')));
  collect('node', pkg.name, pkg.version, dir, pkg.license, `https://registry.npmjs.org/${pkg.name}/-/${pkg.name.split('/').pop()}-${pkg.version}.tgz`);
  for (const child of Object.keys(pkg.dependencies || {})) visitNode(child, dir);
}
for (const name of Object.keys(require('../package.json').dependencies)) visitNode(name, root);
const go = process.env.GO_BINARY || 'go';
const goOptions = {cwd: path.join(root, 'engine'), encoding: 'utf8', timeout: 60000};
const modules = JSON.parse(execFileSync(go, ['mod', 'edit', '-json'], goOptions)).Require;
const moduleCache = execFileSync(go, ['env', 'GOMODCACHE'], goOptions).trim();
const escaped = value => value.replace(/[A-Z]/g, letter => '!' + letter.toLowerCase());
for (const {Path: name, Version: version} of modules) {
  const dir = path.join(moduleCache, escaped(name) + '@' + escaped(version));
  if (!fs.existsSync(dir)) throw new Error(`Go module not cached: ${name}@${version}; run go mod download`);
  collect('go', name, version, dir, null, `https://proxy.golang.org/${escaped(name)}/@v/${escaped(version)}.zip`);
}
records.sort((a,b) => (a.kind + a.name).localeCompare(b.kind + b.name));
fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(records, null, 2) + '\n');
console.log(`Collected license texts for ${seen.size} Node runtime packages and ${records.length - seen.size} Go modules (including test/build modules).`);
