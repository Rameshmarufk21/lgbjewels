/**
 * LabGrownBox — Google Apps Script
 * ==================================
 * SETUP:
 * 1. Open your Google Sheet → Extensions → Apps Script
 * 2. Paste this entire file, replacing all existing code
 * 3. Set your GROQ_API_KEY, Azure DI creds, and SECRET_TOKEN below
 * 4. Deploy → New Deployment → Web App → Execute as Me → Access: Anyone
 * 5. Copy the /exec URL → paste into the PWA Settings
 */

// ─── YOUR SECRETS LIVE HERE (never in the PWA code or GitHub) ────────────────
const GROQ_API_KEY   = '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';          // ← paste your Groq key
const AZURE_DOCINTEL_ENDPOINT = 'https://m-1asd.cognitiveservices.azure.com'; // no trailing slash
const AZURE_DOCINTEL_KEY = 'BTyGC46k1hHhatpulTTmzxnm42P50F508InVBtLMx6kgkb4DtoQqJQQJ99CDACYeBjFXJ3w3AAALACOGVALE';
const SECRET_TOKEN   = 'lgb2024secure';         // ← must match PWA Settings

const SHEET_NAME = 'Orders';
const GROQ_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';
const HEADERS = [
  'Order ID','Style Code','Product Type','Metal','Size','Status','Placed By','Created At',
  'Cast Vendor','Cast Invoice #','Cast Date','Cast DWT','Cast Grams','Cast Print Fee','Cast Total',
  'Cast Picked Up By','Cast Pickup Date',
  'Stone Shape','Stone Color','Stone Sieve','Stone MM','Stone Pcs','Stone Ct',
  'Stone Price/Ct','Stone Total','Stone Lot #','Stone Cert #',
  'Setter','Set Invoice #','Set Date','Set Price','Set Labor','Set Laser',
  'Set Total','Set Job Type','Set ST#',
  'Extras (JSON)','Extras Total','Notes','Last Updated'
];

// ─── ROUTER ───────────────────────────────────────────────────────────────────
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);

    // Secret check
    if (SECRET_TOKEN && payload.secret !== SECRET_TOKEN) {
      return json({ success: false, error: 'Unauthorized' });
    }

    if (payload.action === 'scan')   return json(handleScan(payload));
    if (payload.action === 'upsert') return json(handleUpsert(payload.order));
    if (payload.action === 'delete') return json(handleDelete(payload.id));

    return json({ success: false, error: 'Unknown action' });
  } catch (err) {
    return json({ success: false, error: err.toString() });
  }
}

function doGet(e) {
  try {
    // PWA sends upsert/delete as GET+?payload= to avoid CORS POST redirect issue
    if (e && e.parameter && e.parameter.payload) {
      const payload = JSON.parse(e.parameter.payload);
      if (SECRET_TOKEN && payload.secret !== SECRET_TOKEN) {
        return json({ success: false, error: 'Unauthorized' });
      }
      if (payload.action === 'upsert') return json(handleUpsert(payload.order));
      if (payload.action === 'delete') return json(handleDelete(payload.id));
      if (payload.action === 'getAll') return json({ success: true, orders: getAllOrders() });
      return json({ success: false, error: 'Unknown action: ' + payload.action });
    }
    if (e.parameter.action === 'testGemini' || e.parameter.action === 'testGroq') return json(testGroq());
    if (e.parameter.action === 'getAll') return json({ success: true, orders: getAllOrders() });
    return json({ success: true, status: 'LGB API running ✓' });
  } catch(err) {
    return json({ success: false, error: 'doGet error: ' + err.toString() });
  }
}

