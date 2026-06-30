import { useState } from "react";
import type { PendingApproval } from "../hooks";
import { Markdown } from "./Markdown";

interface Props {
  approval: PendingApproval;
  onRespond: (
    requestId: string,
    decision: "allow" | "deny",
    message?: string
  ) => void;
}

export function Approval({ approval, onRespond }: Props) {
  const [showReject, setShowReject] = useState(false);
  const [reason, setReason] = useState("");

  // ExitPlanMode asks the owner to sign off on a markdown plan — render the plan
  // itself rather than a raw JSON dump.
  const isPlan = approval.toolName === "ExitPlanMode";
  const plan = typeof approval.input.plan === "string" ? approval.input.plan : "";

  return (
    <div className="approval-card">
      <div className="approval-head">
        <span className="approval-badge">{isPlan ? "plan" : "approval"}</span>
        <span className="approval-tool">{isPlan ? "ExitPlanMode" : approval.toolName}</span>
      </div>
      {isPlan ? (
        <div className="approval-plan">
          <Markdown text={plan} />
        </div>
      ) : (
        <pre className="approval-input">
          {JSON.stringify(approval.input, null, 2)}
        </pre>
      )}
      {showReject ? (
        <div className="approval-reject">
          <input
            type="text"
            placeholder={isPlan ? "What to change (optional)" : "Reason (optional)"}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            autoFocus
          />
          <div className="approval-actions">
            <button
              className="btn btn-danger"
              onClick={() =>
                onRespond(approval.requestId, "deny", reason || undefined)
              }
            >
              {isPlan ? "Confirm: keep planning" : "Confirm reject"}
            </button>
            <button className="btn" onClick={() => setShowReject(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="approval-actions">
          <button
            className="btn btn-primary"
            onClick={() => onRespond(approval.requestId, "allow")}
          >
            {isPlan ? "Approve plan" : "Approve"}
          </button>
          <button className="btn btn-danger" onClick={() => setShowReject(true)}>
            {isPlan ? "Keep planning" : "Reject"}
          </button>
        </div>
      )}
    </div>
  );
}
