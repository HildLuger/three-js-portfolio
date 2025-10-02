'use client';


import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import Image from 'next/image';

// R3F canvas only in the browser
const ThreeCanvas = dynamic(() => import('./ThreeCanvas').then(m => m.ThreeCanvas), {
  ssr: false,
  loading: () => (
    <div className="w-full h-screen bg-black flex items-center justify-center">
      Loading 3D…
    </div>
  ),
});

/* ---------- Ease-in-out ---------- */
function cubicBezier(mX1: number, mY1: number, mX2: number, mY2: number) {
  const NEWTON = 4, MIN_SLOPE = 1e-3, SUB_PREC = 1e-7, SUB_MAX = 10, N = 11, STEP = 1 / (N - 1);
  const A = (a1: number, a2: number) => 1 - 3 * a2 + 3 * a1;
  const B = (a1: number, a2: number) => 3 * a2 - 6 * a1;
  const C = (a1: number) => 3 * a1;
  const bez = (t: number, a1: number, a2: number) => ((A(a1, a2) * t + B(a1, a2)) * t + C(a1)) * t;
  const slope = (t: number, a1: number, a2: number) => 3 * A(a1, a2) * t * t + 2 * B(a1, a2) * t + C(a1);
  const samples = new Float32Array(N);
  for (let i = 0; i < N; i++) samples[i] = bez(i * STEP, mX1, mX2);
  const getT = (x: number) => {
    let i = 1, start = 0;
    for (; i < N - 1 && samples[i] <= x; i++) start += STEP;
    i--;
    const dist = (x - samples[i]) / (samples[i + 1] - samples[i]);
    let t = start + dist * STEP;
    let s = slope(t, mX1, mX2);
    if (s >= MIN_SLOPE) {
      for (let k = 0; k < NEWTON; k++) {
        s = slope(t, mX1, mX2);
        if (!s) break;
        t -= (bez(t, mX1, mX2) - x) / s;
      }
      return t;
    }
    let a = start, b = start + STEP, cur = t, it = 0;
    do {
      cur = a + (b - a) / 2;
      const err = bez(cur, mX1, mX2) - x;
      if (err > 0) b = cur; else a = cur;
      if (Math.abs(err) <= SUB_PREC) break;
    } while (++it < SUB_MAX);
    return cur;
  };
  return (x: number) => (mX1 === mY1 && mX2 === mY2) ? x : bez(getT(x), mY1, mY2);
}
const easeSmooth = cubicBezier(0.42, 0.00, 0.58, 1.00);
const SCROLL_MS = 1200;

/* ---- Minimal Lenis typings ---- */
type LenisEasing = (t: number) => number;
interface LenisOptions {
  duration?: number;
  easing?: LenisEasing;
  smoothWheel?: boolean;
  smoothTouch?: boolean;
  gestureOrientation?: 'vertical' | 'horizontal';
  touchMultiplier?: number;
  wheelMultiplier?: number;
  wrapper?: HTMLElement;
  content?: HTMLElement;
}
interface Lenis {
  scrollTo(target: number | string | Element, options?: { duration?: number; easing?: LenisEasing; lock?: boolean }): void;
  raf(time: number): void;
  destroy(): void;
   // optional API on real Lenis – used only for reading virtual scroll & cleanup
 scroll?: number;
 on?(event: 'scroll', handler: (e: unknown) => void): void;
 off?(event: 'scroll', handler?: (e: unknown) => void): void;
}
type LenisConstructor = new (options?: LenisOptions) => Lenis;

