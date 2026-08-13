import { timingSafeEqual } from "node:crypto";

export class CronAuthorizationError extends Error {
  constructor() {
    super("Invalid cron authorization.");
    this.name = "CronAuthorizationError";
  }
}

export function authorizeCron(provided: string | null, expected = process.env.CRON_SECRET): void {
  if (!provided || !expected) throw new CronAuthorizationError();
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) throw new CronAuthorizationError();
}
