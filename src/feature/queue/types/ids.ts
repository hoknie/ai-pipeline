function base36(value: number, width: number): string {
  return Math.floor(value).toString(36).padStart(width, '0').slice(-width);
}

export function queueItemId(nowMillis: number, random: number): string {
  return `q${base36(nowMillis, 8)}${base36(random % 36 ** 3, 3)}`;
}
