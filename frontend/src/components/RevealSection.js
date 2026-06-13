import useReveal from "../helpers/useReveal";

// A <section> that fades and slides up once it scrolls into view, using the
// same reveal-on-scroll pattern as Home, Dashboard, and Governance. It renders
// a real <section> element (no extra wrapper) so it is a drop-in replacement
// for an existing section and never changes layout. Reduced motion is handled
// inside useReveal and the .reveal-up CSS, so content is shown immediately when
// the user prefers reduced motion. Pass any normal section props through.
function RevealSection({ className = "", children, ...props }) {
  const ref = useReveal();
  return (
    <section ref={ref} className={`reveal-up ${className}`.trim()} {...props}>
      {children}
    </section>
  );
}

export default RevealSection;
