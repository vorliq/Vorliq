import logo from "../assets/logo.png";

function BrandLoader({ label = "Loading Vorliq", compact = false }) {
  return (
    <div className={`brand-loader ${compact ? "compact" : ""}`} role="status" aria-live="polite">
      <span className="brand-loader-ring" aria-hidden="true">
        <img className="brand-loader-mark" src={logo} alt="" />
      </span>
      <span className="brand-loader-label">{label}</span>
    </div>
  );
}

export default BrandLoader;
