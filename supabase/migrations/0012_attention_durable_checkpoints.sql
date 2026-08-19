begin;

drop function if exists public.commit_attention_runtime_minute(text,text,bigint,jsonb,jsonb,jsonb);

create or replace function public.commit_attention_runtime_minute(
  p_engine_instance_id text, p_run_id text, p_fencing_token bigint,
  p_checkpoint jsonb, p_snapshot jsonb, p_events jsonb, p_envelopes jsonb
) returns void language plpgsql security definer set search_path = public as $$
declare e jsonb; o jsonb;
begin
  if not exists (
    select 1 from attention_engine_instances
    where engine_instance_id=p_engine_instance_id
      and owner_run_id=p_run_id
      and fencing_token=p_fencing_token
      and lease_expires_at>now()
  ) then raise exception 'attention runtime fencing violation'; end if;

  update attention_engine_instances
     set health = p_snapshot->>'health',
         ready = coalesce((p_snapshot->>'ready')::boolean, false),
         ingestion_mode = p_snapshot->>'ingestionMode',
         heartbeat_at = now(),
         last_completed_minute = to_timestamp((p_snapshot->>'asOf')::double precision/1000),
         updated_at = now()
   where engine_instance_id = p_engine_instance_id;

  insert into attention_engine_checkpoints(
    engine_instance_id,sequence,watermark_at,schema_version,fencing_token,
    universe_hash,calibration_id,config_hash,ingestion_mode,checksum,state
  ) values (
    p_engine_instance_id,(p_checkpoint->>'sequence')::bigint,
    to_timestamp((p_checkpoint->>'watermarkAt')::double precision/1000),
    (p_checkpoint->>'schemaVersion')::integer,p_fencing_token,
    p_checkpoint->'identity'->>'universeHash',
    p_checkpoint->'identity'->>'calibrationId',
    p_checkpoint->'identity'->>'configHash',
    p_checkpoint->>'ingestionMode',p_checkpoint->>'checksum',p_checkpoint
  ) on conflict(engine_instance_id,sequence) do nothing;

  -- The worker restores only the newest durable boundary. Retain three: the
  -- current boundary plus two immediately preceding forensic/fallback points.
  -- Single-writer fencing makes sequence-based pruning deterministic.
  delete from attention_engine_checkpoints
   where engine_instance_id = p_engine_instance_id
     and sequence not in (
       select sequence from attention_engine_checkpoints
        where engine_instance_id = p_engine_instance_id
        order by sequence desc limit 3
     );

  insert into attention_live_snapshots(engine_instance_id,sequence,as_of,fencing_token,snapshot)
  values(p_engine_instance_id,(p_snapshot->>'sequence')::bigint,to_timestamp((p_snapshot->>'asOf')::double precision/1000),p_fencing_token,p_snapshot)
  on conflict(engine_instance_id) do update set sequence=excluded.sequence,as_of=excluded.as_of,fencing_token=excluded.fencing_token,snapshot=excluded.snapshot,updated_at=now();

  -- Store the complete AttentionEvent. The API returns payload as the event row,
  -- and the UI then reads event.payload for score/freshness/context.
  for e in select value from jsonb_array_elements(p_events) loop
    insert into attention_events(event_id,engine_instance_id,event_type,symbol,qualified_at,emitted_at,payload)
    values(e->>'eventId',p_engine_instance_id,e->>'type',e->>'symbol',to_timestamp((e->>'qualifiedAt')::double precision/1000),to_timestamp((e->>'emittedAt')::double precision/1000),e)
    on conflict do nothing;
  end loop;

  for o in select value from jsonb_array_elements(p_envelopes) loop
    insert into attention_delivery_outbox(id,engine_instance_id,idempotency_key,tier,kind,payload,status,attempt_count,next_attempt_at,expires_at)
    values(o->>'id',p_engine_instance_id,o->>'idempotencyKey',o->>'tier',o->>'kind',o,o->>'status',(o->>'attemptCount')::integer,to_timestamp((o->>'nextAttemptAt')::double precision/1000),to_timestamp((o->>'expiresAt')::double precision/1000))
    on conflict(idempotency_key) do update set payload=excluded.payload,next_attempt_at=excluded.next_attempt_at,expires_at=excluded.expires_at,updated_at=now()
    where attention_delivery_outbox.status in ('pending','retrying');
  end loop;
end $$;

revoke all on function public.commit_attention_runtime_minute(text,text,bigint,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
commit;
