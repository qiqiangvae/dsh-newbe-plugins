/** 日志行切分与脱敏：纯函数，便于单独验证。 */
const ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g;

/**
 * 单行清理：剥 ANSI 转义，并把 `\r` 覆写收敛成最后一次内容（Maven/curl 进度行）。
 * 行尾的 `\r`（CRLF 或"进度刷新到此为止"）不是覆写，要取它前面的内容——
 * 直接取最后一段会把它变成空行。
 */
export function cleanLine(line: string): string {
  const stripped = line.replace(ANSI, '');
  const segments = stripped.split('\r');
  const last = segments[segments.length - 1];
  if (last !== '') return last;
  return segments.length >= 2 ? segments[segments.length - 2] : '';
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

/** 密钥类环境变量名：宿主掩码与界面掩码必须共用这一处判定，规则漂移 = 凭据明文上屏。 */
const SECRET_NAME = /KEY|SECRET|TOKEN|PASSWORD/i;

export function isSecretName(name: string): boolean {
  return SECRET_NAME.test(name);
}
