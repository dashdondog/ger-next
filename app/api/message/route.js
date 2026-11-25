import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

// Messages from the page on the map:
//   { kind: "message", text }                    a note to the author
//   { kind: "collab", name, contact, text }      someone who wants to work together
// With TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID set (.env.local, or the host's environment
// settings) each one is sent to that Telegram chat by the bot. Without them they are kept in
// data/messages.jsonl, which only lasts on a server of its own (npm run dev / npm run start).
const FILE = path.join(process.cwd(), "data", "messages.jsonl");
const LIMITS = { text: 1000, name: 100, contact: 120 };

const clean = (v, max) => (typeof v === "string" && v.trim() && v.length <= max ? v.trim() : null);

/** The message as the author reads it in Telegram (plain text, so nothing needs escaping). */
function format(e) {
  if (e.kind === "collab") {
    return `🤝 Хамтран ажиллах хүсэлт\n\nНэр: ${e.name}\nХолбоо барих: ${e.contact}\n\n${e.text}`;
  }
  return `💬 Шинэ сэтгэгдэл\n\n${e.text}`;
}

async function toTelegram(e, token, chatId) {
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: format(e) }),
  });
  if (!r.ok) throw new Error(`telegram ${r.status}: ${await r.text()}`);
}

async function toFile(e) {
  await mkdir(path.dirname(FILE), { recursive: true });
  await appendFile(FILE, JSON.stringify(e) + "\n");
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "bad request" }, { status: 400 });
  }
  const kind = body.kind === "collab" ? "collab" : "message";
  const keys = kind === "collab" ? ["name", "contact", "text"] : ["text"];
  const entry = { at: new Date().toISOString(), kind };
  for (const k of keys) {
    entry[k] = clean(body[k], LIMITS[k]);
    if (!entry[k]) return Response.json({ error: `missing or too long: ${k}` }, { status: 400 });
  }

  const { TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: chatId } = process.env;
  try {
    if (token && chatId) await toTelegram(entry, token, chatId);
    else await toFile(entry);
  } catch (err) {
    console.error("message not delivered:", err.message);
    return Response.json({ error: "not delivered" }, { status: 502 });
  }
  return Response.json({ ok: true });
}
