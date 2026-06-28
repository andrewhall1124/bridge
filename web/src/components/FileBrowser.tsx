import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { FileContent, FileEntry } from "../protocol";

interface Props {
  repoId: string | null;
}

interface DirNode {
  entries: FileEntry[];
  open: boolean;
  loading: boolean;
}

export function FileBrowser({ repoId }: Props) {
  // map of dir path -> node ("" is the root)
  const [dirs, setDirs] = useState<Record<string, DirNode>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [file, setFile] = useState<FileContent | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDir = useCallback(
    async (path: string) => {
      if (!repoId) return;
      setDirs((d) => ({
        ...d,
        [path]: { entries: d[path]?.entries ?? [], open: true, loading: true },
      }));
      try {
        const res = await api.listFiles(repoId, path);
        setDirs((d) => ({
          ...d,
          [path]: { entries: res.entries, open: true, loading: false },
        }));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setDirs((d) => ({
          ...d,
          [path]: { entries: [], open: true, loading: false },
        }));
      }
    },
    [repoId]
  );

  useEffect(() => {
    setDirs({});
    setSelected(null);
    setFile(null);
    setError(null);
    if (repoId) void loadDir("");
  }, [repoId, loadDir]);

  function toggleDir(path: string) {
    const node = dirs[path];
    if (node?.open) {
      setDirs((d) => ({ ...d, [path]: { ...node, open: false } }));
    } else if (node && node.entries.length > 0) {
      setDirs((d) => ({ ...d, [path]: { ...node, open: true } }));
    } else {
      void loadDir(path);
    }
  }

  async function openFile(path: string) {
    if (!repoId) return;
    setSelected(path);
    setFileLoading(true);
    setFile(null);
    try {
      const res = await api.readFile(repoId, path);
      setFile(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setFileLoading(false);
    }
  }

  function renderDir(path: string, depth: number) {
    const node = dirs[path];
    if (!node || !node.open) return null;
    if (node.loading && node.entries.length === 0) {
      return (
        <div className="tree-loading subtle" style={{ paddingLeft: depth * 14 }}>
          loading…
        </div>
      );
    }
    return node.entries
      .slice()
      .sort((a, b) =>
        a.type === b.type
          ? a.name.localeCompare(b.name)
          : a.type === "dir"
          ? -1
          : 1
      )
      .map((entry) => {
        const isDir = entry.type === "dir";
        const childOpen = dirs[entry.path]?.open;
        return (
          <div key={entry.path}>
            <button
              className={`tree-row ${
                selected === entry.path ? "selected" : ""
              }`}
              style={{ paddingLeft: 8 + depth * 14 }}
              onClick={() =>
                isDir ? toggleDir(entry.path) : void openFile(entry.path)
              }
            >
              <span className="tree-icon">
                {isDir ? (childOpen ? "📂" : "📁") : "📄"}
              </span>
              <span className="tree-name">{entry.name}</span>
            </button>
            {isDir && renderDir(entry.path, depth + 1)}
          </div>
        );
      });
  }

  if (!repoId) {
    return <div className="empty-state subtle">No repo selected.</div>;
  }

  return (
    <div className="file-browser">
      <div className="file-tree">
        {error && <div className="system-line error">⚠ {error}</div>}
        {renderDir("", 0)}
      </div>
      <div className="file-view">
        {!selected && <div className="empty-state subtle">Select a file.</div>}
        {selected && (
          <>
            <div className="file-view-head">{selected}</div>
            {fileLoading && <div className="subtle">Loading…</div>}
            {file?.binary && (
              <div className="empty-state subtle">Binary file — not shown.</div>
            )}
            {file && !file.binary && (
              <pre className="file-content">
                <code>{file.content}</code>
                {file.truncated && (
                  <div className="subtle">… (truncated)</div>
                )}
              </pre>
            )}
          </>
        )}
      </div>
    </div>
  );
}
