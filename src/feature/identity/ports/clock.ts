export interface Clock {
  now(): number;
}

export interface Random {
  /** `size` random bytes as base64url text. */
  token(size: number): string;
  id(): string;
}
