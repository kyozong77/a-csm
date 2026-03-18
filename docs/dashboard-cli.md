# Dashboard CLI (RZV-100)

`scripts/dashboard-cli.mjs` provides a read-only local report dashboard for A-CSM outputs.

## Commands

List report summaries:

```bash
npm run dashboard:cli -- list --dir logs,output --limit 50
```

Show one report in full JSON:

```bash
npm run dashboard:cli -- show --id acsm-orchestrator-result --dir logs
```

You can also pass an absolute path to `--id`.

## Output Fields (list)

- `id`: file name without `.json`
- `type`: inferred report type (`orchestrator`, `batch`, etc.)
- `decision`: `GO`, `NO_GO`, or stage decision
- `ps/sub`: primary state and subtype when available
- `generatedAt`: report timestamp

## Notes

- The command is read-only and does not mutate report files.
- Malformed JSON files are skipped with warning messages.
- Default directories are `logs` and `output` when `--dir` is not provided.
