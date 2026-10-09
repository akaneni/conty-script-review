import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { systemClock } from "./clock.ts";
import { openDatabase } from "./db.ts";

const db = openDatabase(process.env.DB_PATH ?? "./data/script-review.sqlite");
const port = Number(process.env.PORT ?? 3003);

serve({ fetch: createApp({ db, clock: systemClock }).fetch, port }, (info) => {
  console.log(`revisão de roteiro em http://127.0.0.1:${info.port}`);
});
