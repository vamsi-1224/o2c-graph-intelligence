// ============================================================
// js/graph.js  — D3 Graph using real SAP O2C field names
// ============================================================

var nodeColorHex = {
  SalesOrder:  '#3b82f6',
  Delivery:    '#10b981',
  BillingDoc:  '#f59e0b',
  JournalEntry:'#8b5cf6',
  Customer:    '#ec4899',
  Product:     '#06b6d4',
  Payment:     '#22c55e'
};

var nodeRadius = {
  Customer: 11, Product: 7, SalesOrder: 9,
  Delivery: 8, BillingDoc: 9, JournalEntry: 7, Payment: 7
};

var allNodes = [], allLinks = [];
var simulation, svg, g;

// ── Build graph from real DB ──────────────────────────────
function buildGraph() {
  var nodes = [], links = [], nodeMap = {};

  function addNode(id, type, label, data) {
    if (!nodeMap[id]) {
      var n = { id: String(id), type: type, label: label, data: data };
      nodes.push(n);
      nodeMap[String(id)] = n;
    }
  }

  function customerName(bpId) {
    var bp = DB.business_partners.find(function(b) {
      return b.businessPartner === String(bpId) || b.customer === String(bpId);
    });
    return bp ? (bp.businessPartnerFullName || bp.businessPartnerName || String(bpId)).split(' ')[0] : String(bpId);
  }

  // Customer nodes
  DB.business_partners.forEach(function(bp) {
    addNode(bp.businessPartner, 'Customer',
      (bp.businessPartnerFullName || bp.businessPartnerName || bp.businessPartner).split(' ')[0],
      { ID: bp.businessPartner, Name: bp.businessPartnerFullName || bp.businessPartnerName, Blocked: bp.businessPartnerIsBlocked }
    );
  });

  // Product nodes (only products in orders/billing - avoid 69 floating nodes)
  var usedProducts = new Set();
  DB.sales_order_items.forEach(function(i){ usedProducts.add(i.material); });
  DB.billing_document_items.forEach(function(i){ usedProducts.add(i.material); });
  usedProducts.forEach(function(matId) {
    var desc = DB.product_descriptions.find(function(d){ return d.product === matId; });
    var label = desc ? desc.productDescription.substring(0,15) : matId;
    addNode('PRD_' + matId, 'Product', label, { Product: matId, Description: desc ? desc.productDescription : matId });
  });

  // Sales Order nodes + Customer→SO links
  DB.sales_order_headers.forEach(function(so) {
    addNode('SO_' + so.salesOrder, 'SalesOrder', 'SO ' + so.salesOrder, {
      SalesOrder:    so.salesOrder,
      NetAmount:     so.totalNetAmount + ' ' + so.transactionCurrency,
      CreationDate:  (so.creationDate||'').substring(0,10),
      DelivStatus:   so.overallDeliveryStatus
    });
    if (nodeMap[String(so.soldToParty)]) {
      links.push({ source: String(so.soldToParty), target: 'SO_' + so.salesOrder, type: 'PLACED_ORDER' });
    }
  });

  // SO Items → Product
  DB.sales_order_items.forEach(function(item) {
    if (nodeMap['SO_' + item.salesOrder] && nodeMap['PRD_' + item.material]) {
      links.push({ source: 'SO_' + item.salesOrder, target: 'PRD_' + item.material, type: 'ORDERED' });
    }
  });

  // Delivery nodes: ODI links delivery→salesOrder
  var deliveryToSO = {};
  DB.outbound_delivery_items.forEach(function(odi) {
    if (odi.referenceSdDocument) deliveryToSO[String(odi.deliveryDocument)] = String(odi.referenceSdDocument);
  });
  DB.outbound_delivery_headers.forEach(function(d) {
    var dlvId = String(d.deliveryDocument);
    addNode('DLV_' + dlvId, 'Delivery', 'DLV ' + dlvId, {
      DeliveryDocument: dlvId,
      CreationDate:     (d.creationDate||'').substring(0,10),
      PickingStatus:    d.overallPickingStatus,
      GoodsMvtStatus:   d.overallGoodsMovementStatus
    });
    var soId = deliveryToSO[dlvId];
    if (soId && nodeMap['SO_' + soId]) {
      links.push({ source: 'SO_' + soId, target: 'DLV_' + dlvId, type: 'LEADS_TO_DELIVERY' });
    }
  });

  // Billing nodes: BDI.referenceSdDocument → deliveryDocument
  DB.billing_document_headers.forEach(function(b) {
    var bdocId = String(b.billingDocument);
    addNode('BLG_' + bdocId, 'BillingDoc', 'BLG ' + bdocId, {
      BillingDocument: bdocId,
      Date:            (b.billingDocumentDate||'').substring(0,10),
      NetAmount:       b.totalNetAmount + ' ' + b.transactionCurrency,
      Cancelled:       b.billingDocumentIsCancelled
    });
    // Link delivery → billing via items
    var bItem = DB.billing_document_items.find(function(i){ return String(i.billingDocument) === bdocId; });
    if (bItem && bItem.referenceSdDocument) {
      var dlvKey = 'DLV_' + bItem.referenceSdDocument;
      if (nodeMap[dlvKey]) {
        links.push({ source: dlvKey, target: 'BLG_' + bdocId, type: 'BILLED_VIA' });
      }
    }
    // Also link customer → billing
    if (nodeMap[String(b.soldToParty)]) {
      links.push({ source: String(b.soldToParty), target: 'BLG_' + bdocId, type: 'INVOICED_TO' });
    }
  });

  // Journal Entry nodes: referenceDocument → billingDocument
  DB.journal_entry_items_accounts_receivable.forEach(function(j) {
    var jeId = String(j.accountingDocument);
    addNode('JE_' + jeId, 'JournalEntry', 'JE ' + jeId, {
      AccountingDoc: jeId,
      PostingDate:   (j.postingDate||'').substring(0,10),
      Amount:        j.amountInTransactionCurrency + ' ' + j.transactionCurrency,
      GLAccount:     j.glAccount
    });
    var blgKey = 'BLG_' + j.referenceDocument;
    if (nodeMap[blgKey]) {
      links.push({ source: blgKey, target: 'JE_' + jeId, type: 'POSTED_AS' });
    }
  });

  // Payment nodes: linked via clearingAccountingDocument in JE
  var jeByAcctDoc = {};
  DB.journal_entry_items_accounts_receivable.forEach(function(j){ jeByAcctDoc[j.accountingDocument] = j; });

  var addedPayments = new Set();
  DB.payments_accounts_receivable.forEach(function(pay) {
    var payId = String(pay.clearingAccountingDocument || pay.accountingDocument);
    if (addedPayments.has(payId)) return;
    addedPayments.add(payId);
    addNode('PAY_' + payId, 'Payment', 'PAY ' + payId, {
      ClearingDoc:  payId,
      ClearingDate: (pay.clearingDate||'').substring(0,10),
      Amount:       pay.amountInTransactionCurrency + ' ' + pay.transactionCurrency
    });
    // Link from journal entry
    var je = DB.journal_entry_items_accounts_receivable.find(function(j) {
      return String(j.clearingAccountingDocument) === payId;
    });
    if (je && nodeMap['JE_' + je.accountingDocument]) {
      links.push({ source: 'JE_' + je.accountingDocument, target: 'PAY_' + payId, type: 'CLEARED_BY' });
    }
  });

  allNodes = nodes;
  allLinks = links.filter(function(l) {
    return nodeMap[String(l.source)] && nodeMap[String(l.target)];
  });

  var totalRecords = Object.values(DB).reduce(function(s,t){ return s + (Array.isArray(t) ? t.length : 0); }, 0);
  document.getElementById('stat-nodes').textContent   = nodes.length;
  document.getElementById('stat-edges').textContent   = allLinks.length;
  document.getElementById('stat-records').textContent = totalRecords.toLocaleString();
}

