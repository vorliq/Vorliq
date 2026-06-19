// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';
import { configure } from "@testing-library/react";
import { TextDecoder, TextEncoder } from "util";
import { webcrypto } from "crypto";

// The first cold render of the full <App /> in a heavy suite can exceed the
// testing-library default findBy/waitFor timeout (1000ms) on slower CI runners,
// which made the home-render smoke test flaky. Raise the async timeout suite-wide
// so cold renders are not mistaken for failures; queries still resolve as soon as
// the element appears, so passing tests stay fast.
configure({ asyncUtilTimeout: 5000 });

if (!global.TextEncoder) {
  global.TextEncoder = TextEncoder;
}

if (!global.TextDecoder) {
  global.TextDecoder = TextDecoder;
}

if (!global.crypto?.subtle) {
  Object.defineProperty(global, "crypto", {
    value: webcrypto,
    configurable: true,
  });
}

if (!window.crypto?.subtle) {
  Object.defineProperty(window, "crypto", {
    value: webcrypto,
    configurable: true,
  });
}

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

class IntersectionObserverMock {
  constructor(callback) {
    this.callback = callback;
  }
  observe(element) {
    this.callback?.([{ isIntersecting: true, target: element }]);
  }
  unobserve() {}
  disconnect() {}
}

if (!window.ResizeObserver) {
  window.ResizeObserver = ResizeObserverMock;
}

if (!window.IntersectionObserver) {
  window.IntersectionObserver = IntersectionObserverMock;
  global.IntersectionObserver = IntersectionObserverMock;
}

if (!window.matchMedia) {
  window.matchMedia = () => ({
    matches: false,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    addListener: jest.fn(),
    removeListener: jest.fn(),
    dispatchEvent: jest.fn(),
  });
}

if (!navigator.clipboard) {
  Object.defineProperty(navigator, "clipboard", {
    value: {
      writeText: jest.fn(() => Promise.resolve()),
    },
    configurable: true,
  });
}

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = jest.fn();
}

// Vorliq ships dark mode only. Production sets data-theme="dark" on <html> in
// public/index.html; mirror that baseline in the jsdom test document so themed
// CSS variables resolve the same way they do in the browser.
document.documentElement.setAttribute("data-theme", "dark");
