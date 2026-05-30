const SHEET_NAME = "money_manager_data";
const REQUEST_SKEW_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const NONCE_TTL_SECONDS = 10 * 60;
const RATE_LIMIT_PER_MIN = 30;
const RATE_LIMIT_PER_10_MIN = 120;
const FIREBASE_TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo";

function doGet() {
  return jsonResponse({ ok: true, message: "Money Manager Sync API is running" });
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    const action = String(body.action || "").trim();

    if (action === "verify") {
      return handleVerify_(body);
    }

    if (action === "pull" || action === "push") {
      return handleSignedDataRequest_(action, body);
    }

    return jsonResponse({ ok: false, message: "Unknown action" });
  } catch (error) {
    return jsonResponse({ ok: false, message: String(error) });
  }
}

function handleVerify_(body) {
  const email = normalizeEmail_(body.email);
  const password = String(body.password || "");

  if (!email || !password) {
    return jsonResponse({ ok: false, message: "Missing email or password" });
  }

  if (!isEmailAllowed_(email)) {
    return jsonResponse({ ok: false, message: "Email is not allowed" });
  }

  if (isRateLimited_(email)) {
    return jsonResponse({ ok: false, message: "Too many requests. Try again in a minute." });
  }

  if (!verifyPassword_(password)) {
    return jsonResponse({ ok: false, message: "Invalid password" });
  }

  const session = issueSession_(email);
  return jsonResponse({
    ok: true,
    message: "Authentication successful",
    email: email,
    sessionToken: session.token,
    expiresAt: session.expiresAt
  });
}

function handleSignedDataRequest_(action, body) {
  if (isFirebaseAuthRequest_(body)) {
    return handleFirebaseDataRequest_(action, body);
  }

  const authToken = String(body.authToken || "");
  const timestamp = Number(body.timestamp);
  const nonce = String(body.nonce || "");
  const signature = String(body.signature || "");
  const payload = body.payload;

  if (!authToken || !timestamp || !nonce || !signature) {
    return jsonResponse({ ok: false, message: "Missing signed request fields" });
  }

  if (action === "push" && payload == null) {
    return jsonResponse({ ok: false, message: "Missing payload" });
  }

  const session = validateSession_(authToken);
  if (!session) {
    return jsonResponse({ ok: false, message: "Session expired. Please sign in again." });
  }

  if (!isRateLimited_(session.email)) {
    // proceed
  } else {
    return jsonResponse({ ok: false, message: "Too many requests. Try again in a minute." });
  }

  if (Math.abs(Date.now() - timestamp) > REQUEST_SKEW_MS) {
    return jsonResponse({ ok: false, message: "Request expired" });
  }

  if (!consumeNonce_(session.tokenHash, nonce)) {
    return jsonResponse({ ok: false, message: "Replay blocked" });
  }

  const payloadHash = sha256Hex_(JSON.stringify(payload == null ? null : payload));
  const signingMessage = [action, String(timestamp), nonce, payloadHash].join("\n");
  const expectedSignature = hmacSha256Hex_(authToken, signingMessage);
  if (!safeEqual_(expectedSignature, signature.toLowerCase())) {
    return jsonResponse({ ok: false, message: "Invalid signature" });
  }

  if (action === "push") {
    upsertUserData(session.email, payload);
    return jsonResponse({ ok: true, message: "Saved", email: session.email });
  }

  const data = getUserData(session.email);
  return jsonResponse({ ok: true, data: data, email: session.email });
}

function isFirebaseAuthRequest_(body) {
  const authProvider = String(body.authProvider || "").trim().toLowerCase();
  const firebaseIdToken = String(body.firebaseIdToken || body.password || "").trim();
  return authProvider === "google-firebase" || firebaseIdToken.length > 0;
}

