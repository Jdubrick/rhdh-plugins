/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { LoggerService } from '@backstage/backend-plugin-api';

import type { Response as ExpressResponse } from 'express';

import { DEFAULT_HISTORY_LENGTH, SKIP_USER_ID_ENDPOINTS } from './constant';

/**
 * Interface for Lightspeed Core Service error response structure
 */
export interface LCSErrorResponse {
  error?: {
    message?: string;
  };
  detail?: {
    cause?: string;
  };
}

/**
 * Sanitizes Lightspeed Core Service (LCS) error responses to prevent
 * information disclosure. Logs full error details server-side for debugging
 * while returning only generic messages to clients.
 *
 * @param errorBody - The error response body from LCS
 * @param logger - Logger instance for server-side logging
 * @param context - Context string describing the operation (e.g., "sending feedback")
 * @returns Generic error message safe to return to clients
 */
export function sanitizeLCSError(
  errorBody: LCSErrorResponse,
  logger: LoggerService,
  context: string,
): string {
  // Log full error details server-side for debugging
  logger.error(
    `Error from lightspeed-core server while ${context}: ${JSON.stringify(errorBody)}`,
  );

  // Return only generic message to client (no internal LCS details)
  return `Error from lightspeed-core server while ${context}`;
}

/**
 * Handles LCS fetch errors by sanitizing the error response and sending it to the client.
 * This helper eliminates code duplication across multiple endpoints.
 *
 * @param fetchResponse - The failed fetch response from LCS
 * @param logger - Logger instance for server-side logging
 * @param context - Context string describing the operation
 * @param response - Express response object
 */
export async function handleLCSFetchError(
  fetchResponse: Response,
  logger: LoggerService,
  context: string,
  response: { status: (code: number) => { json: (body: any) => void } },
): Promise<void> {
  let errorBody: LCSErrorResponse;
  try {
    errorBody = await fetchResponse.json();
  } catch {
    // If LCS doesn't return JSON or doesn't have a body, use empty object
    errorBody = {};
  }
  const sanitizedError = sanitizeLCSError(errorBody, logger, context);
  response.status(fetchResponse.status).json({ error: sanitizedError });
}

export function rewriteProxyPath(
  path: string,
  userEntityRef: string,
  method: string | undefined,
): string {
  // Preserve encoded path segments while rewriting the query.
  const queryIndex = path.indexOf('?');
  let pathname = path;
  let pathWithoutUserId = path;
  if (queryIndex !== -1) {
    pathname = path.slice(0, queryIndex);
    const queryParams = new URLSearchParams(path.slice(queryIndex + 1));
    // Global routes must also discard caller-supplied identities.
    if (queryParams.has('user_id')) {
      queryParams.delete('user_id');
      const queryParamsAsString = queryParams.toString();
      pathWithoutUserId = pathname;
      if (queryParamsAsString) {
        pathWithoutUserId += `?${queryParamsAsString}`;
      }
    }
  }

  // Express accepts an optional trailing slash, which must not prevent a global
  // GET from matching the identity exemption.
  if (pathname.endsWith('/')) {
    pathname = pathname.slice(0, -1);
  }
  if (method === 'GET' && SKIP_USER_ID_ENDPOINTS.has(pathname)) {
    return pathWithoutUserId;
  }

  const userQueryParam = `user_id=${encodeURIComponent(userEntityRef)}`;
  let newPath = pathWithoutUserId.includes('?')
    ? `${pathWithoutUserId}&${userQueryParam}`
    : `${pathWithoutUserId}?${userQueryParam}`;

  if (!path.includes('history_length') && path.includes('conversation_id')) {
    const historyLengthQuery = `history_length=${DEFAULT_HISTORY_LENGTH}`;
    newPath = newPath.includes('?')
      ? `${newPath}&${historyLengthQuery}`
      : `${newPath}?${historyLengthQuery}`;
  }

  return newPath;
}

/**
 * Calls `onDisconnect` once if the client disconnects before the response
 * finishes. Register this before awaiting upstream work: a disconnect that
 * already happened (e.g. while earlier middleware was awaiting) is detected
 * immediately, since Node does not replay the `close` event.
 *
 * @param response - Express response for the current request
 * @param onDisconnect - Callback that cancels upstream work
 */
export function onClientDisconnect(
  response: ExpressResponse,
  onDisconnect: () => void,
): void {
  if (response.destroyed && !response.writableFinished) {
    onDisconnect();
    return;
  }
  response.on('close', () => {
    if (!response.writableFinished) {
      onDisconnect();
    }
  });
}

/**
 * Whether `error` is the rejection of a fetch or body read cancelled through
 * an AbortSignal.
 *
 * @param error - The caught error
 */
export function isAbortError(error: unknown): boolean {
  return (error as { name?: unknown } | null)?.name === 'AbortError';
}
