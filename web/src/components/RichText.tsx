// Dependency-free, whitespace-preserving renderer with light fenced-code
// (```...```) support. No markdown library.

interface Segment {
  kind: "text" | "code";
  lang?: string;
  body: string;
}

function parse(input: string): Segment[] {
  const segments: Segment[] = [];
  const fence = /```([^\n`]*)\n?([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(input)) !== null) {
    if (m.index > last) {
      segments.push({ kind: "text", body: input.slice(last, m.index) });
    }
    segments.push({
      kind: "code",
      lang: (m[1] ?? "").trim() || undefined,
      body: m[2] ?? "",
    });
    last = fence.lastIndex;
  }
  if (last < input.length) {
    segments.push({ kind: "text", body: input.slice(last) });
  }
  if (segments.length === 0) segments.push({ kind: "text", body: input });
  return segments;
}

export function RichText({ text }: { text: string }) {
  const segments = parse(text);
  return (
    <>
      {segments.map((seg, i) =>
        seg.kind === "code" ? (
          <pre key={i} className="code-fence">
            {seg.lang && <span className="code-lang">{seg.lang}</span>}
            <code>{seg.body.replace(/\n$/, "")}</code>
          </pre>
        ) : (
          <span key={i} className="rich-text">
            {seg.body}
          </span>
        )
      )}
    </>
  );
}
