import type { Metadata, Viewport } from "next";
import { Poppins } from "next/font/google";
import "./globals.css";

const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  style: ["normal", "italic"],
});

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3000");

const title = "Panel del chatbot · Natural Lodge Caño Negro";
const description =
  "Panel de administración del asistente virtual de Natural Lodge Caño Negro: gestiona prompts, activa o desactiva el bot y prueba los agentes en tiempo real.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: title,
    template: "%s · Natural Lodge Caño Negro",
  },
  description,
  applicationName: "NLCN · Panel del chatbot",
  keywords: [
    "Natural Lodge Caño Negro",
    "chatbot",
    "asistente virtual",
    "panel de administración",
    "Caño Negro",
    "Costa Rica",
    "hospedaje",
    "turismo",
  ],
  authors: [{ name: "Natural Lodge Caño Negro" }],
  creator: "Natural Lodge Caño Negro",
  publisher: "Natural Lodge Caño Negro",
  formatDetection: { email: false, address: false, telephone: false },
  // Herramienta interna tras login: no debe indexarse.
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false },
  },
  openGraph: {
    type: "website",
    locale: "es_CR",
    url: siteUrl,
    siteName: "Natural Lodge Caño Negro",
    title,
    description,
  },
  twitter: {
    card: "summary",
    title,
    description,
  },
};

export const viewport: Viewport = {
  themeColor: "#08080a",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={poppins.variable}>
      <body>{children}</body>
    </html>
  );
}
