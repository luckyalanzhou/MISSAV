// Search aliases are separate from the video's identity and subtitle file key.
export function extractSubtitleSearchCode(value: string): string {
  const code = value.trim().toUpperCase().replace(/[\s_\u2010-\u2015\u2212\uFF0D]+/g, "-")
  // Keep FC2-PPV and numeric release identifiers intact. Textual version flags
  // such as UNCENSORED-LEAK are not part of the base subtitle search code.
  const match = code.match(/^((?:FC2-PPV|[A-Z0-9]{2,16})-\d{1,16}(?:-\d{1,16})?)(?=$|-[A-Z])/)
  return match?.[1] ?? code
}
