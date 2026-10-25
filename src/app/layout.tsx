import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Financial Intelligence Lab",
  description: "AI-Powered Financial Health, Fundamental Analysis & Valuation of Indian Listed Companies",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