// ── Initialise SVG ────────────────────────────────────────
function initGraph() {
  var container = document.getElementById('graph-container');
  var W = container.clientWidth, H = container.clientHeight;
  svg = d3.select('#graph-svg').attr('width', W).attr('height', H);

  svg.append('defs').append('marker')
    .attr('id','arrow').attr('viewBox','0 -4 8 8')
    .attr('refX',20).attr('refY',0)
    .attr('markerWidth',5).attr('markerHeight',5)
    .attr('orient','auto')
    .append('path').attr('d','M0,-4L8,0L0,4').attr('fill','#253045');

  g = svg.append('g');
  svg.call(d3.zoom().scaleExtent([0.05,4]).on('zoom', function(e){ g.attr('transform', e.transform); }));
  renderGraph(allNodes, allLinks, W, H);
}

// ── Render graph ──────────────────────────────────────────
function renderGraph(nodes, links, W, H) {
  if (!W) { var c = document.getElementById('graph-container'); W=c.clientWidth; H=c.clientHeight; }
  g.selectAll('*').remove();

  var link = g.append('g').selectAll('line').data(links).join('line')
    .attr('stroke','#1e2d42').attr('stroke-width',1)
    .attr('stroke-opacity',0.6).attr('marker-end','url(#arrow)');

  var node = g.append('g').selectAll('g').data(nodes).join('g')
    .attr('class', function(d){ return 'node node-'+d.type; })
    .style('cursor','pointer')
    .call(d3.drag()
      .on('start', function(e,d){ if(!e.active) simulation&&simulation.alphaTarget(0.3).restart(); d.fx=d.x; d.fy=d.y; })
      .on('drag',  function(e,d){ d.fx=e.x; d.fy=e.y; })
      .on('end',   function(e,d){ if(!e.active) simulation&&simulation.alphaTarget(0); d.fx=null; d.fy=null; })
    );

  node.append('circle')
    .attr('r',            function(d){ return nodeRadius[d.type]||8; })
    .attr('fill',         function(d){ return nodeColorHex[d.type]||'#64748b'; })
    .attr('fill-opacity', 0.88)
    .attr('stroke',       function(d){ return nodeColorHex[d.type]||'#64748b'; })
    .attr('stroke-width', 1.5).attr('stroke-opacity',0.5);

  node
    .on('mouseover', function(e,d){ showTooltip(e,d); })
    .on('mousemove', function(e){   moveTooltip(e); })
    .on('mouseout',  function(){    hideTooltip(); })
    .on('click',     function(e,d){ highlightConnected(d, nodes, links); });

  if (simulation) simulation.stop();
  simulation = d3.forceSimulation(nodes)
    .force('link',      d3.forceLink(links).id(function(d){ return d.id; }).distance(60).strength(0.5))
    .force('charge',    d3.forceManyBody().strength(-120))
    .force('center',    d3.forceCenter(W/2, H/2))
    .force('collision', d3.forceCollide(14))
    .on('tick', function(){
      link.attr('x1',function(d){return d.source.x;}).attr('y1',function(d){return d.source.y;})
          .attr('x2',function(d){return d.target.x;}).attr('y2',function(d){return d.target.y;});
      node.attr('transform', function(d){ return 'translate('+d.x+','+d.y+')'; });
    });
}

