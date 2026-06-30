import { FileBrowser } from "./FileBrowser";

export function CodePane({ repoId }: { repoId: string | null }) {
  return (
    <div className="pane code-pane">
      <div className="code-body">
        <FileBrowser repoId={repoId} />
      </div>
    </div>
  );
}
