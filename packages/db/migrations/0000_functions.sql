-- Functions the table definitions depend on. Mirrors packages/domain/src/station.ts.

CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint

-- WCAG contrast ratio of a #rrggbb colour against white, from 1 to 21.
CREATE OR REPLACE FUNCTION public.contrast_on_white(hex text) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE
  channel numeric;
  luminance numeric := 0;
  weights numeric[] := ARRAY[0.2126, 0.7152, 0.0722];
BEGIN
  IF hex !~ '^#[0-9a-fA-F]{6}$' THEN
    RETURN 0;
  END IF;
  FOR i IN 0..2 LOOP
    channel := ('x' || lpad(substr(hex, 2 + i * 2, 2), 8, '0'))::bit(32)::int / 255.0;
    channel := CASE WHEN channel <= 0.03928 THEN channel / 12.92 ELSE power((channel + 0.055) / 1.055, 2.4) END;
    luminance := luminance + weights[i + 1] * channel;
  END LOOP;
  RETURN 1.05 / (luminance + 0.05);
END;
$$;