// ── Tooltip ───────────────────────────────────────────────
function showTooltip(e, d) {
  var tt = document.getElementById('tooltip');
  var title = document.getElementById('tt-title');
  title.textContent = d.label;
  title.style.color = nodeColorHex[d.type]||'white';
  var body = document.getElementById('tt-body');
  body.innerHTML = '<div class="tt-row"><span class="tt-key">Type</span><span class="tt-val">'+d.type+'</span></div>';
  Object.entries(d.data).slice(0,5).forEach(function(kv){
    body.innerHTML += '<div class="tt-row"><span class="tt-key">'+kv[0]+'</span><span class="tt-val">'+kv[1]+'</span></div>';
  });
  tt.style.display = 'block';
  moveTooltip(e);
}
function moveTooltip(e) {
  var tt = document.getElementById('tooltip');
  var rect = document.getElementById('graph-container').getBoundingClientRect();
  var x = e.clientX-rect.left+12, y = e.clientY-rect.top+12;
  if (x+250>rect.width) x-=260;
  if (y+200>rect.height) y-=160;
  tt.style.left=x+'px'; tt.style.top=y+'px';
}
function hideTooltip(){ document.getElementById('tooltip').style.display='none'; }

// ── Highlight connected ───────────────────────────────────
function highlightConnected(d, nodes, links) {
  var connected = new Set([d.id]);
  links.forEach(function(l){
    var src = l.source.id||l.source, tgt = l.target.id||l.target;
    if (src===d.id) connected.add(tgt);
    if (tgt===d.id) connected.add(src);
  });
  g.selectAll('.node circle').attr('fill-opacity', function(n){ return connected.has(n.id)?1:0.1; });
  g.selectAll('line').attr('stroke-opacity', function(l){
    return (connected.has(l.source.id||l.source) && connected.has(l.target.id||l.target))?1:0.03;
  });
}

