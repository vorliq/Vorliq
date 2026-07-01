import { render } from "@testing-library/react";

import useReveal from "./useReveal";

function Revealable() {
  const ref = useReveal();
  return <div ref={ref} data-testid="section">content</div>;
}

test("reveals an element once it is in (or past) the viewport", () => {
  // jsdom getBoundingClientRect returns zeros, so the element counts as entered
  // and the hook adds the visibility class on mount.
  const { getByTestId } = render(<Revealable />);
  expect(getByTestId("section").classList.contains("is-visible")).toBe(true);
});

test("reveals immediately when the user prefers reduced motion", () => {
  const original = window.matchMedia;
  window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  try {
    const { getByTestId } = render(<Revealable />);
    expect(getByTestId("section").classList.contains("is-visible")).toBe(true);
  } finally {
    window.matchMedia = original;
  }
});
