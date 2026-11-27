import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

const script = readFileSync(new URL('../deploy-to-nrjmorgen.sh', import.meta.url), 'utf8');
const deploySuccess = /Mission Control deployet|Lokal API-helsesjekk bestod\. Nginx er lastet på nytt\./;
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

function deploy(t, overrides = {}) {
  const fixture = createFixture(t);
  const host = join(dirname(fixture.checkout), 'host');
  const bin = join(host, 'bin');
  const trace = join(host, 'trace');
  for (const path of ['bin', 'etc/systemd/system', 'etc/nginx/sites-available', 'etc/nginx/sites-enabled']) {
    mkdirSync(join(host, path), { recursive: true });
  }
  writeFileSync(join(host, 'etc/nrj-mission-control.env'), 'Synthetic environment file\n');
  writeFileSync(trace, '');
  const isolatedScript = script
    .replaceAll('/etc/', `${host}/etc/`)
    .replaceAll('/var/www/nrjmorgen.com/kloakontroll', fixture.destination);
  assert.doesNotMatch(isolatedScript, /['"\s](?:\/etc\/|\/var\/www\/)/);
  writeFileSync(fixture.deployScript, isolatedScript);

  const stub = `#!/bin/bash
set -eu
name=\${0##*/}
printf '%s %s\\n' "$name" "$1" >> "$MC_TRACE"
case "$name:$1" in
  systemctl:show)
    if [[ -n "$MC_STATE_AFTER_DAEMON_RELOAD" ]] && grep -Fqx 'systemctl daemon-reload' "$MC_TRACE"; then
      printf '%s\\n' "$MC_STATE_AFTER_DAEMON_RELOAD"
    else
      printf '%s\\n' "$MC_UNIT_STATE"
    fi
    exit "$MC_SHOW_EXIT" ;;
  systemctl:start) exit "$MC_START_EXIT" ;;
  systemctl:reload) exit "$MC_RELOAD_EXIT" ;;
  systemctl:daemon-reload|systemctl:enable|systemctl:is-active) ;;
  nginx:-t) exit "$MC_NGINX_TEST_EXIT" ;;
  curl:*)
    [[ "\${*: -1}" == 'http://127.0.0.1:8081/api/health' ]] || exit 91
    printf '%s\\n' "$MC_HEALTH"
    exit "$MC_CURL_EXIT" ;;
  sleep:*) ;;
  *) exit 92 ;;
esac
`;
  for (const command of ['systemctl', 'nginx', 'curl', 'sleep']) {
    writeFileSync(join(bin, command), stub, { mode: 0o700 });
  }
  const result = spawnSync('bash', [fixture.deployScript], {
    cwd: fixture.callerDirectory, encoding: 'utf8', timeout: 5000,
    env: {
      PATH: `${bin}:${process.env.PATH}`, MC_TRACE: trace,
      MC_UNIT_STATE: 'LoadState=not-found\nActiveState=inactive', MC_SHOW_EXIT: '0', MC_STATE_AFTER_DAEMON_RELOAD: '',
      MC_START_EXIT: '0', MC_RELOAD_EXIT: '0', MC_NGINX_TEST_EXIT: '0',
      MC_HEALTH: '{"status":"ok"}', MC_CURL_EXIT: '0', ...overrides,
    },
  });
  assert.ifError(result.error);
  return { ...result, commands: readFileSync(trace, 'utf8').trim().split('\n'), destination: fixture.destination };
}

test('refuses a running or unverified service before staging files', async (t) => {
  for (const [name, overrides] of [
    ['active service', { MC_UNIT_STATE: 'LoadState=loaded\nActiveState=active' }],
    ['missing ActiveState', { MC_UNIT_STATE: 'LoadState=loaded' }],
    ['load error', { MC_UNIT_STATE: 'LoadState=error\nActiveState=inactive' }],
    ['failed systemd lookup', { MC_SHOW_EXIT: '1' }],
  ]) {
    await t.test(name, (t) => {
      const result = deploy(t, overrides);
      assert.notEqual(result.status, 0);
      assert.equal(existsSync(result.destination), false);
      assert.deepEqual(result.commands, ['systemctl show']);
      assert.doesNotMatch(result.stdout, deploySuccess);
    });
  }
});

test('refuses to start or reload if the API becomes active during staging', (t) => {
  const result = deploy(t, { MC_STATE_AFTER_DAEMON_RELOAD: 'LoadState=loaded\nActiveState=active' });
  assert.notEqual(result.status, 0);
  assert.deepEqual(result.commands, ['systemctl show', 'nginx -t', 'systemctl daemon-reload', 'systemctl show']);
  assert.doesNotMatch(result.stdout, deploySuccess);
});

test('nginx validation failure stops before API activation or proxy reload', (t) => {
  const result = deploy(t, { MC_NGINX_TEST_EXIT: '1' });
  assert.notEqual(result.status, 0);
  assert.deepEqual(result.commands, ['systemctl show', 'nginx -t']);
  assert.doesNotMatch(result.stdout, deploySuccess);
});

test('API start or unhealthy HTTP response stops before proxy reload', async (t) => {
  for (const [name, overrides] of [
    ['start failure', { MC_START_EXIT: '1' }],
    ['invalid health body', { MC_HEALTH: '{"status":"starting"}' }],
    ['non-success HTTP status with an ok body', { MC_CURL_EXIT: '22' }],
  ]) {
    await t.test(name, (t) => {
      const result = deploy(t, overrides);
      assert.notEqual(result.status, 0);
      assert.ok(result.commands.includes('systemctl start'));
      assert.ok(!result.commands.includes('systemctl reload'));
      assert.ok(!result.commands.includes('systemctl enable'));
      assert.doesNotMatch(result.stdout, deploySuccess);
    });
  }
});

test('reload failure stops before enabling the API or reporting success', (t) => {
  const result = deploy(t, { MC_RELOAD_EXIT: '1' });
  assert.notEqual(result.status, 0);
  assert.ok(result.commands.includes('systemctl reload'));
  assert.ok(!result.commands.includes('systemctl enable'));
  assert.doesNotMatch(result.stdout, deploySuccess);
});

test('a missing or inactive service is started and verified before proxy reload', async (t) => {
  for (const loadState of ['not-found', 'loaded']) {
    await t.test(loadState, (t) => {
      const result = deploy(t, { MC_UNIT_STATE: `LoadState=${loadState}\nActiveState=inactive` });
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(result.commands, [
        'systemctl show', 'nginx -t', 'systemctl daemon-reload', 'systemctl show', 'systemctl start',
        'systemctl is-active', 'curl --fail', 'systemctl reload', 'systemctl enable',
      ]);
      assert.match(result.stdout, /Lokal API-helsesjekk bestod\. Nginx er lastet på nytt\./);
    });
  }
});
