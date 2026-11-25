"use client";

import { useState } from "react";

const ACCOUNT = "MN570005005564307659";

// The page written on the old map (Figma "Frame 2", node 55:27): thanks, the donation account
// with a copy button, a box for a message to the author, and the way out; a second side of the
// page takes requests from people who want to work together. It is laid over the unrolled sheet
// at `rect` (its place on screen): drawn at PAGE_W wide and scaled to fit.
const PAGE_W = 420; // the sheet is 2 : 3, so the page is 420 × 630

/** POST a message to the author; resolves true when it was stored. */
async function post(body) {
  try {
    const r = await fetch("/api/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return r.ok;
  } catch {
    return false;
  }
}

const STATUS = { ok: "Илгээлээ, баярлалаа!", error: "Илгээж чадсангүй, дахин оролдоно уу" };

export default function Thanks({ rect, onClose }) {
  const [side, setSide] = useState("thanks"); // "thanks" · "collab"

  return (
    <div
      className="thanks"
      role="dialog"
      aria-labelledby="thanks-title"
      style={{
        left: rect.left,
        top: rect.top,
        width: PAGE_W,
        transform: `scale(${rect.width / PAGE_W})`,
      }}
    >
      {side === "thanks" ? (
        <ThanksSide onCollab={() => setSide("collab")} onClose={onClose} />
      ) : (
        <CollabSide onBack={() => setSide("thanks")} onClose={onClose} />
      )}
    </div>
  );
}

function ThanksSide({ onCollab, onClose }) {
  const [copied, setCopied] = useState(false);
  const [text, setText] = useState("");
  const [sent, setSent] = useState(null); // null · "sending" · "ok" · "error"

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(ACCOUNT);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const send = async (e) => {
    e.preventDefault();
    if (!text.trim() || sent === "sending") return;
    setSent("sending");
    const ok = await post({ kind: "message", text });
    setSent(ok ? "ok" : "error");
    if (ok) setText("");
  };

  return (
    <div className="thanks-body">
      <h2 id="thanks-title">
        Миний хийсэн тоглоомыг
        <br />
        тоглосонд баярлалаа!
      </h2>
      <p>Намайг дэмжихийг хүсвэл доорх дансанд хандив өгч болно</p>
      <p className="account">
        Хаан банк
        <br />
        {ACCOUNT}
      </p>
      <button type="button" className="glass-btn" onClick={copy}>
        {copied ? "Хуулагдлаа ✓" : "Хуулах"}
      </button>

      <form className="message" onSubmit={send}>
        <textarea
          value={text}
          maxLength={1000}
          placeholder="Санал, сэтгэгдлээ бичээрэй…"
          aria-label="Зурвас"
          onChange={(e) => {
            setText(e.target.value);
            if (sent !== "sending") setSent(null);
          }}
        />
        <span className="status" aria-live="polite">
          {STATUS[sent]}
        </span>
        <button
          type="submit"
          className="glass-btn send"
          aria-label="Илгээх"
          disabled={!text.trim() || sent === "sending"}
        >
          <img src="/intro/send-arrow.svg" width={22} height={15} alt="" />
        </button>
      </form>

      <div className="row">
        <button type="button" className="glass-btn" onClick={onCollab}>
          Хамтран ажиллах
        </button>
        <button type="button" className="glass-btn" onClick={onClose}>
          гарах
        </button>
      </div>
    </div>
  );
}

function CollabSide({ onBack, onClose }) {
  const [form, setForm] = useState({ name: "", contact: "", text: "" });
  const [sent, setSent] = useState(null); // null · "sending" · "ok" · "error"
  const ready = form.name.trim() && form.contact.trim() && form.text.trim();
  const field = (key) => ({
    value: form[key],
    onChange: (e) => {
      setForm((f) => ({ ...f, [key]: e.target.value }));
      if (sent !== "sending") setSent(null);
    },
  });

  const send = async (e) => {
    e.preventDefault();
    if (!ready || sent === "sending") return;
    setSent("sending");
    const ok = await post({ kind: "collab", ...form });
    setSent(ok ? "ok" : "error");
    if (ok) setForm({ name: "", contact: "", text: "" });
  };

  return (
    <div className="thanks-body">
      <h2 id="thanks-title">Хамтран ажиллах</h2>
      <p>
        Хамтдаа ямар нэгэн зүйл бүтээх санаа байвал доорх хэсгийг бөглөөрэй. Би эргээд холбогдоно.
      </p>

      <form className="collab" onSubmit={send}>
        <input type="text" placeholder="Нэр" aria-label="Нэр" maxLength={100} {...field("name")} />
        <input
          type="text"
          placeholder="Имэйл эсвэл утас"
          aria-label="Имэйл эсвэл утас"
          maxLength={120}
          {...field("contact")}
        />
        <div className="message">
          <textarea
            placeholder="Ямар ажил дээр хамтрах вэ?"
            aria-label="Хамтран ажиллах санал"
            maxLength={1000}
            {...field("text")}
          />
          <span className="status" aria-live="polite">
            {STATUS[sent]}
          </span>
          <button
            type="submit"
            className="glass-btn send"
            aria-label="Илгээх"
            disabled={!ready || sent === "sending"}
          >
            <img src="/intro/send-arrow.svg" width={22} height={15} alt="" />
          </button>
        </div>
      </form>

      <div className="row">
        <button type="button" className="glass-btn" onClick={onBack}>
          ← Буцах
        </button>
        <button type="button" className="glass-btn" onClick={onClose}>
          гарах
        </button>
      </div>
    </div>
  );
}
