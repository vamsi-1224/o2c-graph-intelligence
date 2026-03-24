// ============================================================
// js/chat.js  —  O2C Graph Intelligence · AI Chat Interface
// Supports: OpenRouter · Groq · Gemini
// ============================================================

var SYSTEM_PROMPT = [
  'You are a specialized AI assistant for an SAP Order-to-Cash (O2C) data analysis system.',
  'You answer questions about the O2C dataset. Be GENEROUS in interpreting O2C-related questions.',
  '',
  'IMPORTANT - Accept these as valid O2C queries (do NOT guardrail them):',
  '- "soldtoproperty", "sold to party", "soldToParty", "who is the customer" → find_order_details or all_sales_orders',
  '- "find journal entry", "journal number", "accounting document" → find_journal_for_document',
  '- Any question with an order ID, billing ID, delivery ID, or customer ID → treat as O2C query',
  '- "property", "party", "partner", "owner", "buyer" → these mean customer/soldToParty in O2C context',
  '- Typos and informal phrasing like "soldtoproperty" = "soldToParty"',
  '- "show orders", "list orders", "display orders" → all_sales_orders',
  '- "show deliveries", "list deliveries" → delivery_performance',
  '',
  'DATASET FACTS:',
  '- 100 sales orders (740506–740605), 86 deliveries, 163 billing documents, 123 journal entries',
  '- 120 payments, 8 customers, 69 products, 44 plants. Currency: INR. Company: ABCD.',
  '- Customer IDs: 310000108 (Cardenas,Parker and Avila), 310000109 (Bradley-Kelley),',
  '  320000082 (Nguyen-Davis), 320000083 (Nelson,Fitzpatrick and Jordan),',
  '  320000085 (Hawkins Ltd), 320000088 (Flores-Simmons),',
  '  320000107 (Henderson,Garner and Graves), 320000108 (Melton Group)',
  '',
  'AVAILABLE QUERY TYPES:',
  '- products_by_billing_count        : products ranked by billing doc appearances',
  '- trace_billing_document           : full O2C flow trace (params: {billing_document: "ID"})',
  '- broken_flows                     : orders with incomplete O2C flows',
  '- customers_by_order_value         : customers ranked by total order value',
  '- unpaid_invoices                  : billing docs with no payment',
  '- total_revenue                    : total billed vs paid vs outstanding',
  '- orders_by_customer               : orders for a customer (params: {customer_id: "ID"})',
  '- product_details                  : all products with descriptions',
  '- all_sales_orders                 : all sales orders with customer names',
  '- delivery_performance             : delivery status overview',
  '- journal_entries_summary          : journal entries linked to billing',
  '- cancelled_billing_docs           : all cancelled billing documents',
  '- top_sales_orders                 : top N orders by value (params: {limit: 10})',
  '- find_journal_for_document        : find journal entry for any doc ID (params: {document_id: "ID"})',
  '- find_order_details               : find soldToParty/customer for a sales order (params: {sales_order: "ID"})',
  '',
  'QUERY SELECTION RULES:',
  '- Number + "soldToParty/customer/who placed/soldtoproperty/party" → find_order_details {sales_order:"NUMBER"}',
  '- Number + "journal/accounting/JE" → find_journal_for_document {document_id:"NUMBER"}',
  '- Number + "trace/flow/full flow" → trace_billing_document {billing_document:"NUMBER"}',
  '- "show/list/display orders" → all_sales_orders',
  '- "show/list deliveries" → delivery_performance',
  '- "how many orders" → all_sales_orders',
  '',
  'Return ONLY valid JSON. No markdown. No explanation outside JSON. No code fences.',
  '',
  'For O2C questions:',
  '{"query":{"type":"QUERY_TYPE","params":{}},"explanation":"brief explanation"}',
  '',
  'For ALL non-O2C questions (general knowledge, weather, sports, cooking, who is X, what is X, coding, math, etc.):',
  '{"query":null,"explanation":"This system is designed to answer questions related to the provided dataset only. Please ask about sales orders, deliveries, billing documents, payments, customers, or products."}',
  '',
  'EXAMPLES of non-O2C → always return query:null:',
  '- "who is the prime minister" → query:null',
  '- "what is the capital of India" → query:null',
  '- "write me a poem" → query:null',
  '- "how do I code in Python" → query:null',
  '- "what is 2+2" → query:null',
  '',
  'EXAMPLES of O2C → always return a query type:',
  '- "show me the orders" → all_sales_orders',
  '- "740511 soldToParty" → find_order_details',
  '- "which products have most billing" → products_by_billing_count'
].join('\n');

