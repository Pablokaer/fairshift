-- FairShift v2: one hospital code, two permanent profession queues, multi-slot
-- shifts that are assigned on publish (no offers).
--
-- New enum values live in their own migration: a value added with
-- ALTER TYPE ... ADD VALUE cannot be used in the transaction that adds it.

create type public.profession as enum ('doctor', 'nurse');

alter type public.entry_close_reason add value if not exists 'profession_changed';
