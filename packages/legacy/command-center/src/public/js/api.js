import { tryParseJson } from './helpers.js';

export function createApi({ onUnauthorized }) {
  return async function api(path, options = {}) {
    const response = await fetch(path, {
      method: options.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (response.status === 401) {
      onUnauthorized?.();
      throw new Error('Unauthorized');
    }

    const payloadText = await response.text();
    const payload = payloadText ? tryParseJson(payloadText) : {};

    if (!response.ok) {
      const message = payload && typeof payload === 'object' && payload.error
        ? payload.error
        : `Request failed (${response.status})`;
      throw new Error(message);
    }

    return payload;
  };
}
