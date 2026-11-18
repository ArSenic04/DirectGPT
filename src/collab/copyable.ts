/** What the baseline "Copy" button puts on the clipboard: the answer body without a leading "Here is …:" line. */
export function copyableText(content: string): string {
  const m = content.match(/^[^\n]{0,80}:\s*\n\s*\n([\s\S]+)$/);
  return (m ? m[1] : content).trim();
}
