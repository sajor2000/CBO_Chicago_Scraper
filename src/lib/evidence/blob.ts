import { put } from "@vercel/blob";
import { redactEvidence } from "./redaction.ts";

export const storeEvidenceCapture = async (input: { runId: string; observationId: string; content: string }) => {
  const pathname = `cbo-evidence/${input.runId}/${input.observationId}.txt`;
  const blob = await put(pathname, redactEvidence(input.content), { access: "private", addRandomSuffix: false, contentType: "text/plain" });
  return { url: blob.url, pathname: blob.pathname };
};
