import {
  THEME_STORAGE_KEY,
  THEMES,
  getStoredTheme,
  applyTheme,
  setStoredTheme,
  toggleTheme,
} from "./theme";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

describe("getStoredTheme", () => {
  test("defaults to dark when nothing is stored", () => {
    expect(getStoredTheme()).toBe("dark");
  });
  test("returns a valid stored theme", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    expect(getStoredTheme()).toBe("light");
  });
  test("falls back to dark for an invalid stored value", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "neon");
    expect(getStoredTheme()).toBe("dark");
  });
});

describe("applyTheme", () => {
  test("sets the data-theme attribute on <html>", () => {
    applyTheme("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });
  test("an unknown theme falls back to the default", () => {
    expect(applyTheme("bogus")).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });
});

describe("setStoredTheme", () => {
  test("persists and applies a valid theme", () => {
    setStoredTheme("light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });
});

describe("toggleTheme", () => {
  test("flips dark to light and back", () => {
    setStoredTheme("dark");
    expect(toggleTheme()).toBe("light");
    expect(toggleTheme()).toBe("dark");
  });
});

test("THEMES contains exactly dark and light", () => {
  expect(THEMES).toEqual(["dark", "light"]);
});
