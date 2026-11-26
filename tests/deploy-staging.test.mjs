import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

const script = readFileSync(new URL('../deploy-to-nrjmorgen.sh', import.meta.url), 'utf8');
const stagedFiles = [
  'index.html',
  'manifest.json',
  'supabase-integration.js',
  'api/backend-v2.py',
  'api/supabase_config.py',
  'api/requirements.txt',
];

function createFixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'mission-control-staging-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const checkout = join(root, 'source checkout');
  const callerDirectory = join(root, 'different working directory');
  const destination = join(root, 'staging directory');
  const deployScript = join(checkout, 'deploy-to-nrjmorgen.sh');

  mkdirSync(join(checkout, 'api'), { recursive: true });
  mkdirSync(callerDirectory);
  writeFileSync(deployScript, script);
  for (const file of stagedFiles) {
    writeFileSync(join(checkout, file), `checkout fixture for ${file}\n`);
    mkdirSync(dirname(join(callerDirectory, file)), { recursive: true });
    writeFileSync(join(callerDirectory, file), `unrelated fixture for ${file}\n`);
  }

  return { checkout, destination, callerDirectory, deployScript };
}

function stage({ deployScript, destination, callerDirectory }) {
  // Refuse to invoke an older script that would ignore the staging-only flag.
  assert.ok(/^if .*--stage-only.*; then$/m.test(script), 'this script must support staging-only mode');
  const result = spawnSync('bash', [deployScript, '--stage-only', destination], {
    cwd: callerDirectory,
    encoding: 'utf8',
  });
  assert.ifError(result.error);
  return result;
}

test('stages the deployed files from the script checkout, even from another directory', (t) => {
  const fixture = createFixture(t);
  const result = stage(fixture);
  assert.equal(result.status, 0, result.stderr);

  assert.deepEqual(readdirSync(fixture.destination).sort(),
    ['api', 'index.html', 'manifest.json', 'supabase-integration.js']);
  assert.deepEqual(readdirSync(join(fixture.destination, 'api')).sort(),
    ['backend-v2.py', 'requirements.txt', 'supabase_config.py']);
  for (const file of stagedFiles) {
    assert.equal(readFileSync(join(fixture.destination, file), 'utf8'), `checkout fixture for ${file}\n`);
  }
});

test('a missing browser dependency fails before creating the staging directory', (t) => {
  const fixture = createFixture(t);
  rmSync(join(fixture.checkout, 'supabase-integration.js'));

  const result = stage(fixture);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /supabase-integration\.js/);
  assert.equal(existsSync(fixture.destination), false);
});
