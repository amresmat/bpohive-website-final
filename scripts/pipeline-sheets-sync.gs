// BPO Hive Pipeline sync — Google Apps Script (script.google.com), owned by amr@bpohive.com.
// Every 15 minutes it reads the callers' "Hot Leads" sheets and sends them to bpohive.com/admin → Pipeline.
// Setup (once): paste this file, paste appsscript.json from the comment at the bottom into the project's
// manifest, then run "setup" and click Allow. To add a sheet, put its ID in SHEETS below.
var ENDPOINT = 'https://www.bpohive.com/api/pipeline/sheets';
var SHEETS = [
  '19r0AwkMBJlcrQEL9vZ5wtUDHxsJ-XDiTQhrwf2mX5HY', // Hot Leads Juwayriya
  '1Ebdfps1QC1LY_GD7_48Uk8RjhCxXTMGFazDiOq50iEc', // Hot Leads Shayen
  '1XlUYu3fb7dEXUP0JhxrzvaKV9RP59SOX72g5uf4eMqk', // Hot Leads Zeina
  '1bCfXKPPcj_NEFvksAOsuqEeWTd2aTw0OSoJjxMu2MIg'  // Hot Leads Habiba
];

function syncPipeline() {
  var out = [];
  SHEETS.forEach(function (id) {
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
    headers: { Authorization: 'Bearer ' + ScriptApp.getIdentityToken() },
    payload: JSON.stringify({ sheets: out })
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
