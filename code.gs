// ════════════════════════════════════════════════════════════
//  ScrapTrack — Google Apps Script con autenticazione
//
//  SETUP:
//  1. Apri Google Sheets → Estensioni → Apps Script
//  2. Incolla questo codice e salva
//  3. Distribuisci → Nuova distribuzione → App web
//     · Esegui come:    Me
//     · Chi ha accesso: Chiunque
//  4. Copia l'URL → incollalo nell'app
//
//  UTENTI:
//  Nel foglio "Utenti" aggiungi righe con:
//  | Username | Password | Nome        | Ruolo |
//  | mario    | pass123  | Mario Rossi | admin |
//  | anna     | pass456  | Anna B.     | user  |
//  Il ruolo "admin" sblocca la sezione Report nell'app.
// ════════════════════════════════════════════════════════════

const SHEET_MOV   = 'Movimenti';
const SHEET_CAT   = 'Categorie';
const SHEET_USERS = 'Utenti';

const MOV_HEADERS   = ['ID', 'CatID', 'Tipo', 'Quantita', 'Note', 'Timestamp', 'Utente'];
const CAT_HEADERS   = ['ID', 'Nome', 'Colore'];
const USER_HEADERS  = ['Username', 'Password', 'Nome', 'Ruolo'];

// ── Risposta JSON ──
function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Assicura che i fogli esistano ──
function ensureSheets(ss) {
  function getOrCreate(name, headers, headerColor) {
    let s = ss.getSheetByName(name);
    if (!s) {
      s = ss.insertSheet(name);
      const r = s.getRange(1, 1, 1, headers.length);
      r.setValues([headers]);
      r.setFontWeight('bold')
       .setBackground(headerColor || '#1a1a1a')
       .setFontColor('#f97316');
      s.setFrozenRows(1);
    }
    return s;
  }
  return {
    mov:   getOrCreate(SHEET_MOV,   MOV_HEADERS),
    cat:   getOrCreate(SHEET_CAT,   CAT_HEADERS),
    users: getOrCreate(SHEET_USERS, USER_HEADERS, '#0d0d0d'),
  };
}

// ════════════════════════════════════════
//  AUTENTICAZIONE
//  Verifica username nel foglio Utenti.
//  Username e password vengono passati come
//  parametri GET o nel body POST.
// ════════════════════════════════════════
function authenticate(ss, username, password) {
  if (!username || !password) return { ok: false, error: 'Credenziali mancanti.' };

  const sheet = ss.getSheetByName(SHEET_USERS);
  if (!sheet) return { ok: false, error: 'Foglio Utenti non trovato.' };

  const rows = sheet.getDataRange().getValues().slice(1); // salta header
  for (const row of rows) {
    const u = String(row[0]).trim();
    const p = String(row[1]).trim();
    const n = String(row[2] || '').trim();
    const r = String(row[3] || 'user').trim().toLowerCase();
    if (u.toLowerCase() === username.toLowerCase() && p === password) {
      return { ok: true, displayName: n || u, role: r };
    }
  }
  return { ok: false, error: 'Username o password non validi.' };
}

// ════════════════════════════════════════
//  GET
//  Parametri URL:
//    action=login   → verifica credenziali
//    action=all     → restituisce movimenti + categorie
//    username=xxx   → sempre richiesto
//    password=xxx   → sempre richiesto
// ════════════════════════════════════════
function doGet(e) {
  try {
    const ss       = SpreadsheetApp.getActiveSpreadsheet();
    const sheets   = ensureSheets(ss);
    const action   = e.parameter.action   || 'all';
    const username = e.parameter.username || '';
    const password = e.parameter.password || '';

    // ── Login ──
    if (action === 'login') {
      const auth = authenticate(ss, username, password);
      return jsonResponse(auth);
    }

    // ── Tutte le azioni richiedono autenticazione completa ──
    const auth = authenticate(ss, username, password);
    if (!auth.ok) return jsonResponse({ ok: false, error: 'Non autorizzato.' });

    // ── Leggi dati ──
    if (action === 'all') {
      const movData = sheets.mov.getDataRange().getValues().slice(1)
        .filter(r => r[0] !== '')
        .map(r => ({
          id:    String(r[0]),
          catId: String(r[1]),
          tipo:  String(r[2]),
          qty:   parseFloat(r[3]) || 0,
          note:  String(r[4] || ''),
          ts:    parseInt(r[5])   || 0,
          user:  String(r[6] || ''),
        }));

      const catData = sheets.cat.getDataRange().getValues().slice(1)
        .filter(r => r[0] !== '')
        .map(r => ({
          id:    String(r[0]),
          name:  String(r[1]),
          color: String(r[2] || '#f97316'),
        }));

      return jsonResponse({ ok: true, movements: movData, categories: catData });
    }

    return jsonResponse({ ok: false, error: 'Azione non riconosciuta: ' + action });

  } catch(err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

// ════════════════════════════════════════
//  POST
//  Body JSON:
//  {
//    username: "mario",
//    password: "pass123",
//    action:   "addMovement" | "deleteMovement" | "addCategory" | "deleteCategory",
//    payload:  { ... }
//  }
// ════════════════════════════════════════
function doPost(e) {
  try {
    const ss     = SpreadsheetApp.getActiveSpreadsheet();
    const sheets = ensureSheets(ss);
    const body   = JSON.parse(e.postData.contents);
    const { username, password, action, payload } = body;

    // Verifica credenziali completa ad ogni chiamata POST
    const auth = authenticate(ss, username, password);
    if (!auth.ok) return jsonResponse({ ok: false, error: 'Non autorizzato.' });

    switch (action) {

      case 'addMovement': {
        const m = payload.movement;
        sheets.mov.appendRow([m.id, m.catId, m.tipo, m.qty, m.note || '', m.ts, m.user || '']);
        return jsonResponse({ ok: true });
      }

      case 'deleteMovement': {
        const id   = String(payload.id);
        const vals = sheets.mov.getDataRange().getValues();
        for (let i = vals.length - 1; i >= 1; i--) {
          if (String(vals[i][0]) === id) { sheets.mov.deleteRow(i + 1); break; }
        }
        return jsonResponse({ ok: true });
      }

      case 'addCategory': {
        const c = payload.category;
        sheets.cat.appendRow([c.id, c.name, c.color || '#f97316']);
        return jsonResponse({ ok: true });
      }

      case 'deleteCategory': {
        const id   = String(payload.id);
        const vals = sheets.cat.getDataRange().getValues();
        for (let i = vals.length - 1; i >= 1; i--) {
          if (String(vals[i][0]) === id) { sheets.cat.deleteRow(i + 1); break; }
        }
        return jsonResponse({ ok: true });
      }

      default:
        return jsonResponse({ ok: false, error: 'Azione non riconosciuta: ' + action });
    }

  } catch(err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}