const SENSITIVE_KEYS = [
  'password', 'passwd', 'secret', 'token', 'authorization',
  'access_token', 'refresh_token', 'apiKey', 'api_key',
  'credit_card', 'ssn', 'cvv',
];

const SENSITIVE_PATTERN = new RegExp(
  `("(?:${SENSITIVE_KEYS.join('|')})"\\s*:\\s*)"[^"]*"`,
  'gi',
);

export function maskSensitiveData(data: unknown): unknown {
  if (typeof data === 'string') {
    return data.replace(SENSITIVE_PATTERN, '$1"[REDACTED]"');
  }
  if (typeof data === 'object' && data !== null) {
    const masked: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      masked[key] = SENSITIVE_KEYS.some((k) =>
        key.toLowerCase().includes(k),
      )
        ? '[REDACTED]'
        : maskSensitiveData(value);
    }
    return masked;
  }
  return data;
}