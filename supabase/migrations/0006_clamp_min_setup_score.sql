-- Fixes a real bug (Codex review): the setup score scale changed from a
-- raw weighted scale (which went as high as ~21 during development) to a
-- fixed 0-10 normalized scale. Any risk_settings row saved before that
-- change could have min_setup_score above 10 - since no score can ever
-- reach that on the new scale, the "attempting a low-scoring setup"
-- accountability check would fail PERMANENTLY on every scan.
--
-- This migration is idempotent: the UPDATEs are no-ops on already-clamped
-- data, and the constraint is dropped-if-exists before being re-added, so
-- running this more than once is safe.

update public.risk_settings
set min_setup_score = 10
where min_setup_score > 10;

update public.risk_settings
set min_setup_score = 0
where min_setup_score < 0;

alter table public.risk_settings
  drop constraint if exists risk_settings_min_setup_score_range;

alter table public.risk_settings
  add constraint risk_settings_min_setup_score_range
  check (min_setup_score >= 0 and min_setup_score <= 10);
