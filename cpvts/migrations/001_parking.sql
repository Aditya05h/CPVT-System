-- CPVTS: PostgreSQL / Supabase. Safe to reapply; never resets occupied slots.
BEGIN;
CREATE TABLE IF NOT EXISTS public.cpvts_slots (
  id text PRIMARY KEY,
  vehicle_type text NOT NULL CHECK (vehicle_type IN ('two_wheeler','four_wheeler')),
  ordinal integer NOT NULL CHECK (ordinal > 0),
  UNIQUE (vehicle_type, ordinal), UNIQUE (id, vehicle_type)
);
CREATE TABLE IF NOT EXISTS public.cpvts_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_number text NOT NULL CHECK (vehicle_number ~ '^[A-Z0-9]{2,20}$'),
  vehicle_type text NOT NULL CHECK (vehicle_type IN ('two_wheeler','four_wheeler')),
  owner_category text NOT NULL CHECK (owner_category IN ('Staff','Student','Visitor')),
  slot_id text NOT NULL,
  entry_hour integer NOT NULL CHECK (entry_hour BETWEEN 0 AND 23),
  exit_hour integer CHECK (exit_hour BETWEEN entry_hour AND 23),
  checked_in_at timestamptz NOT NULL DEFAULT now(),
  checked_out_at timestamptz,
  fee integer CHECK (fee >= 0),
  calculation jsonb,
  FOREIGN KEY (slot_id,vehicle_type) REFERENCES public.cpvts_slots(id,vehicle_type),
  CHECK ((exit_hour IS NULL AND checked_out_at IS NULL AND fee IS NULL AND calculation IS NULL)
    OR (exit_hour IS NOT NULL AND checked_out_at IS NOT NULL AND fee IS NOT NULL AND calculation IS NOT NULL)),
  CHECK (checked_out_at IS NULL OR checked_out_at >= checked_in_at)
);
CREATE TABLE IF NOT EXISTS public.cpvts_reservations (
  slot_id text PRIMARY KEY REFERENCES public.cpvts_slots(id) ON DELETE CASCADE,
  vehicle_number text NOT NULL CHECK (vehicle_number ~ '^[A-Z0-9]{2,20}$'),
  note text NOT NULL DEFAULT 'VIP / emergency reservation',
  reserved_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS cpvts_active_vehicle ON public.cpvts_records(vehicle_number) WHERE exit_hour IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS cpvts_active_slot ON public.cpvts_records(slot_id) WHERE exit_hour IS NULL;
CREATE INDEX IF NOT EXISTS cpvts_entry_date ON public.cpvts_records(checked_in_at);
CREATE INDEX IF NOT EXISTS cpvts_exit_date ON public.cpvts_records(checked_out_at);
INSERT INTO public.cpvts_slots(id,vehicle_type,ordinal)
SELECT 'T-' || lpad(n::text,2,'0'), 'two_wheeler', n FROM generate_series(1,10) n
ON CONFLICT DO NOTHING;
INSERT INTO public.cpvts_slots(id,vehicle_type,ordinal)
SELECT 'F-' || lpad(n::text,2,'0'), 'four_wheeler', n FROM generate_series(1,5) n
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.cpvts_record_json(r public.cpvts_records)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = '' AS $$
SELECT jsonb_build_object('id',r.id,'vehicleNumber',r.vehicle_number,'vehicleType',r.vehicle_type,
  'ownerCategory',r.owner_category,'slotId',r.slot_id,'entryHour',r.entry_hour,'exitHour',r.exit_hour,
  'checkedInAt',r.checked_in_at,'checkedOutAt',r.checked_out_at,'status',CASE WHEN r.exit_hour IS NULL THEN 'Parked' ELSE 'Completed' END,
  'duration',r.exit_hour-r.entry_hour,'fee',r.fee,'calculation',r.calculation);
$$;

CREATE OR REPLACE FUNCTION public.cpvts_check_in(p_vehicle_number text,p_vehicle_type text,p_owner_category text,p_entry_hour integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_number text; v_slot text; v_record public.cpvts_records;
BEGIN
  v_number := regexp_replace(upper(trim(p_vehicle_number)), '[ -]', '', 'g');
  IF v_number IS NULL OR v_number !~ '^[A-Z0-9]{2,20}$' OR p_vehicle_type IS NULL OR p_vehicle_type NOT IN ('two_wheeler','four_wheeler')
    OR p_owner_category IS NULL OR p_owner_category NOT IN ('Staff','Student','Visitor') OR p_entry_hour IS NULL OR p_entry_hour NOT BETWEEN 0 AND 23 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR';
  END IF;
  -- One small campus-wide critical section; preserves first-available allocation under contention.
  LOCK TABLE public.cpvts_slots IN EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM public.cpvts_records WHERE vehicle_number=v_number AND exit_hour IS NULL) THEN
    RAISE EXCEPTION 'DUPLICATE_VEHICLE';
  END IF;
  SELECT s.id INTO v_slot FROM public.cpvts_slots s WHERE s.vehicle_type=p_vehicle_type
    AND NOT EXISTS (SELECT 1 FROM public.cpvts_reservations x WHERE x.slot_id=s.id)
    AND NOT EXISTS (SELECT 1 FROM public.cpvts_records r WHERE r.slot_id=s.id AND r.exit_hour IS NULL)
    ORDER BY s.ordinal LIMIT 1;
  IF v_slot IS NULL THEN RAISE EXCEPTION 'PARKING_FULL'; END IF;
  INSERT INTO public.cpvts_records(vehicle_number,vehicle_type,owner_category,entry_hour,slot_id)
    VALUES(v_number,p_vehicle_type,p_owner_category,p_entry_hour,v_slot) RETURNING * INTO v_record;
  RETURN public.cpvts_record_json(v_record);
END;
$$;

CREATE OR REPLACE FUNCTION public.cpvts_reserve_slot(p_slot_id text,p_vehicle_number text,p_note text DEFAULT 'VIP / emergency reservation')
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_slot public.cpvts_slots; v_number text;
BEGIN
  v_number := regexp_replace(upper(trim(p_vehicle_number)), '[ -]', '', 'g');
  IF p_slot_id IS NULL OR p_slot_id !~ '^[TF]-\d{2,}$' OR v_number IS NULL OR v_number !~ '^[A-Z0-9]{2,20}$' THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  LOCK TABLE public.cpvts_slots IN EXCLUSIVE MODE;
  SELECT s.* INTO v_slot FROM public.cpvts_slots s WHERE s.id=upper(trim(p_slot_id));
  IF NOT FOUND THEN RAISE EXCEPTION 'VEHICLE_NOT_FOUND'; END IF;
  IF EXISTS (SELECT 1 FROM public.cpvts_reservations r WHERE r.slot_id=v_slot.id) THEN RAISE EXCEPTION 'RESERVATION_EXISTS'; END IF;
  INSERT INTO public.cpvts_reservations(slot_id,vehicle_number,note) VALUES(v_slot.id,v_number,coalesce(nullif(trim(p_note),''),'VIP / emergency reservation'));
  RETURN jsonb_build_object('slotId',v_slot.id,'vehicleNumber',v_number,'note',coalesce(nullif(trim(p_note),''),'VIP / emergency reservation'),'status','Reserved');
END;
$$;

CREATE OR REPLACE FUNCTION public.cpvts_release_slot(p_slot_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_id text := upper(trim(p_slot_id));
BEGIN
  IF v_id IS NULL OR v_id !~ '^[TF]-\d{2,}$' THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  DELETE FROM public.cpvts_reservations WHERE slot_id=v_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'RESERVATION_NOT_FOUND'; END IF;
  RETURN jsonb_build_object('slotId',v_id,'status','Available');
END;
$$;

CREATE OR REPLACE FUNCTION public.cpvts_check_out(p_exit_hour integer,p_vehicle_number text DEFAULT NULL,p_slot_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_record public.cpvts_records; v_duration integer; v_free integer; v_rate integer; v_billable integer;
BEGIN
  IF (p_vehicle_number IS NULL) = (p_slot_id IS NULL) OR p_exit_hour IS NULL OR p_exit_hour NOT BETWEEN 0 AND 23 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR';
  END IF;
  LOCK TABLE public.cpvts_slots IN EXCLUSIVE MODE;
  SELECT * INTO v_record FROM public.cpvts_records WHERE exit_hour IS NULL AND
    ((p_vehicle_number IS NOT NULL AND vehicle_number=regexp_replace(upper(trim(p_vehicle_number)),'[ -]','','g'))
    OR (p_slot_id IS NOT NULL AND slot_id=upper(trim(p_slot_id)))) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'VEHICLE_NOT_FOUND'; END IF;
  IF p_exit_hour < v_record.entry_hour THEN RAISE EXCEPTION 'EXIT_BEFORE_ENTRY'; END IF;
  v_duration := p_exit_hour-v_record.entry_hour;
  v_free := CASE v_record.owner_category WHEN 'Staff' THEN v_duration WHEN 'Student' THEN least(2,v_duration) ELSE 0 END;
  v_rate := CASE v_record.owner_category WHEN 'Staff' THEN 0 WHEN 'Student' THEN
    CASE v_record.vehicle_type WHEN 'two_wheeler' THEN 10 ELSE 20 END ELSE
    CASE v_record.vehicle_type WHEN 'two_wheeler' THEN 20 ELSE 40 END END;
  v_billable := v_duration-v_free;
  UPDATE public.cpvts_records SET exit_hour=p_exit_hour,checked_out_at=now(),fee=v_billable*v_rate,
    calculation=jsonb_build_object('freeHours',v_free,'billableHours',v_billable,'ratePerHour',v_rate)
    WHERE id=v_record.id RETURNING * INTO v_record;
  RETURN public.cpvts_record_json(v_record);
END;
$$;

CREATE OR REPLACE FUNCTION public.cpvts_snapshot(p_date date DEFAULT (now() AT TIME ZONE 'Asia/Kolkata')::date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
SELECT jsonb_build_object(
  'date',p_date,'timezone','Asia/Kolkata',
  'zones',(SELECT jsonb_agg(jsonb_build_object('vehicleType',z.vehicle_type,'total',z.total,'occupied',z.occupied,'vacant',z.total-z.occupied) ORDER BY z.vehicle_type DESC)
    FROM (SELECT s.vehicle_type,count(*) AS total,count(r.id) AS occupied FROM public.cpvts_slots s
      LEFT JOIN public.cpvts_records r ON r.slot_id=s.id AND r.exit_hour IS NULL GROUP BY s.vehicle_type) z),
  'slots',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'vehicleType',s.vehicle_type,'ordinal',s.ordinal,
    'status',CASE WHEN x.slot_id IS NOT NULL THEN 'Reserved' WHEN r.id IS NOT NULL THEN 'Occupied' ELSE 'Available' END,'record',CASE WHEN r.id IS NULL THEN NULL ELSE public.cpvts_record_json(r) END,
    'reservation',CASE WHEN x.slot_id IS NULL THEN NULL ELSE jsonb_build_object('slotId',x.slot_id,'vehicleNumber',x.vehicle_number,'note',x.note,'reservedAt',x.reserved_at) END)
    ORDER BY s.vehicle_type DESC,s.ordinal),'[]'::jsonb) FROM public.cpvts_slots s LEFT JOIN public.cpvts_records r ON r.slot_id=s.id AND r.exit_hour IS NULL LEFT JOIN public.cpvts_reservations x ON x.slot_id=s.id),
  'records',(SELECT coalesce(jsonb_agg(public.cpvts_record_json(r) ORDER BY r.checked_in_at DESC),'[]'::jsonb) FROM public.cpvts_records r
    WHERE r.exit_hour IS NULL OR (r.checked_in_at AT TIME ZONE 'Asia/Kolkata')::date=p_date OR (r.checked_out_at AT TIME ZONE 'Asia/Kolkata')::date=p_date),
  'summary',jsonb_build_object(
    'vehiclesParked',(SELECT count(*) FROM public.cpvts_records WHERE (checked_in_at AT TIME ZONE 'Asia/Kolkata')::date=p_date),
    'completedCheckouts',(SELECT count(*) FROM public.cpvts_records WHERE (checked_out_at AT TIME ZONE 'Asia/Kolkata')::date=p_date),
    'feesAssessed',(SELECT coalesce(sum(fee),0) FROM public.cpvts_records WHERE (checked_out_at AT TIME ZONE 'Asia/Kolkata')::date=p_date))
);
$$;

