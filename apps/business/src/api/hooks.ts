import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from "@tanstack/react-query";
import type { EndpointDef } from "@opencast/contracts";
import type { z } from "zod";
import { call, type CallArgs } from "./client";

/** A query key per endpoint and arguments: invalidate by path to refresh everything under it. */
export function keyFor(endpoint: EndpointDef, args: CallArgs = {}) {
  return [endpoint.method, endpoint.path, args.params ?? {}, args.query ?? {}] as const;
}

// Each response schema gets its own cache entry: two screens reading one endpoint through
// different extensions must not strip each other's fields.
const schemaIds = new WeakMap<object, number>();
let nextSchemaId = 1;
function schemaId(schema: object | undefined): number {
  if (!schema) return 0;
  let id = schemaIds.get(schema);
  if (!id) schemaIds.set(schema, (id = nextSchemaId++));
  return id;
}

/** Reads an endpoint. Pass `schema` to read the response another way (api/ext/spots.ts's SpotX). */
export function useApi<E extends EndpointDef, S extends z.ZodType = E["response"]>(
  endpoint: E,
  args: CallArgs = {},
  opts: { schema?: S; enabled?: boolean } & Omit<UseQueryOptions<z.infer<S>>, "queryKey" | "queryFn"> = {}
) {
  const { schema, ...rest } = opts;
  return useQuery<z.infer<S>>({ queryKey: [...keyFor(endpoint, args), schemaId(schema)], queryFn: () => call(endpoint, args, schema), ...rest });
}

/** Changes something, then refreshes the queries under `invalidates` (endpoint paths). */
export function useApiMutation<E extends EndpointDef>(endpoint: E, opts: { invalidates?: EndpointDef[] } = {}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: CallArgs) => call(endpoint, args),
    onSuccess: () => {
      for (const e of opts.invalidates ?? []) void qc.invalidateQueries({ queryKey: [e.method, e.path] });
    }
  });
}
