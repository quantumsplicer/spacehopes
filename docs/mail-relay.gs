// Space hopes mail relay: lets the website send email FROM your Gmail account over plain HTTPS.
// Deploy it once while signed in to the Gmail account that should send (for example spacehopes@gmail.com).
//   1. script.google.com > New project > replace the code with this file.
//   2. Set SECRET below to the long random value you were given (the same value goes into Render as APPS_SCRIPT_MAIL_SECRET).
//   3. Pick the function "authorize" in the toolbar and click Run once; allow the permission it asks for.
//   4. Deploy > New deployment > type "Web app" > Execute as: Me > Who has access: Anyone > Deploy. Copy the Web app URL
//      (it ends in /exec). That URL goes into Render as APPS_SCRIPT_MAIL_URL.
// Limits: a normal Gmail account can send about 100 emails a day through Apps Script.

const SECRET = 'PASTE-THE-SECRET-HERE';

function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents);
    if (!SECRET || SECRET === 'PASTE-THE-SECRET-HERE' || d.secret !== SECRET) return out('forbidden');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.to || '')) return out('bad address');
    MailApp.sendEmail({
      to: d.to,
      subject: String(d.subject || '').slice(0, 200),
      body: String(d.text || ''),
      htmlBody: d.html || undefined,
      name: d.name || 'Space hopes',
    });
    return out('ok');
  } catch (err) {
    return out('error: ' + err.message);
  }
}

function out(text) { return ContentService.createTextOutput(text); }

// Run this once from the editor so Google asks you to approve sending mail.
function authorize() { Logger.log('Emails left today: ' + MailApp.getRemainingDailyQuota()); }
