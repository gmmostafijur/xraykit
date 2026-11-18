/* XRayKit — shared header auth state.
   Hides the "Log in" menu link when a session exists and shows
   "My account" instead. Include AFTER the supabase-js CDN script. */
(function () {
  "use strict";
  var sb = window.supabase.createClient(
    "https://elbddcclcmmpqdxsdahg.supabase.co",
    "sb_publishable_hQlsoIPtOA5buM9KWk0pow_aa9t5OAI"
  );
  function refresh() {
    sb.auth.getSession().then(function (res) {
      var user = res.data && res.data.session && res.data.session.user;
      var login = document.getElementById("navLogin");
      var acct = document.getElementById("navAccount");
      if (login) login.style.display = user ? "none" : "";
      if (acct) acct.style.display = user ? "" : "none";
      /* Admins see "Admin" (to the dashboard) instead of "My account". */
      if (user && acct) {
        sb.from("profiles").select("is_admin").eq("id", user.id).maybeSingle().then(function (pr) {
          if (pr.data && pr.data.is_admin) {
            acct.textContent = "Admin";
            acct.setAttribute("href", "admin.html");
          }
        });
      }
      // Trial / launch offer ("Try Pro free") is for logged-out visitors
      // only — a logged-in user never sees it, even if they never took the trial.
      var offers = document.querySelectorAll("[data-logged-out-only]");
      for (var i = 0; i < offers.length; i++) offers[i].style.display = user ? "none" : "";
    });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", refresh);
  } else {
    refresh();
  }
  sb.auth.onAuthStateChange(function () { refresh(); });
})();
