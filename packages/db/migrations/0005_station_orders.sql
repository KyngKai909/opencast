ALTER TABLE "broadcast"."stations" ADD COLUMN "takes_orders" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "broadcast"."stations" ADD COLUMN "order_turnaround" text;--> statement-breakpoint
ALTER TABLE "broadcast"."stations" ADD COLUMN "order_from_micros" bigint;