function handleFirebaseDataRequest_(action, body) {
  const firebaseIdToken = String(body.firebaseIdToken || body.password || "").trim();
  const payload = body.payload;

  if (!firebaseIdToken) {
    return jsonResponse({ ok: false, message: "Missing firebaseIdToken" });
  }

  if (action === "push" && payload == null) {
    return jsonResponse({ ok: false, message: "Missing payload" });
  }

  const verification = verifyFirebaseIdToken_(firebaseIdToken);
  if (!verification.ok) {
    return jsonResponse({ ok: false, message: verification.message || "Invalid Firebase token" });
  }

  const tokenEmail = normalizeEmail_(verification.email);
  if (!tokenEmail) {
    return jsonResponse({ ok: false, message: "Email missing in Firebase token" });
  }

  const requestedEmail = normalizeEmail_(body.email);
  if (requestedEmail && requestedEmail !== tokenEmail) {
    return jsonResponse({ ok: false, message: "Email mismatch" });
  }

  if (!isEmailAllowed_(tokenEmail)) {
    return jsonResponse({ ok: false, message: "Email is not allowed" });
  }

  if (isRateLimited_(tokenEmail)) {
    return jsonResponse({ ok: false, message: "Too many requests. Try again in a minute." });
  }

  if (action === "push") {
    upsertUserData(tokenEmail, payload);
    return jsonResponse({ ok: true, message: "Saved", email: tokenEmail });
  }

  const data = getUserData(tokenEmail);
  return jsonResponse({ ok: true, data: data, email: tokenEmail });
}

function verifyFirebaseIdToken_(idToken) {
  try {
    const response = UrlFetchApp.fetch(
      FIREBASE_TOKENINFO_URL + "?id_token=" + encodeURIComponent(idToken),
      {
        method: "get",
        muteHttpExceptions: true
      }
    );

    if (response.getResponseCode() !== 200) {
      return { ok: false, message: "Firebase token verification failed" };
    }

    const tokenInfo = JSON.parse(response.getContentText() || "{}");
    const email = normalizeEmail_(tokenInfo.email);
    const aud = String(tokenInfo.aud || "").trim();
    const iss = String(tokenInfo.iss || "").trim();
    const emailVerified = String(tokenInfo.email_verified || "").toLowerCase();
    const expSeconds = Number(tokenInfo.exp || 0);

    if (!email) {
      return { ok: false, message: "Firebase token has no email" };
    }

    if (emailVerified === "false") {
      return { ok: false, message: "Email is not verified" };
    }

    if (!expSeconds || Date.now() >= expSeconds * 1000) {
      return { ok: false, message: "Firebase token expired" };
    }

    const configuredProjectId = String(
      PropertiesService.getScriptProperties().getProperty("FIREBASE_PROJECT_ID") || ""
    ).trim();

    if (configuredProjectId) {
      if (aud !== configuredProjectId) {
        return { ok: false, message: "Token audience mismatch" };
      }

      const expectedIssuer = "https://securetoken.google.com/" + configuredProjectId;
      if (iss !== expectedIssuer) {
        return { ok: false, message: "Token issuer mismatch" };
      }
    } else {
      if (!aud || iss !== "https://securetoken.google.com/" + aud) {
        return { ok: false, message: "Token issuer or audience is invalid" };
      }
    }

    return { ok: true, email: email };
  } catch (error) {
    return {
      ok: false,
      message: "Unable to verify Firebase token: " + String(error)
    };
  }
}

function verifyPassword_(password) {
  const expectedPassword = PropertiesService.getScriptProperties().getProperty("APP_PASSWORD");
  if (!expectedPassword) {
    return false;
  }
  return safeEqual_(expectedPassword, password);
}

function normalizeEmail_(input) {
  return String(input || "").trim().toLowerCase();
}

function isEmailAllowed_(email) {
  const allowedRaw = PropertiesService.getScriptProperties().getProperty("ALLOWED_EMAILS");
  if (!allowedRaw) {
    return true;
  }
  const allowed = allowedRaw
    .split(",")
    .map(function(item) {
      return normalizeEmail_(item);
    })
    .filter(function(item) {
      return item;
    });
  return allowed.indexOf(email) !== -1;
}

