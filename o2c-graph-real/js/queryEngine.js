// ============================================================
// js/queryEngine.js  — Real SAP O2C field names
// ============================================================

var QueryEngine = {

  execute: function(queryObj) {
    try {
      var fn = this[queryObj.type];
      if (!fn) return { error: 'Unknown query type: ' + queryObj.type };
      return fn.call(this, queryObj.params || {});
    } catch(e) {
      return { error: e.message };
    }
  },

  _customerName: function(bpId) {
    var bp = DB.business_partners.find(function(b) { return b.businessPartner === String(bpId) || b.customer === String(bpId); });
    return bp ? (bp.businessPartnerFullName || bp.businessPartnerName || bpId) : String(bpId);
  },

  _productDesc: function(matId) {
    var d = DB.product_descriptions.find(function(p) { return p.product === String(matId); });
    return d ? d.productDescription : String(matId);
  },

  // ── 1. Products ranked by billing document appearances
  products_by_billing_count: function(p) {
    var countMap = {};
    DB.billing_document_items.forEach(function(item) {
      var m = item.material;
      countMap[m] = (countMap[m] || 0) + 1;
    });
    var self = this;
    return Object.entries(countMap)
      .sort(function(a,b){ return b[1]-a[1]; })
      .slice(0, 20)
      .map(function(e) {
        return { Product: e[0], Description: self._productDesc(e[0]), BillingDocCount: e[1] };
      });
  },

  // ── 2. Full O2C flow trace for a billing document
  trace_billing_document: function(p) {
    var bdoc = String(p.billing_document || '');
    var header = DB.billing_document_headers.find(function(b) { return String(b.billingDocument) === bdoc; });
    if (!header) return { error: 'Billing document ' + bdoc + ' not found' };

    var bItems = DB.billing_document_items.filter(function(i) { return String(i.billingDocument) === bdoc; });
    var deliveryDocId = bItems.length > 0 ? bItems[0].referenceSdDocument : null;

    var delivery = deliveryDocId
      ? DB.outbound_delivery_headers.find(function(d) { return String(d.deliveryDocument) === String(deliveryDocId); })
      : null;

    var soId = null;
    if (deliveryDocId) {
      var dItem = DB.outbound_delivery_items.find(function(i) { return String(i.deliveryDocument) === String(deliveryDocId); });
      if (dItem) soId = dItem.referenceSdDocument;
    }
    var salesOrder = soId
      ? DB.sales_order_headers.find(function(s) { return String(s.salesOrder) === String(soId); })
      : null;

    var journal = DB.journal_entry_items_accounts_receivable.find(function(j) { return String(j.referenceDocument) === bdoc; });

    var payment = null;
    if (journal) {
      payment = DB.payments_accounts_receivable.find(function(pay) {
        return String(pay.clearingAccountingDocument) === String(journal.clearingAccountingDocument) &&
               pay.clearingAccountingDocument !== journal.accountingDocument;
      });
      if (!payment) {
        payment = DB.payments_accounts_receivable.find(function(pay) {
          return String(pay.accountingDocument) === String(journal.accountingDocument);
        });
      }
    }

    var self = this;
    var customer = DB.business_partners.find(function(b) {
      return b.businessPartner === String(header.soldToParty) || b.customer === String(header.soldToParty);
    });

    return {
      billing_document: {
        BillingDocument: header.billingDocument,
        Date:            (header.billingDocumentDate || '').substring(0,10),
        NetAmount:       header.totalNetAmount,
        Currency:        header.transactionCurrency,
        IsCancelled:     header.billingDocumentIsCancelled
      },
      sales_order: salesOrder ? {
        SalesOrder:      salesOrder.salesOrder,
        CreationDate:    (salesOrder.creationDate || '').substring(0,10),
        TotalNetAmount:  salesOrder.totalNetAmount,
        DeliveryStatus:  salesOrder.overallDeliveryStatus
      } : null,
      delivery: delivery ? {
        DeliveryDocument:    delivery.deliveryDocument,
        CreationDate:        (delivery.creationDate || '').substring(0,10),
        GoodsMovementStatus: delivery.overallGoodsMovementStatus,
        PickingStatus:       delivery.overallPickingStatus
      } : null,
      journal_entry: journal ? {
        AccountingDoc:  journal.accountingDocument,
        PostingDate:    (journal.postingDate || '').substring(0,10),
        Amount:         journal.amountInTransactionCurrency,
        GLAccount:      journal.glAccount
      } : null,
      payment: payment ? {
        ClearingDoc:  payment.accountingDocument,
        ClearingDate: (payment.clearingDate || '').substring(0,10),
        Amount:       payment.amountInTransactionCurrency
      } : null,
      customer: customer ? {
        BusinessPartner: customer.businessPartner,
        Name:            customer.businessPartnerFullName || customer.businessPartnerName
      } : { BusinessPartner: header.soldToParty, Name: self._customerName(header.soldToParty) }
    };
  },

  // ── 3. Broken / incomplete O2C flows
  broken_flows: function(p) {
    var deliveredOrders = new Set();
    DB.outbound_delivery_items.forEach(function(odi) {
      if (odi.referenceSdDocument) deliveredOrders.add(String(odi.referenceSdDocument));
    });

    var billedDeliveries = new Set(DB.billing_document_items.map(function(i) { return String(i.referenceSdDocument); }));
    var billedOrders = new Set();
    DB.outbound_delivery_items.forEach(function(odi) {
      if (billedDeliveries.has(String(odi.deliveryDocument))) {
        billedOrders.add(String(odi.referenceSdDocument));
      }
    });

    var self = this;
    var result = [];
    DB.sales_order_headers.forEach(function(so) {
      var soId      = String(so.salesOrder);
      var delivered = deliveredOrders.has(soId);
      var billed    = billedOrders.has(soId);
      var issue     = null;

      if (delivered && !billed)                                      issue = 'Delivered but NOT billed';
      else if (billed && !delivered)                                 issue = 'Billed without delivery record';
      else if (!delivered && !billed && so.overallDeliveryStatus !== 'C') issue = 'No delivery, no billing';

      if (issue) {
        result.push({
          SalesOrder:   soId,
          Customer:     self._customerName(so.soldToParty),
          Issue:        issue,
          NetValue:     so.totalNetAmount,
          Currency:     so.transactionCurrency,
          CreationDate: (so.creationDate || '').substring(0,10)
        });
      }
    });
    return result;
  },

  // ── 4. Customers ranked by total order value
  customers_by_order_value: function(p) {
    var map = {};
    var self = this;
    DB.sales_order_headers.forEach(function(so) {
      var bpId = String(so.soldToParty);
      if (!map[bpId]) map[bpId] = { Customer: bpId, Name: self._customerName(bpId), TotalValue: 0, OrderCount: 0, Currency: so.transactionCurrency };
      map[bpId].TotalValue += parseFloat(so.totalNetAmount) || 0;
      map[bpId].OrderCount += 1;
    });
    return Object.values(map)
      .sort(function(a,b){ return b.TotalValue - a.TotalValue; })
      .map(function(r){ return Object.assign({}, r, { TotalValue: r.TotalValue.toFixed(2) }); });
  },

  // ── 5. Unpaid billing documents
  unpaid_invoices: function(p) {
    var clearedJeDocs = new Set(DB.payments_accounts_receivable.map(function(pay) {
      return String(pay.accountingDocument);
    }));
    var unpaidBillingDocs = DB.journal_entry_items_accounts_receivable
      .filter(function(j) { return !clearedJeDocs.has(String(j.accountingDocument)); })
      .map(function(j) { return String(j.referenceDocument); });
    var unpaidSet = new Set(unpaidBillingDocs);

    var self = this;
    return DB.billing_document_headers
      .filter(function(b) { return unpaidSet.has(String(b.billingDocument)) && !b.billingDocumentIsCancelled; })
      .map(function(b) {
        return {
          BillingDocument: b.billingDocument,
          BillingDate:     (b.billingDocumentDate || '').substring(0,10),
          NetAmount:       b.totalNetAmount,
          Currency:        b.transactionCurrency,
          Customer:        self._customerName(b.soldToParty)
        };
      });
  },

  // ── 6. Revenue summary
  total_revenue: function(p) {
    var totalBilled = DB.billing_document_headers
      .filter(function(b){ return !b.billingDocumentIsCancelled; })
      .reduce(function(s,b){ return s + (parseFloat(b.totalNetAmount)||0); }, 0);
    var totalPaid = DB.payments_accounts_receivable
      .reduce(function(s,p){ return s + (parseFloat(p.amountInTransactionCurrency)||0); }, 0);
    var cancelled = DB.billing_document_cancellations.length;
    return [{
      TotalBilled:       totalBilled.toFixed(2),
      TotalPaid:         totalPaid.toFixed(2),
      Outstanding:       (totalBilled - totalPaid).toFixed(2),
      Currency:          'INR',
      CancelledDocs:     cancelled,
      ActiveBillingDocs: DB.billing_document_headers.filter(function(b){ return !b.billingDocumentIsCancelled; }).length
    }];
  },

  // ── 7. Orders for a specific customer
  orders_by_customer: function(p) {
    var id = String(p.customer_id || '');
    var self = this;
    return DB.sales_order_headers
      .filter(function(so){ return String(so.soldToParty) === id || String(so.salesOrder) === id; })
      .map(function(so){
        return {
          SalesOrder:     so.salesOrder,
          CreationDate:   (so.creationDate||'').substring(0,10),
          NetAmount:      so.totalNetAmount,
          Currency:       so.transactionCurrency,
          DeliveryStatus: so.overallDeliveryStatus,
          CustomerName:   self._customerName(so.soldToParty)
        };
      });
  },

  // ── 8. All products with descriptions
  product_details: function(p) {
    return DB.products.slice(0,50).map(function(pr) {
      var desc = DB.product_descriptions.find(function(d){ return d.product === pr.product; });
      return {
        Product:     pr.product,
        OldId:       pr.productOldId || '',
        Description: desc ? desc.productDescription : 'N/A',
        Type:        pr.productType,
        BaseUnit:    pr.baseUnit,
        GrossWeight: pr.grossWeight,
        WeightUnit:  pr.weightUnit
      };
    });
  },

  // ── 9. All sales orders
  all_sales_orders: function(p) {
    var self = this;
    return DB.sales_order_headers.map(function(so){
      return {
        SalesOrder:     so.salesOrder,
        Customer:       self._customerName(so.soldToParty),
        CreationDate:   (so.creationDate||'').substring(0,10),
        NetAmount:      so.totalNetAmount,
        Currency:       so.transactionCurrency,
        DeliveryStatus: so.overallDeliveryStatus
      };
    });
  },

  // ── 10. Delivery performance
  delivery_performance: function(p) {
    return DB.outbound_delivery_headers.map(function(d){
      return {
        DeliveryDocument:    d.deliveryDocument,
        CreationDate:        (d.creationDate||'').substring(0,10),
        GoodsMovementStatus: d.overallGoodsMovementStatus === 'C' ? 'Complete' :
                             d.overallGoodsMovementStatus === 'A' ? 'Not Started' : d.overallGoodsMovementStatus || 'N/A',
        PickingStatus:       d.overallPickingStatus === 'C' ? 'Complete' : d.overallPickingStatus || 'N/A',
        ShippingPoint:       d.shippingPoint
      };
    });
  },

  // ── 11. Journal entries summary
  journal_entries_summary: function(p) {
    var self = this;
    return DB.journal_entry_items_accounts_receivable.slice(0, 50).map(function(j){
      return {
        AccountingDoc: j.accountingDocument,
        BillingDoc:    j.referenceDocument,
        PostingDate:   (j.postingDate||'').substring(0,10),
        Amount:        j.amountInTransactionCurrency,
        Currency:      j.transactionCurrency,
        GLAccount:     j.glAccount,
        Customer:      self._customerName(j.customer),
        ClearingDoc:   j.clearingAccountingDocument || 'Not cleared'
      };
    });
  },

  // ── 12. Cancelled billing documents
  cancelled_billing_docs: function(p) {
    var self = this;
    return DB.billing_document_cancellations.map(function(c){
      return {
        BillingDocument: c.billingDocument,
        Date:            (c.billingDocumentDate||'').substring(0,10),
        NetAmount:       c.totalNetAmount,
        Currency:        c.transactionCurrency,
        Customer:        self._customerName(c.soldToParty),
        AccountingDoc:   c.accountingDocument
      };
    });
  },

  // ── 13. Top sales orders by value
  top_sales_orders: function(p) {
    var self = this;
    return DB.sales_order_headers
      .slice()
      .sort(function(a,b){ return (parseFloat(b.totalNetAmount)||0) - (parseFloat(a.totalNetAmount)||0); })
      .slice(0, parseInt(p.limit)||10)
      .map(function(so){
        return {
          SalesOrder:     so.salesOrder,
          Customer:       self._customerName(so.soldToParty),
          NetAmount:      so.totalNetAmount,
          Currency:       so.transactionCurrency,
          CreationDate:   (so.creationDate||'').substring(0,10),
          DeliveryStatus: so.overallDeliveryStatus
        };
      });
  },

  // ── 14. Find journal entry linked to any document ID
  find_journal_for_document: function(p) {
    var docId = String(p.document_id || '');
    var je = DB.journal_entry_items_accounts_receivable.find(function(j) {
      return String(j.referenceDocument) === docId || String(j.accountingDocument) === docId;
    });
    if (!je) return { error: 'No journal entry found linked to document ' + docId };
    return [{
      QueryDocument:      docId,
      AccountingDocument: je.accountingDocument,
      ReferenceDocument:  je.referenceDocument,
      PostingDate:        (je.postingDate||'').substring(0,10),
      Amount:             je.amountInTransactionCurrency,
      Currency:           je.transactionCurrency,
      GLAccount:          je.glAccount,
      ClearingDoc:        je.clearingAccountingDocument || 'Not cleared'
    }];
  },
  
  // ── 15. Find soldToParty / customer for a specific sales order
  find_order_details: function(p) {
    var soId = String(p.sales_order || p.order_id || '');
    var so = DB.sales_order_headers.find(function(s) {
      return String(s.salesOrder) === soId;
    });
    if (!so) return { error: 'Sales order ' + soId + ' not found in dataset' };
    var bp = DB.business_partners.find(function(b) {
      return b.businessPartner === String(so.soldToParty) || b.customer === String(so.soldToParty);
    });
    return [{
      SalesOrder:      so.salesOrder,
      SoldToParty:     so.soldToParty,
      CustomerName:    bp ? (bp.businessPartnerFullName || bp.businessPartnerName) : so.soldToParty,
      NetAmount:       so.totalNetAmount,
      Currency:        so.transactionCurrency,
      CreationDate:    (so.creationDate||'').substring(0,10),
      DeliveryStatus:  so.overallDeliveryStatus,
      PaymentTerms:    so.customerPaymentTerms || 'N/A'
    }];
  }   // ← no comma, last function// ← NO comma on the last function

};   // ← closes QueryEngine object
  