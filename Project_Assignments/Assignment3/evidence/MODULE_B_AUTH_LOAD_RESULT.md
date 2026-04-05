# Module B Auth Load Result

## Run Context
- mode: auth
- total requests: 600
- users: 20
- requests per user: 30
- backend: http://localhost:4000
- outer token: y8WvF76

## Outcome
- success: 300
- failed: 300
- success rate: 50.0%

## Status Distribution
- HTTP 200: 300
- HTTP 429: 300

## Latency (ms)
- mean: 312.55
- p50: 313.87
- p95: 577.23
- max: 635.43

## Operation Mix
- vault access calls: 300
- file list calls: 300

## Interpretation
- 429 responses are expected under aggressive concurrency due to configured rate-limit defenses.
- This run demonstrates protective behavior under load (throttling) rather than uncontrolled failure.
- For a complementary success-dominant run, lower user/request volume can be used.
