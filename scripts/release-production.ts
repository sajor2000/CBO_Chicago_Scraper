import { spawnSync } from "node:child_process";

const dryRun = process.argv.includes("--dry-run");
const releaseSteps: Array<[string, string[]]> = [
  ["npm", ["run", "check"]],
  ["vercel", ["pull", "--yes", "--environment", "production"]],
  ["vercel", ["build", "--prod"]],
  ["vercel", ["deploy", "--prebuilt", "--prod", "--skip-domain", "--yes"]],
  ["node", ["scripts/apply-review-migrations.ts"]],
  ["node", ["scripts/verify-review-schema.ts"]]
];

const display = ([command, args]: [string, string[]]) => `${command} ${args.join(" ")}`;
if (dryRun) {
  for (const step of releaseSteps) console.log(display(step));
  console.log("vercel promote <staged-production-url> --yes");
  console.log("smoke https://chicagohealthmap-cbo-verifier.vercel.app/review");
  process.exit(0);
}

const output = (command: string, args: string[], capture = false) => {
  console.log(`$ ${display([command, args])}`);
  const result = spawnSync(command, args, { encoding: "utf8", stdio: capture ? ["inherit", "pipe", "inherit"] : "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed with status ${result.status}.`);
  return result.stdout?.trim() ?? "";
};

const status = output("git", ["status", "--porcelain"], true);
if (status) throw new Error("Production releases require a clean worktree.");
if (!process.env.REVIEW_DATABASE_URL) throw new Error("REVIEW_DATABASE_URL is required to migrate and verify production Neon.");
const branch = output("git", ["branch", "--show-current"], true);
if (branch !== "main" && branch !== "master") throw new Error("Production releases must run from main or master.");
output("git", ["fetch", "origin", branch]);
if (output("git", ["rev-parse", "HEAD"], true) !== output("git", ["rev-parse", `origin/${branch}`], true)) {
  throw new Error(`Local ${branch} must exactly match origin/${branch}.`);
}

output(...releaseSteps[0]);
output(...releaseSteps[1]);
output(...releaseSteps[2]);
const stagedUrl = output(...releaseSteps[3], true).split(/\s+/).findLast((value) => value.startsWith("https://"));
if (!stagedUrl) throw new Error("Vercel did not return a staged production URL.");
output(...releaseSteps[4]);
output(...releaseSteps[5]);
output("vercel", ["promote", stagedUrl, "--yes"]);

const review = await fetch("https://chicagohealthmap-cbo-verifier.vercel.app/review", { redirect: "follow" });
if (!review.ok) throw new Error(`Production review smoke failed (${review.status}).`);
const cron = await fetch("https://chicagohealthmap-cbo-verifier.vercel.app/api/cron");
if (cron.status !== 401) throw new Error(`Production cron authorization smoke failed (${cron.status}).`);
output("vercel", ["logs", "--environment", "production", "--since", "5m", "--level", "error", "--limit", "20"]);
console.log(`Production released from ${branch}; Neon migration verified before Vercel promotion.`);
