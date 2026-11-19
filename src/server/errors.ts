import "server-only";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
    readonly headers?: Record<string, string>,
  ) {
    super(message);
  }
}

export const notFound = () => new ApiError(404, "NOT_FOUND", "Recurso não encontrado.");
export const unauthenticated = () => new ApiError(401, "UNAUTHENTICATED", "Entre para continuar.");
export const invalidCredentials = () => new ApiError(401, "INVALID_CREDENTIALS", "Credenciais inválidas.");
export const weakPassword = () =>
  new ApiError(422, "WEAK_PASSWORD", "A senha deve ter de 5 a 128 caracteres.");
