/** Base class for errors that carry a user-presentable message. */
export class AppError extends Error {
  readonly userMessage: string;

  constructor(message: string, userMessage?: string, options?: { cause?: unknown }) {
    super(message, options as ErrorOptions);
    this.name = new.target.name;
    this.userMessage = userMessage ?? message;
  }
}

export class ImportValidationError extends AppError {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(
      `Take import failed validation: ${issues.join('; ')}`,
      'This file is not a valid PoKeyBoard take.',
    );
    this.issues = issues;
  }
}

export class StorageError extends AppError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, 'Saving to this browser failed. Your latest change may not be stored.', options);
  }
}

export class QuotaExceededStorageError extends StorageError {
  constructor(options?: { cause?: unknown }) {
    super('IndexedDB quota exceeded', options);
  }
}

export class AudioUnavailableError extends AppError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, 'Audio could not be started in this browser.', options);
  }
}

export class ExportError extends AppError {
  constructor(message: string, userMessage?: string, options?: { cause?: unknown }) {
    super(message, userMessage ?? 'Audio export failed.', options);
  }
}

export function toUserMessage(error: unknown): string {
  if (error instanceof AppError) return error.userMessage;
  if (error instanceof Error) return error.message;
  return 'Something went wrong.';
}
