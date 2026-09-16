import localFont from "next/font/local";

export const inter = localFont({
  src: [
    { path: "../../public/fonts/inter-normal-latin.woff2", style: "normal" },
    { path: "../../public/fonts/inter-normal-latin-ext.woff2", style: "normal" },
  ],
  variable: "--font-inter",
  display: "swap",
  weight: "300 800",
});

export const fraunces = localFont({
  src: [
    { path: "../../public/fonts/fraunces-normal-latin.woff2", style: "normal" },
    { path: "../../public/fonts/fraunces-normal-latin-ext.woff2", style: "normal" },
    { path: "../../public/fonts/fraunces-italic-latin.woff2", style: "italic" },
    { path: "../../public/fonts/fraunces-italic-latin-ext.woff2", style: "italic" },
  ],
  variable: "--font-fraunces",
  display: "swap",
  weight: "300 900",
});

export const newsreader = localFont({
  src: [
    { path: "../../public/fonts/newsreader-normal-latin.woff2", style: "normal" },
    { path: "../../public/fonts/newsreader-normal-latin-ext.woff2", style: "normal" },
    { path: "../../public/fonts/newsreader-italic-latin.woff2", style: "italic" },
    { path: "../../public/fonts/newsreader-italic-latin-ext.woff2", style: "italic" },
  ],
  variable: "--font-newsreader",
  display: "swap",
  weight: "300 800",
});

export const plexMono = localFont({
  src: [
    { path: "../../public/fonts/ibm-plex-mono-normal-latin.woff2", style: "normal" },
    { path: "../../public/fonts/ibm-plex-mono-normal-latin-ext.woff2", style: "normal" },
  ],
  variable: "--font-plex-mono",
  display: "swap",
  weight: "400 600",
});

export const fontVariables = `${inter.variable} ${fraunces.variable} ${newsreader.variable} ${plexMono.variable}`;
