import {runPairedTheme} from './runner';

export async function main(values: readonly string[]): Promise<void> {
  const options: {protocolPath?: string; output?: string; chromePath?: string;
    metricFreezeCommit?: string; requireClean: boolean; headless: boolean} = {
      requireClean: true, headless: true,
    };
  for (let index = 0; index < values.length; index += 1) {
    const flag = values[index]!;
    if (flag === '--') continue;
    if (flag === '--allow-dirty') options.requireClean = false;
    else if (flag === '--headed') options.headless = false;
    else {
      const value = values[++index];
      if (!value) throw new Error(`Missing value for ${flag}`);
      if (flag === '--protocol') options.protocolPath = value;
      else if (flag === '--output') options.output = value;
      else if (flag === '--chrome') options.chromePath = value;
      else if (flag === '--metric-freeze-commit') options.metricFreezeCommit = value;
      else throw new Error(`Unknown argument: ${flag}`);
    }
  }
  if (!options.protocolPath || !options.output) {
    throw new Error('--protocol and --output are required');
  }
  const result = await runPairedTheme({
    protocolPath: options.protocolPath,
    output: options.output,
    requireClean: options.requireClean,
    headless: options.headless,
    ...(options.metricFreezeCommit ? {metricFreezeCommit: options.metricFreezeCommit} : {}),
    ...(options.chromePath ? {chromePath: options.chromePath} : {}),
  });
  process.stdout.write(`${JSON.stringify({
    ok: true,
    resultSha256: result.report.resultSha256,
    systems: result.report.result.systems.map((system) => ({
      system: system.system,
      pairScore: system.primary.pairScore,
      hardFailures: system.secondary.hardFailureCount,
    })),
    reproducibility: result.reproducibility.status,
  }, null, 2)}\n`);
}
