// File: app/layout.tsx
import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Navbar } from './Navbar';
import { Orbitron } from 'next/font/google';

const orbitron = Orbitron({
  subsets: ['latin'],
  display: 'swap',
  weight: ['400', '500', '700', '900'],
  variable: '--font-orbitron',
});

export const metadata: Metadata = {
  title: 'Interactive 3D Portfolio - Three.js Experience',
  description:
    'Explore interactive 3D scenes with real-time material editing, smooth scrolling animations, and responsive design. Built with Three.js, GSAP, and Locomotive Scroll.',
  keywords: [
    'Three.js',
    '3D',
    'WebGL',
    'Interactive',
    'Portfolio',
    'GSAP',
    'Locomotive Scroll',
    'React',
    'Next.js',
  ],
  authors: [{ name: '3D Portfolio' }],
  openGraph: {
    title: 'Interactive 3D Portfolio - Three.js Experience',
    description:
      'Explore interactive 3D scenes with real-time material editing, smooth scrolling animations, and responsive design.',
    type: 'website',
    locale: 'en_US',
    siteName: '3D Portfolio',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Interactive 3D Portfolio - Three.js Experience',
    description:
      'Explore interactive 3D scenes with real-time material editing and smooth animations.',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
};

// Move viewport to its own export (fixes Next.js warning)
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={orbitron.variable}>
      {/* Use both: className (immediate) + var (for Tailwind `font-sans`) */}
      <body className={`${orbitron.className} antialiased`}>
        <Navbar />
        {children}
      </body>
    </html>
  );
}
