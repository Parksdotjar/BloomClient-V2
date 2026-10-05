import { cosmeticsFromEnvironment } from './api.mjs';

// Run by the deployment operator with server-injected configuration. This command
// reads no configuration files, changes no state and never outputs secret values.
try {
  const api = cosmeticsFromEnvironment();
  if (!api.enabled) {
    console.error('NOT READY: cosmetics are disabled in this deployment.');
    process.exitCode = 1;
  } else {
    await api.checkReadiness();
    console.log('PASS: configured cape storage passed its readiness checks.');
    console.log('Still required: SQL permissions/RPC tests, signed asset delivery, owner sign-in and two-player acceptance.');
  }
} catch {
  console.error('NOT READY: verify server configuration, migration, storage permissions and private PNG-only bucket settings.');
  process.exitCode = 1;
}