var RESPONSE_PROMPT = [
  'You are a concise SAP O2C data analyst. Answer in plain English only. NEVER use tables, JSON, or code blocks.',
  '',
  'FORMAT RULES:',
  '- COUNT: One sentence. "There are X sales orders in the dataset."',
  '- LOOKUP (find ID): One sentence. "The soldToParty for sales order 740511 is 320000083 (Nelson, Fitzpatrick and Jordan)."',
  '- FILTER/LIST: State count first, then top 3-5 as bullet points with • symbol.',
  '- RANKING: Numbered list max 5. "1. Product X – 12 billing docs"',
  '- FLOW TRACE: Steps with arrows. "Customer → SO 740507 → DLV 80737722 → BLG 90XXXXX → JE 9400XXXXX → PAY cleared"',
  '- BROKEN FLOWS: Count first then examples. "X orders have incomplete flows:\n• Order 740584 – No delivery, no billing"',
  '- REVENUE: "Total billed: X INR | Paid: Y INR | Outstanding: Z INR"',
  '',
  'Max 100 words. Use actual IDs and names from the data. Never invent data.'
].join('\n');

var conversationHistory = [];
// AI_PROVIDER and AI_KEY are declared in app.js

// ============================================================
// Helper
// ============================================================
function sleep(ms) { return new Promise(function(r){ setTimeout(r, ms); }); }

// ============================================================
// GEMINI
// ============================================================
var GEMINI_MODELS = ['gemini-1.5-flash', 'gemini-1.5-flash-8b', 'gemini-2.0-flash'];
var geminiModelIdx = 0;

async function callGemini(messages, systemPrompt) {
  var contents = messages.map(function(m) {
    return { role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] };
  });
  for (var attempt = 0; attempt < GEMINI_MODELS.length * 2; attempt++) {
    var model = GEMINI_MODELS[geminiModelIdx % GEMINI_MODELS.length];
    var response = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + AI_KEY,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: contents,
          generationConfig: { maxOutputTokens: 1000, temperature: 0.1 }
        })
      }
    );
    if (response.status === 429 || response.status === 503) {
      var errData = await response.json();
      var retryMsg = (errData.error && errData.error.message) || '';
      var match = retryMsg.match(/retry in ([0-9.]+)s/i);
      var wait = match ? Math.ceil(parseFloat(match[1])) : 0;
      geminiModelIdx++;
      if (geminiModelIdx < GEMINI_MODELS.length) continue;
      if (wait > 0 && wait < 65) {
        appendMsg('ai', '⏳ Rate limit hit. Retrying in ' + wait + 's...');
        await sleep(wait * 1000);
        geminiModelIdx = 0;
        continue;
      }
      throw new Error('All Gemini models rate-limited. Wait 1 min and try again.');
    }
    if (!response.ok) {
      var err = await response.json();
      throw new Error((err.error && err.error.message) || 'Gemini error ' + response.status);
    }
    var data = await response.json();
    return (data.candidates && data.candidates[0] && data.candidates[0].content &&
            data.candidates[0].content.parts && data.candidates[0].content.parts[0].text) || '';
  }
  throw new Error('Gemini: failed after all retries.');
}

// ============================================================
// OPENROUTER  — skips unavailable models automatically
// ============================================================
var OPENROUTER_MODELS = [
  'meta-llama/llama-3.3-70b-instruct:free',
  'meta-llama/llama-3.1-8b-instruct:free',
  'microsoft/phi-3-mini-128k-instruct:free',
  'google/gemma-3-12b-it:free',
  'mistralai/mistral-small-3.1-24b-instruct:free',
  'qwen/qwen3-30b-a3b:free',
  'openrouter/auto'
];

