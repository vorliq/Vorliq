// First-run guided tour shown on the dashboard for a brand-new wallet. It is a
// non-blocking bottom sheet (mobile) / floating panel (desktop): it never covers
// the main content with a backdrop and never stops the member using the app. It
// walks through the five essential first actions, can be dismissed at any step,
// and remembers its place so it resumes — rather than restarts — when the member
// leaves and comes back.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, X } from "lucide-react";

import {
  TOUR_STEPS,
  completeTour,
  dismissTour,
  resolveTourState,
  setTourStep,
} from "../../helpers/onboarding";

export default function OnboardingTour() {
  const navigate = useNavigate();
  const [state, setState] = useState(() => resolveTourState());

  const active = state?.status === "active";

  // While the tour is open, mark the body so the app shell can add a little
  // extra bottom space and the sheet never hides the last row of content.
  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    document.body.classList.toggle("vn-tour-open", active);
    return () => document.body.classList.remove("vn-tour-open");
  }, [active]);

  if (!active) return null;

  const index = Math.min(state.stepIndex || 0, TOUR_STEPS.length - 1);
  const step = TOUR_STEPS[index];
  const isLast = index === TOUR_STEPS.length - 1;

  const advance = (navigateTo) => {
    if (isLast) {
      setState(completeTour());
    } else {
      setState(setTourStep(index + 1));
    }
    if (navigateTo) navigate(navigateTo);
  };

  const skip = () => setState(dismissTour());

  return (
    <aside className="vn-tour" aria-label="Getting started tour">
      <div className="vn-tour__card">
        <div className="vn-tour__head">
          <span className="vn-tour__step">
            Getting started · Step {index + 1} of {TOUR_STEPS.length}
          </span>
          <button type="button" className="vn-tour__close" onClick={skip} aria-label="Dismiss tour">
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <h3 className="vn-tour__title">{step.title}</h3>
        <p className="vn-tour__body">{step.body}</p>

        <div className="vn-tour__dots" aria-hidden="true">
          {TOUR_STEPS.map((s, i) => (
            <span key={s.id} className={`vn-tour__dot ${i === index ? "is-active" : ""} ${i < index ? "is-done" : ""}`} />
          ))}
        </div>

        <div className="vn-tour__actions">
          <button type="button" className="vn-btn vn-btn--primary vn-tour__cta" onClick={() => advance(step.to)}>
            {step.cta}
            <ArrowRight size={16} aria-hidden="true" />
          </button>
          <button type="button" className="vn-tour__skip" onClick={() => advance(null)}>
            {isLast ? "Finish" : "Next"}
          </button>
        </div>
        <button type="button" className="vn-tour__dismiss" onClick={skip}>
          Skip the tour
        </button>
      </div>
    </aside>
  );
}
