/** Small, offline markdown renderer for skill-field previews. Escapes HTML first. */

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function inline(text) {
  return String(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(?!\s)([^*]+?)\*/g, "<em>$1</em>");
}

export function renderMarkdown(src) {
  const lines = escapeHtml(src).split(/\r?\n/);
  const out = [];
  let list = null;

  const flush = () => {
    if (!list) return;
    out.push(list === "ul" ? "</ul>" : "</ol>");
    list = null;
  };

  const open = (kind) => {
    if (list === kind) return;
    flush();
    out.push(kind === "ul" ? "<ul>" : "<ol>");
    list = kind;
  };

  for (const raw of lines) {
    const heading = /^(#{1,4})\s+(.+)$/.exec(raw);
    if (heading) {
      flush();
      const n = heading[1].length;
      out.push(`<h${n}>${inline(heading[2])}</h${n}>`);
      continue;
    }
    const ul = /^[-*]\s+(.+)$/.exec(raw);
    if (ul) {
      open("ul");
      out.push(`<li>${inline(ul[1])}</li>`);
      continue;
    }
    const ol = /^\d+[.)]\s+(.+)$/.exec(raw);
    if (ol) {
      open("ol");
      out.push(`<li>${inline(ol[1])}</li>`);
      continue;
    }
    if (!raw.trim()) {
      flush();
      continue;
    }
    flush();
    out.push(`<p>${inline(raw)}</p>`);
  }
  flush();
  return out.join("") || "<p></p>";
}
