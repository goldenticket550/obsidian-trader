# Live runtime liveness contract

## Exit diagnosis

The sequence-13 process did not reach a normal worker exit. In continuous mode the loop has no
normal completion path, cycle failures are caught, and a rejected `main()` sets a non-zero exit
code. The process was launched beneath a transient Codex shell host and disappeared when that
host process tree was torn down. Empty stderr was therefore evidence of external termination,
not a clean application return, event-loop drain, or lease-loss return.

The worker now writes a structured heartbeat after every newly committed minute and records every
observable clean, signal, fatal, and rejected-main exit. An uncatchable hard termination is recorded
by the independent supervisor as a child exit.

## Supervision

`npm run runtime:worker` starts the supervisor. The supervised child is the actual Node worker
process, not an npm/cmd/tsx wrapper. The supervisor restarts every unexpected child exit, persists
the restart count, and waits out the fencing TTL after a lease-held rejection. The fencing lease
remains the final authority against double writers.

Local shadow operation is owned by the Windows task `ObsidianAttentionShadowWorker`. It is allowed
to run on battery and starts at logon. The task does not enable Attention delivery, purchase SIP,
deploy the application, or apply a migration.

## Dashboard contract

During a scheduled regular session, a missing snapshot or an `asOf` timestamp more than two minutes
old is `WORKER DOWN`. The dashboard hides stale rankings and displays the outage prominently. Outside
the regular session, the free-IEX dark-window state remains intentional and is not called an outage.

## IEX reference availability

- SPY, QQQ, and IWM remain unscored and now expose `self_referential_benchmark` explicitly. A future
  cross-index reference policy is held for trader adjudication.
- COIN, USO, and LLY can skip individual IEX minutes when the target has no exact one-minute print.
  This is expected partial-feed sparsity; the runtime does not forward-fill or substitute SIP.
- SPCX remains `limited_history`; supervision does not alter its listing or baseline policy.

## Full-session acceptance

`ObsidianAttentionShadowLivenessReport` runs after each weekday session and writes
`data/runtime-shadow/full-session-liveness-report.{json,md}`. A pass requires one heartbeat for every
scheduled regular-session minute. Process presence alone is not uptime. Restart count, exit reasons,
missing minutes, maximum consecutive gap, and maximum completion lag are included.
