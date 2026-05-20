import { useState } from "react";
import { toast } from "react-toastify";

import api from "../helpers/api";
import { apiErrorMessage } from "../helpers/errors";

const reasons = [
  ["spam", "Spam"],
  ["impersonation", "Impersonation"],
  ["abuse", "Abuse"],
  ["scam", "Scam"],
  ["illegal_content", "Illegal content"],
  ["other", "Other"],
];

function ReportButton({ targetType, targetId, defaultReporter = "" }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("spam");
  const [description, setDescription] = useState("");
  const [reportedBy, setReportedBy] = useState(defaultReporter);
  const [submitting, setSubmitting] = useState(false);

  async function submitReport(event) {
    event.preventDefault();
    setSubmitting(true);
    try {
      await api.post("/reports", {
        target_type: targetType,
        target_id: targetId,
        reason,
        description,
        reported_by: reportedBy || "anonymous",
      });
      toast.success("Report submitted for moderator review.");
      setOpen(false);
      setDescription("");
    } catch (error) {
      toast.error(apiErrorMessage(error, "Unable to submit report."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="report-control">
      <button className="button secondary small-button" type="button" onClick={() => setOpen((value) => !value)}>
        Report
      </button>
      {open && (
        <form className="report-modal" onSubmit={submitReport} aria-label="Report content">
          <label>
            Reason
            <select className="input" value={reason} onChange={(event) => setReason(event.target.value)}>
              {reasons.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
            </select>
          </label>
          <label>
            Description
            <textarea className="textarea" value={description} maxLength={1000} onChange={(event) => setDescription(event.target.value)} required />
          </label>
          <label>
            Reporter wallet address optional
            <input className="input" value={reportedBy} maxLength={160} onChange={(event) => setReportedBy(event.target.value)} />
          </label>
          <p className="help-text">Reports create a review queue only. Content is not removed automatically.</p>
          <div className="button-row">
            <button className="button" type="submit" disabled={submitting}>{submitting ? "Submitting..." : "Submit Report"}</button>
            <button className="button secondary" type="button" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}

export default ReportButton;
