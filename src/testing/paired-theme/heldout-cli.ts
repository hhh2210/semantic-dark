import {runHeldOutEvaluation} from './heldout-runner';

export async function main(values: readonly string[]): Promise<void> {
  const options: {output?: string; metricFreezeCommit?: string; chromePath?: string;
    headless: boolean} = {headless: true};
  for (let index = 0; index < values.length; index += 1) {
    const flag = values[index]!;
    if (flag === '--') continue;
    if (flag === '--headed') options.headless = false;
    else {
      const value = values[++index];
      if (!value) throw new Error(`Missing value for ${flag}`);
      if (flag === '--output') options.output = value;
      else if (flag === '--metric-freeze-commit') options.metricFreezeCommit = value;
      else if (flag === '--chrome') options.chromePath = value;
      else throw new Error(`Unknown argument: ${flag}`);
    }
  }
  if (!options.output || !options.metricFreezeCommit) {
    throw new Error('--output and --metric-freeze-commit are required');
  }
  const result = await runHeldOutEvaluation({
    output: options.output,
    metricFreezeCommit: options.metricFreezeCommit,
    headless: options.headless,
    ...(options.chromePath ? {chromePath: options.chromePath} : {}),
  });
  process.stdout.write(`${JSON.stringify({
    ok: true, resultSha256: result.report.resultSha256,
    systems: result.report.result.systems.map((system) => ({
      system: system.system, pairScore: system.primary.pairScore,
      hardFailures: system.secondary.hardFailureCount,
    })),
    reproducibility: result.report.reproducibility.status,
    receipt: result.receipt.path,
  }, null, 2)}\n`);
}
