// The Worker's entry (wrangler.toml `main`): every request goes to the relay (src/relay.ts).
import { handle, type Env } from "./relay.js";

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handle(request, env);
  }
} satisfies ExportedHandler<Env>;
