export function bodyWithTags(markdownBody: string, tags: string[]): string {
  if (!tags.length) {
    return markdownBody;
  }
  return `${markdownBody}\n\n---\nTags: ${tags.join(", ")}`;
}

export function markdownToHtml(markdown: string): string {
  const lines = markdown.replace(/\r?\n/g, "\n").split("\n");
  const html: string[] = [];
  let listItems: string[] = [];

  const flushList = () => {
    if (!listItems.length) {
      return;
    }
    html.push(`<ul>${listItems.map((item) => `<li>${inlineMarkdown(item)}</li>`).join("")}</ul>`);
    listItems = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushList();
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      flushList();
      const level = heading[1].length;
      html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    const bullet = /^[-*]\s+(.+)$/.exec(line);
    if (bullet) {
      listItems.push(bullet[1]);
      continue;
    }

    flushList();
    html.push(`<p>${inlineMarkdown(line)}</p>`);
  }

  flushList();

  return [
    "<!doctype html>",
    '<html><body style="font-family: Arial, sans-serif; color: #202124; line-height: 1.45;">',
    html.join(""),
    "</body></html>",
  ].join("");
}

function inlineMarkdown(value: string): string {
  return escapeHtml(value).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
