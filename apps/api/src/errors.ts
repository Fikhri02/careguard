export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super("not_found", message);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super("conflict", message);
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super("validation_error", message);
  }
}
