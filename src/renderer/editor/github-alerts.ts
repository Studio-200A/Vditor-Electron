type GitHubAlertType = 'NOTE' | 'TIP' | 'IMPORTANT' | 'WARNING' | 'CAUTION';

const DEFAULT_ALERT_PRESENTATIONS: Readonly<
  Record<GitHubAlertType, { readonly icon: string; readonly title: string }>
> = {
  NOTE: { icon: '✏️', title: 'Note' },
  TIP: { icon: '💡', title: 'Tip' },
  IMPORTANT: { icon: '❗', title: 'Important' },
  WARNING: { icon: '⚠️', title: 'Warning' },
  CAUTION: { icon: '🚨', title: 'Caution' },
};

const ALERT_HEADER = /^(\s*(?:>\s*)+\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\])(?:[ \t]*(.*))?$/;
const FENCE = /^\s*(?:>\s*)*(`{3,}|~{3,})/;

interface GitHubAlertHeader {
  readonly type: GitHubAlertType;
  readonly title: string;
}

function alertHeaders(markdown: string): GitHubAlertHeader[] {
  let fence: { readonly marker: string; readonly length: number } | null = null;
  return markdown.split(/\r?\n/).flatMap((line) => {
    const fenceMatch = line.match(FENCE);
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence.marker && fenceMatch[1].length >= fence.length)
        fence = null;
      return [];
    }
    if (fenceMatch) {
      fence = { marker: fenceMatch[1][0], length: fenceMatch[1].length };
      return [];
    }
    const match = line.match(ALERT_HEADER);
    if (!match) return [];
    return [{ type: match[2] as GitHubAlertType, title: match[3] || '' }];
  });
}

/**
 * Lute 1.7.6 renders a titleless GitHub alert with a visible default title,
 * then serializes that presentation text as Markdown. Retain the titlelessness
 * of alerts that were already present in the document before Vditor rendered it.
 */
export function restoreGitHubAlertHeaders(markdown: string, previousMarkdown: string): string {
  const previousHeaders = alertHeaders(previousMarkdown);
  let headerIndex = 0;
  let fence: { readonly marker: string; readonly length: number } | null = null;

  return markdown
    .split(/(\r?\n)/)
    .map((part) => {
      if (part === '\n' || part === '\r\n') return part;
      const fenceMatch = part.match(FENCE);
      if (fence) {
        if (fenceMatch && fenceMatch[1][0] === fence.marker && fenceMatch[1].length >= fence.length)
          fence = null;
        return part;
      }
      if (fenceMatch) {
        fence = { marker: fenceMatch[1][0], length: fenceMatch[1].length };
        return part;
      }
      const match = part.match(ALERT_HEADER);
      if (!match) return part;

      const previous = previousHeaders[headerIndex++];
      const type = match[2] as GitHubAlertType;
      const title = match[3] || '';
      if (!previous || previous.type !== type) return part;

      const presentation = DEFAULT_ALERT_PRESENTATIONS[type];
      if (!previous.title) {
        const defaultTitle = `${presentation.icon} ${presentation.title}`;
        if (title === defaultTitle) return match[1];
        if (title.startsWith(`${defaultTitle} `)) {
          return `${match[1]} ${title.slice(defaultTitle.length + 1)}`;
        }
        return part;
      }

      // Lute prepends the type icon even when the source supplied a title.
      // Keep a source-supplied icon/title pair intact instead of treating it as
      // presentation text.
      if (previous.title.startsWith(`${presentation.icon} `)) return part;
      const generatedPrefix = `${presentation.icon} `;
      if (!title.startsWith(generatedPrefix)) return part;
      if (title.slice(generatedPrefix.length) !== previous.title) return part;
      return `${match[1]} ${previous.title}`;
    })
    .join('');
}
