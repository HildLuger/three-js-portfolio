'use client';
import { motion } from 'framer-motion';

export function Navbar() {
  return (
    <motion.nav
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.4 }}
      className="
        fixed inset-x-0 top-0 z-50
        h-12                              /* 64px tall to match your offsets */
        border-b border-white/10
        bg-violet-900/40 backdrop-blur-lg
        text-white
      "
    >
      <div className="mx-auto h-full max-w-7xl px-4">
        <div className="flex h-full items-center justify-between">
          <a
            href="#hero"
            className="font-extrabold tracking-wide leading-none"
            aria-label="Home"
          >
            Hild Luger 3D Developer
          </a>

          <nav className="hidden sm:flex items-center gap-4 text-sm">
            <a className="ui-button" href="#hero">Hero</a>
            <a className="ui-button" href="#video">Video</a>
            <a className="ui-button" href="#more">More</a>
          </nav>
        </div>
      </div>
    </motion.nav>
  );
}
