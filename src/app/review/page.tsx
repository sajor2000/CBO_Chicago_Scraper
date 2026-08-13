import { UserButton } from "@clerk/nextjs";

export default function ReviewQueuePage() {
  return <main><UserButton /><h1>Reviewer queue</h1><p>Review staged evidence and approve only the supported field changes.</p></main>;
}
