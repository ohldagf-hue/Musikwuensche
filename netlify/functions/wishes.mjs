// Musikwünsche-API: speichert alle Wünsche in Netlify Blobs.
// GET    /api/wishes              -> Liste aller Wünsche (JSON)
// GET    /api/wishes?format=csv   -> Liste als CSV (für die Playlist)
// POST   /api/wishes              -> { action: "add", title, artist, decade, name }
//                                    { action: "vote", id }
// DELETE /api/wishes?id=...       -> Wunsch löschen (Header x-admin-key = ADMIN_KEY)

import { getStore } from "@netlify/blobs";

const KEY = "wishes";
const DECADES = ["70er", "80er", "90er"];

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const clean = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const norm = (v) => v.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");

async function load(store) {
  const data = await store.get(KEY, { type: "json", consistency: "strong" });
  return Array.isArray(data) ? data : [];
}

export default async (req) => {
  const store = getStore({ name: "musikwuensche", consistency: "strong" });
  const url = new URL(req.url);

  if (req.method === "GET") {
    const wishes = await load(store);
    if (url.searchParams.get("format") === "csv") {
      const esc = (s) => `"${String(s).replace(/"/g, '""')}"`;
      const rows = [["Song", "Interpret", "Jahrzehnt", "Gewünscht von", "Stimmen"]]
        .concat(
          [...wishes]
            .sort((a, b) => b.votes - a.votes)
            .map((w) => [w.title, w.artist, w.decade, w.names.join(", "), w.votes])
        )
        .map((r) => r.map(esc).join(";"));
      return new Response("﻿" + rows.join("\n"), {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": 'attachment; filename="musikwuensche.csv"',
        },
      });
    }
    return json(wishes);
  }

  if (req.method === "POST") {
    let body;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Ungültige Anfrage" }, 400);
    }
    if (body.website) return json({ ok: true }); // Spam-Falle

    const wishes = await load(store);

    if (body.action === "vote") {
      const w = wishes.find((x) => x.id === body.id);
      if (!w) return json({ error: "Wunsch nicht gefunden" }, 404);
      w.votes += 1;
      await store.setJSON(KEY, wishes);
      return json({ ok: true, wish: w });
    }

    const title = clean(body.title, 80);
    const artist = clean(body.artist, 80);
    const name = clean(body.name, 40) || "Anonym";
    const decade = DECADES.includes(body.decade) ? body.decade : "";
    if (!title || !artist) return json({ error: "Bitte Song und Interpret angeben." }, 400);
    if (wishes.length >= 500) return json({ error: "Die Wunschliste ist voll!" }, 400);

    // Gleicher Song schon da? Dann zählt der Wunsch als Stimme.
    const dup = wishes.find((x) => norm(x.title) === norm(title) && norm(x.artist) === norm(artist));
    if (dup) {
      dup.votes += 1;
      if (!dup.names.includes(name)) dup.names.push(name);
      await store.setJSON(KEY, wishes);
      return json({ ok: true, duplicate: true, wish: dup });
    }

    const wish = {
      id: crypto.randomUUID(),
      title,
      artist,
      decade,
      names: [name],
      votes: 1,
      created: new Date().toISOString(),
    };
    wishes.push(wish);
    await store.setJSON(KEY, wishes);
    return json({ ok: true, wish }, 201);
  }

  if (req.method === "DELETE") {
    const adminKey = process.env.ADMIN_KEY;
    if (!adminKey || req.headers.get("x-admin-key") !== adminKey) {
      return json({ error: "Nicht erlaubt" }, 403);
    }
    const id = url.searchParams.get("id");
    const wishes = await load(store);
    await store.setJSON(KEY, wishes.filter((w) => w.id !== id));
    return json({ ok: true });
  }

  return json({ error: "Methode nicht erlaubt" }, 405);
};

export const config = { path: "/api/wishes" };
