/** Parse a captured/live Server-Sent Events response into JSON data records. Comments,
 * retry directives, ids, and blank separators are protocol metadata rather than payload. */
export function parseJsonSse(contents: string): unknown[] {
  const records: unknown[] = [];
  let dataLines: string[] = [];

  const flush = (): void => {
    if (dataLines.length === 0) return;
    const payload = dataLines.join("\n");
    dataLines = [];
    records.push(JSON.parse(payload));
  };

  for (const rawLine of contents.split(/\r?\n/)) {
    if (rawLine === "") {
      flush();
      continue;
    }
    if (rawLine.startsWith(":")) continue;
    const colon = rawLine.indexOf(":");
    const field = colon < 0 ? rawLine : rawLine.slice(0, colon);
    let value = colon < 0 ? "" : rawLine.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") dataLines.push(value);
  }
  flush();
  return records;
}
