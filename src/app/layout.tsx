import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Azure Prices Agent",
  description: "Search Azure service prices using natural language",
  icons: {
    icon: '/favicon.ico',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.className} antialiased text-gray-900 bg-gradient-to-br from-gray-50 to-gray-100 min-h-screen`}>
        {children}
      </body>
    </html>
  );
}
