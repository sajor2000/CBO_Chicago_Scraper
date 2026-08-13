import { profileCboSource, sourceProfileConfigFromEnv } from "../src/lib/imports/cbo-source-profile.ts";

try {
  console.log(`CBO source profile: ${JSON.stringify(await profileCboSource(sourceProfileConfigFromEnv()))}`);
} catch {
  console.error("CBO source profile failed safely. Check the operator runbook and server-side configuration.");
  process.exitCode = 1;
}
