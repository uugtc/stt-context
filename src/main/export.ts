import type { Meeting } from '../shared/types';
import { formatTime } from '../shared/segments';
export function exportText(meeting: Meeting, markdown: boolean): string {
  const heading = (level: number, text: string) =>
    `${markdown ? '#'.repeat(level) + ' ' : ''}${text}\n`;
  let output = heading(1, meeting.title) + `${meeting.createdAt}\n\n`;
  if (meeting.summary) {
    output +=
      heading(2, meeting.summaryStale ? '要約（文字起こし更新前）' : '要約') +
      meeting.summary.overview +
      '\n\n';
    for (const [title, entries] of [
      ['主な論点', meeting.summary.topics],
      ['決定事項', meeting.summary.decisions],
      ['次の行動', meeting.summary.actions],
      ['未決事項', meeting.summary.questions],
    ] as const) {
      if (!entries.length) continue;
      output += heading(3, title);
      for (const entry of entries) {
        output += `- ${entry.text}`;
        if ('owner' in entry)
          output += `（担当: ${entry.owner || '未指定'} / 期限: ${entry.due || '未指定'}）`;
        const refs = entry.evidence
          .map((id) => meeting.segments.find((s) => s.id === id))
          .filter(Boolean)
          .map((s) => formatTime(s!.start));
        output += refs.length ? ` [${refs.join(', ')}]\n` : '\n';
      }
      output += '\n';
    }
  }
  output += heading(2, '文字起こし');
  for (const s of meeting.segments)
    output += `[${formatTime(s.start)}] ${meeting.speakerNames[s.speaker] || s.speaker}\n${s.text}\n\n`;
  return output;
}
