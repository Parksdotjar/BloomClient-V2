import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
function action(name, next, development, context) {
  const code = source.slice(source.indexOf(`  const ${name} = async`), source.indexOf(next, source.indexOf(`  const ${name} = async`)))
    .replaceAll('import.meta.env.DEV', String(development));
  return runInNewContext(`${code}\n${name}();`, context);
}

test('development never checks or installs a production update', async () => {
  const fail = () => assert.fail('Production updater was reached in development');
  await action('checkForUpdates', '  useEffect(', true, { check: fail });
  await action('installUpdate', '  const closeUpdateError', true, { mockUpdateActive: false, availableUpdate: { downloadAndInstall: fail } });
});

test('release checks and installs through the real updater path', async () => {
  let checked = 0, installed = 0, restarted = 0;
  const update = { downloadAndInstall: async notify => {
    installed++;
    notify({event:'Started',data:{contentLength:100}});
    notify({event:'Progress',data:{chunkLength:100}});
    notify({event:'Finished'});
  }};
  const noop = () => {};
  await action('checkForUpdates', '  useEffect(', false, {
    updateChecking:false, setUpdateChecking:noop,
    check:async () => { checked++; return update; },
    setAvailableUpdate:callback => assert.equal(callback(null), update),
  });
  await action('installUpdate', '  const closeUpdateError', false, {
    mockUpdateActive:false, availableUpdate:update, updatePhase:'ready',
    setUpdatePanelOpen:noop,setUpdatePhase:noop,setUpdateProgress:noop,setUpdateError:noop,
    relaunch:async () => { restarted++; },
  });
  assert.deepEqual([checked,installed,restarted],[1,1,1]);
});
