// Extract quick-reply options from AI response text.
// Looks for patterns like [Option A] [Option B] [Option C].
// Markdown links like [text](url) are kept as plain text, not chips.
export function extractOptions(text: string): { clean: string; options: string[] } {
  const withoutLinks = text.replace(/\[([^\[\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1: $2");
  const optionRegex = /\[([^\[\]\n]{1,60})\]/g;
  const options: string[] = [];
  let match;
  while ((match = optionRegex.exec(withoutLinks)) !== null) {
    const opt = match[1].trim();
    if (opt && !options.includes(opt)) options.push(opt);
  }
  const clean = withoutLinks
    .replace(optionRegex, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { clean, options };
}

/** Normalise a chip / typed message for matching: drop emoji & punctuation, lowercase. */
export function normalize(text: string) {
  return text
    .replace(/[^\p{L}\p{N}\s₹-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
