import {runM0V2EvidenceSuite} from '../src/testing/paired-theme/v2/m0-evidence-runner';

if (process.argv.length !== 2) {
  throw new Error('M0-v2 evidence runner accepts no arguments');
}

const result = await runM0V2EvidenceSuite({repoRoot: process.cwd()});
process.stdout.write(`${JSON.stringify({
  verify: result.verify.reference,
  e2e: result.e2e.reference,
}, null, 2)}\n`);