// ─── AI SCAN (Azure OCR + Groq mapping) ────────────────────────────────────────
function handleScan(payload) {
  const { scanType, imageData, mimeType } = payload;
  if (!AZURE_DOCINTEL_ENDPOINT || /YOUR-RESOURCE/i.test(AZURE_DOCINTEL_ENDPOINT)) {
    return { success: false, error: 'Azure Document Intelligence endpoint is not configured in Apps Script.' };
  }
  if (!AZURE_DOCINTEL_KEY || /KEY_HERE/i.test(AZURE_DOCINTEL_KEY)) {
    return { success: false, error: 'Azure Document Intelligence key is not configured in Apps Script.' };
  }

  // Step 1: OCR in Azure Document Intelligence
  let rawText;
  try {
    rawText = extractTextWithAzure(imageData, mimeType);
  } catch (err) {
    return { success: false, error: 'Azure OCR failed: ' + err.toString() };
  }
  if (!rawText) return { success: false, error: 'Azure OCR returned empty text.' };

  // Step 2: text-only mapping with Groq
  const prompt = buildPrompt(scanType) + '\n\nRAW OCR TEXT:\n' + rawText;
  const reqBody = {
    model: GROQ_MODEL,
    temperature: 0,
    messages: [
      { role: 'system', content: 'Map OCR text to schema exactly. Output only strict JSON.' },
      { role: 'user', content: prompt }
    ]
  };

  const resp = UrlFetchApp.fetch(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + GROQ_API_KEY },
      payload: JSON.stringify(reqBody),
      muteHttpExceptions: true
    }
  );

  const status = resp.getResponseCode();
  const body = resp.getContentText();

  // Parse body first and handle API errors regardless of HTTP status.
  let result;
  try { result = JSON.parse(body); } catch(_) {
    return { success: false, error: 'Groq returned non-JSON (HTTP ' + status + '): ' + body.slice(0, 200) };
  }

  if (result && result.error) {
    let msg = result.error.message || JSON.stringify(result.error);
    if (/quota|rate.?limit|billing|credit/i.test(msg)) {
      msg = 'Groq quota or billing limit reached. Check your Groq account usage, then retry.';
    } else if (/api.?key|invalid.?key|unauthorized|authentication/i.test(msg)) {
      msg = 'Groq API key is invalid or missing. Open Apps Script and set GROQ_API_KEY, then redeploy.';
    }
    return { success: false, error: msg };
  }

  if (status < 200 || status >= 300) {
    return { success: false, error: 'Groq HTTP ' + status + ': ' + body.slice(0, 200) };
  }

  const text = result.choices?.[0]?.message?.content || '';
  if (!text) {
    const reason = result.choices?.[0]?.finish_reason || 'UNKNOWN';
    return { success: false, error: 'Groq returned no text (finish_reason: ' + reason + '). Try a clearer photo.' };
  }
  const clean = text.replace(/```json\s*/gi, '').replace(/```/g, '').trim();

  try {
    const extracted = JSON.parse(clean);
    return { success: true, extracted, rawTextPreview: rawText.slice(0, 400) };
  } catch (err) {
    return { success: false, error: 'AI responded but output was not valid JSON. Try again.', raw: text.slice(0, 300) };
  }
}

function extractTextWithAzure(imageData, mimeType) {
  const endpoint = AZURE_DOCINTEL_ENDPOINT.replace(/\/+$/, '');
  const analyzeUrl = endpoint + '/formrecognizer/documentModels/prebuilt-read:analyze?api-version=2024-02-29-preview';
  const bytes = Utilities.base64Decode(imageData);

  const analyzeResp = UrlFetchApp.fetch(analyzeUrl, {
    method: 'post',
    headers: { 'Ocp-Apim-Subscription-Key': AZURE_DOCINTEL_KEY, 'Content-Type': mimeType || 'image/jpeg' },
    payload: bytes,
    muteHttpExceptions: true
  });
  const analyzeCode = analyzeResp.getResponseCode();
  if (analyzeCode < 200 || analyzeCode >= 300) {
    throw new Error('Analyze HTTP ' + analyzeCode + ': ' + analyzeResp.getContentText().slice(0, 300));
  }

  const opUrl = analyzeResp.getHeaders()['Operation-Location'] || analyzeResp.getHeaders()['operation-location'];
  if (!opUrl) throw new Error('Operation-Location header missing from Azure response.');

  for (let i = 0; i < 12; i++) {
    Utilities.sleep(900);
    const pollResp = UrlFetchApp.fetch(opUrl, {
      method: 'get',
      headers: { 'Ocp-Apim-Subscription-Key': AZURE_DOCINTEL_KEY },
      muteHttpExceptions: true
    });
    const pollCode = pollResp.getResponseCode();
    if (pollCode < 200 || pollCode >= 300) {
      throw new Error('Poll HTTP ' + pollCode + ': ' + pollResp.getContentText().slice(0, 300));
    }
    const result = JSON.parse(pollResp.getContentText());
    if (result.status === 'succeeded') {
      if (result.analyzeResult && result.analyzeResult.content) return result.analyzeResult.content;
      const pages = (result.analyzeResult && result.analyzeResult.pages) || [];
      const lines = [];
      pages.forEach(p => (p.lines || []).forEach(l => lines.push(l.content || '')));
      return lines.join('\n');
    }
    if (result.status === 'failed') {
      throw new Error('Azure analyze failed: ' + JSON.stringify(result.error || result));
    }
  }
  throw new Error('Azure analyze timed out while waiting for OCR result.');
}

