import type { Metadata } from "next";
import { Fraunces, JetBrains_Mono } from "next/font/google";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  axes: ["opsz"],
  display: "swap",
});

const jbMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jbmono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Design system — showcase",
  description: "Iedora design system primitives, in situ.",
};

export default function ShowcaseLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      className={`${fraunces.variable} ${jbMono.variable}`}
      style={{
        // Re-point design-system font vars at the next/font-loaded families
        // so the showcase renders with proper Fraunces + JetBrains Mono
        // without dragging Google Fonts CSS into the rest of the app.
        ["--serif" as string]: "var(--font-fraunces), 'Times New Roman', serif",
        ["--mono" as string]: "var(--font-jbmono), ui-monospace, SFMono-Regular, Menlo, monospace",
      }}
    >
      {children}
    </div>
  );
}
