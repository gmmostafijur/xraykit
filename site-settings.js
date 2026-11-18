/* XRayKit — shared site settings.
   Fetches the public site_settings rows once and caches them.
   Include AFTER the supabase-js CDN script. */
(function () {
  "use strict";
  var sb = window.supabase.createClient(
    "https://elbddcclcmmpqdxsdahg.supabase.co",
    "sb_publishable_hQlsoIPtOA5buM9KWk0pow_aa9t5OAI"
  );
  var defaults = {
    pro_price_usd: 7, trial_days: 3, free_audit_limit: 1,
    pro_audit_limit: 30, signups_paused: false,
    features: {
      ai_image: true, hashtags: true, auto_posting: false,
      tracker: true, history: true, compare: true,
      scheduler: true, custom_packages: true, share_card: true
    }
  };
  var cache = null;
  function load() {
    if (cache) return cache;
    cache = sb.from("site_settings").select("key,value").then(function (res) {
      var out = JSON.parse(JSON.stringify(defaults));
      if (res.data) res.data.forEach(function (row) {
        if (row.key === "features" && row.value && typeof row.value === "object") {
          for (var k in row.value) out.features[k] = row.value[k];
        } else {
          out[row.key] = row.value;
        }
      });
      return out;
    }).catch(function () {
      return JSON.parse(JSON.stringify(defaults));
    });
    return cache;
  }
  window.XRayKitSettings = {
    load: load,
    /* Feature guard: when the flag is off, show #featureOff (if the page
       has one) and hide every [data-feature-body] on the page. */
    guard: function (flag) {
      load().then(function (s) {
        if (s.features && s.features[flag] === false) {
          var note = document.getElementById("featureOff");
          if (note) note.style.display = "";
          var bodies = document.querySelectorAll("[data-feature-body]");
          for (var i = 0; i < bodies.length; i++) bodies[i].style.display = "none";
        }
      });
    }
  };
})();
