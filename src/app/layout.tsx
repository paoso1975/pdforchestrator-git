import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PDFOrchestrator",
  description: "Organizza e gestisci i tuoi documenti PDF.",
  icons: {
    icon: [{ url: "/favicon.png", sizes: "32x32", type: "image/png" }],
    shortcut: "/favicon.png",
    apple: "/favicon.png",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="it"><body>{children}</body></html>;
}
