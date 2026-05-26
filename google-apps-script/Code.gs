const SHEET_NAME = "money_manager_data";

function doGet() {
  return jsonResponse({ ok: true, message: "Money Manager Sync API is running" });
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    const action = body.action;
    const email = body.email;
    const password = body.password;
    const payload = body.payload;

    if (!action || !email || !password) {
      return jsonResponse({ ok: false, message: "Missing action, email, or password" });
    }

    if (!verifyPassword(password)) {
      return jsonResponse({ ok: false, message: "Invalid password" });
    }

    if (action === "verify") {
      return jsonResponse({ ok: true, message: "Authentication successful" });
    }

    if (action === "push") {
      if (!payload) {
        return jsonResponse({ ok: false, message: "Missing payload" });
      }
      upsertUserData(email, payload);
      return jsonResponse({ ok: true, message: "Saved" });
    }

    if (action === "pull") {
      const data = getUserData(email);
      return jsonResponse({ ok: true, data: data });
    }

    return jsonResponse({ ok: false, message: "Unknown action" });
  } catch (error) {
    return jsonResponse({ ok: false, message: String(error) });
  }
}

function verifyPassword(password) {
  const expectedPassword = PropertiesService.getScriptProperties().getProperty("APP_PASSWORD");
  if (!expectedPassword) {
    return false;
  }
  return password === expectedPassword;
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
