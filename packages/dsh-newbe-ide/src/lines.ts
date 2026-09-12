/** 日志行切分与脱敏：纯函数，便于单独验证。 */
const ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g;

/** 单行清理：剥 ANSI 转义；`\r` 覆写只保留最后一次内容（Maven 进度行）。 */
export function cleanLine(line: string): string {
  const stripped = line.replace(ANSI, '');
  const carriage = stripped.lastIndexOf('\r');
  return carriage >= 0 ? stripped.slice(carriage + 1) : stripped;
}

/** 把新到的文本块接到半行后面，切出完整行，返回剩余半行。 */
export function splitLines(pending: string, chunk: string): { lines: string[]; pending: string } {
  const parts = (pending + chunk).split('\n');
  const rest = parts.pop() ?? '';
  return { lines: parts.map(cleanLine), pending: rest };
}

/** 把出现过的密钥值替换为 ****；空值忽略（否则会把整行打满）。 */
export function maskSecrets(line: string, secrets: readonly string[]): string {
  let masked = line;
  for (const secret of secrets) {
    if (secret === '' || !masked.includes(secret)) continue;
    masked = masked.split(secret).join('****');
  }
  return masked;
}
