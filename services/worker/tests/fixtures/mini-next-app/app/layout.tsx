import type { Metadata } from "next";
import Script from "next/script";
import { Shell } from "@/components/Shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "NovaAir",
  description: "A console for building with models.",
};

const widgetUrl = process.env.NEXT_PUBLIC_LANTERN_WIDGET_URL;
const widgetKey = process.env.NEXT_PUBLIC_LANTERN_KEY;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Shell>{children}</Shell>
        {widgetUrl && widgetKey ? <Script src={widgetUrl} data-key={widgetKey} strategy="afterInteractive" /> : null}
      </body>
    </html>
  );
}
