import { print as printQuery } from "@0no-co/graphql.web";
import { captureException, init } from "@sentry/react";
import { isNotNullish, isNullish } from "@swan-io/lake/src/utils/nullish";
import { P, match } from "ts-pattern";
import { CombinedError, Operation, OperationContext } from "urql";
import { env } from "./env";
import { isCombinedError } from "./urql";

export const initSentry = () => {
  init({
    enabled: import.meta.env.PROD && env.IS_SWAN_MODE,
    release: env.VERSION,
    dsn: "TODO",
    normalizeDepth: 5,

    environment: match({
      dev: import.meta.env.DEV,
      url: env.PAYMENT_URL,
    })
      .with({ dev: true }, () => "dev")
      .with({ url: P.string.includes("master") }, () => "master")
      .with({ url: P.string.includes("preprod") }, () => "preprod")
      .otherwise(() => "prod"),
  });
};

const getOperationContextHeaders = (context: OperationContext): Record<string, string> => {
  const { headers } =
    typeof context.fetchOptions === "function"
      ? context.fetchOptions()
      : context.fetchOptions ?? {};

  if (isNullish(headers)) {
    return {};
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }
  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }

  return headers;
};

export const logFrontendError = (exception: unknown, extra?: Record<string, unknown>) => {
  if (!isCombinedError(exception)) {
    captureException(exception, {
      extra,
      tags: { scope: "frontend" },
    });
  }
};

export const logBackendError = (
  { graphQLErrors }: CombinedError,
  { context, query, variables }: Operation,
) => {
  if (graphQLErrors.length === 0) {
    return;
  }

  const headers = getOperationContextHeaders(context);
  const existingHeaders = Object.keys(headers).filter(key => isNotNullish(headers[key]));
  const requestId = headers["x-swan-request-id"];

  graphQLErrors
    .filter(({ message }) => {
      const lowerCased = message.toLowerCase();

      return (
        !lowerCased.includes("unauthenticated") &&
        !lowerCased.includes("unauthorized") &&
        !lowerCased.includes("cannot return null for non-nullable field")
      );
    })
    .forEach(({ message }) => {
      // Update the error message to prepend the requestId
      const error = new Error(isNotNullish(requestId) ? `${requestId} - ${message}` : message);
      error.name = "GraphQLError";

      captureException(error, {
        tags: {
          scope: "backend",
          endpoint: context.url,
        },
        extra: {
          headers: existingHeaders,
          query: printQuery(query),
          requestPolicy: context.requestPolicy,
          suspense: context.suspense,
          variables,
        },
      });
    });
};
