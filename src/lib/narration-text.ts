const pronunciationMap: Record<string, string> = {
  SSO: 'S S O',
  'vs.': 'versus',
};

export function narrationText(title: string, author: string, markdown: string, override?: string | null): string {
  if (override?.trim()) return `${title}. By ${author}.\n\n${plainText(override)}`;
  return `${title}. By ${author}.\n\n${plainText(markdown)}`;
}

export function plainText(markdown: string): string {
  return markdown
    .replace(/<(script|style|iframe|object)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<pre\b[^>]*>[\s\S]*?<\/pre>/gi, 'There is a code example here; see the written post.')
    .replace(/```[\s\S]*?```/g, 'There is a code example here; see the written post.')
    .replace(/~~~[\s\S]*?~~~/g, 'There is a code example here; see the written post.')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, ' ')
    .replace(/<img\b[^>]*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+(.+)$/gm, '$1.')
    .replace(/^\s*[-+*]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/\[\^[^\]]+\]/g, '')
    .replace(/&(?:amp|lt|gt|quot|#39);/g, (entity) => ({ '&amp;': 'and', '&lt;': '', '&gt;': '', '&quot;': '"', '&#39;': "'" }[entity] ?? ''))
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\bSSO\b|\bvs\./g, (match) => pronunciationMap[match] ?? match)
    .trim();
}

export function splitNarration(text: string, maxLength = 4500): string[] {
  if (text.length > 40_000) throw new Error('Narration text exceeds the 40,000 character limit.');
  const paragraphs = text.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  const chunks: string[] = [];
  let chunk = '';
  for (const paragraph of paragraphs) {
    if (paragraph.length > maxLength) {
      const sentences = paragraph.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) ?? [paragraph];
      for (const sentence of sentences) {
        if (sentence.trim().length > maxLength) throw new Error('A single narration sentence exceeds the chunk size limit.');
        const next = chunk ? `${chunk} ${sentence.trim()}` : sentence.trim();
        if (next.length > maxLength && chunk) {
          chunks.push(chunk);
          chunk = sentence.trim();
        } else chunk = next;
      }
      continue;
    }
    const next = chunk ? `${chunk}\n\n${paragraph}` : paragraph;
    if (next.length > maxLength && chunk) {
      chunks.push(chunk);
      chunk = paragraph;
    } else chunk = next;
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

export function slugify(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}
