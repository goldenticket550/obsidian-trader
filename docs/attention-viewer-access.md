# Attention viewer access boundary

LIVE-2 adds a read-only `viewer` membership on one attention engine instance. It does not create another worker and it does not share the trader's private records. Navigation hiding is cosmetic; PostgreSQL row-level security is the boundary.

## Live database access matrix

`Own` means rows whose existing policy resolves to the signed-in owner's `auth.uid()`. `Scanner` means the one engine instance named by the membership. All unlisted writes are service-role only.

| Public table | Owner read | Owner write | Viewer read | Viewer write | Anonymous read/write |
|---|---:|---:|---:|---:|---:|
| `alert_events` | Own | Own | No | No | No / No |
| `attention_delivery_outbox` | No | No | No | No | No / No |
| `attention_engine_checkpoints` | No | No | No | No | No / No |
| `attention_engine_instances` | Scanner | No | Scanner | No | No / No |
| `attention_engine_memberships` | Scanner memberships | No | Own membership | No | No / No |
| `attention_events` | Scanner | No | Scanner | No | No / No |
| `attention_ingestion_audit` | No | No | No | No | No / No |
| `attention_live_snapshots` | Scanner | No | Scanner | No | No / No |
| `attention_runtime_controls` | Own scanner | No | No | No | No / No |
| `core_signal_outbox` | Own | Own insert only | No | No | No / No |
| `daily_trading_status` | Own | Own insert/update | No | No | No / No |
| `risk_settings` | Own | Own insert/update | No | No | No / No |
| `scan_snapshots` | Own | Own insert/update | No | No | No / No |
| `strategy_configs` | Own | Own insert/update | No | No | No / No |
| `trade_journal_entries` | Own | Own insert/update/delete | No | No | No / No |
| `trader_run_reports` | No | No | No | No | No / No |
| `watchlist_symbols` | Own via watchlist | Own insert/delete via watchlist | No | No | No / No |
| `watchlists` | Own | Own insert/update/delete | No | No | No / No |

The three replay-label tables described by migration `0008_label_assistant.sql` are not present in the linked production database as of LIVE-2. The `/api/labels` route now requires the canonical engine `owner` role before any read or write. If the label migration is applied later, rerun migration 0010 so its restrictive viewer policies are added to those new tables too.

## Database enforcement

- Scanner SELECT policies call `attention_engine_access_role(engine_instance_id)` and admit only the instance owner or an explicit membership.
- Every other public table has a restrictive SELECT policy that denies a read-only viewer even if an older permissive `user_id = auth.uid()` policy would otherwise admit a viewer-owned row.
- Every public table has restrictive INSERT, UPDATE, and DELETE policies for read-only viewers.
- Scanner table write privileges are revoked from `authenticated`; worker writes and membership administration use the service role.
- Runtime security-definer write functions remain executable by `service_role` only.

## Verification

After granting a disposable viewer, run:

```powershell
npx tsx scripts/verify-attention-viewer-access.ts viewer@example.com https://obsidian-trader-blue.vercel.app
```

The verifier authenticates with a magic-link token, requires one readable instance/snapshot/membership, checks every private table returns zero rows, attempts INSERT on every table, tests private UPDATE/DELETE against a disposable row, tests membership escalation/removal, and cleans up the disposable private row.

The production signup setting at the LIVE-2 check was `disable_signup=false`: any email may request creation of an auth account through the existing OTP form. A non-member still receives no scanner or private data. To close account creation, disable new-user signup in Supabase Auth while retaining owner-issued admin invitations; existing and invited users can continue to use magic-link login.
