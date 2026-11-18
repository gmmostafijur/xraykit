/* XRayKit — on-site live chatbox.
   Floating button on every public page; visitors write without an account,
   messages land in Supabase (chat_messages) and the admin answers from
   Admin -> Messages. Include AFTER the supabase-js CDN script. */
(function () {
  "use strict";
  var sb = window.supabase.createClient(
    "https://elbddcclcmmpqdxsdahg.supabase.co",
    "sb_publishable_hQlsoIPtOA5buM9KWk0pow_aa9t5OAI"
  );
  var VID_KEY = "xraykit_visitor";
  var NAME_KEY = "xraykit_chat_name";
  var EMAIL_KEY = "xraykit_chat_email";
  var SEEN_KEY = "xraykit_chat_seen";

  function vid() {
    var v = null;
    try { v = localStorage.getItem(VID_KEY); } catch (e) {}
    if (!v) {
      v = "v-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
      try { localStorage.setItem(VID_KEY, v); } catch (e) {}
    }
    return v;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function fmtTime(iso) {
    var d = new Date(iso);
    return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  }

  var css = [
    "#xrChatBtn{position:fixed;right:18px;bottom:18px;z-index:9998;width:56px;height:56px;border-radius:50%;border:2px solid #131a05;background:#9be315;color:#131a05;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 22px rgba(0,0,0,.28)}",
    "#xrChatBtn:hover{transform:scale(1.06)}",
    "#xrChatDot{position:absolute;top:2px;right:2px;width:14px;height:14px;border-radius:50%;background:#ff5a4e;border:2px solid #fff;display:none}",
    "#xrChatPanel{position:fixed;right:18px;bottom:86px;z-index:9999;width:340px;max-width:calc(100vw - 36px);height:470px;max-height:calc(100vh - 120px);background:#fff;color:#111;border:1.5px solid #131a05;border-radius:16px;box-shadow:0 14px 40px rgba(0,0,0,.3);display:none;flex-direction:column;overflow:hidden;font-family:inherit}",
    "#xrChatPanel.open{display:flex}",
    "#xrChatHead{background:#0b100e;color:#fff;padding:12px 14px;display:flex;align-items:center;gap:10px}",
    "#xrChatHead .t{font-weight:700;font-size:15px}",
    "#xrChatHead .s{font-size:12px;color:#9be315}",
    "#xrChatClose{margin-left:auto;background:none;border:0;color:#fff;font-size:20px;cursor:pointer;line-height:1}",
    "#xrChatBody{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;background:#f4f6f2}",
    ".xr-msg{max-width:82%;padding:8px 11px;border-radius:12px;font-size:14px;line-height:1.45;white-space:pre-wrap;word-break:break-word}",
    ".xr-msg.me{align-self:flex-end;background:#9be315;color:#131a05;border-bottom-right-radius:4px}",
    ".xr-msg.them{align-self:flex-start;background:#fff;border:1px solid #d8dee0;border-bottom-left-radius:4px}",
    ".xr-msg .who{display:block;font-size:11px;font-weight:700;margin-bottom:2px;color:#555}",
    ".xr-msg .when{display:block;font-size:10px;color:#888;margin-top:3px;text-align:right}",
    "#xrChatMeta{padding:10px 12px 0;display:flex;gap:8px}",
    "#xrChatMeta input{flex:1;min-width:0;padding:8px 10px;border:1.5px solid #c9d1cd;border-radius:9px;font-size:13px}",
    "#xrChatFoot{padding:10px 12px;display:flex;gap:8px;border-top:1px solid #e3e8e3}",
    "#xrChatInput{flex:1;min-width:0;padding:9px 11px;border:1.5px solid #c9d1cd;border-radius:9px;font-size:14px}",
    "#xrChatSend{background:#0b100e;color:#fff;border:0;border-radius:9px;padding:0 14px;font-weight:700;cursor:pointer}",
    "#xrChatSend:disabled{opacity:.5;cursor:default}",
    "#xrChatHint{padding:0 12px 8px;font-size:12px;color:#666}"
  ].join("\n");

  function build() {
    var style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);

    var btn = document.createElement("button");
    btn.id = "xrChatBtn";
    btn.type = "button";
    btn.setAttribute("aria-label", "Chat with XRayKit");
    btn.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg><span id="xrChatDot"></span>';
    document.body.appendChild(btn);

    var panel = document.createElement("div");
    panel.id = "xrChatPanel";
    panel.innerHTML =
      '<div id="xrChatHead"><div><div class="t">Chat with XRayKit</div><div class="s">We usually reply within a day</div></div>' +
      '<button id="xrChatClose" type="button" aria-label="Close chat">&times;</button></div>' +
      '<div id="xrChatBody"></div>' +
      '<div id="xrChatMeta"><input id="xrChatName" type="text" placeholder="Your name" maxlength="60" /><input id="xrChatEmail" type="email" placeholder="Email (for the reply)" maxlength="120" /></div>' +
      '<div id="xrChatFoot"><input id="xrChatInput" type="text" placeholder="Ask about pricing, audits, anything…" maxlength="2000" /><button id="xrChatSend" type="button">Send</button></div>' +
      '<div id="xrChatHint">No account needed. Leave your email and we can reply to you there too.</div>';
    document.body.appendChild(panel);

    var body = panel.querySelector("#xrChatBody");
    var input = panel.querySelector("#xrChatInput");
    var sendBtn = panel.querySelector("#xrChatSend");
    var nameInput = panel.querySelector("#xrChatName");
    var emailInput = panel.querySelector("#xrChatEmail");
    var dot = btn.querySelector("#xrChatDot");
    var open = false;
    var lastCount = 0;

    try {
      nameInput.value = localStorage.getItem(NAME_KEY) || "";
      emailInput.value = localStorage.getItem(EMAIL_KEY) || "";
    } catch (e) {}
    if (nameInput.value && emailInput.value) panel.querySelector("#xrChatMeta").style.display = "none";

    function render(rows) {
      body.innerHTML = "";
      if (!rows || !rows.length) {
        body.innerHTML = '<p style="color:#666;font-size:13px;margin:6px 2px">Hi! Ask anything about XRayKit — pricing, audits, the custom package. A human (Mostafijur) answers.</p>';
        return;
      }
      rows.forEach(function (m) {
        var div = document.createElement("div");
        div.className = "xr-msg " + (m.is_admin ? "them" : "me");
        div.innerHTML = '<span class="who">' + esc(m.is_admin ? "XRayKit" : "You") + '</span>' +
          esc(m.body) + '<span class="when">' + esc(fmtTime(m.created_at)) + "</span>";
        body.appendChild(div);
      });
      body.scrollTop = body.scrollHeight;
    }

    function fetchMsgs() {
      return sb.rpc("get_chat", { p_visitor_id: vid() }).then(function (res) {
        if (res.error) return null;
        return res.data || [];
      }).catch(function () { return null; });
    }

    function refresh() {
      fetchMsgs().then(function (rows) {
        if (rows === null) return;
        render(rows);
        var adminNew = rows.filter(function (m) {
          return m.is_admin && new Date(m.created_at).getTime() > (Number(localStorage.getItem(SEEN_KEY)) || 0);
        }).length;
        dot.style.display = (!open && adminNew > 0) ? "" : "none";
        lastCount = rows.length;
      });
    }

    function markSeen() {
      try { localStorage.setItem(SEEN_KEY, String(Date.now())); } catch (e) {}
      dot.style.display = "none";
    }

    btn.addEventListener("click", function () {
      open = !open;
      panel.classList.toggle("open", open);
      if (open) { refresh(); markSeen(); input.focus(); }
    });
    panel.querySelector("#xrChatClose").addEventListener("click", function () {
      open = false;
      panel.classList.remove("open");
    });

    function send() {
      var text = input.value.trim();
      if (!text) return;
      var name = nameInput.value.trim();
      var email = emailInput.value.trim();
      sendBtn.disabled = true;
      sb.from("chat_messages").insert({
        visitor_id: vid(), name: name || null, email: email || null, body: text
      }).then(function (res) {
        sendBtn.disabled = false;
        if (res.error) {
          body.innerHTML += '<p style="color:#b3261e;font-size:13px">Could not send — check your connection and try again.</p>';
          return;
        }
        try {
          if (name) localStorage.setItem(NAME_KEY, name);
          if (email) localStorage.setItem(EMAIL_KEY, email);
        } catch (e) {}
        if (name && email) panel.querySelector("#xrChatMeta").style.display = "none";
        input.value = "";
        refresh();
      });
    }
    sendBtn.addEventListener("click", send);
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") send(); });

    refresh();
    setInterval(function () { refresh(); if (open) markSeen(); }, 8000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", build);
  } else {
    build();
  }
})();
