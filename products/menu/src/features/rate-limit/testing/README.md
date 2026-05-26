# rate-limit/testing — slice E2E surface

- `seedRateLimitEvents(key, count, occurredAt?)` — pre-populate the
  sliding window so a spec asserts 429-on-Nth-call without firing N real
  requests.