CREATE OR REPLACE FUNCTION public.cpvts_find_vehicle(p_vehicle_number text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
SELECT public.cpvts_record_json(r) FROM public.cpvts_records r
WHERE vehicle_number=regexp_replace(upper(trim(p_vehicle_number)),'[ -]','','g') AND exit_hour IS NULL LIMIT 1;
$$;

-- No public Data API access. The Node server calls RPC with its server-only key.
ALTER TABLE public.cpvts_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cpvts_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cpvts_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cpvts_slots,public.cpvts_records,public.cpvts_reservations FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cpvts_record_json(public.cpvts_records),public.cpvts_check_in(text,text,text,integer),
  public.cpvts_check_out(integer,text,text),public.cpvts_snapshot(date),public.cpvts_find_vehicle(text),public.cpvts_reserve_slot(text,text,text),public.cpvts_release_slot(text) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON public.cpvts_slots,public.cpvts_records,public.cpvts_reservations FROM anon,authenticated;
    REVOKE EXECUTE ON FUNCTION public.cpvts_record_json(public.cpvts_records),public.cpvts_check_in(text,text,text,integer),
      public.cpvts_check_out(integer,text,text),public.cpvts_snapshot(date),public.cpvts_find_vehicle(text),public.cpvts_reserve_slot(text,text,text),public.cpvts_release_slot(text) FROM anon,authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    GRANT SELECT,INSERT,UPDATE,DELETE ON public.cpvts_slots,public.cpvts_records,public.cpvts_reservations TO service_role;
    GRANT EXECUTE ON FUNCTION public.cpvts_record_json(public.cpvts_records),public.cpvts_check_in(text,text,text,integer),
      public.cpvts_check_out(integer,text,text),public.cpvts_snapshot(date),public.cpvts_find_vehicle(text),public.cpvts_reserve_slot(text,text,text),public.cpvts_release_slot(text) TO service_role;
  END IF;
END $$;
COMMIT;
