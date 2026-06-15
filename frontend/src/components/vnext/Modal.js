// Minimal centered modal: backdrop click + Escape to close, focus returned to
// the body, scroll handling left simple. Reused by the Receive flow.
import { useEffect } from "react";
import { X } from "lucide-react";

export default function Modal({ title, onClose, children }) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="vn-modal-backdrop" onClick={onClose}>
      <div
        className="vn-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="vn-modal__head">
          <h2 className="vn-panel-title" style={{ margin: 0 }}>
            {title}
          </h2>
          <button type="button" className="vn-theme-toggle" aria-label="Close" onClick={onClose}>
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