async function callOpenRouter(messages, systemPrompt) {
  var allMessages = [{ role: 'system', content: systemPrompt }].concat(
    messages.map(function(m) {
      return { role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content };
    })
  );

  var lastError = '';
  for (var i = 0; i < OPENROUTER_MODELS.length; i++) {
    var model = OPENROUTER_MODELS[i];
    try {
      var response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + AI_KEY,
          'HTTP-Referer': window.location.href,
          'X-Title': 'O2C Graph Intelligence'
        },
        body: JSON.stringify({
          model: model,
          messages: allMessages,
          max_tokens: 1000,
          temperature: 0.1
        })
      });

      var data = await response.json();

      // Model unavailable or endpoint error — silently skip to next
      if (data.error) {
        lastError = (data.error.message || JSON.stringify(data.error));
        console.warn('OpenRouter skip [' + model + ']: ' + lastError);
        await sleep(300);
        continue;
      }

      if (response.status === 429) {
        console.warn('Rate limited on ' + model + ', trying next...');
        await sleep(1500);
        continue;
      }

      var text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      if (text) return text;

      lastError = 'Empty response from ' + model;
      await sleep(300);

    } catch(e) {
      lastError = e.message;
      console.warn('OpenRouter exception [' + model + ']: ' + e.message);
      await sleep(300);
    }
  }

  throw new Error(
    'All OpenRouter models failed. Last error: ' + lastError + '\n' +
    'Fix: Go to openrouter.ai/models → filter "Free" → copy a model ID → add it to OPENROUTER_MODELS in chat.js'
  );
}

// ============================================================
// GROQ  — fastest free tier (14,400 req/day)
// Get key at: console.groq.com
// ============================================================
var GROQ_MODELS = [
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
  'gemma2-9b-it',
  'mixtral-8x7b-32768'
];
var groqModelIdx = 0;

async function callGroq(messages, systemPrompt) {
  var allMessages = [{ role: 'system', content: systemPrompt }].concat(
    messages.map(function(m) {
      return { role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content };
    })
  );
  var lastError = '';
  for (var i = 0; i < GROQ_MODELS.length; i++) {
    var model = GROQ_MODELS[(groqModelIdx + i) % GROQ_MODELS.length];
    try {
      var response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + AI_KEY
        },
        body: JSON.stringify({ model: model, messages: allMessages, max_tokens: 1000, temperature: 0.1 })
      });
      if (response.status === 429) {
        groqModelIdx = (groqModelIdx + 1) % GROQ_MODELS.length;
        await sleep(2000); continue;
      }
      var data = await response.json();
      if (!response.ok || data.error) {
        lastError = (data.error && data.error.message) || 'HTTP ' + response.status;
        await sleep(500); continue;
      }
      var text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      if (text) return text;
      lastError = 'Empty response from ' + model;
    } catch(e) {
      lastError = e.message;
      await sleep(500);
    }
  }
  throw new Error('Groq failed: ' + lastError + '. Check your key at console.groq.com');
}

// ============================================================
// Unified entry point
// ============================================================
async function callAI(messages, systemPrompt) {
  if (AI_PROVIDER === 'groq')       return callGroq(messages, systemPrompt);
  if (AI_PROVIDER === 'openrouter') return callOpenRouter(messages, systemPrompt);
  return callGemini(messages, systemPrompt);
}

// ============================================================
// Format query result (summary-only, no raw tables)
// ============================================================
function formatResult(result) {
  if (!result) return '';
  if (result.error) return '⚠️ ' + result.error;
  return ''; // AI summary only — no raw data shown
}

// ============================================================
// Node highlight IDs from query result
// ============================================================
function getHighlightIds(queryObj, result) {
  var ids = [];
  if (!queryObj || !result) return ids;

  if (queryObj.type === 'trace_billing_document') {
    var bdoc = queryObj.params && queryObj.params.billing_document;
    if (bdoc) {
      ids.push('BLG_' + bdoc);
      if (result.sales_order)   ids.push('SO_'  + result.sales_order.SalesOrder);
      if (result.delivery)      ids.push('DLV_' + result.delivery.DeliveryDocument);
      if (result.journal_entry) ids.push('JE_'  + result.journal_entry.AccountingDoc);
      if (result.payment)       ids.push('PAY_' + result.payment.ClearingDoc);
      if (result.customer)      ids.push(result.customer.BusinessPartner);
    }
  } else if (queryObj.type === 'find_order_details' && Array.isArray(result)) {
    result.forEach(function(r){ ids.push('SO_' + r.SalesOrder); ids.push(String(r.SoldToParty)); });
  } else if (queryObj.type === 'find_journal_for_document' && Array.isArray(result)) {
    result.forEach(function(r){ ids.push('JE_' + r.AccountingDocument); });
  } else if (queryObj.type === 'broken_flows' && Array.isArray(result)) {
    result.slice(0,8).forEach(function(r){ ids.push('SO_' + r.SalesOrder); });
  } else if (queryObj.type === 'products_by_billing_count' && Array.isArray(result)) {
    result.slice(0,5).forEach(function(r){ ids.push('PRD_' + r.Product); });
  } else if (queryObj.type === 'customers_by_order_value' && Array.isArray(result)) {
    result.forEach(function(r){ ids.push(r.Customer); });
  } else if (queryObj.type === 'unpaid_invoices' && Array.isArray(result)) {
    result.slice(0,5).forEach(function(r){ ids.push('BLG_' + r.BillingDocument); });
  } else if (queryObj.type === 'all_sales_orders' && Array.isArray(result)) {
    result.slice(0,10).forEach(function(r){ ids.push('SO_' + r.SalesOrder); });
  } else if (queryObj.type === 'delivery_performance' && Array.isArray(result)) {
    result.slice(0,8).forEach(function(r){ ids.push('DLV_' + r.DeliveryDocument); });
  } else if (queryObj.type === 'top_sales_orders' && Array.isArray(result)) {
    result.forEach(function(r){ ids.push('SO_' + r.SalesOrder); });
  } else if (queryObj.type === 'orders_by_customer' && Array.isArray(result)) {
    result.forEach(function(r){ ids.push('SO_' + r.SalesOrder); });
  } else if (queryObj.type === 'journal_entries_summary' && Array.isArray(result)) {
    result.slice(0,5).forEach(function(r){ ids.push('JE_' + r.AccountingDoc); });
  }

  return ids;
}