// ── Filter by type ────────────────────────────────────────
function filterGraph(type) {
  document.querySelectorAll('.ctrl-btn').forEach(function(b){ b.classList.remove('active'); });
  var btnMap = { all:'btn-all', SalesOrder:'btn-orders', Delivery:'btn-deliveries',
                 BillingDoc:'btn-billing', JournalEntry:'btn-journal',
                 Customer:'btn-customers', Product:'btn-products', Payment:'btn-payments' };
  var el = document.getElementById(btnMap[type]||'btn-all');
  if (el) el.classList.add('active');

  if (type==='all'){ renderGraph([].concat(allNodes),[].concat(allLinks)); return; }

  var filteredNodes = allNodes.filter(function(n){ return n.type===type; });
  var nodeIds = new Set(filteredNodes.map(function(n){ return n.id; }));
  allLinks.forEach(function(l){
    var src=l.source.id||l.source, tgt=l.target.id||l.target;
    if (nodeIds.has(src)||nodeIds.has(tgt)){
      if (!nodeIds.has(src)){ var sn=allNodes.find(function(n){return n.id===src;}); if(sn){filteredNodes.push(sn);nodeIds.add(src);} }
      if (!nodeIds.has(tgt)){ var tn=allNodes.find(function(n){return n.id===tgt;}); if(tn){filteredNodes.push(tn);nodeIds.add(tgt);} }
    }
  });
  var filteredLinks = allLinks.filter(function(l){
    return nodeIds.has(l.source.id||l.source) && nodeIds.has(l.target.id||l.target);
  });
  renderGraph(filteredNodes, filteredLinks);
}

// ── Highlight specific nodes (called from chat) ───────────
function highlightNodes(nodeIds) {
  if (!nodeIds || !nodeIds.length) return;
  var idSet = new Set(nodeIds);

  g.selectAll('.node circle')
    .attr('fill-opacity', function(n) { return idSet.has(n.id) ? 1 : 0.15; })
    .attr('r',            function(n) { return idSet.has(n.id) ? (nodeRadius[n.type] || 8) * 1.8 : nodeRadius[n.type] || 8; })
    .attr('stroke-width', function(n) { return idSet.has(n.id) ? 3 : 1.5; });

  g.selectAll('line').attr('stroke-opacity', function(l) {
    return (idSet.has(l.source.id) || idSet.has(l.target.id)) ? 1 : 0.04;
  });

  // Auto-open tooltip on the FIRST highlighted node
  var firstId = nodeIds[0];
  var firstNode = allNodes.find(function(n) { return n.id === firstId; });
  if (firstNode && firstNode.x && firstNode.y) {
    autoShowTooltip(firstNode);
  } else {
    // Node position not ready yet — wait for simulation
    var attempts = 0;
    var interval = setInterval(function() {
      var n = allNodes.find(function(n) { return n.id === firstId; });
      if (n && n.x && n.y) {
        autoShowTooltip(n);
        clearInterval(interval);
      }
      if (++attempts > 20) clearInterval(interval);
    }, 200);
  }

  // Auto-reset after 6 seconds
  setTimeout(function() {
    g.selectAll('.node circle')
      .attr('fill-opacity', 0.88)
      .attr('r', function(n) { return nodeRadius[n.type] || 8; })
      .attr('stroke-width', 1.5);
    g.selectAll('line').attr('stroke-opacity', 0.6);
    hideTooltip();
  }, 6000);
}

// Auto-show tooltip at node's position on the graph
function autoShowTooltip(node) {
  var container = document.getElementById('graph-container');
  var rect = container.getBoundingClientRect();

  // Get current transform (zoom/pan)
  var transform = d3.zoomTransform(svg.node());
  var screenX = transform.applyX(node.x);
  var screenY = transform.applyY(node.y);

  // Build tooltip content
  var tt = document.getElementById('tooltip');
  var title = document.getElementById('tt-title');
  title.textContent = node.label;
  title.style.color = nodeColorHex[node.type] || 'white';

  var body = document.getElementById('tt-body');
  body.innerHTML = '<div class="tt-row"><span class="tt-key">Type</span><span class="tt-val">' + node.type + '</span></div>';
  Object.entries(node.data).forEach(function(kv) {
    body.innerHTML += '<div class="tt-row"><span class="tt-key">' + kv[0] + '</span><span class="tt-val">' + kv[1] + '</span></div>';
  });

  // Position tooltip next to the node
  var x = screenX + 16;
  var y = screenY - 10;
  if (x + 250 > rect.width)  x = screenX - 260;
  if (y + 220 > rect.height) y = screenY - 200;
  if (y < 0) y = 10;

  tt.style.left    = x + 'px';
  tt.style.top     = y + 'px';
  tt.style.display = 'block';
}