function buildPrompt(type) {
  const base = `You are an expert data extraction assistant for a jewelry manufacturing company called LabGrownBox.
Extract ALL relevant data from this ${type} invoice/document OCR text.
Return ONLY valid JSON — no markdown, no explanation, no code fences.
Use null for any field you cannot find. Numbers should be numeric (no $ signs).`;

  const schemas = {
    casting: `${base}
{"castInvoice":"invoice number","castDate":"YYYY-MM-DD","castVendor":"vendor company name","metal":"metal type e.g. Platinum","styleCode":"style/product code like GL04R or SFR-63","productType":"Ring or Bracelet or Earring etc","castDWT":"weight in DWT as number","castGrams":"weight in grams as number","castPrint":"print/3D fee as number","castTotal":"total due as number","notes":"any other info"}`,
    setting: `${base}
{"setInvoice":"invoice number","setDate":"YYYY-MM-DD","setter":"setter company name","productType":"Ring or Bracelet or Earring etc","styleCode":"style code if visible","setJob":"job type","stonePcs":"pieces count","setST":"ST# number","setPrice":"setting price as number","setLabor":"labor cost as number","setLaser":"laser cost as number","setTotal":"total as number","metal":"metal type if mentioned"}`,
    memo: `${base}
{"stoneLot":"lot number","setter":"setter name from TO: field","stoneShape":"stone shape","stoneMM":"stone size in mm","stonePcs":"number of pieces","stoneCt":"total carats","stonePrice":"price per carat as number","stoneTotal":"total value as number","metal":"metal type if mentioned","productType":"product type if mentioned","notes":"any other details"}`,
    spec: `${base}
{"styleCode":"style number","productType":"Ring or Bracelet etc","size":"ring size","metal":"primary metal","centerStoneMM":"center stone dimensions","stoneMM":"side stone size","stonePcs":"side stone count","stoneShape":"stone shape","stoneCt":"total stone weight","notes":"other specs"}`
  };
  return schemas[type] || schemas.casting;
}

// ─── SHEETS ───────────────────────────────────────────────────────────────────
function getOrCreateSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(HEADERS);  // append first
    const hRange = sh.getRange(1, 1, 1, HEADERS.length);
    hRange.setBackground('#0F5F5F').setFontColor('#ffffff').setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.setColumnWidths(1, HEADERS.length, 120);
  }
  return sh;
}

function orderToRow(o) {
  const extTotal = (o.extras||[]).reduce((a,e)=>a+(parseFloat(e.cost)||0), 0);
  return [
    o.id, o.styleCode, o.productType, o.metal, o.size, o.status, o.placedBy, o.createdAt,
    o.castVendor, o.castInvoice, o.castDate, o.castDWT, o.castGrams, o.castPrint, o.castTotal,
    o.castPickup, o.castPickupDate,
    o.stoneShape, o.stoneColor, o.stoneSieve, o.stoneMM, o.stonePcs, o.stoneCt,
    o.stonePrice, o.stoneTotal, o.stoneLot, o.stoneCert,
    o.setter, o.setInvoice, o.setDate, o.setPrice, o.setLabor, o.setLaser,
    o.setTotal, o.setJob, o.setST,
    JSON.stringify(o.extras||[]), extTotal||'', o.notes,
    new Date().toISOString()
  ];
}

function handleUpsert(order) {
  const sh   = getOrCreateSheet();
  const data = sh.getDataRange().getValues();
  const idx  = data.slice(1).findIndex(r => r[0] === order.id);
  const row  = orderToRow(order);

  if (idx >= 0) {
    sh.getRange(idx + 2, 1, 1, row.length).setValues([row]);
    styleStatusCell(sh, idx + 2, order.status);  // refresh colour on edit too
  } else {
    sh.appendRow(row);
    styleStatusCell(sh, sh.getLastRow(), order.status);
  }
  return { success: true };
}

function handleDelete(id) {
  const sh   = getOrCreateSheet();
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === id) { sh.deleteRow(i + 1); break; }
  }
  return { success: true };
}

function getAllOrders() {
  const sh   = getOrCreateSheet();
  const data = sh.getDataRange().getValues();
  return data.slice(1).map(r => ({ id:r[0], styleCode:r[1], productType:r[2], metal:r[3], size:r[4], status:r[5], placedBy:r[6] }));
}

function styleStatusCell(sh, rowNum, status) {
  const colors = { Inquiry:'#dbeafe', Casting:'#fef9c3', 'At Setter':'#dcfce7', Hold:'#ffedd5', Blocked:'#fee2e2', Completed:'#f0fdf4' };
  const col = HEADERS.indexOf('Status') + 1;
  if (colors[status]) sh.getRange(rowNum, col).setBackground(colors[status]);
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function testGroq() {
  try {
    const resp = UrlFetchApp.fetch(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        method: 'post',
        contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + GROQ_API_KEY },
        payload: JSON.stringify({
          model: GROQ_MODEL,
          temperature: 0,
          messages: [{ role: 'user', content: 'Reply with exactly: OK' }]
        }),
        muteHttpExceptions: true
      }
    );
    const status = resp.getResponseCode();
    const body = resp.getContentText();
    if (status < 200 || status >= 300) {
      let msg = `Groq test failed (${status})`;
      try {
        const parsed = JSON.parse(body);
        if (parsed && parsed.error && parsed.error.message) msg = parsed.error.message;
      } catch (_) {}
      return { success: false, error: msg };
    }
    return { success: true, message: 'Groq reachable', raw: body };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}
