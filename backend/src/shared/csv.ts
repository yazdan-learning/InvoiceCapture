function escapeCsvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const lines = [headers, ...rows].map((row) =>
    row.map((cell) => escapeCsvCell(cell === null || cell === undefined ? '' : String(cell))).join(',')
  );
  return lines.join('\n');
}
