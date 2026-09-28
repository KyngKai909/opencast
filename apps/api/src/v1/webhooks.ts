// Provider webhooks (Stripe, Clear). They need the raw body to check the signature, so the server
// mounts this before any JSON body parser; the v1 router mounts it too, for tests.

import express, { type RequestHandler } from "express";
import type { Deps, Services } from "./context.js";

export function webhookHandler(deps: Deps, services: Services): RequestHandler[] {
  return [
    express.raw({ type: "*/*", limit: "1mb" }),
    async (req, res) => {
      const provider = req.params.provider;
      if (provider !== "stripe" && provider !== "clear") {
        res.status(404).end();
        return;
      }
      let event;
      try {
        event = await deps.payments.webhook(provider, req.body as Buffer, req.headers as Record<string, string | undefined>);
      } catch (error) {
        console.warn(`[webhooks] ${provider}: refused`, (error as Error).message);
        res.status(400).json({ error: { code: "bad_signature", message: "That webhook couldn't be verified." } });
        return;
      }
      if (event) await services.ledger.handlePaymentEvent(event);
      res.json({ received: true });
    }
  ];
}
