// Movement for the whole app. Two libraries, each for what it does best:
//  · Motion (the library that used to be called Framer Motion) moves things that React puts on and takes off the screen:
//    pages, pop-ups, messages, the sliding marks in the sidebar and the switches.
//  · Anime.js runs the sequences: number tiles and table rows arriving one after another, and icons drawing themselves line by line.
// It all lives in this file so every screen moves the same way, and it goes still for people who switch animations off on their device.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { waapi, animate as play, stagger, svg } from 'animejs';
import { LazyMotion, domMax, MotionConfig, AnimatePresence, m, animate, useInView, useMotionValue, useMotionValueEvent, useReducedMotion, useScroll, useSpring, useTransform } from 'motion/react';

export { m, AnimatePresence };
export const EASE = [0.22, 1, 0.36, 1]; // quick start, soft landing
export const SPRING = { type: 'spring', stiffness: 440, damping: 36, mass: 0.9 };

export const Motion = ({ children }) => <LazyMotion features={domMax} strict><MotionConfig reducedMotion="user" transition={{ duration: 0.3, ease: EASE }}>{children}</MotionConfig></LazyMotion>;

const still = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
// Number tiles and table rows arrive one after another, evenly spaced however many there are. They run as the browser's own
// animations, so nothing is left on the element when they end (hover effects and dimmed rows stay as they were).
const ARRIVE = '.stats > .stat, tbody > tr';
function arrive(found) {
  // At most 14 arrive one by one, and the whole wave is over in about half a second however long the list is (the user wants it smooth, 18 Oct 2026).
  const els = found.filter((e) => e.isConnected && !e.closest('.paper')).slice(0, 14);
  if (els.length) waapi.animate(els, { opacity: { from: 0 }, translate: { from: '0px 10px' }, delay: stagger(Math.min(30, 220 / els.length)), duration: 420, ease: 'outQuart', onComplete: (a) => a.revert() });
}
function useArrivals(ref) {
  useLayoutEffect(() => {
    const root = ref.current; if (!root || still()) return;
    arrive([...root.querySelectorAll(ARRIVE)]);
    const seen = new MutationObserver((list) => { const got = [];
      for (const x of list) for (const n of x.addedNodes) if (n.nodeType === 1) { if (n.matches(ARRIVE)) got.push(n); else got.push(...n.querySelectorAll(ARRIVE)); }
      if (got.length) arrive(got); });
    seen.observe(root, { childList: true, subtree: true });
    return () => seen.disconnect();
  }, []);
}
// An icon that draws itself, line by line, when it appears (and again when "again" changes).
export function useDraw(again) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const lines = ref.current?.querySelectorAll('path, line, polyline, polygon, circle, rect'); if (!lines?.length || still()) return;
    const run = play(svg.createDrawable(lines), { draw: ['0 0', '0 1'], duration: 720, delay: stagger(70), ease: 'outQuart' });
    return () => run.revert();
  }, [again]);
  return ref;
}
// A section's page: it rises in when opened and slips away when you leave it. Kept short, because people change section all day long.
export function Page({ children }) {
  const ref = useRef(null); useArrivals(ref);
  return <m.div ref={ref} className="page" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.06 } }} transition={{ duration: 0.22, ease: EASE }}>{children}</m.div>;
}

// Anything wrapped in Reveal fades up the first time it scrolls into view.
export function Reveal({ children, delay = 0, y = 18, ...p }) {
  return <m.div initial={{ opacity: 0, y }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '0px 0px -48px 0px' }} transition={{ duration: 0.4, ease: EASE, delay }} {...p}>{children}</m.div>;
}
// A group whose children arrive one after another. Give each child variants={rise}.
export const Stagger = ({ children, gap = 0.05, ...p }) => <m.div initial="hide" animate="show" variants={{ hide: {}, show: { transition: { staggerChildren: gap } } }} {...p}>{children}</m.div>;
export const rise = { hide: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: EASE } } };

// A number that counts up to its value when it first comes into view, and glides when the value changes.
const whole = (n) => Math.round(n).toLocaleString('en-IN');
export function CountUp({ value, format = whole }) {
  const ref = useRef(null), seen = useInView(ref, { once: true }), still = useReducedMotion(), mv = useMotionValue(still ? value : 0), text = useTransform(mv, (v) => format(v));
  useEffect(() => { if (!seen) return; if (still) { mv.set(value); return; } const run = animate(mv, value, { duration: 0.7, ease: EASE }); return () => run.stop(); }, [value, seen, still]);
  return <m.span ref={ref}>{text}</m.span>;
}
// A ring that fills to a share (0–100) of a target.
export function Ring({ pct, label }) {
  const r = 50, len = 2 * Math.PI * r, p = Math.max(0, Math.min(100, pct || 0));
  return <div className="ring" role="img" aria-label={`${Math.round(pct || 0)}% ${label}`}>
    <svg viewBox="0 0 118 118"><circle className="bg" cx="59" cy="59" r={r} />
      <m.circle className="fg" cx="59" cy="59" r={r} strokeDasharray={len} initial={{ strokeDashoffset: len }} animate={{ strokeDashoffset: len * (1 - p / 100) }} transition={{ duration: 1.2, ease: EASE, delay: 0.2 }} /></svg>
    <div><b><CountUp value={pct || 0} />%</b><span className="cap">{label}</span></div></div>;
}
// The thin gold line at the top of the window: how far down the page you are.
export function ScrollLine() {
  // On a page too short to scroll the line stays hidden.
  const { scrollY } = useScroll(), part = useTransform(scrollY, (y) => { const max = document.documentElement.scrollHeight - innerHeight; return max > 60 ? Math.min(1, y / max) : 0; }), x = useSpring(part, { stiffness: 240, damping: 34, restDelta: 0.001 });
  return <m.div className="scrollbar" style={{ scaleX: x }} aria-hidden="true" />;
}
// A round button that appears after a long scroll and takes you back to the top.
export function ToTop() {
  const { scrollY } = useScroll(), [on, setOn] = useState(false);
  useMotionValueEvent(scrollY, 'change', (v) => setOn(v > 700));
  return <AnimatePresence>{on && <m.button key="top" type="button" className="totop" aria-label="Back to the top" title="Back to the top" initial={{ opacity: 0, y: 18, scale: 0.85 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 18, scale: 0.85 }} transition={SPRING}
    onClick={() => scrollTo({ top: 0, behavior: 'smooth' })}><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" /></svg></m.button>}</AnimatePresence>;
}
