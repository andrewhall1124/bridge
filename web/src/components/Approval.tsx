import { useState } from "react";
import type { PendingApproval } from "../hooks";

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

  return (
    <div className="approval-card">
      <div className="approval-head">
        <span className="approval-badge">approval</span>
        <span className="approval-tool">{approval.toolName}</span>
      </div>
      <pre className="approval-input">
        {JSON.stringify(approval.input, null, 2)}
      </pre>
      {showReject ? (
        <div className="approval-reject">
          <input
            type="text"
            placeholder="Reason (optional)"
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
              Confirm reject
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
            Approve
          </button>
          <button className="btn btn-danger" onClick={() => setShowReject(true)}>
            Reject
          </button>
        </div>
      )}
    </div>
  );
}
