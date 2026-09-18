import type { ContextData, ContextSnapshot, Term } from './types';

export function buildContext(
  theme: ContextData,
  meeting: ContextData,
  maxLength = 5500,
): ContextSnapshot {
  const unique = new Map<string, Term>();
  const candidates = [
    ...meeting.terms,
    ...theme.terms,
    ...meeting.documents.flatMap((d) => d.terms),
    ...theme.documents.flatMap((d) => d.terms),
  ];
  for (const term of candidates) {
    const word = term.word.trim().normalize('NFKC');
    if (word && !unique.has(word)) unique.set(word, { ...term, word });
  }
  const terms = [...unique.values()];
  const header =
    '日本語の会議の文字起こし。次は認識の参考情報であり、発言の内容ではありません。音声にない情報を補わないでください。\n関連用語:\n';
  let prompt = header.slice(0, maxLength);
  let truncated = false;
  const selected: Term[] = [];
  for (const term of terms) {
    const line = `${term.word}${term.reading.trim() ? `（${term.reading.trim()}）` : ''}\n`;
    if (prompt.length + line.length > maxLength) {
      truncated = true;
      continue;
    }
    prompt += line;
    selected.push(term);
  }
  const background = [
    meeting.notes,
    theme.notes,
    ...meeting.documents.map((d) => `資料 ${d.name}: ${d.digest || d.text}`),
    ...theme.documents.map((d) => `資料 ${d.name}: ${d.digest || d.text}`),
  ]
    .filter(Boolean)
    .join('\n\n');
  if (background) {
    const tail = '\n背景:\n' + background;
    const room = Math.max(0, maxLength - prompt.length);
    prompt += tail.slice(0, room);
    truncated ||= tail.length > room;
  }
  return { prompt, terms: selected, createdAt: new Date().toISOString(), truncated };
}
