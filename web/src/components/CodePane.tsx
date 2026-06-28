import { useState } from "react";
import { DiffViewer } from "./DiffViewer";
import { FileBrowser } from "./FileBrowser";

type SubTab = "files" | "diff";

export function CodePane({ repoId }: { repoId: string | null }) {
  const [tab, setTab] = useState<SubTab>("files");
  return (
    <div className="pane code-pane">
      <div className="subtabs">
        <button
          className={`subtab ${tab === "files" ? "active" : ""}`}
          onClick={() => setTab("files")}
        >
          Files
        </button>
        <button
          className={`subtab ${tab === "diff" ? "active" : ""}`}
          onClick={() => setTab("diff")}
        >
          Diff
        </button>
      </div>
      <div className="code-body">
        {tab === "files" ? (
          <FileBrowser repoId={repoId} />
        ) : (
          <DiffViewer repoId={repoId} />
        )}
      </div>
    </div>
  );
}
