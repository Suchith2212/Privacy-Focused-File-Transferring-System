# Module B Public Load Result

## Run Context
- mode: public
- total requests: 600
- users: 20
- requests per user: 30
- backend: http://localhost:4000

## Outcome
- success: 600
- failed: 0
- success rate: 100.0%

## Latency (ms)
- mean: 22.37
- p50: 8.0
- p95: 24.16
- max: 428.31

## Operation Mix
- health calls: 300
- captcha calls: 300

## Notes
- This run validates concurrent public endpoint stability.
- Next run should use --mode auth for vault/file critical-path concurrency with a real outerToken + innerToken.
