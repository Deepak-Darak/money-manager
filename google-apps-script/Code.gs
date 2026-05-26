const SHEET_NAME = "money_manager_data";

function doGet() {
  return jsonResponse({ ok: true, message: "Money Manager Sync API is running" });
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    const action = body.action;
    const idToken = body.idToken;
    const payload = body.payload;

    if (!action || !idToken) {
      return jsonResponse({ ok: false, message: "Missing action or idToken" });
    }

    const user = verifyGoogleIdToken(idToken);
    if (!user || !user.email) {
      return jsonResponse({ ok: false, message: "Invalid Google token" });
    }

    if (action === "push") {
      if (!payload) {
        return jsonResponse({ ok: false, message: "Missing payload" });
      }
      upsertUserData(user.email, payload);
      return jsonResponse({ ok: true, message: "Saved" });
    }

    if (action === "pull") {
      const data = getUserData(user.email);
      return jsonResponse({ ok: true, data: data });
    }

    return jsonResponse({ ok: false, message: "Unknown action" });
  } catch (error) {
    return jsonResponse({ ok: false, message: String(error) });
  }
}

function verifyGoogleIdToken(idToken) {
  const url = "https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(idToken);
  const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) {
    return null;
  }

  const tokenInfo = JSON.parse(response.getContentText());
  const expectedClientId = PropertiesService.getScriptProperties().getProperty("GOOGLE_CLIENT_ID");

  if (expectedClientId && tokenInfo.aud !== expectedClientId) {
    return null;
  }

  return {
    email: tokenInfo.email,
    name: tokenInfo.name
  };
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
