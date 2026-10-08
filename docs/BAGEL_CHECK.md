# bagel-check: gate recordings in CI

`bagel-check` runs BAGEL's own parsers in Node, with no browser, and fails when a
recording is not what you expected: a topic missing, a sensor publishing too
slowly, a long silence in the middle, a run that is too short. It reads `.mcap`,
`.db3` and `.bag`, and treats a folder of numbered parts (`run_0.mcap`,
`run_1.mcap`, or a rosbag2 folder with `metadata.yaml`) as one recording.

## GitHub Action

```yaml
- uses: actions/checkout@v4
- uses: Hussain004/BAGEL@main
  with:
    path: recordings/*.mcap
    expect: ci/bag-expectations.json
```

Per-topic tables are also written to the job summary. Runners need Node 22.

## Command line

```bash
node cli/bundle/bagel-check.mjs [--expect rules.json] [--json] [--summary out.md] <bag-or-folder>...
```

| Exit code | Meaning |
| --- | --- |
| 0 | Every recording passed (or no rules were given) |
| 1 | A check failed |
| 2 | Bad usage, an unreadable bag, or an invalid rules file |

A rules file is never partly applied: a mistake in it exits 2 rather than
silently checking less.

## Expectations file

Strict JSON. Every key is optional; an unknown key is an error.

```json
{
  "min_duration_s": 30,
  "max_duration_s": 600,
  "allow_extra_topics": true,
  "topics": {
    "/scan":      { "type": "sensor_msgs/msg/LaserScan", "min_hz": 8, "max_gap_s": 0.5 },
    "/imu/data":  { "min_hz": 40, "min_messages": 1000 },
    "/gps/fix":   { "optional": true, "min_hz": 0.5 },
    "/tf":        {}
  }
}
```

- A topic you list must exist unless it is `"optional": true`. `{}` means "must exist".
- `type` ignores the `/msg/` spelling, so ROS 1 and ROS 2 names compare equal.
- `min_hz` / `max_hz` use the mean rate over the topic's own span.
- `max_gap_s` is the longest silence between two consecutive messages. Use it
  rather than only `min_hz`: a sensor that dies for ten seconds can still
  average a healthy rate.
- `"allow_extra_topics": false` fails on any topic you did not list.

## Notes

- The tool reads message times from the file index where it can, so memory use
  stays small on large bags (a 300 MB bag peaks around 60 MB).
- The CLI is built from the same source as the web app. `pnpm build:cli`
  regenerates `cli/bundle/`, which is committed so the Action needs no install
  step; CI fails if it is out of date.
