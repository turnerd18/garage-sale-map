// Val Town function: garage sales API backed by SQL store.
// Configure these vals/secrets:
// - TURSO_DATABASE_URL
// - TURSO_AUTH_TOKEN

import { createClient } from "https://esm.sh/@libsql/client@0.14.0/web";

const db = createClient({
  url: Deno.env.get("TURSO_DATABASE_URL") ?? "",
  authToken: Deno.env.get("TURSO_AUTH_TOKEN") ?? ""
});

const RATE_LIMIT_SECONDS = 60;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,PATCH,OPTIONS",
      "access-control-allow-headers": "content-type,x-forwarded-for,cf-connecting-ip"
    }
  });
}

function getIp(request: Request) {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    "unknown"
  );
}

async function isRateLimited(ip: string) {
  const result = await db.execute({
    sql: `
      SELECT updated_at, created_at
      FROM locations
      WHERE last_updated_ip_address = ?1
      ORDER BY COALESCE(updated_at, created_at) DESC
      LIMIT 1
    `,
    args: [ip]
  });

  if (!result.rows.length) return false;

  const row = result.rows[0] as Record<string, string | null>;
  const last = row.updated_at ?? row.created_at;
  if (!last) return false;

  const secondsSince = (Date.now() - new Date(last).getTime()) / 1000;
  return secondsSince < RATE_LIMIT_SECONDS;
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") return json({ ok: true });

  const url = new URL(request.url);
  const ip = getIp(request);

  if (request.method === "GET") {
    const includeClosed = url.searchParams.get("includeClosed") === "true";
    const result = await db.execute({
      sql: `
        SELECT id, street_address, city, state, zip, name,
               last_updated_ip_address, is_closed, created_at, updated_at
        FROM locations
        ${includeClosed ? "" : "WHERE is_closed = 0"}
        ORDER BY is_closed ASC, updated_at DESC, created_at DESC
      `
    });

    return json({ sales: result.rows });
  }

  if (request.method === "POST") {
    if (await isRateLimited(ip)) {
      return json({ error: "Too many requests from this IP. Wait 60 seconds." }, 429);
    }

    const body = await request.json();
    const now = new Date().toISOString();

    const result = await db.execute({
      sql: `
        INSERT INTO locations (
          street_address, city, state, zip, name,
          last_updated_ip_address, is_closed, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7, ?7)
        RETURNING id
      `,
      args: [
        body.street_address,
        body.city,
        body.state,
        body.zip,
        body.name,
        ip,
        now
      ]
    });

    return json({ ok: true, id: result.rows[0]?.id }, 201);
  }

  if (request.method === "PATCH") {
    if (await isRateLimited(ip)) {
      return json({ error: "Too many requests from this IP. Wait 60 seconds." }, 429);
    }

    const body = await request.json();
    const now = new Date().toISOString();

    await db.execute({
      sql: `
        UPDATE locations
        SET is_closed = ?1,
            last_updated_ip_address = ?2,
            updated_at = ?3
        WHERE id = ?4
      `,
      args: [body.is_closed ? 1 : 0, ip, now, body.id]
    });

    return json({ ok: true });
  }

  return json({ error: "Method not allowed" }, 405);
}
