import { useCallback, useEffect, useRef, useState } from "react";

const ONBOARDING_KEY = "vorliq_onboarding_complete";

const steps = [
  {
    title: "Welcome to Vorliq",
    body:
      "Vorliq is a community savings bank running on its own lightweight blockchain. The coin inside the network is called VLQ, and the system runs independently without depending on Ethereum, Bitcoin, or any outside cryptocurrency network.",
  },
  {
    title: "Create Your Wallet",
    body:
      "The first thing to do is visit the Wallet page and create a free wallet. Your wallet gives you a unique address for receiving VLQ. Save your private key safely, because Vorliq cannot recover it if it is lost.",
  },
  {
    title: "Get VLQ",
    body:
      "VLQ is earned by mining blocks on the Mine page. Each block mined earns 50 VLQ as a reward, and that reward appears in your balance after the next block is mined because rewards are added as pending transactions first.",
  },
  {
    title: "Join the Community",
    body:
      "Vorliq is built for community participation. You can lend VLQ to members, trade on the exchange, vote on governance proposals, and connect your node to other people in the network.",
  },
];

const communityLinks = [
  { label: "Discord", href: "https://discord.gg/qpX5sHD4pC" },
  { label: "Telegram", href: "https://t.me/Vorliq" },
  { label: "Reddit", href: "https://www.reddit.com/u/Vorliq/s/PbPMGkrGVS" },
  { label: "GitHub", href: "https://github.com/vorliq/Vorliq" },
  { label: "X", href: "https://x.com/vorliq" },
];

function Onboarding() {
  const modalRef = useRef(null);
  const previousFocusRef = useRef(null);
  const [visible, setVisible] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }

    return window.localStorage.getItem(ONBOARDING_KEY) !== "true";
  });
  const [stepIndex, setStepIndex] = useState(0);

  const completeOnboarding = useCallback(() => {
    window.localStorage.setItem(ONBOARDING_KEY, "true");
    setVisible(false);
  }, []);

  const nextStep = useCallback(() => {
    setStepIndex((current) => {
      if (current === steps.length - 1) {
        completeOnboarding();
        return current;
      }

      return current + 1;
    });
  }, [completeOnboarding]);

  useEffect(() => {
    if (!visible) {
      return undefined;
    }

    previousFocusRef.current = document.activeElement;
    window.setTimeout(() => {
      const firstButton = modalRef.current?.querySelector("button");
      firstButton?.focus();
    }, 0);

    return () => {
      const previous = previousFocusRef.current;
      if (previous && typeof previous.focus === "function") {
        previous.focus();
      }
    };
  }, [visible]);

  useEffect(() => {
    if (!visible) {
      return undefined;
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        completeOnboarding();
      }

      if (event.key === "Enter") {
        event.preventDefault();
        nextStep();
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        setStepIndex((current) => Math.min(current + 1, steps.length - 1));
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setStepIndex((current) => Math.max(current - 1, 0));
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [completeOnboarding, nextStep, visible]);

  if (!visible) {
    return null;
  }

  const step = steps[stepIndex];
  const isLastStep = stepIndex === steps.length - 1;

  return (
    <div
      className="onboarding-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      aria-describedby="onboarding-description"
    >
      <section className="onboarding-modal" ref={modalRef}>
        <button className="onboarding-skip" type="button" onClick={completeOnboarding}>
          Skip
        </button>
        <span className="eyebrow">Getting Started</span>
        <div className="onboarding-progress" aria-live="polite">
          Step {stepIndex + 1} of {steps.length}
        </div>
        <h2 id="onboarding-title">{step.title}</h2>
        <p id="onboarding-description">{step.body}</p>
        {isLastStep && (
          <div className="onboarding-links">
            {communityLinks.map((link) => (
              <a href={link.href} target="_blank" rel="noreferrer" key={link.href}>
                {link.label}
              </a>
            ))}
          </div>
        )}
        <div className="onboarding-footer">
          <span aria-hidden="true">
            Step {stepIndex + 1} of {steps.length}
          </span>
          <button className="button" type="button" onClick={nextStep}>
            {isLastStep ? "Get Started" : "Next"}
          </button>
        </div>
      </section>
    </div>
  );
}

export { ONBOARDING_KEY };
export default Onboarding;
