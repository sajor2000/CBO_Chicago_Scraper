import type { EvidenceValues } from "../types.ts";

const fields = ["name", "address", "phone", "url"] as const;

export function extractBenchmarkValues(html: string): EvidenceValues | undefined {
  const values = Object.fromEntries(fields.flatMap((field) => {
    const match = html.match(new RegExp(`data-benchmark-${field}="([^"]+)"`, "i"));
    return match ? [[field, match[1]!]] : [];
  }));
  return Object.keys(values).length ? values : undefined;
}

export function classifiedError(error: unknown): "timeout" | "malformed" {
  return error instanceof DOMException && error.name === "TimeoutError" ? "timeout" : "malformed";
}