function issueSession_(email) {
  const token = Utilities.getUuid().replace(/-/g, "") + Utilities.getUuid().replace(/-/g, "");
  const tokenHash = sha256Hex_(token);
  const expiresAtMs = Date.now() + SESSION_TTL_MS;
  const payload = {
    email: email,
    expiresAtMs: expiresAtMs
  };

  PropertiesService.getScriptProperties().setProperty(sessionKey_(tokenHash), JSON.stringify(payload));

  return {
    token: token,
    expiresAt: new Date(expiresAtMs).toISOString()
  };
}

function validateSession_(token) {
  const tokenHash = sha256Hex_(token);
  const key = sessionKey_(tokenHash);
  const raw = PropertiesService.getScriptProperties().getProperty(key);
  if (!raw) {
    return null;
  }

  const parsed = JSON.parse(raw);
  if (!parsed || !parsed.email || !parsed.expiresAtMs || Date.now() > Number(parsed.expiresAtMs)) {
    PropertiesService.getScriptProperties().deleteProperty(key);
    return null;
  }

  return {
    email: normalizeEmail_(parsed.email),
    tokenHash: tokenHash
  };
}

function sessionKey_(tokenHash) {
  return "SESSION_" + tokenHash;
}

function isRateLimited_(email) {
  const cache = CacheService.getScriptCache();
  const now = Date.now();

  const minuteBucket = Math.floor(now / 60000);
  const minuteKey = "RL_M_" + email + "_" + String(minuteBucket);
  const minuteCount = Number(cache.get(minuteKey) || "0") + 1;
  cache.put(minuteKey, String(minuteCount), 120);

  const tenMinuteBucket = Math.floor(now / 600000);
  const tenMinuteKey = "RL_10M_" + email + "_" + String(tenMinuteBucket);
  const tenMinuteCount = Number(cache.get(tenMinuteKey) || "0") + 1;
  cache.put(tenMinuteKey, String(tenMinuteCount), 12 * 60);

  return minuteCount > RATE_LIMIT_PER_MIN || tenMinuteCount > RATE_LIMIT_PER_10_MIN;
}

function consumeNonce_(tokenHash, nonce) {
  if (!nonce || nonce.length > 128) {
    return false;
  }
  const cache = CacheService.getScriptCache();
  const key = "NONCE_" + tokenHash + "_" + nonce;
  if (cache.get(key)) {
    return false;
  }
  cache.put(key, "1", NONCE_TTL_SECONDS);
  return true;
}

function hmacSha256Hex_(key, value) {
  return toHex_(Utilities.computeHmacSha256Signature(value, key));
}

function sha256Hex_(value) {
  return toHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value));
}

function toHex_(bytes) {
  return bytes
    .map(function(b) {
      const normalized = b < 0 ? b + 256 : b;
      return ("0" + normalized.toString(16)).slice(-2);
    })
    .join("");
}

function safeEqual_(a, b) {
  const aStr = String(a || "");
  const bStr = String(b || "");
  if (aStr.length !== bStr.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < aStr.length; i++) {
    diff |= aStr.charCodeAt(i) ^ bStr.charCodeAt(i);
  }
  return diff === 0;
}

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(["email", "payload_json", "updated_at"]);
  }
  return sheet;
}

function upsertUserData(email, payload) {
  const sheet = getSheet_();
  const values = sheet.getDataRange().getValues();
  const payloadJson = JSON.stringify(payload);
  const now = new Date().toISOString();

  for (let i = 1; i < values.length; i++) {
    if (values[i][0] === email) {
      sheet.getRange(i + 1, 2).setValue(payloadJson);
      sheet.getRange(i + 1, 3).setValue(now);
      return;
    }
  }

  sheet.appendRow([email, payloadJson, now]);
}

function getUserData(email) {
  const sheet = getSheet_();
  const values = sheet.getDataRange().getValues();

  for (let i = 1; i < values.length; i++) {
    if (values[i][0] === email) {
      if (!values[i][1]) {
        break;
      }
      return JSON.parse(values[i][1]);
    }
  }

  return {
    version: 1,
    transactions: [],
    accounts: [],
    accountTypes: []
  };
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
