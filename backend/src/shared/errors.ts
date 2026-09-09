export class AppError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found') {
    super(404, message);
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Bad request') {
    super(400, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(403, message);
  }
}
