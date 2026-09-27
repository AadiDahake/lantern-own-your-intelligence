import type { Metadata } from "next";
import { Fraunces, Inter, Newsreader } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-inter" });

/** Display serif, used for the landing page headlines. */
const fraunces = Fraunces({
  subsets: ["latin"],
  display: "swap",
  axes: ["SOFT", "WONK"],
  variable: "--font-fraunces",
});

/** Reading serif, used for every heading inside the console. */
const newsreader = Newsreader({
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600"],
  variable: "--font-newsreader",
});

export const metadata: Metadata = {
  title: "Lantern",
  description:
    "Support that learns, and what it learns is yours. It answers from your own knowledge, remembers every finished route and builds what is missing.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${fraunces.variable} ${newsreader.variable}`}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
