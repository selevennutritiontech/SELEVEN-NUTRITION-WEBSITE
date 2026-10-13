/**
 * S-ELEVEN CREATOR PROGRAMME — BACKEND (Cloudflare Worker)
 * ------------------------------------------------------------
 * No Google. No Sheets. No Excel. No "app not verified" screens.
 * Data lives in a Cloudflare Workers KV namespace (a simple free
 * key-value database) and is only readable with the password below.
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // Handle CORS preflight requests
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // ---------------------------------------------------------
    // POST /submit — public application form sends new entries here
    // ---------------------------------------------------------
    if (url.pathname === "/submit" && request.method === "POST") {
      let data;
      try {
        data = await request.json();
      } catch (e) {
        return jsonResponse({ error: "Invalid JSON" }, 400, corsHeaders);
      }

      // Basic server-side validation — required fields must actually be present,
      // and nothing absurdly long gets stored (simple abuse/size guard).
      const clean = (val, maxLen) => String(val || "").trim().slice(0, maxLen || 500);
      const email = clean(data.email, 200);
      const phone = clean(data.phone, 40);

      if (!clean(data.fullName, 200) || !email || !phone) {
        return jsonResponse({ error: "fullName, email and phone are required" }, 400, corsHeaders);
      }

      // ---- light per-IP rate limit (max 5 submissions/hour) — basic spam guard ----
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      const rlKey = "rl:" + ip;
      const rlRaw = await env.SUBMISSIONS.get(rlKey);
      const rlCount = rlRaw ? parseInt(rlRaw, 10) : 0;
      if (rlCount >= 5) {
        return jsonResponse({ error: "Too many submissions from this network. Please try again later." }, 429, corsHeaders);
      }
      await env.SUBMISSIONS.put(rlKey, String(rlCount + 1), { expirationTtl: 3600 });

      // ---- single-user, single-registration check ----
      // Normalize so trivial formatting differences (spaces, dashes, case) still match.
      const normEmail = email.toLowerCase();
      const normPhone = phone.replace(/[^0-9]/g, "");

      const existingList = await env.SUBMISSIONS.list({ prefix: "sub:" });
      for (const key of existingList.keys) {
        const existingRaw = await env.SUBMISSIONS.get(key.name);
        if (!existingRaw) continue;
        const existing = JSON.parse(existingRaw);
        const existingEmail = String(existing.email || "").trim().toLowerCase();
        const existingPhone = String(existing.phone || "").replace(/[^0-9]/g, "");
        if ((existingEmail && existingEmail === normEmail) || (existingPhone && existingPhone === normPhone)) {
          return jsonResponse(
            { error: "An application already exists with this email or phone number." },
            409,
            corsHeaders
          );
        }
      }

      // ---- tight race-condition guard ----
      // The scan above catches duplicates against everything already saved, but two
      // requests arriving within milliseconds of each other (e.g. a double-tap on
      // Submit) can both pass that scan before either has actually been written yet.
      // These dedicated claim keys close that gap: whichever request claims them
      // first wins, the other is rejected as a duplicate right here.
      const emailClaimKey = "claim:email:" + normEmail;
      const phoneClaimKey = normPhone ? "claim:phone:" + normPhone : null;

      const [emailClaimed, phoneClaimed] = await Promise.all([
        env.SUBMISSIONS.get(emailClaimKey),
        phoneClaimKey ? env.SUBMISSIONS.get(phoneClaimKey) : Promise.resolve(null),
      ]);
      if (emailClaimed || phoneClaimed) {
        return jsonResponse(
          { error: "An application already exists with this email or phone number." },
          409,
          corsHeaders
        );
      }
      await Promise.all([
        env.SUBMISSIONS.put(emailClaimKey, "1"),
        phoneClaimKey ? env.SUBMISSIONS.put(phoneClaimKey, "1") : Promise.resolve(),
      ]);

      const key = "sub:" + Date.now() + ":" + crypto.randomUUID();

      const entry = {
        id: key,
        timestamp: new Date().toISOString(),
        fullName: clean(data.fullName, 200),
        phone: phone,
        email: email,
        city: clean(data.city, 150),
        country: clean(data.country, 100),
        stateProvince: clean(data.stateProvince, 150),
        addressLine: clean(data.addressLine, 400),
        pincode: clean(data.pincode, 30),
        platform: clean(data.platform, 100),
        handle: clean(data.handle, 200),
        followers: clean(data.followers, 40),
        avgViews: clean(data.avgViews, 40),
        dealerRef: clean(data.dealerRef, 300),
        contentStyle: clean(data.contentStyle, 150),
        pitch: clean(data.pitch, 3000),
        specializations: clean(data.specializations, 500),
        associate: clean(data.associate, 300),
        agreed: clean(data.agreed, 20),
        // team-managed fields, set later from the dashboard
        status: "",
        brand: "",
        stage: "",
        note: "",
        productMRP: "",
        depositReceived: "",
        productSent: "",
        repeatEligible: "",
        repeatBrand: "",
      };

      await env.SUBMISSIONS.put(key, JSON.stringify(entry));

      return jsonResponse({ result: "success" }, 200, corsHeaders);
    }

    // ---------------------------------------------------------
    // GET /data?password=... — dashboard pulls submissions from here
    // ---------------------------------------------------------
    if (url.pathname === "/data" && request.method === "GET") {
      const providedPassword = url.searchParams.get("password");

      if (providedPassword !== env.ADMIN_PASSWORD) {
        return jsonResponse({ error: "Unauthorized" }, 401, corsHeaders);
      }

      const list = await env.SUBMISSIONS.list({ prefix: "sub:" });
      const entries = [];
      for (const key of list.keys) {
        const value = await env.SUBMISSIONS.get(key.name);
        if (value) {
          const parsed = JSON.parse(value);
          // Entries submitted before this update won't have an id field yet — use the KV key itself.
          if (!parsed.id) parsed.id = key.name;
          entries.push(parsed);
        }
      }

      entries.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

      return jsonResponse({ submissions: entries }, 200, corsHeaders);
    }

    // ---------------------------------------------------------
    // POST /update?password=... — dashboard sets status / brand / note
    // Body: { id: "<the sub:... key>", field: "status"|"brand"|"note", value: "..." }
    // ---------------------------------------------------------
    if (url.pathname === "/update" && request.method === "POST") {
      const providedPassword = url.searchParams.get("password");

      if (providedPassword !== env.ADMIN_PASSWORD) {
        return jsonResponse({ error: "Unauthorized" }, 401, corsHeaders);
      }

      let body;
      try {
        body = await request.json();
      } catch (e) {
        return jsonResponse({ error: "Invalid JSON" }, 400, corsHeaders);
      }

      const { id, field, value } = body;
      const allowedFields = ["status", "brand", "stage", "note", "productMRP", "depositReceived", "productSent", "repeatEligible", "repeatBrand"];

      if (!id || !field) {
        return jsonResponse({ error: "id and field are required" }, 400, corsHeaders);
      }
      if (!allowedFields.includes(field)) {
        return jsonResponse({ error: "field must be one of: " + allowedFields.join(", ") }, 400, corsHeaders);
      }

      const existingRaw = await env.SUBMISSIONS.get(id);
      if (!existingRaw) {
        return jsonResponse({ error: "Submission not found" }, 404, corsHeaders);
      }

      const existing = JSON.parse(existingRaw);
      existing[field] = value;
      await env.SUBMISSIONS.put(id, JSON.stringify(existing));

      return jsonResponse({ result: "success" }, 200, corsHeaders);
    }

    // ---------------------------------------------------------
    // POST /delete?password=... — dashboard removes an entry entirely
    // Body: { id: "<the sub:... key>" }
    // ---------------------------------------------------------
    if (url.pathname === "/delete" && request.method === "POST") {
      const providedPassword = url.searchParams.get("password");

      if (providedPassword !== env.ADMIN_PASSWORD) {
        return jsonResponse({ error: "Unauthorized" }, 401, corsHeaders);
      }

      let body;
      try {
        body = await request.json();
      } catch (e) {
        return jsonResponse({ error: "Invalid JSON" }, 400, corsHeaders);
      }

      const { id } = body;
      if (!id) {
        return jsonResponse({ error: "id is required" }, 400, corsHeaders);
      }

      const existingRaw = await env.SUBMISSIONS.get(id);
      if (!existingRaw) {
        return jsonResponse({ error: "Submission not found" }, 404, corsHeaders);
      }

      // Release the claim keys too, so this email/phone can submit again if needed
      // (e.g. deleting an accidental duplicate frees the other one back up).
      const existing = JSON.parse(existingRaw);
      const normEmail = String(existing.email || "").trim().toLowerCase();
      const normPhone = String(existing.phone || "").replace(/[^0-9]/g, "");
      await Promise.all([
        env.SUBMISSIONS.delete(id),
        normEmail ? env.SUBMISSIONS.delete("claim:email:" + normEmail) : Promise.resolve(),
        normPhone ? env.SUBMISSIONS.delete("claim:phone:" + normPhone) : Promise.resolve(),
      ]);

      return jsonResponse({ result: "success" }, 200, corsHeaders);
    }

    // ---------------------------------------------------------
    // POST /notify?password=... — sends the applicant-facing status message
    // Body: { id: "<the sub:... key>", event: "reviewed"|"accepted"|"rejected" }
    //
    // This composes the message and relays it to env.NOTIFY_WEBHOOK_URL — point
    // that at a Zapier/Make.com webhook (or your own relay) wired to whichever
    // SMS/WhatsApp/email provider you use (Twilio, MSG91, Gupshup, SendGrid,
    // etc). The webhook receives { name, phone, email, event, brand, message }
    // and is responsible for actually sending it — this Worker doesn't talk to
    // any SMS/email provider directly, since that depends entirely on which
    // one you sign up with.
    // ---------------------------------------------------------
    if (url.pathname === "/notify" && request.method === "POST") {
      const providedPassword = url.searchParams.get("password");

      if (providedPassword !== env.ADMIN_PASSWORD) {
        return jsonResponse({ error: "Unauthorized" }, 401, corsHeaders);
      }

      let body;
      try {
        body = await request.json();
      } catch (e) {
        return jsonResponse({ error: "Invalid JSON" }, 400, corsHeaders);
      }

      const { id, event } = body;
      if (!id || !event) {
        return jsonResponse({ error: "id and event are required" }, 400, corsHeaders);
      }

      const existingRaw = await env.SUBMISSIONS.get(id);
      if (!existingRaw) {
        return jsonResponse({ error: "Submission not found" }, 404, corsHeaders);
      }
      const s = JSON.parse(existingRaw);
      const name = s.fullName || "there";
      const brand = s.brand || "the brand";

      let message;
      if (event === "reviewed") {
        message = "Hi " + name + ", thank you for applying to the S-Eleven Creator Programme. Your application has been received and is currently under review. We'll be in touch soon!";
      } else if (event === "accepted") {
        message = "Congratulations " + name + "! Your profile has been accepted for a collaboration with " + brand + " under the S-Eleven Creator Programme. Welcome aboard — our team will reach out shortly with your onboarding details.";
      } else if (event === "rejected") {
        message = "Hi " + name + ", thank you for your interest in the S-Eleven Creator Programme. Unfortunately, your profile is not currently matching our brand criteria and is not eligible at this time. Do explore our page and keep an eye out for future opportunities — we'd love to see you apply again.";
      } else {
        return jsonResponse({ error: "event must be one of: reviewed, accepted, rejected" }, 400, corsHeaders);
      }

      // Don't re-send the same notification twice (e.g. status re-saved by accident).
      const notifKey = "notif:" + id + ":" + event;
      const alreadySent = await env.SUBMISSIONS.get(notifKey);
      if (alreadySent) {
        return jsonResponse({ result: "skipped", reason: "already sent", message }, 200, corsHeaders);
      }

      let sent = false;
      let reason = "NOTIFY_WEBHOOK_URL is not configured — message composed but nothing was sent";
      if (env.NOTIFY_WEBHOOK_URL) {
        try {
          const res = await fetch(env.NOTIFY_WEBHOOK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: name, phone: s.phone, email: s.email, event: event, brand: brand, message: message }),
          });
          sent = res.ok;
          reason = res.ok ? "" : "webhook responded with an error";
        } catch (e) {
          reason = "webhook request failed";
        }
      }

      if (sent) {
        await env.SUBMISSIONS.put(notifKey, "1");
      }

      return jsonResponse({ result: "success", sent: sent, reason: reason, message: message }, 200, corsHeaders);
    }

    return jsonResponse({ error: "Not found" }, 404, corsHeaders);
  },
};

function jsonResponse(obj, status, corsHeaders) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}
