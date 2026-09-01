const timeoutMs = 75_000;

/** @param {Record<string, string | undefined>} env */
function required(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

/** @param {Record<string, string | undefined>} env */
export function cronUrl(env) {
  const value = required(env, "CBO_CRON_URL");
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("CBO_CRON_URL must be an absolute HTTPS URL.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/api/cron") {
    throw new Error("CBO_CRON_URL must be an HTTPS /api/cron endpoint without embedded credentials.");
  }
  return url;
}

/** @param {Record<string, string | undefined>} env @param {typeof fetch} fetchImpl */
export async function dispatchOnce(env = process.env, fetchImpl = fetch) {
  const url = cronUrl(env);
  const secret = required(env, "CRON_SECRET");
  const response = await fetchImpl(url, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${secret}`,
      "user-agent": "cbo-railway-dispatcher/1"
    },
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) throw new Error(`Cron request failed (${response.status}).`);
  const payload = await response.json().catch(() => ({}));
  const runId = typeof payload?.runId === "string" ? payload.runId : undefined;
  return { dispatched: true, status: response.status, ...(runId ? { runId } : {}), skipped: payload?.skipped === true };
}

if (import.meta.main) {
  dispatchOnce().then((result) => console.log(JSON.stringify(result))).catch((error) => {
    console.error(error instanceof Error ? error.message : "Railway dispatch failed.");
    process.exitCode = 1;
  });
}
