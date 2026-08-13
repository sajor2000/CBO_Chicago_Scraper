import { importCboBaseline, sourceConfigFromEnv } from "../src/lib/imports/cbo-baseline.ts";

try {
  const report = await importCboBaseline(sourceConfigFromEnv());
  console.log(`CBO baseline import complete: ${JSON.stringify(report)}`);
} catch {
  console.error("CBO baseline import failed safely. Check the operator runbook and server-side configuration.");
  process.exitCode = 1;
}
