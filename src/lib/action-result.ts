export type ActionSuccess<T> = { ok: true; data: T; message?: string };
export type ActionFailure = { ok: false; error: string; fieldErrors?: Record<string, string[]>; code?: string };
export type ActionResult<T = null> = ActionSuccess<T> | ActionFailure;

export function ok<T>(data: T, message?: string): ActionSuccess<T> {
  return { ok: true, data, message };
}

export function fail(error: string, extra?: Partial<Omit<ActionFailure, "ok" | "error">>): ActionFailure {
  return { ok: false, error, ...extra };
}

export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string = "APP_ERROR",
    public readonly status: number = 400,
    public readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class NotFoundError extends AppError {
  constructor(what = "Resource") {
    super(`${what} not found`, "NOT_FOUND", 404);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to do this") {
    super(message, "FORBIDDEN", 403);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Please sign in") {
    super(message, "UNAUTHORIZED", 401);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, fieldErrors?: Record<string, string[]>) {
    super(message, "VALIDATION", 422, fieldErrors);
  }
}

export function toActionFailure(err: unknown): ActionFailure {
  if (err instanceof AppError) return fail(err.message, { code: err.code, fieldErrors: err.fieldErrors });
  if (err instanceof Error) return fail(err.message, { code: "ERROR" });
  return fail("Unexpected error", { code: "ERROR" });
}
