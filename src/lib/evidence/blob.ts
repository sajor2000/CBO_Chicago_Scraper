import { put } from "@vercel/blob";

const redact = (content: string) => content
  .replace(/(authorization|api[-_ ]?key|cookie)\s*[:=]\s*[^\s;]+/gi, "$1=[redacted]")
  .slice(0, 1_000_000);

export const storeEvidenceCapture = async (input: { runId: string; observationId: string; content: string }) => {
  const pathname = `cbo-evidence/${input.runId}/${input.observationId}.txt`;
  const blob = await put(pathname, redact(input.content), { access: "private", addRandomSuffix: false, contentType: "text/plain" });
  return { url: blob.url, pathname: blob.pathname };
};
