import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Language Learner",
  description: "Learn Japanese/Chinese via YouTube",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
