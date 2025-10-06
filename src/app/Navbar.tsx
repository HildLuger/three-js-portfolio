'use client';
import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export function Navbar() {
  const [activeSection, setActiveSection] = useState(0);

  useEffect(() => {
    // Listen for section changes from the page
    const handleSectionChange = (e: CustomEvent) => {
      setActiveSection(e.detail);
    };

    window.addEventListener('sectionchange', handleSectionChange as EventListener);
    return () => window.removeEventListener('sectionchange', handleSectionChange as EventListener);
  }, []);

  const linkClass = (index: number) => {
    const isActive = activeSection === index;
    return `px-3 py-1 sm:px-4 sm:py-2 transition-all duration-300 rounded-md ${
      isActive 
        ? 'bg-violet-500/90 text-white sm:bg-transparent sm:text-white/85 sm:hover:bg-white/10' 
        : 'text-white/85 hover:bg-white/10 hover:text-white'
    }`;
  };

  return (
    <motion.nav
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.4 }}
      className="
        fixed inset-x-0 top-0 z-50
        border-b border-white/10
        bg-violet-900/40 backdrop-blur-lg
        text-white
      "
    >
      <div className="mx-auto max-w-7xl px-4">
        {/* Desktop: single line with title left, nav right */}
        {/* Mobile: two lines centered */}
        <div className="
          flex flex-col items-center gap-2 py-2
          sm:flex-row sm:h-12 sm:items-center sm:justify-between sm:py-0 sm:gap-0
        ">
          {/* Title */}
          <a
            href="#hero"
            className="font-extrabold tracking-wide leading-none text-base sm:text-base"
            aria-label="Home"
          >
            Hild Luger 3D Developer
          </a>

          {/* Navigation links */}
          <nav className="flex items-center gap-3 text-xs sm:gap-4 sm:text-sm">
            <a className={linkClass(0)} href="#hero">Hero</a>
            <a className={linkClass(1)} href="#video">Video</a>
            <a className={linkClass(2)} href="#more">More</a>
          </nav>
        </div>
      </div>
    </motion.nav>
  );
}
