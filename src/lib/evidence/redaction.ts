export const redactEvidence = (content: string) => content
  .replace(/(authorization|api[-_ ]?key|cookie)\s*[:=]\s*[^\s;]+/gi, "$1=[redacted]")
  .slice(0, 1_000_000);