// ============================================================
// Send message
// ============================================================
async function sendMessage() {
  var input = document.getElementById('chat-input');
  var text  = input.value.trim();
  if (!text) return;
  input.value = '';
  autoResize(input);
  document.getElementById('suggestions-box').style.display = 'none';
  appendMsg('user', text);
  var sendBtn = document.getElementById('send-btn');
  sendBtn.disabled = true;
  var typingEl = appendTyping();

  try {
    conversationHistory.push({ role: 'user', content: text });

    // Step 1: classify query
    var queryResponse = await callAI(conversationHistory, SYSTEM_PROMPT);
    var parsed;
    try {
      parsed = JSON.parse(queryResponse.replace(/```json|```/g, '').trim());
    } catch(e) {
      throw new Error('Could not parse AI response. Please rephrase your question.');
    }

    if (!parsed.query) {
      removeTyping(typingEl);
      appendMsg('ai', parsed.explanation);
      conversationHistory.push({ role: 'assistant', content: parsed.explanation });
    } else {
      // Step 2: execute query on local data
      var queryResult = QueryEngine.execute(parsed.query);

      // Step 3: summarise with AI
      var summary = await callAI([{
        role: 'user',
        content: 'User asked: "' + text + '"\nQuery: ' + JSON.stringify(parsed.query) + '\nData: ' + JSON.stringify(queryResult) + '\nSummarise.'
      }], RESPONSE_PROMPT);

      removeTyping(typingEl);
      appendMsg('ai', summary, true);
      conversationHistory.push({ role: 'assistant', content: summary });

      // Step 4: highlight graph nodes
      var hlIds = getHighlightIds(parsed.query, queryResult);
      if (hlIds.length > 0) setTimeout(function(){ highlightNodes(hlIds); }, 400);
    }
  } catch(err) {
    removeTyping(typingEl);
    appendMsg('ai', '⚠️ ' + err.message);
  }
  sendBtn.disabled = false;
}

// ============================================================
// DOM helpers
// ============================================================
function appendMsg(role, html, isRaw) {
  var messages = document.getElementById('messages');
  var div = document.createElement('div');
  div.className = 'msg ' + role;
  var label = document.createElement('div');
  label.className = 'msg-label';
  label.textContent = role === 'user' ? 'You' : 'Graph Agent';
  var bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  bubble.innerHTML = html;
  div.appendChild(label);
  div.appendChild(bubble);
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
  return div;
}

function appendTyping() {
  var messages = document.getElementById('messages');
  var div = document.createElement('div');
  div.className = 'msg ai';
  var label = document.createElement('div');
  label.className = 'msg-label';
  label.textContent = 'Graph Agent';
  var typing = document.createElement('div');
  typing.className = 'typing';
  typing.innerHTML = '<span></span><span></span><span></span>';
  div.appendChild(label);
  div.appendChild(typing);
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
  return div;
}

function removeTyping(el) { if (el) el.remove(); }
function handleKey(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }
function autoResize(el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 100) + 'px'; }
function sendSuggestion(text) { document.getElementById('chat-input').value = text; sendMessage(); }