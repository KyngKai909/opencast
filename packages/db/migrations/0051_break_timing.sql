-- 2026-10-04: A247, more ways to set when breaks come (the user's decision). On the break rule:
-- after every N programs (`every_programs`, with `after_every_program`), clock breaks at minutes
-- past the hour (`clock_minutes`, with `every_n_minutes`, whose `every_minutes` is then 60 over how
-- many), and breaks inside long programs too (`long_programs`, `{ overMs, everyMs }`).
-- Additive: three nullable columns, null for every existing row (today's breaks exactly), and checks
-- that every existing row passes. No enum value: `mode` keeps its three, so apps from before read
-- every rule. Named by hand after 0050 (0038 is reserved, see 0040); drizzle-kit agrees with it.
ALTER TABLE "broadcast"."break_rules" ADD COLUMN "every_programs" smallint;--> statement-breakpoint
ALTER TABLE "broadcast"."break_rules" ADD COLUMN "clock_minutes" jsonb;--> statement-breakpoint
ALTER TABLE "broadcast"."break_rules" ADD COLUMN "long_programs" jsonb;--> statement-breakpoint
ALTER TABLE "broadcast"."break_rules" ADD CONSTRAINT "every_programs_range" CHECK ("broadcast"."break_rules"."every_programs" is null or ("broadcast"."break_rules"."mode" = 'after_every_program' and "broadcast"."break_rules"."every_programs" between 2 and 12));--> statement-breakpoint
ALTER TABLE "broadcast"."break_rules" ADD CONSTRAINT "clock_minutes_mode" CHECK ("broadcast"."break_rules"."clock_minutes" is null or ("broadcast"."break_rules"."mode" = 'every_n_minutes' and jsonb_typeof("broadcast"."break_rules"."clock_minutes") = 'array'));