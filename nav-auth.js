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
    });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", refresh);
  } else {
    refresh();
  }
  sb.auth.onAuthStateChange(function () { refresh(); });
})();
