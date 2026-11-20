import "server-only";
import { ApiError } from "@feito/core/product/errors";

export { ApiError, notFound } from "@feito/core/product/errors";

export const unauthenticated = () => new ApiError(401, "UNAUTHENTICATED", "Entre para continuar.");
export const invalidCredentials = () => new ApiError(401, "INVALID_CREDENTIALS", "Credenciais inválidas.");
export const weakPassword = () =>
  new ApiError(422, "WEAK_PASSWORD", "A senha deve ter de 5 a 128 caracteres.");
