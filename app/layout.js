import { Comfortaa } from "next/font/google";
import "./globals.css";

// the intro's start label (Figma: Comfortaa Bold)
const comfortaa = Comfortaa({ subsets: ["cyrillic"], weight: "700", variable: "--font-comfortaa" });

export const metadata = {
  title: "Монгол гэр барих",
  description: "Монгол гэрийг алхам алхмаар барих 3D анимэйшн",
};

export const viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }) {
  return (
    <html lang="mn" className={comfortaa.variable}>
      <body>{children}</body>
    </html>
  );
}
