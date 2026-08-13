import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import "./styles.css";

export const metadata: Metadata = {
  title: "ChicagoHealthMap CBO Review",
  description: "Review-first verification workspace for Chicago community resources."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><ClerkProvider>{children}</ClerkProvider></body></html>;
}
