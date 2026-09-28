import { index, jsonb, text, uuid } from "drizzle-orm/pg-core";
import { at, createdAt, id } from "./columns.js";
import { notify } from "./namespaces.js";
import { users } from "./accounts.js";

/** In-app notices, and the record of each push or email sent for one. Owned by the notifications module. */
export const notices = notify.table(
  "notices",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    link: text("link"),
    scopeKind: text("scope_kind", { enum: ["viewer", "station", "business"] }).notNull(),
    scopeId: uuid("scope_id"),
    /** Stops the same notice twice (a warning for one gap, a reminder for one airing). */
    dedupeKey: text("dedupe_key").unique(),
    data: jsonb("data"),
    createdAt: createdAt(),
    readAt: at("read_at")
  },
  (t) => [index("notices_user").on(t.userId, t.createdAt)]
);

export const deliveries = notify.table("deliveries", {
  id: id(),
  noticeId: uuid("notice_id")
    .notNull()
    .references(() => notices.id),
  channel: text("channel", { enum: ["push", "email"] }).notNull(),
  sentAt: at("sent_at"),
  error: text("error"),
  createdAt: createdAt()
});
