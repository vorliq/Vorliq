// Dark, monospace code block with a copy button in the top-right corner and
// light shell-style syntax coloring (comments muted; leading command in teal;
// flags in blue). Theme-aware via the vnext tokens. Reusable for any setup or
// command snippet.
import { useState } from "react";
import { Check, Copy } from "lucide-react";

function highlightLine(line, key) {
  const trimmed = line.trimStart();
  if (trimmed.startsWith("#")) {
    return (
      <span className="vn-code__comment" key={key}>
        {line}
        {"\n"}
      </span>
    );
  }
  const tokens = line.split(/(\s+)/); // keep whitespace tokens
  let seenCommand = false;
  return (
    <span key={key}>
      {tokens.map((token, i) => {
        if (/^\s+$/.test(token) || token === "") {
          return token;
        }
        if (!seenCommand) {
          seenCommand = true;
          return (
            <span className="vn-code__cmd" key={i}>
              {token}
            </span>
          );
        }
        if (token.startsWith("-")) {
          return (
            <span className="vn-code__flag" key={i}>
              {token}
            </span>
          );
        }
        return token;
      })}
      {"\n"}
    </span>
  );
}

export default function CodeBlock({ code, ariaLabel = "Command snippet" }) {
  const [copied, setCopied] = useState(false);
  const lines = String(code || "").replace(/\n$/, "").split("\n");

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(String(code || ""));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard may be blocked; ignore
    }
  }

  return (
    <div className="vn-code" role="group" aria-label={ariaLabel}>
      <button type="button" className="vn-code__copy" onClick={handleCopy} aria-label="Copy commands">
        {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
        {copied ? "Copied" : "Copy"}
      </button>
      <pre className="vn-code__pre">
        <code>{lines.map((line, i) => highlightLine(line, i))}</code>
      </pre>
    </div>
  );
}
