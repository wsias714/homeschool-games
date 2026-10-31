/* In-app Feedback button, shared by every app Wade builds (his rule, 2026-10-31).
 * One plain ES module, no dependencies, no stylesheet (styles are set through the DOM, so it also works under
 * a strict Content-Security-Policy). Vendor a copy into the app (see README.md); do not edit the copy.
 *
 *   import { initFeedback } from "./feedback.js";
 *   initFeedback({ app: "workout", version: "1.4.0", upload: async (item) => { ...store item... } });
 *
 * `app` must be a key of ai-housekeeping/config/feedback-apps.json. How the item travels is the app's choice:
 *   upload(item)   store it somewhere the collector reads (Dropbox: feedback/<id>.json). Throw to retry later.
 *   endpoint       POST the item as JSON to a same-origin route (desktop apps).
 *   neither        saved on the device; the panel offers an "Email it" link (mailto) instead. The address is never in
 *                  the code (these repos are public): pass `email` from a private place, or the panel asks for it once
 *                  and keeps it on the device.
 * Items are saved on the device first, so a failed or offline send is retried on the next load or "online".
 */

const GOLD = "#e8b84a";

function uid() {
  const a = new Uint8Array(8);
  (globalThis.crypto || { getRandomValues: (x) => x.map(() => Math.floor(Math.random() * 256)) }).getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

function device() {
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || matchMedia("(pointer: coarse)").matches;
  const standalone = !!(navigator.standalone || matchMedia("(display-mode: standalone)").matches);
  return { kind: mobile ? "mobile" : "desktop", ua: navigator.userAgent.slice(0, 80), screen: `${innerWidth}x${innerHeight}`, standalone: String(standalone) };
}

function style(el, css) {
  Object.assign(el.style, css);
  return el;
}

function el(tag, css, props) {
  const e = document.createElement(tag);
  if (props) Object.assign(e, props);
  return style(e, css || {});
}

export function initFeedback(opts) {
  const o = Object.assign({ version: "", hold: 0, bottom: 14, side: "right", email: "", label: "Feedback" }, opts);
  if (!o.app || document.getElementById("app-feedback-root")) return { flush: () => Promise.resolve(), open: () => {} };
  const QKEY = "app-feedback-queue:" + o.app;

  const load = () => { try { return JSON.parse(localStorage.getItem(QKEY) || "[]"); } catch { return []; } };
  const save = (q) => { try { localStorage.setItem(QKEY, JSON.stringify(q)); } catch { /* private mode: send now or lose it */ } };

  async function deliver(item) {
    if (o.upload) return o.upload(item);
    if (o.endpoint) {
      const r = await fetch(o.endpoint, { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, o.headers), body: JSON.stringify(item) });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return;
    }
    throw new Error("no transport");
  }

  let flushing = null;
  function flush() {
    if (flushing) return flushing;
    flushing = (async () => {
      let sent = 0;
      for (const item of load()) {
        try { await deliver(item); save(load().filter((x) => x.id !== item.id)); sent++; } catch { break; }
      }
      return sent;
    })().finally(() => { flushing = null; });
    return flushing;
  }

  const EKEY = "app-feedback-email";
  const addr = () => { try { return o.email || localStorage.getItem(EKEY) || ""; } catch { return o.email; } };
  const mailto = (item) =>
    "mailto:" + addr() + "?subject=" + encodeURIComponent(`[feedback:${o.app}] ${item.text.slice(0, 60)}`) +
    "&body=" + encodeURIComponent(`${item.text}\n\nDevice: ${item.device.kind} ${item.device.screen} v${item.version}`);

  // ---- UI -------------------------------------------------------------------------------------------------
  const root = el("div", { position: "fixed", zIndex: "2147483000", [o.side]: "12px", bottom: `calc(env(safe-area-inset-bottom, 0px) + ${o.bottom}px)`, fontFamily: "system-ui, sans-serif" }, { id: "app-feedback-root" });
  const fab = el("button", { width: "44px", height: "44px", borderRadius: "22px", border: "1px solid rgba(255,255,255,.25)", background: "#1d1d22", color: GOLD, fontSize: "20px", lineHeight: "1", cursor: "pointer", boxShadow: "0 2px 10px rgba(0,0,0,.45)", opacity: ".8", padding: "0" },
    { type: "button", textContent: "\u{1F4AC}", title: o.label, ariaLabel: "Send feedback about this app" });
  const panel = el("div", { display: "none", position: "absolute", [o.side]: "0", bottom: "54px", width: "min(340px, calc(100vw - 24px))", background: "#1d1d22", color: "#f2f2f2", border: "1px solid rgba(255,255,255,.2)", borderRadius: "12px", padding: "12px", boxShadow: "0 8px 30px rgba(0,0,0,.55)", boxSizing: "border-box" }, { role: "dialog", ariaLabel: "Feedback" });
  const title = el("div", { fontSize: "14px", fontWeight: "600", marginBottom: "8px" }, { textContent: "Feedback on this app" });
  const chips = el("div", { display: "flex", gap: "6px", marginBottom: "8px" });
  let kind = "bug";
  const chipEls = [["bug", "Problem"], ["idea", "Idea"], ["other", "Other"]].map(([k, name]) => {
    const c = el("button", { flex: "1", padding: "8px 4px", fontSize: "14px", borderRadius: "8px", border: "1px solid rgba(255,255,255,.25)", background: "transparent", color: "#f2f2f2", cursor: "pointer" }, { type: "button", textContent: name });
    c.onclick = () => { kind = k; paint(); };
    chips.append(c);
    return [k, c];
  });
  const paint = () => chipEls.forEach(([k, c]) => style(c, { background: k === kind ? GOLD : "transparent", color: k === kind ? "#111" : "#f2f2f2" }));
  const box = el("textarea", { width: "100%", height: "110px", boxSizing: "border-box", fontSize: "16px", padding: "8px", borderRadius: "8px", border: "1px solid rgba(255,255,255,.25)", background: "#101014", color: "#f2f2f2", resize: "vertical", fontFamily: "inherit" }, { placeholder: "What happened, or what would make this better?" });
  const msg = el("div", { fontSize: "13px", minHeight: "18px", margin: "6px 0", color: "#bbb" });
  const row = el("div", { display: "flex", gap: "8px" });
  const send = el("button", { flex: "1", padding: "10px", fontSize: "15px", fontWeight: "600", borderRadius: "8px", border: "0", background: GOLD, color: "#111", cursor: "pointer" }, { type: "button", textContent: "Send" });
  const close = el("button", { padding: "10px 14px", fontSize: "15px", borderRadius: "8px", border: "1px solid rgba(255,255,255,.25)", background: "transparent", color: "#f2f2f2", cursor: "pointer" }, { type: "button", textContent: "Close" });
  const who = el("input", { display: "none", width: "100%", boxSizing: "border-box", fontSize: "16px", padding: "8px", margin: "0 0 6px", borderRadius: "8px", border: "1px solid rgba(255,255,255,.25)", background: "#101014", color: "#f2f2f2" }, { type: "email", placeholder: "Your email, to send it by mail (kept on this device)" });
  const mail = el("a", { display: "none", fontSize: "13px", color: GOLD, margin: "0 0 6px" }, { textContent: "Email it instead", target: "_blank", rel: "noopener" });
  row.append(send, close);
  panel.append(title, chips, box, msg, who, mail, row);
  root.append(panel, fab);
  if (o.fab === false) { fab.style.display = "none"; panel.style.bottom = "0"; }   // opened from the app's own Settings instead

  const open = () => { panel.style.display = "block"; msg.textContent = ""; mail.style.display = "none"; who.style.display = "none"; paint(); box.focus(); };
  const hide = () => { panel.style.display = "none"; };
  close.onclick = hide;
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });

  if (o.hold > 0) {                      // kids' games: a press-and-hold keeps small fingers out
    let t;
    const start = () => { t = setTimeout(open, o.hold); };
    const stop = () => clearTimeout(t);
    fab.addEventListener("pointerdown", start);
    ["pointerup", "pointerleave", "pointercancel"].forEach((ev) => fab.addEventListener(ev, stop));
    style(fab, { opacity: ".35" });
  } else {
    fab.onclick = () => (panel.style.display === "block" ? hide() : open());
  }

  send.onclick = async () => {
    const text = box.value.trim();
    if (!text) { msg.textContent = "Type a few words first."; return; }
    const item = { id: uid(), app: o.app, kind, text: text.slice(0, 4000), ts: new Date().toISOString(), version: o.version, device: device() };
    save(load().concat(item));
    box.value = "";
    send.disabled = true;
    msg.textContent = "Sending…";
    await flush();
    send.disabled = false;
    if (!load().some((x) => x.id === item.id)) {
      msg.textContent = "Sent. It will be looked at tomorrow.";
      setTimeout(hide, 1600);
    } else {
      msg.textContent = o.upload || o.endpoint ? "Saved on this device; it will send when you are back online." : "Saved on this device.";
      const show = () => { mail.href = mailto(item); mail.style.display = "inline-block"; who.style.display = "none"; };
      if (addr()) show();
      else {
        who.style.display = "block";
        who.onchange = () => { try { localStorage.setItem(EKEY, who.value.trim()); } catch { /* keep going */ } if (addr()) show(); };
      }
    }
  };

  (document.body || document.documentElement).append(root);
  addEventListener("online", flush);
  flush();
  return { flush, open };
}
