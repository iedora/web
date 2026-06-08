import type { Metadata } from "next";
import {
  Geist,
  Geist_Mono,
  Inter,
  Lora,
  Playfair_Display,
  Space_Grotesk,
} from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import "@iedora/design-system/styles.css";
import "./globals.css";

// Printed-menu vocabulary — four faces of the same voice:
//   --display   Playfair Display 600   wordmark + h1
//   --serif     Lora italic            eyebrows + course voice + copy
//   --sans      Geist                  UI controls + body
//   --mono      Geist Mono             labels + step counter + meta
// Loaded once at the root so every product surface shares the same
// glyph cache. Variable-font CSS vars carry the next/font handle.
const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
  style: ["normal", "italic"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});
const lora = Lora({
  variable: "--font-lora",
  subsets: ["latin"],
  style: ["normal", "italic"],
  weight: ["400", "500", "600"],
  display: "swap",
});

// Per-restaurant theme fonts (rendered into the public menu template
// when restaurant.theme picks one). Kept on the root html so a theme
// swap doesn't trigger a font fetch.
const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});

// Root layout serves every surface (menu / core / house) —
// the title/description here are the brand-level fallbacks. Each
// surface's pages override via their own `export const metadata` so
// the template suffix lands on the brand, not on a specific product.
export const metadata: Metadata = {
  title: { default: "Iedora — House of Software", template: "%s · Iedora" },
  description: "We do software with quality.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Locale comes from the cookie set by setUserLocale; falls back to 'en' when
  // absent. The public menu page overrides `lang` on its inner wrapper for
  // anonymous visitors who don't carry a locale cookie.
  const locale = await getLocale();
  return (
    <html
      lang={locale}
      className={`${geistSans.variable} ${geistMono.variable} ${playfair.variable} ${lora.variable} ${inter.variable} ${spaceGrotesk.variable} h-full antialiased`}
      style={{
        ["--display" as string]:
          "var(--font-playfair), Georgia, serif",
        ["--serif" as string]:
          "var(--font-lora), Georgia, serif",
        ["--sans" as string]:
          "var(--font-geist-sans), 'Helvetica Neue', Helvetica, Arial, sans-serif",
        ["--mono" as string]:
          "var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace",
      }}
    >
      <body className="min-h-full flex flex-col">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
