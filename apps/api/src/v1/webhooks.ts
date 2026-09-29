// Provider webhooks (Stripe, Clear). They need the raw body to check the signature, so the server
// mounts this before any JSON body parser; the v1 router mounts it too, for tests.

import express, { type RequestHandler } from "express";
import type { Deps, Services } from "./context.js";
import { HttpError } from "./errors.js";

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

/**
 * P20 (added 2026-09-29): a business's connected checkout (Shopify, Stripe or Square) sends its
 * order webhooks to `/v1/webhooks/checkout/:hookToken`; each promotion code used counts as a use.
 * Signed with the secret the business gave when it connected; retries count once.
 */
export function checkoutWebhookHandler(deps: Deps, services: Services): RequestHandler[] {
  return [
    express.raw({ type: "*/*", limit: "1mb" }),
    async (req, res) => {
      const token = String(req.params.hookToken ?? "");
      // Square signs the address it posted to: the API's public one when it's set.
      const url = deps.config.publicBase ? `${deps.config.publicBase.replace(/\/+$/, "")}${req.originalUrl}` : `${req.protocol}://${req.get("host")}${req.originalUrl}`;
      try {
        const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from(typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {}));
        const result = await services.spots.checkoutWebhook(token, body, req.headers as Record<string, string | undefined>, url);
        if (!result) {
          res.status(404).json({ error: { code: "not_found", message: "That connection wasn't found." } });
          return;
        }
        res.json({ received: true, counted: result.counted });
      } catch (error) {
        if (error instanceof HttpError) {
          res.status(error.status).json({ error: { code: error.code, message: error.message } });
          return;
        }
        console.error("[webhooks] checkout failed", error);
        res.status(500).json({ error: { code: "internal", message: "Something went wrong on our side." } });
      }
    }
  ];
}
