const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
const sourceRoots = ['src', 'bingo-api', 'styles', 'scripts'];
const sourceFiles = [
  'package.json',
  'package-lock.json',
  '.nvmrc',
  '.babelrc',
  '.eslintrc',
  'server.js',
  'gulpfile.js',
  'index.html',
  'back-office.html',
  'discoverer.html',
  'config.json',
  'config/public-network.js',
  'config/piloto.borrador.json'
];
const assets = [
  'js/app.js',
  'js/back-office.js',
  'js/back-office-discoverer.js',
  'styles/all.min.css',
  'styles/back-office.css'
];

function sourceDigest(directory = root) {
  const names = [...sourceFiles];
  function visit(relative) {
    for (const entry of fs.readdirSync(path.join(directory, relative), { withFileTypes: true })) {
      const name = relative + '/' + entry.name;
      if (entry.isSymbolicLink()) throw new Error('Release sources must not contain symlinks');
      if (entry.isDirectory()) visit(name);
      else if (/\.(js|cjs|scss)$/.test(name)) names.push(name);
    }
  }
  sourceRoots.forEach(visit);
  return sha(
    JSON.stringify(names.sort().map((name) => [name, sha(fs.readFileSync(path.join(directory, name)))]))
  );
}

function gitRevision(directory) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: directory,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch (_) {
    return null;
  }
}

function gitTreeClean(directory) {
  try {
    return !execFileSync(
      'git',
      ['status', '--porcelain', '--untracked-files=all', '--', ...sourceFiles, ...sourceRoots],
      { cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim();
  } catch (_) {
    return null;
  }
}

function writeRelease(directory = root) {
  if (Number(process.versions.node.split('.')[0]) !== 22) throw new Error('Build requires Node 22');
  const manifest = {
    schemaVersion: 1,
    version: JSON.parse(fs.readFileSync(path.join(directory, 'package.json'))).version,
    revision: gitRevision(directory),
    gitTreeClean: gitTreeClean(directory),
    sourceSha256: sourceDigest(directory),
    lockSha256: sha(fs.readFileSync(path.join(directory, 'package-lock.json'))),
    node: process.versions.node,
    builtAt: new Date().toISOString(),
    assets: Object.fromEntries(
      assets.map((name) => [name, sha(fs.readFileSync(path.join(directory, 'build', name)))])
    )
  };
  manifest.buildId = sha(JSON.stringify(manifest));
  fs.writeFileSync(path.join(directory, 'build/release.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

function verifyRelease(directory = root) {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'build/release.json')));
  const { buildId, ...payload } = manifest;
  if (
    manifest.schemaVersion !== 1 ||
    buildId !== sha(JSON.stringify(payload)) ||
    manifest.version !== JSON.parse(fs.readFileSync(path.join(directory, 'package.json'))).version ||
    manifest.sourceSha256 !== sourceDigest(directory) ||
    manifest.lockSha256 !== sha(fs.readFileSync(path.join(directory, 'package-lock.json'))) ||
    !/^22\./.test(manifest.node) ||
    JSON.stringify(Object.keys(manifest.assets)) !== JSON.stringify(assets) ||
    assets.some((name) => manifest.assets[name] !== sha(fs.readFileSync(path.join(directory, 'build', name))))
  ) {
    throw new Error('Release verification failed; run npm run build');
  }
  return {
    status: 'verified',
    version: manifest.version,
    buildId,
    revision: manifest.revision,
    gitTreeClean: manifest.gitTreeClean,
    sourceSha256: manifest.sourceSha256,
    lockSha256: manifest.lockSha256,
    builtAt: manifest.builtAt,
    node: manifest.node
  };
}

function releaseInfo(strict = false) {
  try {
    return verifyRelease();
  } catch (_) {
    if (strict) throw new Error('Verified release required');
    return { status: 'unverified', version: require('../package.json').version, buildId: null };
  }
}

module.exports = { writeRelease, verifyRelease, releaseInfo, sourceDigest, assets, sourceFiles, sourceRoots };
