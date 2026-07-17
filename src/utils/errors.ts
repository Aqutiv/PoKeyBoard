import type { ErrorMessageKey } from '@/i18n/types';

/**
 * Base class for errors that carry a user-presentable message. Each error also
 * carries a stable `messageKey` so the UI can translate it at the render site;
 * `userMessage` remains the English fallback (logs, non-React callers).
 */
export class AppError extends Error {
  readonly userMessage: string;
  readonly messageKey: ErrorMessageKey;

  constructor(
    message: string,
    userMessage: string,
    messageKey: ErrorMessageKey,
    options?: { cause?: unknown },
  ) {
    super(message, options as ErrorOptions);
    this.name = new.target.name;
    this.userMessage = userMessage;
    this.messageKey = messageKey;
  }
}

export class ImportValidationError extends AppError {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(
      `Take import failed validation: ${issues.join('; ')}`,
      'This file is not a valid PoKeyBoard take.',
      'notValidTake',
    );
    this.issues = issues;
  }
}

export class StorageError extends AppError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(
      message,
      'Saving to this browser failed. Your latest change may not be stored.',
      'storageFailed',
      options,
    );
  }
}

export class QuotaExceededStorageError extends StorageError {
  constructor(options?: { cause?: unknown }) {
    super('IndexedDB quota exceeded', options);
  }
}

export class AudioUnavailableError extends AppError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, 'Audio could not be started in this browser.', 'audioUnavailable', options);
  }
}

export class ExportError extends AppError {
  constructor(
    message: string,
    userMessage = 'Audio export failed.',
    messageKey: ErrorMessageKey = 'exportFailed',
    options?: { cause?: unknown },
  ) {
    super(message, userMessage, messageKey, options);
  }
}

export function toUserMessage(error: unknown): string {
  if (error instanceof AppError) return error.userMessage;
  if (error instanceof Error) return error.message;
  return 'Something went wrong.';
}

/** Stable message key for translating a caught error at the render site. */
export function toErrorMessageKey(error: unknown): ErrorMessageKey {
  if (error instanceof AppError) return error.messageKey;
  return 'generic';
}
