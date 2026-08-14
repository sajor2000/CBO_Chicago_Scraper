export const redactEvidence = (content: string) => content
  .replace(/(authorization|api[-_ ]?key|cookie|password|client[-_ ]?secret|access[-_ ]?token)\s*["']?\s*[:=]\s*["']?[^\s,;}"']+["']?/gi, "$1=[redacted]")
  .replace(/\bbearer\s+[a-z0-9._~+/=-]+/gi, "Bearer [redacted]")
  .slice(0, 1_000_000);
