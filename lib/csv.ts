// Keep ordinary text intact; neutralize spreadsheet formula/control prefixes.
// Quoting and doubled quotes prevent values from breaking into another cell.
// See https://owasp.org/www-community/attacks/CSV_Injection
export function csvCell(value: string) {
  const risky = /^[\t\r\n]/.test(value) || /^[ \t\r\n]*[=+@\-＝＋－＠]/.test(value);
  const safe = risky ? "'" + value : value;
  return '"' + safe.replaceAll('"', '""') + '"';
}
