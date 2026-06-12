import { useEffect, useRef } from "react";

// Reveal-on-scroll for marketing sections. Adds .is-visible once the element
// has entered the viewport or been scrolled past, so fast scrolling and
// anchor jumps can never leave content hidden. Falls back to immediately
// visible when the user prefers reduced motion, so content is never hidden
// or delayed.
export default function useReveal() {
  const ref = useRef(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;

    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduceMotion) {
      element.classList.add("is-visible");
      return undefined;
    }

    let revealed = false;
    let intervalId = 0;

    function check() {
      if (revealed) return;
      const rect = element.getBoundingClientRect();
      const entered = rect.top < window.innerHeight * 0.92;
      const passed = rect.bottom < 0;
      if (entered || passed) {
        revealed = true;
        element.classList.add("is-visible");
        window.removeEventListener("scroll", check);
        window.removeEventListener("resize", check);
        window.clearInterval(intervalId);
      }
    }

    check();
    if (!revealed) {
      window.addEventListener("scroll", check, { passive: true });
      window.addEventListener("resize", check, { passive: true });
      // Safety net for environments that drop scroll events: content must
      // never stay hidden behind the reveal effect.
      intervalId = window.setInterval(check, 500);
    }
    return () => {
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
      window.clearInterval(intervalId);
    };
  }, []);

  return ref;
}
