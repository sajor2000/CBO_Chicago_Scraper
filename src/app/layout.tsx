import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "Chicago CBO Review",
  description: "Review-first verification workspace for Chicago community resources."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
