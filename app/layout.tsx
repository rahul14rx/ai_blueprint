import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Blueprint Studio — AI 2D to 3D Home Designer",
  description: "Turn a home idea into an editable floor plan and a true interactive 3D model.",
  openGraph: {
    title: "Blueprint Studio",
    description: "From idea to interactive 3D.",
    images: [{ url: "/og.png", width: 1680, height: 945, alt: "Blueprint Studio 2D to 3D home design" }],
  },
  twitter: { card: "summary_large_image", title: "Blueprint Studio", description: "From idea to interactive 3D.", images: ["/og.png"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // suppressHydrationWarning: password managers / extensions inject attrs (bis_*, data-nlok-*) before React hydrates.
  return <html lang="en" suppressHydrationWarning><body className={`${geist.variable} ${mono.variable}`} suppressHydrationWarning>{children}</body></html>;
}
