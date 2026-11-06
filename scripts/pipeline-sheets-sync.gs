// BPO Hive Pipeline sync — Google Apps Script (script.google.com), owned by amr@bpohive.com.
// Every 15 minutes it reads the Lead Entry sheets listed in Admin → Pipeline → Sources and sends them to the Pipeline.
// Setup (once): paste this file, paste appsscript.json from the comment at the bottom into the project's
// manifest, then run "setup" and click Allow.
var ENDPOINT = 'https://www.bpohive.com/api/pipeline/sheets';
// Which sheets to read is set in bpohive.com/admin -> Pipeline -> Sources (no need to edit this script).

function syncPipeline() {
  var auth = { Authorization: 'Bearer ' + ScriptApp.getIdentityToken() };
  var cfg = UrlFetchApp.fetch(ENDPOINT, { headers: auth, muteHttpExceptions: true });
  if (cfg.getResponseCode() !== 200) { Logger.log('Could not get the sheet list: ' + cfg.getResponseCode() + ' ' + cfg.getContentText().slice(0, 300)); return; }
  var ids = JSON.parse(cfg.getContentText()).sheets || [];
  var out = [];
  ids.forEach(function (id) {
    try {
      var ss = SpreadsheetApp.openById(id);
      ss.getSheets().forEach(function (sh) {
        if (sh.isSheetHidden()) return;
        var values = sh.getDataRange().getDisplayValues().slice(0, 5000);
        out.push({ id: id, title: ss.getName(), tab: sh.getName(), rows: values });
      });
    } catch (e) {
      out.push({ id: id, title: id, error: String(e) });
    }
  });
  var r = UrlFetchApp.fetch(ENDPOINT, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: auth, payload: JSON.stringify({ sheets: out })
  });
  Logger.log(r.getResponseCode() + ' ' + r.getContentText().slice(0, 500));
}

function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('syncPipeline').timeBased().everyMinutes(15).create();
  syncPipeline();
}

/* appsscript.json (Project Settings → "Show appsscript.json manifest file in editor"):
{
  "timeZone": "Africa/Cairo",
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "oauthScopes": [
    "https://www.googleapis.com/auth/spreadsheets.readonly",
    "https://www.googleapis.com/auth/script.external_request",
    "https://www.googleapis.com/auth/script.scriptapp",
    "https://www.googleapis.com/auth/userinfo.email",
    "openid"
  ]
}
*/
