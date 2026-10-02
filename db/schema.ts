import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const trades = sqliteTable("trades", {
  id: text("id").primaryKey(), symbol: text("symbol").notNull(), side: text("side").notNull(),
  entryTime: text("entry_time").notNull(), exitTime: text("exit_time").notNull(), quantity: real("quantity").notNull(),
  entryPrice: real("entry_price").notNull(), exitPrice: real("exit_price").notNull(), pnl: real("pnl").notNull(),
  spyMove: real("spy_move").notNull().default(0), rrs: real("rrs").notNull().default(0), aligned: integer("aligned",{mode:"boolean"}).notNull().default(false),
  setup: text("setup").notNull().default(""), tags: text("tags").notNull().default("[]"), notes: text("notes").notNull().default(""), grade: text("grade").notNull().default("—")
});
