const topicRules: Array<[string, RegExp]> = [
  ["Lifestyle", /\b(lifestyle|habit|routine|morning|sleep|food|meal|home|personal|weekend)\b/i],
  ["Health", /\b(health|fitness|exercise|workout|medical|wellness|diet|doctor|mental)\b/i],
  ["Finance", /\b(finance|money|budget|saving|investment|payment|billing|price|cost|revenue)\b/i],
  ["Relationships", /\b(family|friend|relationship|partner|team|people|community|customer)\b/i],
  ["Learning", /\b(learn|course|study|book|research|training|lesson|education|read)\b/i],
  ["Travel", /\b(travel|trip|flight|hotel|holiday|vacation|journey|visit)\b/i],
  ["Product", /\b(product|feature|user|ux|roadmap|launch|requirement|feedback)\b/i],
  ["Engineering", /\b(code|api|database|server|client|react|typescript|architecture|bug|deploy|cache|git|test)\b/i],
  ["Work", /\b(work|project|meeting|deadline|office|career|business|strategy)\b/i],
  ["Creativity", /\b(create|design|write|music|art|idea|creative|story|visual)\b/i],
];

export function inferTopic(content: string): string {
  return topicRules.find(([, pattern]) => pattern.test(content))?.[0] ?? "General";
}
