import {
  TOUR_STEPS,
  completeTour,
  dismissTour,
  markWalletCreated,
  resolveTourState,
  setTourStep,
} from "./onboarding";

const STATE_KEY = "vorliq_onboarding_v1";
const PENDING_KEY = "vorliq_onboarding_pending";

beforeEach(() => {
  window.localStorage.clear();
});

test("TOUR_STEPS lists the five essential first actions with routes", () => {
  expect(TOUR_STEPS).toHaveLength(5);
  TOUR_STEPS.forEach((step) => {
    expect(step.id).toBeTruthy();
    expect(step.title).toBeTruthy();
    expect(step.body).toBeTruthy();
    expect(step.to.startsWith("/")).toBe(true);
  });
});

test("a freshly created wallet starts the tour exactly once", () => {
  markWalletCreated();
  expect(window.localStorage.getItem(PENDING_KEY)).toBe("true");

  // First dashboard visit consumes the pending flag and activates the tour.
  const state = resolveTourState();
  expect(state).toEqual({ status: "active", stepIndex: 0 });
  expect(window.localStorage.getItem(PENDING_KEY)).toBeNull();

  // A later visit returns the stored state, and never re-pends.
  expect(resolveTourState()).toEqual({ status: "active", stepIndex: 0 });
});

test("resolveTourState returns null with no pending flag and no stored state", () => {
  expect(resolveTourState()).toBeNull();
});

test("markWalletCreated does not re-pend when a tour state already exists", () => {
  setTourStep(2);
  markWalletCreated();
  expect(window.localStorage.getItem(PENDING_KEY)).toBeNull();
});

test("resolveTourState returns the stored state verbatim when present", () => {
  setTourStep(3);
  expect(resolveTourState()).toEqual({ status: "active", stepIndex: 3 });
});

test("setTourStep persists an active tour at the given step", () => {
  expect(setTourStep(4)).toEqual({ status: "active", stepIndex: 4 });
  expect(JSON.parse(window.localStorage.getItem(STATE_KEY))).toEqual({ status: "active", stepIndex: 4 });
});

test("dismissTour marks dismissed and preserves the current step", () => {
  setTourStep(2);
  expect(dismissTour()).toEqual({ status: "dismissed", stepIndex: 2 });
});

test("completeTour marks completed at the end of the tour", () => {
  setTourStep(1);
  expect(completeTour()).toEqual({ status: "completed", stepIndex: TOUR_STEPS.length });
});
