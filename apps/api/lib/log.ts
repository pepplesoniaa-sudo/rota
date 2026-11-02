import pino from 'pino';

export const logger = pino({
  level: process.env.NODE_ENV === 'test' ? 'silent' : 'info',
  redact: {
    paths: [
      'password',
      'newPassword',
      'token',
      'refreshToken',
      'authorization',
      'verif-hash',
      'cardLast4',
      'providerTokenEncrypted',
      '*.password',
      '*.newPassword',
      '*.token',
      '*.refreshToken',
      '*.authorization',
      '*["verif-hash"]',
    ],
    censor: '[REDACTED]',
  },
});