/* ---------- Fallback rAF animator (only if Lenis missing) ---------- */
function animateScrollFallback(
  el: HTMLElement,
  to: number,
  ms = SCROLL_MS,
  ease = easeSmooth,
  onDone?: () => void,
  onUpdate?: (y: number) => void
) {
  const from = el.scrollTop;
  const delta = to - from;
  if (Math.abs(delta) < 1 || ms <= 0) { el.scrollTop = to; onUpdate?.(to); onDone?.(); return { cancel(){} }; }
  let raf = 0;
  const t0 = performance.now();
  const step = () => {
    const t = Math.min(1, (performance.now() - t0) / ms);
    const y = Math.round(from + delta * ease(t));
    el.scrollTop = y;
    onUpdate?.(y);
    if (t < 1) raf = requestAnimationFrame(step); else onDone?.();
  };
  raf = requestAnimationFrame(step);
  return { cancel(){ cancelAnimationFrame(raf); } };
}

export default function Page() {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const sectionsRef = useRef<HTMLElement[]>([]);
  const animRef = useRef<{ cancel: () => void } | null>(null);
  const isAnimatingRef = useRef(false);

  const lenisRef = useRef<Lenis | null>(null);
  const rafRef = useRef<number | null>(null);
  const virtScrollRef = useRef(0);

  const [active, setActive] = useState(0);

   // --- Video controls ---
  const vRef = useRef<HTMLVideoElement | null>(null);
    const [muted, setMuted] = useState(true);
    const [vol, setVol] = useState(0.6);
    // keep element properties in sync and ensure playback while section 2 is visible
    useEffect(() => {
      const v = vRef.current;
      if (!v) return;
      v.muted = muted;
      v.volume = vol;
      if (active === 1 && v.paused) v.play().catch(() => {});
    }, [muted, vol, active]);
    // attempt autoplay when section 2 becomes active (and on first visibility)
    useEffect(() => {
      const v = vRef.current;
      if (!v || active !== 1) return;
      const tryPlay = () => v.play().catch(() => {});
      if (v.readyState >= 2) tryPlay();
      else {
        const onld = () => { tryPlay(); v.removeEventListener('loadeddata', onld); };
        v.addEventListener('loadeddata', onld);
      }
    }, [active]);
    // ensure it loops even if some browsers ignore the attribute on programmatic play
    useEffect(() => {
      const v = vRef.current;
      if (!v) return;
      const onEnd = () => { v.currentTime = 0; v.play().catch(() => {}); };
      v.addEventListener('ended', onEnd);
      return () => v.removeEventListener('ended', onEnd);
    }, []);
  /* --- Carousel data (6 thumbs) --- */
    const thumbs = useMemo(
        () => [
          { src: '/thumb1.jpg', href: 'https://wh-web-gl.vercel.app/', alt: '3D web game' },
          { src: '/thumb2.jpg', href: 'https://next-js-r3f-tailwind.vercel.app/globe', alt: 'three.js project' },
          { src: '/thumb3.jpg', href: 'https://asset-configurator2.vercel.app/', alt: '3D Asset Configurator' },
          { src: '/thumb4.jpg', href: 'https://lnkd.in/dhbkJmK9', alt: 'Stylized Anatomy Viewer' },
          { src: '/thumb5.jpg', href: 'https://lnkd.in/dTcfDgHk', alt: 'Three.js Physics' },
          { src: '/thumb6.jpg', href: 'https://www.artstation.com/longshortdreamslsd', alt: '3D  Portfolio' },
        ],
        []
      );
  // Carousel state/handlers
  const [slide, setSlide] = useState(0);
  const count = thumbs.length;
  const prevSlide = useCallback(() => setSlide(s => (s - 1 + count) % count), [count]);
  const nextSlide = useCallback(() => setSlide(s => (s + 1) % count), [count]);

  const touchX = useRef(0);
  const onTouchStartCarousel = (e: React.TouchEvent) => { touchX.current = e.touches[0]?.clientX ?? 0; };
    const onTouchEndCarousel   = (e: React.TouchEvent) => {
      const dx = (e.changedTouches[0]?.clientX ?? touchX.current) - touchX.current;
      if (Math.abs(dx) > 30) {
        if (dx < 0) nextSlide();
        else prevSlide();
      }
    };
     

  const collect = useCallback(() => {
    const root = contentRef.current;
    if (!root) return;
    sectionsRef.current = Array.from(root.querySelectorAll<HTMLElement>('.snap-section'));
  }, []);

  const centerYFor = useCallback((el: HTMLElement) => {
    const wrap = wrapperRef.current!;
    return el.offsetTop + el.offsetHeight / 2 - wrap.clientHeight / 2;
  }, []);

  const updateActive = useCallback(() => {
    const wrap = wrapperRef.current;
    if (!wrap || sectionsRef.current.length === 0) return;
    const top = lenisRef.current ? virtScrollRef.current : wrap.scrollTop;
    const center = top + wrap.clientHeight / 2;
    let best = 0, dist = Infinity;
    for (let i = 0; i < sectionsRef.current.length; i++) {
      const s = sectionsRef.current[i];
      const mid = s.offsetTop + s.offsetHeight / 2;
      const d = Math.abs(mid - center);
      if (d < dist) { dist = d; best = i; }
    }
    setActive(best);
  }, []);

  const goToY = useCallback((y: number, ms = SCROLL_MS) => {
    const lenis = lenisRef.current;
    const wrap = wrapperRef.current!;
    if (lenis) {
      isAnimatingRef.current = true;
      lenis.scrollTo(y, { duration: ms / 1000, easing: easeSmooth, lock: true });
      window.setTimeout(() => { isAnimatingRef.current = false; updateActive(); }, ms + 20);
      return;
    }
    isAnimatingRef.current = true;
    animRef.current?.cancel();
    animRef.current = animateScrollFallback(
      wrap,
      Math.max(0, y),
      ms,
      easeSmooth,
      () => { isAnimatingRef.current = false; updateActive(); },
      () => { updateActive(); }
    );
  }, [updateActive]);

  const scrollToIndex = useCallback((idx: number, ms = SCROLL_MS) => {
    const el = sectionsRef.current[idx];
    if (!el) return;
    goToY(centerYFor(el), ms);
  }, [centerYFor, goToY]);

  // Init Lenis (container mode)
  useEffect(() => {
    (async () => {
      try {
        const mod = (await import('@studio-freight/lenis')) as unknown as { default: LenisConstructor } | LenisConstructor;
        const Ctor: LenisConstructor = (typeof mod === 'function')
          ? (mod as LenisConstructor)
          : (mod as { default: LenisConstructor }).default;

        const wrapper = wrapperRef.current!;
        const content = contentRef.current!;

        const lenis = new Ctor({
          wrapper,
          content,
          duration: 1.2,
          easing: easeSmooth,
          gestureOrientation: 'vertical',
          smoothWheel: false,
          smoothTouch: false,
          touchMultiplier: 1.1,
        });

        lenisRef.current = lenis;

        const raf = (time: number) => {
          lenis.raf(time);
          virtScrollRef.current = typeof lenis.scroll === 'number' ? lenis.scroll : virtScrollRef.current;
          updateActive();
          rafRef.current = requestAnimationFrame(raf);
        };
        rafRef.current = requestAnimationFrame(raf);
      } catch {
        // fallback only
      }
    })();

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      try { lenisRef.current?.off?.('scroll'); } catch {}
      lenisRef.current?.destroy?.();
      lenisRef.current = null;
    };
  }, [updateActive]);

  // Setup sections + initial position + fallback native scroll listener
  useEffect(() => {
    collect();
    const wrap = wrapperRef.current;
    if (!wrap || sectionsRef.current.length === 0) return;

    const first = location.hash
      ? contentRef.current!.querySelector<HTMLElement>(location.hash)
      : sectionsRef.current[0];
    if (first) setTimeout(() => {
      scrollToIndex(sectionsRef.current.indexOf(first), 0);
      updateActive();
    }, 0);

    const onScroll = () => { if (!lenisRef.current) updateActive(); };
    wrap.addEventListener('scroll', onScroll, { passive: true });
    return () => { wrap.removeEventListener('scroll', onScroll); };
  }, [collect, scrollToIndex, updateActive]);

  // Nav / dots → smooth, centered
  useEffect(() => {
    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('nav a[href^="#"]'));
    const onClick = (ev: Event) => {
      const a = ev.currentTarget as HTMLAnchorElement;
      const id = a.getAttribute('href');
      if (!id || id === '#') return;
      const el = contentRef.current!.querySelector<HTMLElement>(id);
      if (!el) return;
      ev.preventDefault();
      const idx = sectionsRef.current.indexOf(el);
      if (idx >= 0) {
        scrollToIndex(idx, SCROLL_MS);
        history.replaceState(null, '', id);
      }
    };
    links.forEach(a => a.addEventListener('click', onClick));
    return () => links.forEach(a => a.removeEventListener('click', onClick));
  }, [scrollToIndex]);

  // Wheel / touch → step between sections with settle
  useEffect(() => {
    const wrap = wrapperRef.current;
    if (!wrap) return;

    const currentIndex = () => {
      const top = lenisRef.current ? virtScrollRef.current : wrap.scrollTop;
      const center = top + wrap.clientHeight / 2;
      let best = 0, dist = Infinity;
      for (let i = 0; i < sectionsRef.current.length; i++) {
        const s = sectionsRef.current[i];
        const mid = s.offsetTop + s.offsetHeight / 2;
        const d = Math.abs(mid - center);
        if (d < dist) { dist = d; best = i; }
      }
      return best;
    };

    let accum = 0;
    let lastTs = 0;
    let settleTimer: number | null = null;
    const THRESHOLD = 40;
    const RESET_MS = 260;

    const onWheel = (e: WheelEvent) => {
      if (isAnimatingRef.current) { e.preventDefault(); return; }
      if ((e.target as HTMLElement | null)?.closest('.ui-card,[data-no-snap]')) return;

      const now = performance.now();
      if (now - lastTs > RESET_MS) accum = 0;
      lastTs = now;

      accum += e.deltaY;
      const abs = Math.abs(accum);
      if (abs >= THRESHOLD) {
        e.preventDefault();
        const dir = accum > 0 ? 1 : -1;
        accum = 0;
        const idx = currentIndex();
        scrollToIndex(Math.max(0, Math.min(sectionsRef.current.length - 1, idx + dir)), SCROLL_MS);
      } else {
        if (settleTimer) window.clearTimeout(settleTimer);
        settleTimer = window.setTimeout(() => {
          if (!isAnimatingRef.current) scrollToIndex(currentIndex(), 800);
        }, 140);
      }
    };

    let touchStartY = 0;
    const onTouchStart = (ev: TouchEvent) => { touchStartY = ev.touches[0]?.clientY ?? 0; };
    const onTouchEnd = (ev: TouchEvent) => {
      if (isAnimatingRef.current) return;
      const dy = touchStartY - (ev.changedTouches[0]?.clientY ?? touchStartY);
      const dir = Math.abs(dy) < 36 ? 0 : (dy > 0 ? 1 : -1);
      const idx = currentIndex();
      scrollToIndex(Math.max(0, Math.min(sectionsRef.current.length - 1, idx + dir)), dir === 0 ? 800 : SCROLL_MS);
    };

    wrap.addEventListener('wheel', onWheel, { passive: false });
    wrap.addEventListener('touchstart', onTouchStart, { passive: true });
    wrap.addEventListener('touchend', onTouchEnd, { passive: true });

    return () => {
      wrap.removeEventListener('wheel', onWheel);
      wrap.removeEventListener('touchstart', onTouchStart);
      wrap.removeEventListener('touchend', onTouchEnd);
    };
  }, [scrollToIndex]);

  const dots = useMemo(() => [0, 1, 2], []);

  return (
    <>
      {/* Wrapper is the scroll viewport; Content is translated by Lenis */}
      <div ref={wrapperRef} className="snap-wrapper">
        <div ref={contentRef} className="snap-content-root">
          {/* 1 — 3D hero */}
          <section id="hero" className="snap-section section-1">
            <div className="three-layer"><ThreeCanvas /></div>
            <div className="snap-text">
              <h1>3D Asset Configurator</h1>
              <p>Change objects and material properties in real-time using WebGPU.</p>
            </div>
          </section>

          {/* 2 — video */}
         <section id="video" className="snap-section section-2">
            <video
              id="bgvid"
              ref={vRef}
              className="media-bg"
              autoPlay
              muted
              loop
              playsInline
              preload="auto"
            >
              <source src="/demo.mp4" type="video/mp4" />
            </video>
            {active === 1 ? (
              <div className="video-ctrl" data-no-snap>
                <button
                  className="vc-btn"
                  onClick={() => setMuted(m => !m)}
                  aria-label={muted ? 'Unmute video' : 'Mute video'}
                >
                  {/* monochrome gray icon */}
                  <svg className="vc-icon" viewBox="0 0 24 24" aria-hidden="true">
                    {/* speaker body */}
                    <path d="M4 10v4h3l5 4V6l-5 4H4z" />
                    {/* slash when muted */}
                    {muted ? <path d="M19 5L5 19" /> : null}
                  </svg>
                </button>
                      <div className="vc-rail">
                  <input
                    className="vc-range"
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={vol}
                    data-orient="vertical"
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setVol(v);
                      if (v === 0) setMuted(true);
                      else if (muted) setMuted(false);
                    }}
                    aria-label="Video volume"
                  />
                </div>
              </div>
             ) : null}
            <div className="snap-text">
              <h1>High Quality 3D</h1>
              <p>Real-time and pre-rendered graphics to display the best experience.</p>
            </div>
          </section>

          {/* 3 — centered-top carousel + bottom text */}
          <section id="more" className="snap-section section-3">
            {/* Carousel sits near the top and is narrower */}
            <div
              className="carousel"
              data-no-snap
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'ArrowLeft') prevSlide(); if (e.key === 'ArrowRight') nextSlide(); }}
              onTouchStart={onTouchStartCarousel}
              onTouchEnd={onTouchEndCarousel}
              aria-roledescription="carousel"
              aria-label="Project gallery"
            >
              <button className="carousel-hit left" onClick={prevSlide} aria-label="Previous project">‹</button>

              <div className="carousel-viewport">
                <div
                  className="carousel-track"
                  style={{ transform: `translateX(${-slide * 100}%)` }}
                >
                  {thumbs.map((t, i) => (
                    <div className="slide" key={i} aria-hidden={i !== slide}>
                      <a
                        href={t.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={t.alt}
                        className="slide-link"
                      >
                        <div className="img-wrap">
                          <Image
                            src={t.src}
                            alt={t.alt}
                            fill
                            sizes="(max-width: 900px) 78vw, 50vw"
                            priority={i === 0}
                            style={{ objectFit: 'cover', userSelect: 'none' }}
                          />
                        </div>
                      </a>
                    </div>
                  ))}
                </div>
              </div>

              <button className="carousel-hit right" onClick={nextSlide} aria-label="Next project">›</button>

              <div className="carousel-dots" role="tablist" aria-label="Slides">
                {thumbs.map((_, i) => (
                  <button
                    key={i}
                    className={`cdot ${i === slide ? 'active' : ''}`}
                    onClick={() => setSlide(i)}
                    role="tab"
                    aria-selected={i === slide}
                    aria-label={`Go to slide ${i + 1}`}
                  />
                ))}
              </div>
            </div>

            {/* Bottom-centered text (as before) */}
            <div className="snap-text">
              <h1>Explore more projects</h1>
              <p></p>
            </div>
          </section>
        </div>
      </div>

      {/* dots for sections */}
      <div className="scroll-indicator" aria-hidden>
        {dots.map(i => (
          <button
            key={i}
            className={`dot ${active === i ? 'active' : ''}`}
            onClick={() => scrollToIndex(i)}
            aria-label={`Go to section ${i + 1}`}
          />
        ))}
      </div>

      {/* styles */}
      <style jsx global>{`
        html, body { height: 100%; }
        body { margin: 0; overflow: hidden; background: #000; color: #fff; }

        .snap-wrapper {
          position: relative;
          height: 100svh;
          overflow: hidden;
          contain: layout paint size;
        }
        .snap-content-root {
          position: relative;
          will-change: transform;
          transform: translateZ(0);
        }

        .snap-section {
          position: relative;
          height: 100svh;
          display: grid;
          place-items: center;
          text-align: center;
        }

        .section-1 { background: transparent; }
        .section-2 { background: transparent; }
        .section-3 {
          background: linear-gradient(135deg, #8a2be2, #4b0082);
          overflow: hidden;
        }

        .three-layer, .media-bg {
          position: absolute; inset: 0; width: 100%; height: 100%;
          z-index: 0; object-fit: cover; will-change: transform;
          transform: translateZ(0);
        }

        .snap-text {
          position: absolute;
          bottom: 10%;
          left: 50%;
          transform: translateX(-50%);
          text-align: center;
          z-index: 1;
          max-width: 680px;
          padding: 16px;
          opacity: 1;
          transition: opacity .8s ease, transform .8s ease;
        }
        .snap-text h1 { font-weight: 500; font-size: clamp(2rem, 4vw, 3.2rem); margin: 0 0 .5rem; }
        .snap-text p  { font-size: clamp(1rem, 1.5vw, 1.2rem); opacity: .9; margin: 0; }

        .scroll-indicator {
          position: fixed; top: 50%; right: 20px; transform: translateY(-50%);
          display: flex; flex-direction: column; gap: 10px; z-index: 10;
        }
        .dot { width: 12px; height: 12px; border-radius: 50%; border: 0; padding: 0; cursor: pointer;
               background: rgba(255,255,255,.5); transition: background .25s ease, transform .25s ease; }
        .dot.active { background: #fff; transform: scale(1.35); }

        /* --- Centered-top slider carousel (smaller, narrower) --- */
        .carousel {
          position: absolute;
          top: 8%;
          left: 50%;
          transform: translateX(-50%);
          z-index: 1;
          width: min(78vw, 420px);
          aspect-ratio: 1 / 1;
          display: grid;
          place-items: center;
          gap: 0.5rem;
        }
        @media (min-width: 900px) {
          .carousel { width: min(50vw, 520px); top: 10%; }
        }
        @media (max-height: 700px) {
          .carousel { top: 6%; }
        }

        .carousel-viewport {
          position: relative;            /* center link above side hits */
          z-index: 1;
          width: 100%; height: 100%;
          overflow: hidden;
          border-radius: 18px;
          box-shadow: 0 16px 40px rgba(0,0,0,.45);
          background: #101018;
        }
        .carousel-track {
          display: flex;
          height: 100%;
          will-change: transform;
          transition: transform .45s cubic-bezier(.2,.7,.2,1);
        }
        .slide { flex: 0 0 100%; width: 100%; height: 100%; }
        .slide-link { display: block; width: 100%; height: 100%; }
        .img-wrap { position: relative; width: 100%; height: 100%; }

        /* Thin side hit-areas ≈ navbar height */
        .carousel-hit {
          position: absolute;
          top: 50%;
          transform: translateY(-50%);
          height: clamp(44px, 6vw, 64px);
          width: clamp(44px, 6vw, 64px);
          background: transparent;
          border: none;
          color: rgba(255,255,255,.95);
          font-size: clamp(26px, 6vw, 36px);
          line-height: 1;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          text-shadow: 0 2px 8px rgba(0,0,0,.6);
          z-index: 2;
          transition: background .2s ease;
        }
        .carousel-hit.left  { right: calc(100% + 12px); }
        .carousel-hit.right { left:  calc(100% + 12px); }
        @media (max-width: 520px) {
          .carousel-hit.left  { right: calc(100% + 8px); }
          .carousel-hit.right { left:  calc(100% + 8px); }
        }
        .carousel-hit:hover { background: rgba(0,0,0,.08); }
        .carousel-hit:focus-visible { outline: 2px solid rgba(255,255,255,.6); outline-offset: -2px; }

        .carousel-dots {
          position: absolute;
          bottom: -22px;
          left: 50%;
          transform: translateX(-50%);
          display: flex; gap: 8px;
        }
        .cdot {
          width: 8px; height: 8px;
          border-radius: 999px;
          border: 0; padding: 0;
          background: rgba(255,255,255,.5);
        }
        .cdot.active { background: #fff; }
           /* --- Video controls (visible only in section 2 via conditional render) --- */
        .video-ctrl{
          position:absolute; right:12px; bottom:12px; z-index:2; /* bottom-right of section 2 */
          display:flex; flex-direction:column; align-items:flex-end; gap:8px;
          padding:6px; border-radius:12px;
          background: rgba(0,0,0,.0);
         
          pointer-events:auto;
          overflow: visible; /* let the vertical slider sit above the button */
        }
        .vc-btn{
          width:34px; height:34px; border-radius:999px;
          border:1px solid rgba(255,255,255,.18);
          background: rgba(100,100,100,.50);
          display:inline-flex; align-items:center; justify-content:center;
        cursor:pointer;
      }

        .vc-icon{
          width:18px; height:18px;
          stroke:#d1d5db; fill:none; stroke-width:2; stroke-linecap:round; stroke-linejoin:round;
        }
        /* Holder to keep the slider fully inside section 2 and ABOVE the button */
        .vc-rail{
          position:absolute;
          right: 8px;
          bottom: calc(100% + 8px);     /* sits directly above the bubble */
          width: 28px;
          height: 120px;                /* vertical length of the control */
          display:flex;
          align-items:center;
          justify-content:center;
          pointer-events:auto;
          overflow: visible;
        }
        /* Vertical, neutral gray slider */
        .vc-range{
          -webkit-appearance: none;
          appearance: none;
          width: 110px;                 /* length after rotation */
          height: 22px;                 /* thickness before rotation */
          transform: rotate(-90deg);
          transform-origin: 50% 50%;    /* rotate around center so it stays inside vc-rail */
          background: transparent;
          accent-color: #9ca3af;        /* neutral gray */
        }
       /* WebKit track/thumb */
       .vc-range::-webkit-slider-runnable-track{
         height: 5px;
         background: rgba(255,255,255,.35);
         border-radius: 999px;
       }
       .vc-range::-webkit-slider-thumb{
         -webkit-appearance: none;
         appearance: none;
         width: 14px; height: 14px;
         background: #d1d5db;       /* gray thumb */
         border: 1px solid rgba(0,0,0,.25);
         border-radius: 50%;
         margin-top: -4px;          /* center on 6px track */
       }
       /* Firefox vertical */
       .vc-range[data-orient="vertical"]{
         writing-mode: bt-lr;       /* let FF know it's vertical */
       }
       .vc-range::-moz-range-track{
         width: 5px;
         background: rgba(255,255,255,.35);
         border-radius: 999px;
       }
       .vc-range::-moz-range-thumb{
         width: 14px; height: 14px;
         background: #d1d5db;
         border: 1px solid rgba(0,0,0,.25);
         border-radius: 50%;
       }
       @media (max-width:520px){
          .vc-btn{ width:32px; height:32px; }
          .vc-rail{ height: 100px; }
          .vc-range{ width: 90px; }
       }
      `}</style>
    </>
  );
}
