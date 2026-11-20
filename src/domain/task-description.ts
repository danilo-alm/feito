export function taskDescriptionExcerpt(description: string) {
  const line = description.split(/\r\n|\n|\r/).map((entry) => entry.trim()).find(Boolean);
  return line ? [...line].slice(0, 140).join("") : null;
}
