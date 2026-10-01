import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { createClient } from '@supabase/supabase-js'
const supabase = createClient('https://nsuzmljxfmzrqddiqmok.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5zdXptbGp4Zm16cnFkZGlxbW9rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI4OTIzNjAsImV4cCI6MjA5ODQ2ODM2MH0.AUt7onhK-n3VCrN3sPi7Rtp6CXoDJu1NMjv1FOKZhN4')
const logoUrl = '/logo.png'

/* =========================================================================
   TMS 买卖管理系统 · 云同步版
   数据存 Supabase，多设备实时同步，邮箱登录，审计记真实用户。
   ========================================================================= */

/* ---------- 通用小工具 ---------- */
// 金额小数位：2 或 4，可用顶栏开关切换（汇率固定 4 位）
let DEC = (typeof window !== 'undefined' && window.__tmsDec) || 2
const setDecimals = n => { DEC = n; if (typeof window !== 'undefined') window.__tmsDec = n }
const fmt = n => (isFinite(n) ? n : 0).toLocaleString('en-MY', { minimumFractionDigits: DEC, maximumFractionDigits: DEC })
const fmtInt = n => (isFinite(n) ? Math.round(n) : 0).toLocaleString('en-MY')
const fmtRate = n => (isFinite(n) ? n : 0).toLocaleString('en-MY', { minimumFractionDigits: 4, maximumFractionDigits: 4 })
const rm = n => 'RM ' + fmt(n)
const todayISO = () => new Date().toISOString().slice(0, 10)
const rateOf = (currencies, ccy) => { const c = currencies.find(x => x.code === ccy); return c ? c.rate : 1 }

const ALL_AREAS = [
  { k: 'dash', label: '仪表板' }, { k: 'purchase', label: '采购' }, { k: 'sales', label: '销售' },
  { k: 'payment', label: '收款' }, { k: 'spay', label: '供应商付款' }, { k: 'sreturn', label: '销售退货' }, { k: 'preturn', label: '采购退货' },
  { k: 'customer', label: '顾客' }, { k: 'supplier', label: '供应商' },
  { k: 'item', label: '货品' }, { k: 'currency', label: '货币' }, { k: 'inventory', label: '库存' },
  { k: 'profit', label: '利润' }, { k: 'report', label: '报表' }, { k: 'roles', label: '角色权限' },
]
const areaLabel = k => (ALL_AREAS.find(a => a.k === k) || {}).label || k

/* ---------- 业务计算（与单机版一致，只是数据来自云）---------- */
function invoiceTotals(inv) {
  const amt = inv.items.reduce((s, l) => s + l.qty * l.price * (1 - (l.disc || 0) / 100), 0)
  return { amt, rm: amt * inv.rate }
}
function purchaseTotals(po) {
  const amt = po.items.reduce((s, l) => s + l.qty * l.cost * (1 - (l.disc || 0) / 100), 0)
  return { amt, rm: amt * po.rate }
}
function invoicePaidRM(D, invNo) {
  let p = 0
  D.payments.forEach(pm => (pm.allocs || []).forEach(a => { if (a.invoice === invNo) p += a.rm }))
  return p
}
function invoiceStatus(D, inv) {
  const total = invoiceTotals(inv).rm
  const paid = invoicePaidRM(D, inv.no)
  if (paid <= 0.001) return 'Open'
  if (paid + 0.01 < total) return 'Partial'
  return 'Paid'
}
function creditNoteTotals(cn) {
  const amt = (cn.items || []).reduce((s, l) => s + l.qty * l.price * (1 - (l.disc || 0) / 100), 0)
  return { amt, rm: amt * cn.rate }
}
function debitNoteTotals(dn) {
  const amt = (dn.items || []).reduce((s, l) => s + l.qty * l.cost * (1 - (l.disc || 0) / 100), 0)
  return { amt, rm: amt * dn.rate }
}
function customerBalance(D, custCode) {
  let inv = 0, paid = 0, credit = 0
  D.sales.filter(s => s.customer === custCode).forEach(s => inv += invoiceTotals(s).rm)
  D.payments.filter(p => p.customer === custCode).forEach(p => (p.allocs || []).forEach(a => paid += a.rm))
  ;(D.creditNotes || []).filter(c => c.customer === custCode).forEach(c => credit += creditNoteTotals(c).rm)
  // 未收 = 已开票 − 已收 − 退货(贷记单)
  return { invoiced: inv, paid, credit, outstanding: inv - paid - credit }
}
// 采购单已付 RM（供应商付款分配到这张采购单的）
function purchasePaidRM(D, poNo) {
  let p = 0
  ;(D.supplierPayments || []).forEach(pm => (pm.allocs || []).forEach(a => { if (a.purchase === poNo) p += a.rm }))
  return p
}
function purchaseStatus(D, po) {
  const total = purchaseTotals(po).rm
  const paid = purchasePaidRM(D, po.no)
  // 采购退货减少应付
  let ret = 0
  ;(D.debitNotes || []).filter(d => d.refPurchase === po.no).forEach(d => ret += debitNoteTotals(d).rm)
  if (paid + ret <= 0.001) return 'Open'
  if (paid + ret + 0.01 < total) return 'Partial'
  return 'Paid'
}
// 你欠某供应商多少（应付）
// 你欠某供应商多少（应付）
function supplierBalance(D, supCode) {
  let billed = 0, paid = 0, debit = 0
  D.purchases.filter(p => p.supplier === supCode).forEach(p => billed += purchaseTotals(p).rm)
  ;(D.supplierPayments || []).filter(sp => sp.supplier === supCode).forEach(sp => (sp.allocs || []).forEach(a => paid += a.rm))
  ;(D.debitNotes || []).filter(dn => dn.supplier === supCode).forEach(dn => debit += debitNoteTotals(dn).rm)
  // 应付 = 采购总额 − 已付 − 采购退货
  return { billed, paid, debit, outstanding: billed - paid - debit }
}
function fxGainLoss(D) {
  let total = 0; const rows = []
  D.payments.forEach(p => (p.allocs || []).forEach(a => {
    if (a.fx !== undefined && Math.abs(a.fx) > 0.0001) { total += a.fx; rows.push({ payment: p.no, invoice: a.invoice, fx: a.fx, date: p.date }) }
  }))
  ;(D.supplierPayments || []).forEach(p => (p.allocs || []).forEach(a => {
    if (a.fx !== undefined && Math.abs(a.fx) > 0.0001) { total += a.fx; rows.push({ payment: p.no, invoice: a.purchase, fx: a.fx, date: p.date }) }
  }))
  return { total, rows }
}
// 最新进价成本模型（Latest Cost）
function costModel(D) {
  const cur = {}
  D.items.forEach(it => { cur[it.code] = it.cost || 0 })
  const ev = []
  D.purchases.forEach(po => po.items.forEach(l => ev.push({
    date: po.date, ord: 0, kind: 'P', item: l.item, unitRM: (l.cost || 0) * (1 - (l.disc || 0) / 100) * (po.rate || 1)
  })))
  D.sales.forEach(s => s.items.forEach((l, idx) => ev.push({ date: s.date, ord: 1, kind: 'S', item: l.item, qty: l.qty, no: s.no, idx })))
  ev.sort((a, b) => a.date === b.date ? a.ord - b.ord : a.date.localeCompare(b.date))
  const cogsUnit = {}
  ev.forEach(e => {
    if (e.kind === 'P') { cur[e.item] = e.unitRM }
    else { cogsUnit[e.no] = cogsUnit[e.no] || {}; cogsUnit[e.no][e.idx] = cur[e.item] !== undefined ? cur[e.item] : (D.items.find(i => i.code === e.item)?.cost || 0) }
  })
  return { avg: cur, cogsUnit }
}
function computeInventory(D) {
  const map = {}
  D.items.forEach(it => map[it.code] = { ...it, purchased: 0, sold: 0, adj: 0 })
  D.invTx.forEach(t => {
    const m = map[t.item]; if (!m) return
    if (t.type === '进货' || t.type === 'Purchase') m.purchased += t.qty
    else if (t.type === '销售' || t.type === 'Sales') m.sold += t.qty
    else if (t.type === '销退入库') m.purchased += t.qty   // 客户退货，货加回来
    else if (t.type === '采退出库') m.sold += t.qty          // 退给供应商，货出去
    else if (t.type === '调整' || t.type === 'Adjustment') m.adj += t.qty
  })
  const cm = costModel(D)
  Object.values(map).forEach(m => { m.balance = (m.opening || 0) + m.purchased - m.sold + m.adj; m.avgCost = cm.avg[m.code] !== undefined ? cm.avg[m.code] : m.cost })
  return map
}
function profit(D, from, to) {
  let sales = 0, cogs = 0
  const cm = costModel(D)
  const inRange = d => (!from || d >= from) && (!to || d <= to)
  D.sales.filter(s => inRange(s.date)).forEach(s => {
    sales += invoiceTotals(s).rm
    s.items.forEach((l, idx) => {
      const unit = cm.cogsUnit[s.no]?.[idx]; const it = D.items.find(i => i.code === l.item)
      cogs += (unit !== undefined ? unit : (it ? it.cost : 0)) * l.qty
    })
  })
  // 销售退货（贷记单）：冲减销售额，冲回成本
  ;(D.creditNotes || []).filter(c => inRange(c.date)).forEach(c => {
    sales -= creditNoteTotals(c).rm
    ;(c.items || []).forEach(l => {
      const it = D.items.find(i => i.code === l.item)
      const unit = cm.avg[l.item] !== undefined ? cm.avg[l.item] : (it ? it.cost : 0)
      cogs -= unit * l.qty
    })
  })
  const fx = D.payments.filter(p => inRange(p.date)).reduce((t, p) => t + (p.allocs || []).reduce((x, a) => x + (a.fx || 0), 0), 0)
    + (D.supplierPayments || []).filter(p => inRange(p.date)).reduce((t, p) => t + (p.allocs || []).reduce((x, a) => x + (a.fx || 0), 0), 0)
  return { sales, cogs, fx, net: sales - cogs + fx }
}
const cName = (D, code) => { const c = D.customers.find(x => x.code === code); return c ? c.name : code }
const sName = (D, code) => { const s = D.suppliers.find(x => x.code === code); return s ? s.name : code }
const itemName = (D, code) => { const i = D.items.find(x => x.code === code); return i ? `${code} — ${i.name}` : code }

/* =========================================================================
   数据层：从 Supabase 读所有表 → 组成本地 D 对象；写操作直接打云端。
   ========================================================================= */
// 数据库列名 → 前端字段名 的转换（数据库用 dt/tx_type，前端用 date/type）
const fromDB = {
  purchases: r => ({ no: r.no, supplier: r.supplier, date: r.dt, ccy: r.ccy, rate: r.rate, items: r.items || [] }),
  sales: r => ({ no: r.no, customer: r.customer, date: r.dt, ccy: r.ccy, rate: r.rate, items: r.items || [], foreignOnly: r.foreign_only || false }),
  payments: r => ({ no: r.no, customer: r.customer, date: r.dt, ccy: r.ccy, rate: r.rate, amount: r.amount, allocs: r.allocs || [] }),
  invTx: r => ({ id: r.id, item: r.item, type: r.tx_type, qty: r.qty, doc: r.doc, date: r.dt }),
  credit_notes: r => ({ no: r.no, refInvoice: r.ref_invoice, customer: r.customer, date: r.dt, ccy: r.ccy, rate: r.rate, items: r.items || [], reason: r.reason }),
  debit_notes: r => ({ no: r.no, refPurchase: r.ref_purchase, supplier: r.supplier, date: r.dt, ccy: r.ccy, rate: r.rate, items: r.items || [], reason: r.reason }),
  supplier_payments: r => ({ no: r.no, supplier: r.supplier, date: r.dt, ccy: r.ccy, rate: r.rate, amount: r.amount, allocs: r.allocs || [], method: r.method || '' }),
  ac_suppliers: r => ({ ...r }),
  ac_customers: r => ({ ...r }),
  ac_cards: r => ({ cardNo: r.card_no, cardType: r.card_type, bank: r.bank, cost: r.cost, sell: r.sell, bankAccount: r.bank_account, supplier: r.supplier, inDate: r.in_date, status: r.status, customer: r.customer, assignDate: r.assign_date, soldPrice: r.sold_price, note: r.note }),
  ac_accounts: r => ({ code: r.code, supplier: r.supplier, ssm: r.ssm, bank: r.bank, accountNo: r.account_no, accountName: r.account_name, cost: r.cost, sell: r.sell, monthlyFee: r.monthly_fee, hasCard: r.has_card, cardNo: r.card_no, cardType: r.card_type, status: r.status, customer: r.customer, assignDate: r.assign_date, soldPrice: r.sold_price, note: r.note }),
  ac_bills: r => ({ no: r.no, billType: r.bill_type, account: r.account, customer: r.customer, date: r.dt, period: r.period, items: r.items || [], note: r.note }),
  ac_receipts: r => ({ no: r.no, customer: r.customer, date: r.dt, amount: r.amount, allocs: r.allocs || [], method: r.method, note: r.note }),
  ac_settlements: r => ({ no: r.no, supplier: r.supplier, date: r.dt, amount: r.amount, accounts: r.accounts || [], method: r.method, note: r.note }),
  ac_companies: r => ({ code: r.code, name: r.name, supplier: r.supplier, cost: r.cost, inDate: r.in_date, ssmNo: r.ssm_no, status: r.status, customer: r.customer, assignDate: r.assign_date, soldPrice: r.sold_price, note: r.note }),
  ac_bank_accounts: r => ({ code: r.code, company: r.company, bank: r.bank, accountNo: r.account_no, receiveDate: r.receive_date, monthlyFee: r.monthly_fee, supplierShare: r.supplier_share, status: r.status, stopCharge: r.stop_charge, stopPay: r.stop_pay, hasCard: r.has_card, cardNo: r.card_no, cardType: r.card_type, openDate: r.open_date, note: r.note, cost: r.cost, soldPrice: r.sold_price, customer: r.customer, assignDate: r.assign_date, stockStatus: r.stock_status || '在库', statusDate: r.status_date, agent: r.agent || '', agentFee: r.agent_fee || 0 }),
  ac_supplier_dues: r => ({ id: r.id, supplier: r.supplier, bankAccount: r.bank_account, company: r.company, billNo: r.bill_no, period: r.period, date: r.dt, amount: r.amount, settled: r.settled, note: r.note }),
  ac_banks: r => ({ name: r.name, sortOrder: r.sort_order }),
  ac_agents: r => ({ code: r.code, name: r.name, phone: r.phone, note: r.note }),
  ac_agent_dues: r => ({ id: r.id, agent: r.agent, bankAccount: r.bank_account, company: r.company, billNo: r.bill_no, period: r.period, date: r.dt, amount: r.amount, settled: r.settled, note: r.note }),
  ac_agent_settlements: r => ({ no: r.no, agent: r.agent, date: r.dt, amount: r.amount, method: r.method, note: r.note }),
  expenses: r => ({ no: r.no, date: r.dt, category: r.category, payee: r.payee, amount: r.amount, method: r.method, company: r.company, note: r.note }),
  ac_orders: r => ({ no: r.no, customer: r.customer, orderDate: r.order_date, bank: r.bank, qty: r.qty, price: r.price, monthlyFee: r.monthly_fee, status: r.status, note: r.note }),
  ac_order_fills: r => ({ id: r.id, orderNo: r.order_no, bankAccount: r.bank_account, fillDate: r.fill_date }),
  ac_ba_history: r => ({ id: r.id, bankAccount: r.bank_account, company: r.company, customer: r.customer, assignDate: r.assign_date, returnDate: r.return_date, soldPrice: r.sold_price, monthlyFee: r.monthly_fee, supplierShare: r.supplier_share, returnReason: r.return_reason, note: r.note }),
  bank_accounts: r => ({ code: r.code, bankName: r.bank_name, accountNo: r.account_no, accountName: r.account_name, branch: r.branch, swift: r.swift, note: r.note }),
  currencies: r => ({ code: r.code, rate: r.rate, date: r.eff_date }),
  items: r => ({ code: r.code, name: r.name, category: r.category, unit: r.unit, minStock: r.min_stock, sell: r.sell, cost: r.cost, status: r.status, opening: r.opening }),
  roles: r => ({ name: r.name, locked: r.locked, areas: r.areas || [] }),
  customers: r => ({ ...r }),
  suppliers: r => ({ ...r }),
  audit: r => ({ ts: r.ts, who: r.who, role: r.role, action: r.action, entity: r.entity, ref: r.ref, detail: r.detail }),
}

function useData(session) {
  const [D, setD] = useState(null)
  const [err, setErr] = useState('')

  const loadAll = useCallback(async () => {
    try {
      const tbl = async (name, order) => {
        let q = supabase.from(name).select('*')
        if (order) q = q.order(order.col, { ascending: order.asc })
        const { data, error } = await q
        if (error) throw error
        return (data || []).map(fromDB[name] || (x => x))
      }
      const [currencies, customers, suppliers, items, purchases, sales, payments, invTx, roles, audit, creditNotes, debitNotes, supplierPayments, acSuppliers, acCustomers, acCards, bankAccounts, acAccounts, acBills, acReceipts, acSettlements, acCompanies, acBankAccounts, acSupplierDues, acBaHistory, acOrders, acOrderFills, acAgents, acAgentDues, acAgentSettlements, expenses, acBanks] = await Promise.all([
        tbl('currencies'), tbl('customers'), tbl('suppliers'), tbl('items'),
        tbl('purchases'), tbl('sales'), tbl('payments'),
        tbl('inv_tx'), tbl('roles'), tbl('audit', { col: 'ts', asc: true }),
        tbl('credit_notes'), tbl('debit_notes'), tbl('supplier_payments'),
        tbl('ac_suppliers'), tbl('ac_customers'), tbl('ac_cards'), tbl('bank_accounts'), tbl('ac_accounts'), tbl('ac_bills'), tbl('ac_receipts'), tbl('ac_settlements'),
        tbl('ac_companies'), tbl('ac_bank_accounts'), tbl('ac_supplier_dues', { col: 'id', asc: true }), tbl('ac_ba_history', { col: 'id', asc: true }), tbl('ac_orders'), tbl('ac_order_fills', { col: 'id', asc: true }), tbl('ac_agents'), tbl('ac_agent_dues', { col: 'id', asc: true }), tbl('ac_agent_settlements'), tbl('expenses', { col: 'dt', asc: false }), tbl('ac_banks', { col: 'sort_order', asc: true }),
      ])
      setD({ currencies, customers, suppliers, items, purchases, sales, payments, invTx, roles, audit, creditNotes, debitNotes, supplierPayments, acSuppliers, acCustomers, acCards, bankAccounts, acAccounts, acBills, acReceipts, acSettlements, acCompanies, acBankAccounts, acSupplierDues, acBaHistory, acOrders, acOrderFills, acAgents, acAgentDues, acAgentSettlements, expenses, acBanks })
      setErr('')
    } catch (e) { console.error(e); setErr(e.message || '读取数据失败') }
  }, [])

  useEffect(() => { if (session) loadAll() }, [session, loadAll])

  // 实时同步：任何表变化就重新加载（简单可靠，适合中小数据量）
  useEffect(() => {
    if (!session) return
    const ch = supabase.channel('tms-all')
    ;['currencies', 'customers', 'suppliers', 'items', 'purchases', 'sales', 'payments', 'inv_tx', 'roles', 'audit', 'credit_notes', 'debit_notes', 'supplier_payments', 'ac_suppliers', 'ac_customers', 'ac_cards', 'bank_accounts', 'ac_accounts', 'ac_bills', 'ac_receipts', 'ac_settlements', 'ac_companies', 'ac_bank_accounts', 'ac_supplier_dues', 'ac_ba_history', 'ac_orders', 'ac_order_fills', 'ac_agents', 'ac_agent_dues', 'ac_agent_settlements', 'expenses', 'ac_banks']
      .forEach(t => ch.on('postgres_changes', { event: '*', schema: 'public', table: t }, () => loadAll()))
    ch.subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [session, loadAll])

  return { D, err, reload: loadAll }
}

/* ---- 云端写操作封装 ---- */
async function nextNo(prefix) {
  // 原子递增计数器，避免多人同时开单撞号
  const { data, error } = await supabase.rpc('next_seq', { p_prefix: prefix })
  let seq
  if (error || data == null) {
    // 兜底：没建 rpc 时用读改写（并发下有极小概率撞号，量小可接受）
    const { data: row } = await supabase.from('counters').select('seq').eq('prefix', prefix).single()
    seq = (row?.seq || 0) + 1
    await supabase.from('counters').update({ seq }).eq('prefix', prefix)
  } else { seq = data }
  return `${prefix}-${todayISO().replace(/-/g, '')}-${String(seq).padStart(4, '0')}`
}

// 继续见 App.jsx 第 2 段

/* ---- 各类写操作（写云端；实时订阅会自动刷新界面）---- */
const db = {
  async saveCustomer(c) { return supabase.from('customers').upsert(c) },
  async delCustomer(code) { return supabase.from('customers').delete().eq('code', code) },
  async saveSupplier(s) { return supabase.from('suppliers').upsert(s) },
  async delSupplier(code) { return supabase.from('suppliers').delete().eq('code', code) },
  async delItem(code) { return supabase.from('items').delete().eq('code', code) },
  async saveItem(it) {
    return supabase.from('items').upsert({
      code: it.code, name: it.name, category: it.category, unit: it.unit,
      min_stock: it.minStock, sell: it.sell, cost: it.cost, status: it.status, opening: it.opening
    })
  },
  async saveCurrency(c) { return supabase.from('currencies').upsert({ code: c.code, rate: c.rate, eff_date: c.date }) },
  async saveRole(r) { return supabase.from('roles').upsert({ name: r.name, locked: !!r.locked, areas: r.areas }) },
  async delRole(name) { return supabase.from('roles').delete().eq('name', name) },

  async savePurchase(po, isEdit) {
    await supabase.from('purchases').upsert({ no: po.no, supplier: po.supplier, dt: po.date, ccy: po.ccy, rate: po.rate, items: po.items })
    if (isEdit) await supabase.from('inv_tx').delete().eq('doc', po.no)
    const rows = po.items.map(l => ({ item: l.item, tx_type: '进货', qty: l.qty, doc: po.no, dt: po.date }))
    if (rows.length) await supabase.from('inv_tx').insert(rows)
  },
  async delPurchase(no) {
    await supabase.from('inv_tx').delete().eq('doc', no)
    await supabase.from('purchases').delete().eq('no', no)
  },
  async saveSale(s, isEdit) {
    await supabase.from('sales').upsert({ no: s.no, customer: s.customer, dt: s.date, ccy: s.ccy, rate: s.rate, items: s.items, foreign_only: !!s.foreignOnly })
    if (isEdit) await supabase.from('inv_tx').delete().eq('doc', s.no)
    const rows = s.items.map(l => ({ item: l.item, tx_type: '销售', qty: l.qty, doc: s.no, dt: s.date }))
    if (rows.length) await supabase.from('inv_tx').insert(rows)
  },
  async delSale(D, no) {
    await supabase.from('inv_tx').delete().eq('doc', no)
    // 移除相关收款分配
    for (const p of D.payments) {
      if ((p.allocs || []).some(a => a.invoice === no)) {
        const allocs = p.allocs.filter(a => a.invoice !== no)
        await supabase.from('payments').update({ allocs }).eq('no', p.no)
      }
    }
    await supabase.from('sales').delete().eq('no', no)
  },
  async savePayment(p) {
    return supabase.from('payments').upsert({ no: p.no, customer: p.customer, dt: p.date, ccy: p.ccy, rate: p.rate, amount: p.amount, allocs: p.allocs })
  },
  async delPayment(no) { return supabase.from('payments').delete().eq('no', no) },

  // 供应商付款（应付）
  async saveSupplierPayment(p) {
    return supabase.from('supplier_payments').upsert({ no: p.no, supplier: p.supplier, dt: p.date, ccy: p.ccy, rate: p.rate, amount: p.amount, allocs: p.allocs, method: p.method || '' })
  },
  async delSupplierPayment(no) { return supabase.from('supplier_payments').delete().eq('no', no) },

  // 销售退货（贷记单）：货加回库存
  async saveCreditNote(cn) {
    await supabase.from('credit_notes').upsert({ no: cn.no, ref_invoice: cn.refInvoice, customer: cn.customer, dt: cn.date, ccy: cn.ccy, rate: cn.rate, items: cn.items, reason: cn.reason || '' })
    await supabase.from('inv_tx').delete().eq('doc', cn.no)
    const rows = cn.items.map(l => ({ item: l.item, tx_type: '销退入库', qty: l.qty, doc: cn.no, dt: cn.date }))
    if (rows.length) await supabase.from('inv_tx').insert(rows)
  },
  async delCreditNote(no) {
    await supabase.from('inv_tx').delete().eq('doc', no)
    await supabase.from('credit_notes').delete().eq('no', no)
  },
  // 采购退货（借记单）：货从库存减少
  async saveDebitNote(dn) {
    await supabase.from('debit_notes').upsert({ no: dn.no, ref_purchase: dn.refPurchase, supplier: dn.supplier, dt: dn.date, ccy: dn.ccy, rate: dn.rate, items: dn.items, reason: dn.reason || '' })
    await supabase.from('inv_tx').delete().eq('doc', dn.no)
    const rows = dn.items.map(l => ({ item: l.item, tx_type: '采退出库', qty: l.qty, doc: dn.no, dt: dn.date }))
    if (rows.length) await supabase.from('inv_tx').insert(rows)
  },
  async delDebitNote(no) {
    await supabase.from('inv_tx').delete().eq('doc', no)
    await supabase.from('debit_notes').delete().eq('no', no)
  },
  // 供应商付款（应付）
  async saveSupplierPayment(p) {
    return supabase.from('supplier_payments').upsert({ no: p.no, supplier: p.supplier, dt: p.date, ccy: p.ccy, rate: p.rate, amount: p.amount, allocs: p.allocs, method: p.method || '' })
  },
  async delSupplierPayment(no) { return supabase.from('supplier_payments').delete().eq('no', no) },

  // ===== AC Management =====
  async saveAcSupplier(s) { return supabase.from('ac_suppliers').upsert(s) },
  async delAcSupplier(code) { return supabase.from('ac_suppliers').delete().eq('code', code) },
  async saveAcCustomer(c) { return supabase.from('ac_customers').upsert(c) },
  async delAcCustomer(code) { return supabase.from('ac_customers').delete().eq('code', code) },
  async saveAcCard(c) {
    return supabase.from('ac_cards').upsert({
      card_no: c.cardNo, card_type: c.cardType, bank: c.bank, cost: c.cost, sell: c.sell,
      bank_account: c.bankAccount, supplier: c.supplier, in_date: c.inDate, status: c.status,
      customer: c.customer || null, assign_date: c.assignDate || null, sold_price: c.soldPrice ?? null, note: c.note || ''
    })
  },
  async delAcCard(cardNo) { return supabase.from('ac_cards').delete().eq('card_no', cardNo) },
  async assignCard(cardNo, customer, assignDate, soldPrice) {
    return supabase.from('ac_cards').update({ status: '已发', customer, assign_date: assignDate, sold_price: soldPrice }).eq('card_no', cardNo)
  },
  async returnCard(cardNo) { return supabase.from('ac_cards').update({ status: '已退' }).eq('card_no', cardNo) },
  async voidCard(cardNo) { return supabase.from('ac_cards').update({ status: '注销' }).eq('card_no', cardNo) },

  // ===== 银行户口（核心）=====
  async saveAcAccount(a) {
    return supabase.from('ac_accounts').upsert({
      code: a.code, supplier: a.supplier || null, ssm: a.ssm || null, bank: a.bank, account_no: a.accountNo, account_name: a.accountName,
      cost: a.cost, sell: a.sell, monthly_fee: a.monthlyFee || 0, has_card: !!a.hasCard, card_no: a.cardNo || null, card_type: a.cardType || null,
      status: a.status, customer: a.customer || null, assign_date: a.assignDate || null, sold_price: a.soldPrice ?? null, note: a.note || ''
    })
  },
  async delAcAccount(code) { return supabase.from('ac_accounts').delete().eq('code', code) },
  async assignAccount(code, customer, assignDate, soldPrice) {
    return supabase.from('ac_accounts').update({ status: '已发', customer, assign_date: assignDate, sold_price: soldPrice }).eq('code', code)
  },
  async returnAccount(code) { return supabase.from('ac_accounts').update({ status: '已退' }).eq('code', code) },
  async voidAccount(code) { return supabase.from('ac_accounts').update({ status: '注销' }).eq('code', code) },

  // ===== AC 账单 & 收款 =====
  async saveAcBill(b) {
    return supabase.from('ac_bills').upsert({ no: b.no, bill_type: b.billType, account: b.account, customer: b.customer, dt: b.date, period: b.period, items: b.items, note: b.note || '' })
  },
  async delAcBill(no) { return supabase.from('ac_bills').delete().eq('no', no) },
  async saveAcReceipt(r) {
    return supabase.from('ac_receipts').upsert({ no: r.no, customer: r.customer, dt: r.date, amount: r.amount, allocs: r.allocs, method: r.method || '', note: r.note || '' })
  },
  async delAcReceipt(no) { return supabase.from('ac_receipts').delete().eq('no', no) },
  async saveAcSettlement(s) {
    return supabase.from('ac_settlements').upsert({ no: s.no, supplier: s.supplier, dt: s.date, amount: s.amount, accounts: s.accounts || [], method: s.method || '', note: s.note || '' })
  },
  async delAcSettlement(no) { return supabase.from('ac_settlements').delete().eq('no', no) },

  // ===== AC 公司层（卡商 → 公司 → 银行户口）=====
  async saveAcCompany(c) {
    return supabase.from('ac_companies').upsert({
      code: c.code, name: c.name, supplier: c.supplier, cost: +c.cost || 0, in_date: c.inDate || null,
      ssm_no: c.ssmNo || '', status: c.status || '在库', customer: c.customer || null,
      assign_date: c.assignDate || null, sold_price: +c.soldPrice || 0, note: c.note || ''
    })
  },
  async delAcCompany(code) {
    await supabase.from('ac_bank_accounts').delete().eq('company', code)
    return supabase.from('ac_companies').delete().eq('code', code)
  },
  async saveAcBankAccount(b) {
    return supabase.from('ac_bank_accounts').upsert({
      code: b.code, company: b.company, bank: b.bank, account_no: b.accountNo || '',
      monthly_fee: +b.monthlyFee || 0, supplier_share: +b.supplierShare || 0,
      status: b.status || '正常', stop_charge: !!b.stopCharge, stop_pay: !!b.stopPay,
      has_card: !!b.hasCard, card_no: b.cardNo || '', card_type: b.cardType || '',
      open_date: b.openDate || null, note: b.note || '',
      cost: +b.cost || 0, sold_price: +b.soldPrice || 0,
      customer: b.customer || null, assign_date: b.assignDate || null,
      stock_status: b.stockStatus || '在库', receive_date: b.receiveDate || null,
      status_date: b.statusDate || null, agent: b.agent || '', agent_fee: +b.agentFee || 0
    })
  },
  async delAcBankAccount(code) { return supabase.from('ac_bank_accounts').delete().eq('code', code) },
  async saveAcDue(d) {
    const row = { supplier: d.supplier, bank_account: d.bankAccount, company: d.company || '', bill_no: d.billNo || '', period: d.period || '', dt: d.date, amount: +d.amount || 0, settled: !!d.settled, note: d.note || '' }
    if (d.id) return supabase.from('ac_supplier_dues').update(row).eq('id', d.id)
    // 有账单号的：先删掉同一账单已有的应付，避免重复（保留已结算的不动）
    if (d.billNo) {
      const { data: ex } = await supabase.from('ac_supplier_dues').select('id,settled').eq('bill_no', d.billNo)
      if (ex && ex.length) {
        // 若已有已结算的，不重复加，直接返回
        if (ex.some(x => x.settled)) return { data: null, error: null }
        await supabase.from('ac_supplier_dues').delete().eq('bill_no', d.billNo).eq('settled', false)
      }
    }
    return supabase.from('ac_supplier_dues').insert(row)
  },
  async delAcDuesByBill(billNo) { return supabase.from('ac_supplier_dues').delete().eq('bill_no', billNo) },
  async markDuesSettled(ids, settled) { return supabase.from('ac_supplier_dues').update({ settled }).in('id', ids) },
  // ===== agent =====
  async saveAgent(a) { return supabase.from('ac_agents').upsert({ code: a.code, name: a.name, phone: a.phone || '', note: a.note || '' }) },
  async delAgent(code) { return supabase.from('ac_agents').delete().eq('code', code) },
  async saveAgentDue(d) {
    const row = { agent: d.agent, bank_account: d.bankAccount, company: d.company || '', bill_no: d.billNo || '', period: d.period || '', dt: d.date, amount: +d.amount || 0, settled: !!d.settled, note: d.note || '' }
    if (d.id) return supabase.from('ac_agent_dues').update(row).eq('id', d.id)
    if (d.billNo) {
      const { data: ex } = await supabase.from('ac_agent_dues').select('id,settled').eq('bill_no', d.billNo)
      if (ex && ex.length) {
        if (ex.some(x => x.settled)) return { data: null, error: null }
        await supabase.from('ac_agent_dues').delete().eq('bill_no', d.billNo).eq('settled', false)
      }
    }
    return supabase.from('ac_agent_dues').insert(row)
  },
  async delAgentDuesByBill(billNo) { return supabase.from('ac_agent_dues').delete().eq('bill_no', billNo) },
  async markAgentDuesSettled(ids, settled) { return supabase.from('ac_agent_dues').update({ settled }).in('id', ids) },
  async saveAgentSettlement(s) { return supabase.from('ac_agent_settlements').upsert({ no: s.no, agent: s.agent, dt: s.date, amount: +s.amount || 0, method: s.method || '', note: s.note || '' }) },
  // 删结算：把该 agent 因这笔结算而标已结的佣金，按金额从最新往回改成未结（还原）
  async delAgentSettlement(no, agent, amount, D) {
    await supabase.from('ac_agent_settlements').delete().eq('no', no)
    // 还原：从最近已结的佣金往前，退回相当于这笔结算金额的佣金到未结
    let left = +amount || 0
    const settled = (D.acAgentDues || []).filter(d => d.agent === agent && d.settled).sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    const ids = []
    for (const d of settled) { if (left >= (+d.amount || 0) - 0.01) { ids.push(d.id); left -= (+d.amount || 0) } else break }
    if (ids.length) await supabase.from('ac_agent_dues').update({ settled: false }).in('id', ids)
  },
  // ===== 开销 =====
  async saveExpense(e) { return supabase.from('expenses').upsert({ no: e.no, dt: e.date, category: e.category || '', payee: e.payee || '', amount: +e.amount || 0, method: e.method || '', company: e.company || '', note: e.note || '' }) },
  async delExpense(no) { return supabase.from('expenses').delete().eq('no', no) },
  async saveAcBank(name, order) { return supabase.from('ac_banks').upsert({ name, sort_order: order || 50 }) },
  async delAcBank(name) { return supabase.from('ac_banks').delete().eq('name', name) },
  // 改户口「给卡商」后，同步未结算的应付（整月的用新值，按天的重算）
  async syncDuesForAccount(baCode, newShare, D) {
    const ba = (D.acBankAccounts || []).find(x => x.code === baCode); if (!ba) return
    const dues = (D.acSupplierDues || []).filter(x => x.bankAccount === baCode && !x.settled)
    for (const due of dues) {
      const bill = (D.acBills || []).find(b => b.no === due.billNo)
      const isFirst = bill && bill.billType === '首期'
      const isProrated = isFirst || (due.note && /按天/.test(due.note))
      let amt = +newShare || 0
      if (isProrated && ba.assignDate && acPeriodOf(ba.assignDate) === due.period) {
        amt = +acProratedFee(+newShare || 0, ba.assignDate).toFixed(2)
      }
      await supabase.from('ac_supplier_dues').update({ amount: amt }).eq('id', due.id)
    }
  },
  // 改户口「月费」后，同步未收清的月费账单（整月用新值，首期按天那张的月费项重算）
  async syncBillsForAccount(baCode, newFee, D) {
    const ba = (D.acBankAccounts || []).find(x => x.code === baCode); if (!ba) return
    const bills = (D.acBills || []).filter(b => b.account === baCode)
    for (const b of bills) {
      const paid = acBillPaid(D, b.no)
      if (paid > 0.01) continue   // 已收过钱的不动
      const isFirstMonth = ba.assignDate && acPeriodOf(ba.assignDate) === b.period
      let changed = false
      const items = (b.items || []).map(it => {
        if (it.kind === 'fee' || it.name === '月费' || /月费/.test(it.name)) {
          const val = (b.billType === '首期' || /按天/.test(it.name)) && isFirstMonth
            ? +acProratedFee(+newFee || 0, ba.assignDate).toFixed(2)
            : (+newFee || 0)
          changed = true
          return { ...it, amount: val }
        }
        return it
      })
      if (changed) await supabase.from('ac_bills').update({ items }).eq('no', b.no)
    }
  },
  // 改户口 agent / agent佣金后：为该户口所有月费账单补上/更新/清除 agent 应付（已结算不动）
  async syncAgentDuesForAccount(baCode, D) {
    const ba = (D.acBankAccounts || []).find(x => x.code === baCode); if (!ba) return
    const bills = (D.acBills || []).filter(b => b.account === baCode)
    for (const b of bills) {
      const { data: ex } = await supabase.from('ac_agent_dues').select('id,settled').eq('bill_no', b.no)
      const settledExists = (ex || []).some(x => x.settled)
      if (settledExists) continue   // 已结算的账单不动
      // 先删这张账单未结的 agent 应付
      await supabase.from('ac_agent_dues').delete().eq('bill_no', b.no).eq('settled', false)
      // 若现在有 agent 且有佣金，重新插一笔
      if (ba.agent && (+ba.agentFee || 0) > 0) {
        const isFirstMonth = ba.assignDate && acPeriodOf(ba.assignDate) === b.period
        const amt = isFirstMonth ? +acProratedFee(+ba.agentFee || 0, ba.assignDate).toFixed(2) : (+ba.agentFee || 0)
        if (amt > 0) await supabase.from('ac_agent_dues').insert({ agent: ba.agent, bank_account: baCode, company: ba.company, bill_no: b.no, period: b.period, dt: b.date, amount: amt, settled: false, note: `${acCoName(D, ba.company)} · ${ba.bank}` })
      }
    }
  },
  // 顾客订单（排队）
  async saveAcOrder(o) {
    return supabase.from('ac_orders').upsert({
      no: o.no, customer: o.customer, order_date: o.orderDate, bank: o.bank || '',
      qty: +o.qty || 1, price: +o.price || 0, monthly_fee: +o.monthlyFee || 0,
      status: o.status || '排队中', note: o.note || ''
    })
  },
  async delAcOrder(no) {
    await supabase.from('ac_order_fills').delete().eq('order_no', no)
    return supabase.from('ac_orders').delete().eq('no', no)
  },
  async fillAcOrder(orderNo, baCode, fillDate) {
    return supabase.from('ac_order_fills').insert({ order_no: orderNo, bank_account: baCode, fill_date: fillDate })
  },
  async unfillAcOrder(id) { return supabase.from('ac_order_fills').delete().eq('id', id) },
  // 户口流转历史
  async openBaHistory(h) {
    return supabase.from('ac_ba_history').insert({
      bank_account: h.bankAccount, company: h.company || '', customer: h.customer,
      assign_date: h.assignDate, sold_price: +h.soldPrice || 0,
      monthly_fee: +h.monthlyFee || 0, supplier_share: +h.supplierShare || 0, note: h.note || ''
    })
  },
  async closeBaHistory(baCode, returnDate, reason) {
    // 关掉这个户口最近一条还没退回的记录
    const { data } = await supabase.from('ac_ba_history').select('id').eq('bank_account', baCode).is('return_date', null).order('id', { ascending: false }).limit(1)
    if (!data || !data.length) return { error: null }
    return supabase.from('ac_ba_history').update({ return_date: returnDate, return_reason: reason || '' }).eq('id', data[0].id)
  },

  // ===== Bank 数据库（共用）=====
  async saveBank(b) {
    return supabase.from('bank_accounts').upsert({ code: b.code, bank_name: b.bankName, account_no: b.accountNo, account_name: b.accountName, branch: b.branch, swift: b.swift, note: b.note })
  },
  async delBank(code) { return supabase.from('bank_accounts').delete().eq('code', code) },

  async audit(who, role, action, entity, ref, detail) {
    return supabase.from('audit').insert({ who, role, action, entity, ref: ref || '', detail: detail || '' })
  },
}

/* =========================================================================
   样式
   ========================================================================= */
const CSS = `
:root{
--ink:#0d1a15;--ink-soft:#4a5a52;--ink-mut:#7b8a82;--line:#e2e0d6;--line-strong:#c9c5b6;--paper:#f0f3ef;--paper-2:#e9ede9;--card:#ffffff;--row-alt:#fafbf9;--row-hover:#eef4f0;
--accent:#0d3b30;--accent-2:#175f4c;--accent-3:#1f7159;--accent-soft:#e9f1ec;--accent-line:#c6ddd0;
--gold:#a8801f;--gold-2:#c69a34;--gold-soft:#f8f0da;--gold-line:#e7d5a6;
--warn:#9c5416;--danger:#b8281f;--danger-soft:#fbe6e4;--danger-line:#efc0bb;--pos:#0f6b45;
--nav:#0b2b23;--nav-2:#0e332a;--nav-hover:#154438;--nav-text:#a9bdb3;--nav-dim:#6b8177;--nav-head:#5d7368;
--mono:"SF Mono",ui-monospace,"Roboto Mono",Menlo,"PingFang SC","Microsoft YaHei",monospace;--sans:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei","Helvetica Neue",Helvetica,Arial,sans-serif;
--shadow-xs:0 1px 2px rgba(13,45,37,.04);--shadow-sm:0 1px 3px rgba(13,45,37,.06),0 1px 2px rgba(13,45,37,.04);
--shadow-md:0 6px 24px rgba(13,45,37,.09);--shadow-lg:0 24px 68px rgba(9,28,23,.30);
--r:8px;--r-lg:14px;--ease:cubic-bezier(.22,.61,.36,1);
}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--sans);font-size:15px;line-height:1.55;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;letter-spacing:-.005em}
button{transition:background .2s var(--ease),color .2s var(--ease),border-color .2s var(--ease),transform .12s var(--ease),box-shadow .2s var(--ease)}
.app{display:flex;min-height:100vh}
aside{width:230px;background:linear-gradient(176deg,var(--nav) 0%,var(--nav-2) 100%);color:var(--nav-text);flex-shrink:0;position:sticky;top:0;height:100vh;overflow:auto;display:flex;flex-direction:column;border-right:1px solid rgba(0,0,0,.15)}
aside::-webkit-scrollbar{width:5px}aside::-webkit-scrollbar-thumb{background:rgba(255,255,255,.07);border-radius:3px}
.brand{padding:22px 18px 18px;border-bottom:1px solid rgba(255,255,255,.06);margin-bottom:2px}
.brand b{color:#fff;font-size:16px;display:block;letter-spacing:.01em}.brand span{font-size:10px;color:var(--gold-2);letter-spacing:.16em;text-transform:uppercase;font-weight:600}
nav{padding:8px 10px;flex:1}nav .grp{font-size:9.5px;letter-spacing:.18em;color:var(--nav-head);padding:16px 12px 7px;text-transform:uppercase;font-weight:600}
nav button{display:flex;gap:11px;align-items:center;width:100%;background:none;border:0;color:var(--nav-text);padding:10px 12px;border-radius:8px;cursor:pointer;font-size:14px;text-align:left;font-family:var(--sans);position:relative;letter-spacing:-.005em}
nav button span{font-size:14px;width:18px;text-align:center;opacity:.72;transition:opacity .2s}
nav button:hover{background:var(--nav-hover);color:#fff}nav button:hover span{opacity:1}
nav button.on{background:linear-gradient(90deg,rgba(198,154,52,.32),rgba(198,154,52,.10));color:#fff;font-weight:650;box-shadow:inset 3px 0 0 var(--gold-2)}
nav button.on span{opacity:1}
nav button.on::before{content:"";position:absolute;left:0;top:6px;bottom:6px;width:3px;border-radius:0 3px 3px 0;background:linear-gradient(180deg,var(--gold-2),var(--gold))}
main{flex:1;min-width:0;display:flex;flex-direction:column}
.top{display:flex;align-items:center;justify-content:space-between;padding:15px 30px;background:rgba(255,255,255,.85);backdrop-filter:saturate(1.4) blur(8px);border-bottom:1px solid var(--line);position:sticky;top:0;z-index:5}
.top h1{margin:0;font-size:18px;font-weight:600;letter-spacing:-.02em;color:var(--ink)}.top .sub{font-size:12px;color:var(--ink-soft);margin-top:2px}
.rolebox{display:flex;align-items:center;gap:10px;font-size:12px}
select,input,textarea{font-family:var(--sans);font-size:13px;padding:8px 11px;border:1px solid var(--line-strong);border-radius:var(--r);background:#fff;color:var(--ink);transition:border-color .18s,box-shadow .18s}
select:hover,input:hover,textarea:hover{border-color:var(--ink-mut)}
select:focus,input:focus,textarea:focus{outline:0;border-color:var(--accent-3);box-shadow:0 0 0 3.5px var(--accent-soft)}
.wrap{padding:26px 30px;max-width:1240px;animation:fade .3s var(--ease)}
@keyframes fade{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:20px}
.kpi{background:var(--card);border:1px solid var(--line);border-radius:var(--r-lg);padding:17px 18px;box-shadow:var(--shadow-xs);transition:box-shadow .22s var(--ease),transform .22s var(--ease),border-color .22s}
.kpi:hover{box-shadow:var(--shadow-md);transform:translateY(-2px);border-color:var(--accent-line)}
.kpi .l{font-size:12px;letter-spacing:.01em;color:var(--ink-soft);font-weight:600}
.kpi .v{font-size:26px;font-weight:750;margin-top:6px;font-variant-numeric:tabular-nums;letter-spacing:-.03em;color:var(--ink)}
.kpi .v.mono{font-family:var(--mono);font-size:26px;letter-spacing:-.03em;font-weight:750}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:18px}
.panel{background:var(--card);border:1px solid var(--line);border-radius:var(--r-lg);overflow:hidden;box-shadow:var(--shadow-xs)}
.panel h3{margin:0;padding:15px 18px;font-size:14.5px;font-weight:700;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;color:var(--ink);letter-spacing:-.01em}
.panel .body{padding:17px 18px}
.bar{display:flex;gap:10px;align-items:center;margin-bottom:16px;flex-wrap:wrap}.bar .sp{flex:1}
.btn{background:var(--accent);color:#fff;border:0;padding:9px 17px;border-radius:var(--r);font-size:13px;font-weight:550;cursor:pointer;box-shadow:var(--shadow-xs);letter-spacing:.005em}
.btn:hover{background:var(--accent-2);transform:translateY(-1px);box-shadow:var(--shadow-md)}
.btn:active{transform:translateY(0);box-shadow:var(--shadow-xs)}
.btn.ghost{background:#fff;color:var(--ink);border:1px solid var(--line-strong);box-shadow:none}
.btn.ghost:hover{background:var(--paper);border-color:var(--ink-mut);transform:none;box-shadow:none}
.btn.gold{background:linear-gradient(135deg,var(--gold-2),var(--gold));color:#fff}.btn.gold:hover{filter:brightness(1.06)}
.btn.sm{padding:6px 12px;font-size:12px}.btn.danger{background:var(--danger)}.btn.danger:hover{background:#8f2a24}
.btn:disabled{opacity:.4;cursor:not-allowed;transform:none;box-shadow:none}
table{width:100%;border-collapse:collapse;font-size:14px}
th{text-align:left;font-size:11px;letter-spacing:.04em;color:var(--ink-soft);padding:12px 15px;border-bottom:2px solid var(--line-strong);white-space:nowrap;background:var(--paper-2);text-transform:uppercase;font-weight:700}
td{padding:13px 15px;border-bottom:1px solid var(--line);vertical-align:middle}tr:last-child td{border-bottom:0}
tbody tr:nth-child(even){background:var(--row-alt)}
tbody tr:hover{background:var(--row-hover)}
tbody tr{transition:background .14s}tbody tr:hover{background:var(--accent-soft)}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums;font-family:var(--mono);font-size:13.5px;font-weight:600;color:var(--ink)}
.code{font-family:var(--mono);font-size:12.5px;font-weight:700;color:var(--accent-2);letter-spacing:-.02em}.muted{color:var(--ink-mut)}
.pill{display:inline-block;font-size:11.5px;padding:4px 11px;border-radius:99px;font-weight:700;letter-spacing:.005em;border:1px solid transparent}
.pill.open{background:var(--gold-soft);color:var(--gold);border-color:var(--gold-line)}.pill.partial{background:#fbf1da;color:#95721b;border-color:var(--gold-line)}
.pill.paid{background:var(--accent-soft);color:var(--accent);border-color:var(--accent-line)}.pill.low{background:var(--danger-soft);color:var(--danger);border-color:var(--danger-line)}.pill.ok{background:var(--accent-soft);color:var(--accent);border-color:var(--accent-line)}
.pos{color:var(--pos);font-weight:650}.neg{color:var(--danger);font-weight:650}
.empty{padding:36px;text-align:center;color:var(--ink-mut);font-size:13px}
.ov{position:fixed;inset:0;background:rgba(11,30,24,.52);backdrop-filter:blur(3px);display:flex;align-items:flex-start;justify-content:center;padding:40px 14px;z-index:40;overflow:auto;animation:ovin .2s ease}
@keyframes ovin{from{opacity:0}to{opacity:1}}
.modal{background:var(--card);border-radius:var(--r-lg);width:100%;max-width:720px;box-shadow:var(--shadow-lg);animation:modin .26s var(--ease)}
@keyframes modin{from{opacity:0;transform:translateY(14px) scale(.985)}to{opacity:1;transform:none}}
.modal.wide{max-width:920px}
.modal .mh{display:flex;justify-content:space-between;align-items:center;padding:18px 24px;border-bottom:1px solid var(--line)}
.modal .mh b{font-size:15px;font-weight:600;letter-spacing:-.01em}
.modal .mb{padding:22px 24px;max-height:70vh;overflow:auto}
.modal .mf{padding:15px 24px;border-top:1px solid var(--line);display:flex;align-items:center;gap:10px;background:var(--paper);border-radius:0 0 var(--r-lg) var(--r-lg)}
.modal .mf>button:first-child:not(.danger){margin-left:auto}
.x{border:0;background:none;font-size:20px;cursor:pointer;color:var(--ink-mut);width:32px;height:32px;border-radius:8px;transition:background .15s,color .15s}.x:hover{background:var(--paper);color:var(--ink)}
.fld{display:flex;flex-direction:column;gap:6px;margin-bottom:14px}
.fld label{font-size:11.5px;font-weight:600;color:var(--ink-soft);letter-spacing:.005em}
.fg{display:grid;grid-template-columns:1fr 1fr;gap:14px}.fg3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px}
.lineitems td{padding:6px 6px}.lineitems input,.lineitems select{padding:7px 9px;width:100%}
.tot{display:flex;justify-content:flex-end;gap:28px;padding:12px 4px 0;font-size:14px;align-items:baseline}
.tot .k{color:var(--ink-soft);font-weight:500}.tot .v{font-family:var(--mono);font-weight:700;min-width:118px;text-align:right;color:var(--ink);font-size:15px}
.hint{font-size:12.5px;color:var(--ink-soft);margin-top:5px;line-height:1.6}
.rateline{background:var(--accent-soft);border:1px solid var(--accent-line);border-radius:var(--r);padding:11px 14px;font-size:12.5px;margin-bottom:14px;font-family:var(--mono);color:var(--accent);letter-spacing:-.01em}
.seg{display:inline-flex;border:1px solid var(--line-strong);border-radius:var(--r);overflow:hidden}
.seg button{border:0;background:#fff;padding:7px 15px;font-size:12px;cursor:pointer;font-family:var(--sans)}.seg button.on{background:var(--accent);color:#fff}
.toast{position:fixed;bottom:26px;left:50%;transform:translateX(-50%);background:var(--ink);color:#fff;padding:13px 22px;border-radius:11px;font-size:13px;z-index:60;box-shadow:var(--shadow-lg);animation:tin .3s var(--ease);border:1px solid rgba(255,255,255,.08)}
@keyframes tin{from{opacity:0;transform:translate(-50%,14px)}to{opacity:1;transform:translate(-50%,0)}}
.linkbtn{border:0;background:none;color:var(--accent-2);cursor:pointer;font-size:12.5px;padding:3px 6px;font-family:var(--sans);border-radius:6px;font-weight:500;transition:background .14s,color .14s}.linkbtn:hover{background:var(--accent-soft)}.linkbtn.del{color:var(--danger)}.linkbtn.del:hover{background:var(--danger-soft)}
.login{max-width:390px;margin:11vh auto;background:var(--card);border:1px solid var(--line);border-radius:18px;padding:38px 34px;box-shadow:var(--shadow-md)}
.login h2{margin:0 0 4px;font-size:23px;font-weight:650;letter-spacing:-.02em}.login p{margin:0 0 22px;color:var(--ink-soft);font-size:13px}
.login .fld{margin-bottom:16px}.login input{width:100%}
.menutog{display:none;border:1px solid var(--line-strong);background:#fff;border-radius:var(--r);padding:7px 11px;cursor:pointer}
.navbk{display:none}.modcard{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:28px 24px;cursor:pointer;text-align:center;transition:border-color .22s var(--ease),box-shadow .22s var(--ease),transform .22s var(--ease);box-shadow:var(--shadow-xs)}
.modcard:hover{border-color:var(--gold-line);box-shadow:var(--shadow-md);transform:translateY(-4px)}
.modcard .modic{font-size:34px;margin-bottom:11px}
.modcard b{display:block;font-size:15px;margin-bottom:4px;font-weight:600;letter-spacing:-.01em}
.modcard span{font-size:12px;color:var(--ink-soft)}
.modcard.wide{padding:20px 24px}
@media(max-width:820px){
  body{font-size:15px}
  .kpis{grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px}
  .kpi{padding:12px 13px;border-radius:11px}
  .kpi .l{font-size:11px}.kpi .v{font-size:20px;margin-top:4px}.kpi .v.mono{font-size:16px}
  .grid2{grid-template-columns:1fr;gap:14px}
  aside{position:fixed;left:-260px;width:260px;transition:left .24s var(--ease);z-index:50;box-shadow:var(--shadow-lg)}
  aside.open{left:0}
  .menutog{display:inline-flex!important;font-size:20px;padding:8px 12px}
  .wrap{padding:14px 13px}
  .top{padding:11px 14px}
  .top h1{font-size:16px}.top .sub{display:none}
  .brand{padding:18px 16px 14px}
  nav button{padding:12px 14px;font-size:15px}
  nav button span{font-size:17px}
  /* 按钮和输入放大好点 */
  .btn{padding:12px 18px;font-size:15px}
  .btn.sm{padding:9px 14px;font-size:14px}
  select,input,textarea{font-size:16px;padding:11px 12px}
  .linkbtn{font-size:15px;padding:8px 10px;display:inline-block}
  td .linkbtn{padding:9px 12px}
  /* 表格：横向滚动，别硬挤 */
  .panel{overflow-x:auto;-webkit-overflow-scrolling:touch}
  table{min-width:560px}
  th{font-size:11px;padding:11px 12px}
  td{padding:12px 12px;font-size:14px}
  td.num,th.num{font-size:13px}
  .bar{gap:8px}
  .bar input,.bar select{flex:1;min-width:0}
  /* 弹窗全屏化，好填 */
  .ov{padding:0;align-items:stretch}
  .modal,.modal.wide{max-width:100%;width:100%;min-height:100vh;border-radius:0;animation:modinm .24s var(--ease)}
  .modal .mh{padding:16px 18px;position:sticky;top:0;background:var(--card);z-index:2}
  .modal .mh b{font-size:17px}
  .modal .mb{padding:18px;max-height:none}
  .modal .mf{padding:14px 18px;position:sticky;bottom:0;flex-wrap:wrap}
  .modal .mf .btn{flex:1;min-width:120px}
  /* 表单两列改一列 */
  .fg,.fg3{grid-template-columns:1fr;gap:12px}
  .fld label{font-size:13px}
  .lineitems{min-width:480px}
  .x{width:38px;height:38px;font-size:22px}
  .modcard{padding:22px 18px}
  .navbk{display:block;position:fixed;inset:0;background:rgba(11,30,24,.45);z-index:49;animation:ovin .2s ease}
}
@keyframes modinm{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:none}}
`

/* 小组件 */
function Field({ label, children }) { return <div className="fld"><label>{label}</label>{children}</div> }
function Pill({ s }) {
  const MAP = { Open: ['open', '未收'], Partial: ['partial', '部分'], Paid: ['paid', '已付'], Low: ['low', '偏低'], OK: ['ok', '正常'], '启用': ['ok', '启用'], '停用': ['', '停用'] }
  const m = MAP[s] || [String(s).toLowerCase(), s]
  return <span className={'pill ' + m[0]}>{m[1]}</span>
}

// 继续见 App.jsx 第 3 段

/* =========================================================================
   登录页
   ========================================================================= */
function Login() {
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const submit = async () => {
    setBusy(true); setErr('')
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pw })
    setBusy(false)
    if (error) setErr('登录失败：' + (error.message || '邮箱或密码错误'))
  }
  return (
    <div className="login">
      <div style={{ textAlign: 'center', marginBottom: 14 }}>
        <img src={logoUrl} alt="logo" style={{ width: 72, height: 72, objectFit: 'contain', borderRadius: 12, background: '#000' }} />
      </div>
      <h2 style={{ textAlign: 'center' }}>至尊萬象閣</h2>
      <p style={{ textAlign: 'center' }}>SP 管理系统 · 请用管理员分配给你的邮箱登录</p>
      <Field label="邮箱"><input value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" /></Field>
      <Field label="密码"><input type="password" value={pw} onChange={e => setPw(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} /></Field>
      {err && <div className="hint" style={{ color: 'var(--danger)' }}>{err}</div>}
      <button className="btn" style={{ width: '100%', marginTop: 8 }} disabled={busy} onClick={submit}>{busy ? '登录中…' : '登录'}</button>
    </div>
  )
}

/* =========================================================================
   主应用
   ========================================================================= */
export default function App() {
  const [session, setSession] = useState(undefined) // undefined=加载中, null=未登录
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  if (session === undefined) return <><style>{CSS}</style><div className="empty" style={{ marginTop: '20vh' }}>加载中…</div></>
  if (!session) return <><style>{CSS}</style><Login /></>
  return <Main session={session} />
}

function Main({ session }) {
  const { D, err, reload } = useData(session)
  const [module, setModule] = useState('pick')  // pick | sp | ac | both
  const [tab, setTab] = useState('dash')
  const [role, setRole] = useState('管理员')
  const [modal, setModal] = useState(null)
  const [toast, setToast] = useState('')
  const [navOpen, setNavOpen] = useState(false)
  const [dec, setDec] = useState(DEC)
  const flash = m => { setToast(m); setTimeout(() => setToast(''), 2200) }
  const who = session.user?.email || '未知'

  if (err) return <><style>{CSS}</style><div className="empty" style={{ marginTop: '20vh' }}>
    连接数据库出错：{err}<br /><br />请检查 src/supabase.js 里的 URL 和 KEY 是否填对。
    <br /><button className="btn ghost" style={{ marginTop: 12 }} onClick={reload}>重试</button></div></>
  if (!D) return <><style>{CSS}</style><div className="empty" style={{ marginTop: '20vh' }}>加载数据中…</div></>

  const can = area => {
    const r = (D.roles || []).find(x => x.name === role)
    if (!r) return false
    if (r.name === '管理员') return true
    // AC 模块骨架阶段：暂时放行 ac 开头的模块（第2阶段再做细权限）
    if (area.startsWith('ac') || area === 'bank') return true
    return (r.areas || []).includes(area)
  }
  // 审计：写云端 audit 表，记真实登录邮箱
  const logAudit = (action, entity, ref, detail) => db.audit(who, role, action, entity, ref, detail)

  const spNav = [
    ['总览', [['dash', '▤', '仪表板']]],
    ['交易', [['purchase', '▦', '采购'], ['sales', '🧾', '销售'], ['payment', '💵', '收款'], ['spay', '💳', '供应商付款'], ['sreturn', '↩', '销售退货'], ['preturn', '↪', '采购退货']]],
    ['主数据', [['customer', '👤', '顾客'], ['supplier', '🏭', '供应商'], ['item', '📦', '货品'], ['currency', '💱', '货币']]],
    ['分析', [['inventory', '🗂', '库存'], ['profit', '📈', '利润'], ['report', '📊', '报表']]],
    ['系统', [['roles', '🔐', '角色权限'], ['audit', '📜', '操作日志']]],
  ]
  const acNav = [
    ['总览', [['dash', '▤', '仪表板']]],
    ['户口业务', [['accompany', '🏢', '公司 / 户口'], ['acorder', '📝', '顾客订单'], ['achistory', '🕘', '户口历史']]],
    ['账务', [['acbilling', '🧾', '账单'], ['acpay', '💵', '收款'], ['acrecv', '📇', '应收总览'], ['acsettle', '💳', '卡商结算'], ['acagentsettle', '🤝', 'Agent结算'], ['expenses', '💸', '开销记录']]],
    ['主数据', [['accustomer', '👤', '顾客'], ['acsupplier', '🏭', '卡商'], ['acagent', '🤝', 'Agent'], ['acbanks', '🏦', '银行名单']]],
    ['分析', [['acreport', '📊', '报表']]],
    ['系统', [['roles', '🔐', '角色权限'], ['audit', '📜', '操作日志']]],
  ]
  const nav = module === 'ac' ? acNav : spNav
  const titles = {
    dash: module === 'ac' ? ['AC 仪表板', '银行卡业务总览'] : (module === 'both' ? ['合并总览', 'SP + AC 一起看'] : ['仪表板', '买卖状况实时总览']),
    purchase: ['采购', '多货币进货'], sales: ['销售发票', '开单与扣库存'],
    payment: ['顾客还款', '收款与冲账'], spay: ['供应商付款', '付款与应付冲账'], sreturn: ['销售退货', '客户退货 · 贷记单'], preturn: ['采购退货', '退给供应商 · 借记单'],
    customer: ['顾客', 'SP 系列账户'], supplier: ['供应商', 'SUP 系列供应商'],
    item: ['货品', '货品目录'], currency: ['货币', '人工汇率'], inventory: ['库存', '库存流水与结存'],
    profit: ['利润', '销售额 − 销货成本 ± 汇兑'], report: ['报表', '对账单与分析'],
    roles: ['角色权限', '自定义角色与模块访问'], audit: ['操作日志', '谁在何时改了什么'],
    accard: ['卡管理', '单张卡追踪'], acassign: ['发户口', '把户口发给顾客'], acreturn: ['退户口', '顾客退回'],
    acbilling: ['账单', '首期 / 月费 · 手动出账'], acpay: ['收款', 'AC 顾客收款'], acrecv: ['应收总览', '每个顾客欠多少'], acsettle: ['卡商结算', '付卡商的钱'],
    accustomer: ['AC 顾客', '银行卡顾客'], acsupplier: ['卡商', '卡供应商'], acreport: ['报表', 'AC 分析'],
    acaccount: ['户口管理', '银行户口 · 可选带卡'],
    accompany: ['公司 / 户口', '卡商 → 公司 → 银行户口'],
    achistory: ['户口历史', '这个户口之前谁在用'],
    acorder: ['顾客订单', '顾客预定 · 排队等货'],
    bank: ['银行账户', 'Bank 数据库 · SP/AC 共用'],
  }
  const ctx = { D, role, who, can, setModal, flash, logAudit, reload, setTab, setModule }
  const roleNames = (D.roles || []).map(r => r.name)

  // 模块选择页
  if (module === 'pick') {
    return <><style>{CSS}</style>
      <div style={{ maxWidth: 720, margin: '8vh auto', padding: '0 20px' }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <img src={logoUrl} alt="logo" style={{ width: 80, height: 80, objectFit: 'contain', borderRadius: 14, background: '#000' }} />
          <h2 style={{ margin: '14px 0 4px' }}>至尊萬象閣</h2>
          <div className="muted" style={{ fontSize: 13 }}>{who} · 请选择要进入的系统</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div className="modcard" onClick={() => { setModule('sp'); setTab('dash') }}>
            <div className="modic">📦</div>
            <b>SP Trading System</b>
            <span>买卖 · 库存 · 进销存</span>
          </div>
          <div className="modcard" onClick={() => { setModule('ac'); setTab('dash') }}>
            <div className="modic">💳</div>
            <b>AC Management System</b>
            <span>银行卡 · 月费 · 结算</span>
          </div>
        </div>
        <div className="modcard wide" onClick={() => { setModule('both'); setTab('dash') }} style={{ marginTop: 14 }}>
          <div className="modic">📊</div>
          <b>Both · 合并总览</b>
          <span>两个系统数据一起看</span>
        </div>
        <div style={{ textAlign: 'center', marginTop: 24 }}>
          <button className="btn ghost sm" onClick={() => supabase.auth.signOut()}>退出登录</button>
        </div>
      </div>
    </>
  }

  const spPages = {
    dash: Dashboard, purchase: Purchases, sales: Sales, payment: Payments,
    sreturn: SalesReturns, preturn: PurchaseReturns, spay: SupplierPayments,
    customer: Customers, supplier: Suppliers, item: Items, currency: Currencies,
    inventory: Inventory, profit: Profit, report: Reports, roles: RolesPage, audit: AuditPage,
  }
  const acPages = {
    dash: ACDashboard, acaccount: ACAccounts, acassign: ACAssign, acreturn: ACReturn,
    accompany: ACCompanies, achistory: ACBaHistory, acorder: ACOrders,
    acbilling: ACBilling, acpay: ACPay, acrecv: ACReceivables, acsettle: ACSettle,
    acagent: ACAgents, acagentsettle: ACAgentSettle, expenses: Expenses, acbanks: ACBanks,
    accustomer: ACCustomers, acsupplier: ACSuppliers, acreport: ACReport,
    roles: RolesPage, audit: AuditPage,
  }
  const Page = module === 'ac' ? acPages[tab] : (module === 'both' ? BothDashboard : spPages[tab])

  const modLabel = module === 'ac' ? 'AC Management' : (module === 'both' ? '合并总览' : 'SP Trading')
  return (
    <><style>{CSS}</style>
      <div className="app">
        {navOpen && <div className="navbk" onClick={() => setNavOpen(false)} />}
        <aside className={navOpen ? 'open' : ''}>
          <div className="brand" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src={logoUrl} alt="logo" style={{ width: 40, height: 40, objectFit: 'contain', borderRadius: 8, flexShrink: 0, background: '#000' }} />
            <div style={{ minWidth: 0 }}><b style={{ fontSize: 15, lineHeight: 1.2, display: 'block' }}>至尊萬象閣</b><span>{modLabel}</span></div>
          </div>
          {module !== 'both' && <nav>{nav.map(([g, items]) => {
            const vis = items.filter(([k]) => can(k))
            if (!vis.length) return null
            return <div key={g}><div className="grp">{g}</div>
              {vis.map(([k, ic, lab]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => { setTab(k); setNavOpen(false) }}><span>{ic}</span>{lab}</button>)}
            </div>
          })}</nav>}
          <div style={{ padding: 10, marginTop: 8 }}>
            <button className="btn ghost sm" style={{ width: '100%' }} onClick={() => { setModule('pick'); setNavOpen(false) }}>⇄ 切换系统</button>
          </div>
        </aside>
        <main>
          <div className="top">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button className="menutog" onClick={() => setNavOpen(o => !o)}>☰</button>
              <div><h1>{(titles[tab] || ['', ''])[0]}</h1><div className="sub">{(titles[tab] || ['', ''])[1]}</div></div>
            </div>
            <div className="rolebox">
              <button className="btn ghost sm" title="切换金额小数位（2 位 / 4 位）" onClick={() => { setDecimals(dec === 2 ? 4 : 2); setDec(dec === 2 ? 4 : 2) }}>{dec === 2 ? '0.00' : '0.0000'}</button>
              <span className="muted">{who}</span>
              <select value={role} onChange={e => { setRole(e.target.value); setTab('dash') }}>{roleNames.map(r => <option key={r}>{r}</option>)}</select>
              <button className="btn ghost sm" onClick={() => supabase.auth.signOut()}>退出</button>
            </div>
          </div>
          <div className="wrap">
            {(!Page) ? <div className="empty">建设中…</div> : (!can(tab) ? <div className="empty">当前角色无权访问此模块</div> : <Page {...ctx} module={module} />)}
          </div>
        </main>
        {modal && <Modal ctx={ctx} modal={modal} />}
        {toast && <div className="toast">{toast}</div>}
      </div>
    </>
  )
}

// 继续见 App.jsx 第 4 段

/* ---------- 通用表格页 ---------- */
function TablePage({ rows, cols, onAdd, addLabel, empty, can = true, sortable = true }) {
  const [q, setQ] = useState('')
  const [sort, setSort] = useState('default')
  let filtered = rows.filter(r => JSON.stringify(r).toLowerCase().includes(q.toLowerCase()))
  if (sort === 'az') filtered = [...filtered].sort((a, b) => String(a.name || a.code || '').localeCompare(String(b.name || b.code || '')))
  else if (sort === 'za') filtered = [...filtered].sort((a, b) => String(b.name || b.code || '').localeCompare(String(a.name || a.code || '')))
  else if (sort === 'code') filtered = [...filtered].sort((a, b) => String(a.code || '').localeCompare(String(b.code || '')))
  const hasName = rows.length > 0 && (rows[0].name !== undefined || rows[0].code !== undefined)
  return <div>
    <div className="bar">
      <input placeholder="搜索…" value={q} onChange={e => setQ(e.target.value)} style={{ minWidth: 220 }} />
      {sortable && hasName && <select value={sort} onChange={e => setSort(e.target.value)}>
        <option value="default">默认顺序</option>
        <option value="az">名称 A-Z</option>
        <option value="za">名称 Z-A</option>
        <option value="code">编码排序</option>
      </select>}
      <div className="sp" />
      {can && onAdd && <button className="btn" onClick={onAdd}>{addLabel}</button>}
    </div>
    <div className="panel"><table>
      <thead><tr>{cols.map((c, i) => <th key={i} className={c.num ? 'num' : ''}>{c.h}</th>)}</tr></thead>
      <tbody>{filtered.length ? filtered.map((r, i) => <tr key={i}>{cols.map((c, j) => <td key={j} className={c.num ? 'num' : ''}>{c.c(r, i)}</td>)}</tr>)
        : <tr><td colSpan={cols.length}><div className="empty">{empty}</div></td></tr>}</tbody>
    </table></div>
  </div>
}

/* ---------- AC 模块（第1阶段：骨架/占位）---------- */
function ACPlaceholder() {
  return <div className="panel"><div className="body" style={{ textAlign: 'center', padding: '40px 20px' }}>
    <div style={{ fontSize: 34, marginBottom: 10 }}>🚧</div>
    <b style={{ fontSize: 15 }}>建设中</b>
    <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>这个功能在第 2 阶段加上。<br />目前先把 AC 系统的骨架搭好，能在 SP / AC / 合并之间切换。</div>
  </div></div>
}
function ACDashboard({ D, setTab }) {
  const bas = D.acBankAccounts || []
  const inStock = bas.filter(b => b.stockStatus === '在库')
  const assigned = bas.filter(b => b.stockStatus === '已发')
  const charging = bas.filter(baCharging)
  const stockValue = inStock.reduce((s, b) => s + (+b.cost || 0), 0)
  // 每月固定净利（月费 − 卡商分成）
  const monthlyNet = charging.reduce((s, b) => s + (+b.monthlyFee || 0) - (baPaying(b) ? (+b.supplierShare || 0) : 0), 0)
  const monthlyFee = charging.reduce((s, b) => s + (+b.monthlyFee || 0), 0)
  // 应收 / 应付
  let recvOut = 0, owingCust = 0
  ;(D.acCustomers || []).forEach(c => { const b = acCustomerBalance(D, c.code); if (b.outstanding > 0.01) { recvOut += b.outstanding; owingCust++ } })
  let payableOut = 0
  ;(D.acSuppliers || []).forEach(s => { payableOut += acSupplierPayableV2(D, s.code).payable })
  // 停用提醒 + 订单
  const stopped = assigned.filter(b => b.status !== '正常')
  const openOrders = (D.acOrders || []).filter(o => o.status !== '取消' && orderRemain(D, o) > 0)
    .map(o => ({ ...o, remain: orderRemain(D, o), waited: daysSince(o.orderDate) }))
    .sort((a, b) => (b.waited || 0) - (a.waited || 0))
  const owedQty = openOrders.reduce((s, o) => s + o.remain, 0)
  const problemBAs = stopped.map(b => ({ ...b, dayss: daysSince(b.statusDate) })).sort((a, b) => (b.dayss || 0) - (a.dayss || 0))
  // 近6个账期：账单开出 + 收款
  const months = acLastMonths(6)
  const recvByM = months.map(m => (D.acReceipts || []).filter(r => acPeriodOf(r.date) === m.key).reduce((sm, r) => sm + (+r.amount || 0), 0))
  const billByM = months.map(m => (D.acBills || []).filter(b => acPeriodOf(b.date) === m.key).reduce((sm, b) => sm + acBillTotal(b), 0))
  // 本账期净赚
  const per = acPeriodRangeOf(acCurrentPeriod())
  const P = acProfitV2(D, per.from, per.to)
  const K = (l, v, mono, onClick) => <div className="kpi" onClick={onClick} style={onClick ? { cursor: 'pointer' } : {}}><div className="l">{l}</div><div className={'v' + (mono ? ' mono' : '')}>{v}</div></div>
  return <div>
    <div className="panel" style={{ marginBottom: 14, textAlign: 'center', padding: '20px 16px', background: 'linear-gradient(160deg,var(--card),var(--accent-soft))', cursor: 'pointer' }} onClick={() => setTab('acreport')}>
      <div className="hint" style={{ fontSize: 12 }}>本账期净赚（{per.from} ~ {per.to}）</div>
      <div className="mono" style={{ fontSize: 34, fontWeight: 800, color: P.net >= 0 ? 'var(--accent)' : 'var(--danger)', letterSpacing: -1, margin: '3px 0' }}>{rm(P.net)}</div>
      <div className="hint">卖户口 {rm(P.sellProfit)} · 首期 {rm(P.initProfit)} · 月费 {rm(P.feeProfit)}</div>
    </div>
    <div className="kpis">
      {K('在库户口', fmtInt(inStock.length), 0, () => setTab('accompany'))}
      {K('已发户口', fmtInt(assigned.length), 0, () => setTab('accompany'))}
      {K('顾客应收', rm(recvOut), 1, () => setTab('acrecv'))}
      {K('卡商应付', rm(payableOut), 1, () => setTab('acsettle'))}
    </div>
    <div className="kpis">
      {K('每月月费收入', rm(monthlyFee), 1, () => setTab('acreport'))}
      {K('每月净赚（扣卡商）', rm(monthlyNet), 1, () => setTab('acreport'))}
      {K('顾客在等（订单）', fmtInt(owedQty) + ' 个', 0, () => setTab('acorder'))}
      {K('在库成本', rm(stockValue), 1, () => setTab('accompany'))}
    </div>
    <div className="grid2" style={{ marginBottom: 16 }}>
      <div className="panel" style={{ border: '1px solid ' + (openOrders.length ? 'var(--gold-line)' : 'var(--line)') }}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>📝 顾客在等的订单
          <span className={'pill ' + (owedQty ? 'open' : 'ok')} style={{ marginLeft: 'auto', fontSize: 11 }}>还欠 {owedQty} 个</span></h3>
        {openOrders.length > 0 && <table><thead><tr><th>顾客</th><th>银行</th><th className="num">还欠</th><th className="num">等了</th></tr></thead>
          <tbody>{openOrders.slice(0, 6).map(o => <tr key={o.no} style={{ cursor: 'pointer' }} onClick={() => setTab('acorder')}>
            <td><b>{acCustName(D, o.customer)}</b></td>
            <td>{o.bank || <span className="hint">不指定</span>}</td>
            <td className="num" style={{ color: 'var(--danger)', fontWeight: 700 }}>{fmtInt(o.remain)}</td>
            <td className="num" style={{ color: (o.waited || 0) > 14 ? 'var(--danger)' : 'var(--ink-soft)', fontWeight: (o.waited || 0) > 14 ? 700 : 400 }}>{o.waited != null ? o.waited + ' 天' : '—'}</td>
          </tr>)}</tbody></table>}
        {openOrders.length > 6 && <div className="hint" style={{ padding: '6px 14px' }}>还有 {openOrders.length - 6} 张…</div>}
        {!openOrders.length && <div className="empty">目前没有顾客在等 — 有人预定就记在「顾客订单」</div>}
        <div style={{ padding: '8px 14px' }}><button className="btn ghost sm" onClick={() => setTab('acorder')}>去看订单 →</button></div>
      </div>
      <div className="panel" style={{ border: '1px solid ' + (problemBAs.length ? 'var(--danger-line)' : 'var(--line)') }}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>⚠️ 有状况的户口
          <span className={'pill ' + (problemBAs.length ? 'low' : 'ok')} style={{ marginLeft: 'auto', fontSize: 11 }}>{problemBAs.length} 个</span></h3>
        {problemBAs.length > 0 && <table><thead><tr><th>公司 · 银行</th><th>顾客</th><th>状况</th><th className="num">多久了</th></tr></thead>
          <tbody>{problemBAs.slice(0, 6).map(b => <tr key={b.code} style={{ cursor: 'pointer' }} onClick={() => setTab('accompany')}>
            <td><b>{acCoName(D, b.company)}</b><div className="hint">{b.bank}</div></td>
            <td>{acCustName(D, b.customer)}</td>
            <td><BAStatusPill s={b.status} /></td>
            <td className="num" style={{ color: (b.dayss || 0) > 30 ? 'var(--danger)' : 'var(--ink-soft)', fontWeight: (b.dayss || 0) > 30 ? 700 : 400 }}>{b.dayss != null ? b.dayss + ' 天' : '—'}</td>
          </tr>)}</tbody></table>}
        {problemBAs.length > 6 && <div className="hint" style={{ padding: '6px 14px' }}>还有 {problemBAs.length - 6} 个…</div>}
        {!problemBAs.length && <div className="empty">所有户口都正常 ✓</div>}
        <div style={{ padding: '8px 14px' }}><button className="btn ghost sm" onClick={() => setTab('accompany')}>去看户口 →</button></div>
      </div>
    </div>
    {(owingCust > 0 || payableOut > 0.01) && <div className="panel" style={{ marginBottom: 16 }}><h3>提醒</h3><div className="body">
      {owingCust > 0 && <AlertRow icon="💰" tone="warn" text={`${owingCust} 位顾客欠款 · 应收 ${rm(recvOut)}`} onClick={() => setTab('acrecv')} />}
      {payableOut > 0.01 && <AlertRow icon="🏭" tone="danger" text={`应付卡商 ${rm(payableOut)}`} onClick={() => setTab('acsettle')} />}
    </div></div>}
    <div className="panel" style={{ marginBottom: 16 }}><h3>近 6 个账期趋势</h3><div className="body">
      <TrendBars months={months} a={billByM} b={recvByM} aLabel="账单开出" bLabel="实际收款" aColor="var(--accent-3)" bColor="var(--gold)" />
    </div></div>
    <div className="grid2">
      <div className="panel"><h3>户口状态分布</h3><div className="body">
        <div className="tot"><span className="k">在库</span><span className="v">{fmtInt(inStock.length)} 个</span></div>
        <div className="tot"><span className="k">已发 · 正常在收</span><span className="v">{fmtInt(charging.length)} 个</span></div>
        {BA_STATUS.filter(s => s !== '正常').map(st => {
          const n = bas.filter(b => b.status === st).length
          return n > 0 ? <div key={st} className="tot"><span className="k" style={{ color: 'var(--danger)' }}>{st}</span><span className="v">{fmtInt(n)} 个</span></div> : null
        })}
        <div className="tot" style={{ borderTop: '1px solid var(--line)', marginTop: 6, paddingTop: 8 }}><span className="k">公司数</span><span className="v">{fmtInt((D.acCompanies || []).length)} 家</span></div>
      </div></div>
      <div className="panel"><h3>快捷操作</h3><div className="body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button className="btn" onClick={() => setTab('accompany')}>+ 进公司 / 加户口</button>
        <button className="btn ghost" onClick={() => setTab('acbilling')}>开账单</button>
        <button className="btn ghost" onClick={() => setTab('acreport')}>看报表 / 打印单据</button>
      </div></div>
    </div>
  </div>
}

const acCustName = (D, code) => { const c = (D.acCustomers || []).find(x => x.code === code); return c ? c.name : (code || '—') }
const acSupName = (D, code) => { const s = (D.acSuppliers || []).find(x => x.code === code); return s ? s.name : (code || '—') }
// 按天算当月月费：月费 ÷ 当月天数 × 剩余天数（含当天）
function proratedFee(monthlyFee, dateStr) {
  const d = new Date(dateStr)
  const dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  const remaining = dim - d.getDate() + 1
  return (monthlyFee || 0) / dim * remaining
}
function acBillTotal(bill) { return (bill.items || []).reduce((s, it) => s + (+it.amount || 0), 0) }
function acBillPaid(D, billNo) {
  let p = 0
  ;(D.acReceipts || []).forEach(r => (r.allocs || []).forEach(a => { if (a.bill === billNo) p += (+a.amount || 0) }))
  return p
}
function acBillStatus(D, bill) {
  const tot = acBillTotal(bill), paid = acBillPaid(D, bill.no)
  if (paid <= 0.001) return 'Open'
  if (paid + 0.01 < tot) return 'Partial'
  return 'Paid'
}
// 顾客欠款（AC）= 所有账单总额 − 已收
function acCustomerBalance(D, custCode) {
  let billed = 0, paid = 0
  ;(D.acBills || []).filter(b => b.customer === custCode).forEach(b => billed += acBillTotal(b))
  ;(D.acReceipts || []).filter(r => r.customer === custCode).forEach(r => (r.allocs || []).forEach(a => paid += (+a.amount || 0)))
  return { billed, paid, outstanding: billed - paid }
}
// 卡商应付（AC）= 月费分成 − 已结算（进价不计入）
function acSupplierPayable(D, supCode) {
  let owed = 0, settled = 0
  ;(D.acAccounts || []).filter(a => a.supplier === supCode && a.status === '已发').forEach(a => owed += (+a.cost || 0))
  ;(D.acSettlements || []).filter(s => s.supplier === supCode).forEach(s => settled += (+s.amount || 0))
  return { owed, settled, payable: owed - settled }
}
// AC 利润总览
function acProfit(D) {
  // 卖户口利润：已发户口 (卖价 − 进价)
  let cardProfit = 0
  ;(D.acAccounts || []).filter(a => a.status === '已发').forEach(a => cardProfit += (+a.soldPrice || 0) - (+a.cost || 0))
  // 账单收入（首期各项 + 月费）总额
  let billIncome = 0
  ;(D.acBills || []).forEach(b => billIncome += acBillTotal(b))
  // 已收
  let received = 0
  ;(D.acReceipts || []).forEach(r => received += (+r.amount || 0))
  return { cardProfit, billIncome, received }
}
/* ===================== AC 公司层 · 助手函数 =====================
   结构：卡商 → 公司(ac_companies) → 银行户口(ac_bankAccounts，最小计费单位)
   ================================================================ */
const BANK_LIST_DEFAULT = ['RHB', 'MBB', 'HLB', 'CIMB', 'ISLAM', 'OCBC', 'PBB', 'AGRO', 'AmBank', 'Affin', 'BSN', 'UOB', 'Alliance', '其他']
const banksOf = D => ((D && D.acBanks && D.acBanks.length) ? D.acBanks.map(b => b.name) : BANK_LIST_DEFAULT)
const BA_STATUS = ['正常', '盖户口', '风控', '收回', '退卡', '停租金', '人头收回']
const acCoName = (D, code) => { const c = (D.acCompanies || []).find(x => x.code === code); return c ? c.name : (code || '—') }
const acCoOf = (D, code) => (D.acCompanies || []).find(x => x.code === code) || null
// 某公司下的所有银行户口
const baOfCompany = (D, coCode) => (D.acBankAccounts || []).filter(b => b.company === coCode)
// 某银行户口所属顾客（现在直接存在户口上）
const baCustomer = (D, ba) => ba.customer || null
// 某银行户口的卡商（跟随公司）
const baSupplier = (D, ba) => { const co = acCoOf(D, ba.company); return co ? co.supplier : null }
// 这个银行户口现在还该收顾客月费吗
const baCharging = ba => !ba.stopCharge && ba.status === '正常' && ba.stockStatus === '已发'
// 这个银行户口现在还该付卡商分成吗
const baPaying = ba => !ba.stopPay && ba.status === '正常' && ba.stockStatus === '已发'
// 某顾客名下所有已发的银行户口
function acCustomerBAs(D, custCode) {
  return (D.acBankAccounts || []).filter(ba => ba.customer === custCode && ba.stockStatus === '已发')
}
// 某卡商名下所有银行户口
function acSupplierBAs(D, supCode) {
  return (D.acBankAccounts || []).filter(ba => {
    const co = acCoOf(D, ba.company)
    return co && co.supplier === supCode
  })
}
// 账单项目：金额与成本（代收代付 → 成本=金额，赚0）
function acBillCost(bill) { return (bill.items || []).reduce((s, it) => s + (+it.cost || 0), 0) }
function acBillProfit(bill) { return acBillTotal(bill) - acBillCost(bill) }
// 卡商月费应付：某卡商未结算的 dues 总额
function acSupplierDueTotal(D, supCode, onlyUnsettled = true) {
  return (D.acSupplierDues || [])
    .filter(d => d.supplier === supCode && (!onlyUnsettled || !d.settled))
    .reduce((s, d) => s + (+d.amount || 0), 0)
}
/* 卡商应付（新）= 已发银行户口的进价 + 未结算月费分成 − 已结算 */
function acSupplierPayableV2(D, supCode) {
  // 卡商应付只算月费分成（进价不计入）
  const coCost = 0
  const dues = acSupplierDueTotal(D, supCode, true)
  let settled = 0
  ;(D.acSettlements || []).filter(s => s.supplier === supCode).forEach(s => settled += (+s.amount || 0))
  return { coCost, dues, settled, payable: dues - settled }
}
const acAgentName = (D, code) => (D.acAgents || []).find(a => a.code === code)?.name || code || '—'
/* agent 应付 = 未结算佣金 − 已结算 */
function acAgentPayable(D, agentCode) {
  const dues = (D.acAgentDues || []).filter(d => d.agent === agentCode && !d.settled).reduce((s, d) => s + (+d.amount || 0), 0)
  let settled = 0
  ;(D.acAgentSettlements || []).filter(s => s.agent === agentCode).forEach(s => settled += (+s.amount || 0))
  return { dues, settled, payable: dues - settled }
}
/* 某 agent 底下的户口 */
const acAgentBAs = (D, agentCode) => (D.acBankAccounts || []).filter(b => b.agent === agentCode)
/* AC 利润（新模型）：三块分开算
   1) 卖户口：卖价 − 进价（银行户口层）
   2) 首期项目：售价 − 成本
   3) 月费：收的月费 − 给卡商的分成
   期间用 from/to 过滤（留空=全部） */
function acProfitV2(D, from, to) {
  const inR = d => (!from || (d && d >= from)) && (!to || (d && d <= to))
  // 1) 卖户口利润（按发出日期，银行户口层）
  let sellRevenue = 0, sellCost = 0
  ;(D.acBankAccounts || []).filter(b => b.stockStatus === '已发' && inR(b.assignDate)).forEach(b => {
    sellRevenue += (+b.soldPrice || 0); sellCost += (+b.cost || 0)
  })
  // 2+3) 账单拆成「月费」和「首期项目」
  let feeRevenue = 0, feeCost = 0, initRevenue = 0, initCost = 0
  ;(D.acBills || []).filter(b => inR(b.date)).forEach(b => {
    ;(b.items || []).forEach(it => {
      const amt = +it.amount || 0, cost = +it.cost || 0
      if (it.kind === 'fee') { feeRevenue += amt; feeCost += cost }
      else { initRevenue += amt; initCost += cost }
    })
  })
  // 月费成本另计：期间内产生的卡商分成 + agent 佣金
  const dueCost = (D.acSupplierDues || []).filter(d => inR(d.date)).reduce((s, d) => s + (+d.amount || 0), 0)
  const agentCost = (D.acAgentDues || []).filter(d => inR(d.date)).reduce((s, d) => s + (+d.amount || 0), 0)
  feeCost += dueCost + agentCost
  const sellProfit = sellRevenue - sellCost
  const initProfit = initRevenue - initCost
  const feeProfit = feeRevenue - feeCost
  return {
    sellRevenue, sellCost, sellProfit,
    initRevenue, initCost, initProfit,
    feeRevenue, feeCost, feeProfit, dueCost, agentCost,
    revenue: sellRevenue + initRevenue + feeRevenue,
    cost: sellCost + initCost + feeCost,
    net: sellProfit + initProfit + feeProfit,
  }
}
// 距今多少天（含当天）
const daysSince = d => d ? Math.max(0, Math.round((new Date(todayISO()) - new Date(d)) / 86400000)) : null
const bankLabel = (D, code) => { const b = (D.bankAccounts || []).find(x => x.code === code); return b ? (b.bankName + ' ' + (b.accountNo || '')) : (code || '—') }
function ACStatusPill({ s }) {
  const map = { '在库': ['ok', '在库'], '已发': ['partial', '已发'], '已退': ['open', '已退'], '注销': ['low', '注销'] }
  const m = map[s] || ['', s]
  return <span className={'pill ' + m[0]}>{m[1]}</span>
}

/* ---------- AC 卡商 ---------- */
function ACSuppliers({ D, setModal, flash, logAudit, reload }) {
  const del = async r => {
    if ((D.acCards || []).some(c => c.supplier === r.code)) return flash('此卡商已有卡记录，不能删除')
    if (!confirm('删除卡商「' + r.name + '」？')) return
    await db.delAcSupplier(r.code); await logAudit('删除', 'AC卡商', r.code, r.name); reload(); flash('卡商已删除')
  }
  return <TablePage rows={D.acSuppliers || []} onAdd={() => setModal({ type: 'acSupplier' })} addLabel="+ 新增卡商" empty="暂无卡商" cols={[
    { h: '编码', c: r => <span className="code">{r.code}</span> }, { h: '名称', c: r => r.name },
    { h: '电话', c: r => r.phone || '—' }, { h: '邮箱', c: r => <span className="muted">{r.email || '—'}</span> },
    { h: '', c: r => <span><button className="linkbtn" onClick={() => setModal({ type: 'acSupplier', data: r })}>编辑</button>
      <button className="linkbtn del" onClick={() => del(r)}>删除</button></span> },
  ]} />
}

/* ---------- AC 顾客 ---------- */
function ACCustomers({ D, setModal, flash, logAudit, reload }) {
  const del = async r => {
    if ((D.acCards || []).some(c => c.customer === r.code)) return flash('此顾客已有卡记录，不能删除（可改停用）')
    if (!confirm('删除 AC 顾客「' + r.name + '」？')) return
    await db.delAcCustomer(r.code); await logAudit('删除', 'AC顾客', r.code, r.name); reload(); flash('顾客已删除')
  }
  return <TablePage rows={D.acCustomers || []} onAdd={() => setModal({ type: 'acCustomer' })} addLabel="+ 新增顾客" empty="暂无顾客" cols={[
    { h: '编码', c: r => <span className="code">{r.code}</span> }, { h: '名称', c: r => r.name },
    { h: '身份证', c: r => r.ic || '—' }, { h: '电话', c: r => r.phone || '—' },
    { h: '状态', c: r => <Pill s={r.status || '启用'} /> },
    { h: '', c: r => <span><button className="linkbtn" onClick={() => setModal({ type: 'acCustomer', data: r })}>编辑</button>
      <button className="linkbtn del" onClick={() => del(r)}>删除</button></span> },
  ]} />
}

/* ---------- 顾客订单（排队的户口）---------- */
function orderFilled(D, no) { return (D.acOrderFills || []).filter(f => f.orderNo === no).length }
function orderRemain(D, o) { return Math.max(0, (+o.qty || 0) - orderFilled(D, o.no)) }
function ACOrders({ D, setModal, flash, logAudit, reload }) {
  const [filter, setFilter] = useState('未完成')
  const [q, setQ] = useState('')
  let rows = [...(D.acOrders || [])].reverse()
  if (filter === '未完成') rows = rows.filter(o => orderRemain(D, o) > 0 && o.status !== '取消')
  else if (filter !== '全部') rows = rows.filter(o => o.status === filter)
  if (q) rows = rows.filter(o => (acCustName(D, o.customer) + o.no + (o.bank || '')).toLowerCase().includes(q.toLowerCase()))
  const totalWait = (D.acOrders || []).filter(o => o.status !== '取消').reduce((s, o) => s + orderRemain(D, o), 0)
  const del = async o => {
    if (!confirm(`删除订单 ${o.no}？已配的记录也会删除（户口不会退回）。`)) return
    await db.delAcOrder(o.no); await logAudit('删除', 'AC订单', o.no, acCustName(D, o.customer)); reload(); flash('订单已删除')
  }
  return <div>
    <div className="kpis">
      <div className="kpi"><div className="l">还欠顾客户口</div><div className="v">{fmtInt(totalWait)} 个</div></div>
      <div className="kpi"><div className="l">排队中订单</div><div className="v">{fmtInt((D.acOrders || []).filter(o => orderRemain(D, o) > 0 && o.status !== '取消').length)}</div></div>
      <div className="kpi"><div className="l">在库可配</div><div className="v">{fmtInt((D.acBankAccounts || []).filter(b => b.stockStatus === '在库').length)} 个</div></div>
    </div>
    <div className="bar">
      <input placeholder="搜索顾客/单号/银行…" value={q} onChange={e => setQ(e.target.value)} style={{ minWidth: 200 }} />
      <select value={filter} onChange={e => setFilter(e.target.value)}>{['未完成', '全部', '排队中', '部分交货', '已完成', '取消'].map(x => <option key={x}>{x}</option>)}</select>
      <div className="sp" />
      <button className="btn" onClick={() => setModal({ type: 'acOrder' })}>+ 新订单</button>
    </div>
    <div className="panel"><table>
      <thead><tr>{['单号', '日期', '等了', '顾客', '要的银行', '订量', '已配', '还欠', '卖价', '月费', '状态', ''].map((x, i) => <th key={i} className={[2, 5, 6, 7, 8, 9].includes(i) ? 'num' : ''}>{x}</th>)}</tr></thead>
      <tbody>{rows.length ? rows.map(o => {
        const filled = orderFilled(D, o.no), remain = orderRemain(D, o)
        const st = o.status === '取消' ? '取消' : remain === 0 ? '已完成' : filled > 0 ? '部分交货' : '排队中'
        return <tr key={o.no}>
          <td><span className="code">{o.no}</span></td>
          <td>{o.orderDate}</td>
          <td className="num" style={{ color: (daysSince(o.orderDate) || 0) > 14 && remain > 0 ? 'var(--danger)' : 'var(--ink-soft)', fontWeight: (daysSince(o.orderDate) || 0) > 14 && remain > 0 ? 700 : 400 }}>{daysSince(o.orderDate) != null ? daysSince(o.orderDate) + ' 天' : '—'}</td>
          <td><b>{acCustName(D, o.customer)}</b></td>
          <td>{o.bank || <span className="hint">不指定</span>}</td>
          <td className="num">{fmtInt(o.qty)}</td>
          <td className="num">{fmtInt(filled)}</td>
          <td className="num" style={{ color: remain > 0 ? 'var(--danger)' : 'var(--accent)', fontWeight: 600 }}>{fmtInt(remain)}</td>
          <td className="num">{fmt(o.price)}</td>
          <td className="num">{fmt(o.monthlyFee)}</td>
          <td><span className={'pill ' + (st === '已完成' ? 'ok' : st === '取消' ? 'low' : st === '部分交货' ? 'partial' : 'open')}>{st}</span></td>
          <td style={{ whiteSpace: 'nowrap' }}>
            {remain > 0 && o.status !== '取消' && <button className="linkbtn" style={{ color: 'var(--gold)', fontWeight: 600 }} onClick={() => setModal({ type: 'acOrderFill', data: o })}>配户口</button>}
            <button className="linkbtn" onClick={() => setModal({ type: 'acOrder', data: o })}>编辑</button>
            <button className="linkbtn del" onClick={() => del(o)}>删除</button>
          </td>
        </tr>
      }) : <tr><td colSpan={12}><div className="empty">暂无订单 — 点「+ 新订单」记下顾客要的户口</div></td></tr>}</tbody>
    </table></div>
    <div className="hint" style={{ marginTop: 8 }}>顾客先订、你手上没货时记在这里。有货了点「配户口」，选在库的户口发给他，订单自动扣减。</div>
  </div>
}

function ACOrderForm({ D, setModal, flash, logAudit, reload, modal }) {
  const d = modal.data
  const [f, setF] = useState(d || { no: '', customer: (D.acCustomers || [])[0]?.code || '', orderDate: todayISO(), bank: '', qty: 1, price: 0, monthlyFee: 0, status: '排队中', note: '' })
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    if (!f.customer) return flash('请选顾客')
    if (!f.qty || f.qty < 1) return flash('请填要几个')
    setBusy(true)
    const no = d?.no || await nextNo('ORD')
    const { error } = await db.saveAcOrder({ ...f, no })
    if (error) { setBusy(false); return flash('保存失败：' + error.message) }
    await logAudit(d ? '修改' : '新增', 'AC订单', no, `${acCustName(D, f.customer)} · ${f.qty} 个${f.bank ? ' · ' + f.bank : ''}`)
    reload(); setBusy(false); setModal(null); flash(d ? '订单已更新' : '订单已记录')
  }
  return <Shell title={d ? '编辑订单 — ' + d.no : '新增订单（顾客预定）'} onClose={() => setModal(null)}
    footer={[<button key={1} className="btn ghost" onClick={() => setModal(null)}>取消</button>, <button key={2} className="btn" disabled={busy} onClick={submit}>{busy ? '保存中…' : '保存'}</button>]}>
    <div className="fg"><Field label="顾客"><select value={f.customer} onChange={e => set('customer', e.target.value)}>{(D.acCustomers || []).map(c => <option key={c.code} value={c.code}>{c.name}</option>)}</select></Field>
      <Field label="下单日期"><input type="date" value={f.orderDate || ''} onChange={e => set('orderDate', e.target.value)} /></Field></div>
    <div className="fg"><Field label="要哪家银行（可留空）"><select value={f.bank} onChange={e => set('bank', e.target.value)}><option value="">不指定</option>{banksOf(D).map(b => <option key={b}>{b}</option>)}</select></Field>
      <Field label="要几个"><input type="number" min="1" value={f.qty} onChange={e => set('qty', +e.target.value)} /></Field></div>
    <div className="fg"><Field label="谈好的卖价 (RM/个)"><input type="number" value={f.price} onChange={e => set('price', +e.target.value)} /></Field>
      <Field label="谈好的月费 (RM/个)"><input type="number" value={f.monthlyFee} onChange={e => set('monthlyFee', +e.target.value)} /></Field></div>
    {d && <Field label="状态"><select value={f.status} onChange={e => set('status', e.target.value)}>{['排队中', '部分交货', '已完成', '取消'].map(x => <option key={x}>{x}</option>)}</select></Field>}
    <Field label="备注"><input value={f.note} onChange={e => set('note', e.target.value)} /></Field>
    <div className="hint">订单合计 {rm((+f.qty || 0) * (+f.price || 0))} · 每月月费 {rm((+f.qty || 0) * (+f.monthlyFee || 0))}</div>
  </Shell>
}

/* 配户口：从在库里选一个发给这个订单的顾客 */
function ACOrderFillForm({ D, setModal, flash, logAudit, reload, modal }) {
  const o = modal.data
  const remain = orderRemain(D, o)
  let stock = (D.acBankAccounts || []).filter(b => b.stockStatus === '在库')
  if (o.bank) stock = stock.filter(b => b.bank === o.bank)
  const [sel, setSel] = useState({})
  const [date, setDate] = useState(todayISO())
  const [alsoBill, setAlsoBill] = useState(true)
  const [busy, setBusy] = useState(false)
  const chosen = stock.filter(b => sel[b.code])
  const submit = async () => {
    if (!chosen.length) return flash('请至少选一个户口')
    if (chosen.length > remain) return flash(`这张订单只还欠 ${remain} 个，选多了`)
    setBusy(true)
    try {
      for (const b of chosen) {
        await db.saveAcBankAccount({ ...b, stockStatus: '已发', customer: o.customer, assignDate: date, soldPrice: +o.price || b.soldPrice || 0, monthlyFee: +o.monthlyFee || b.monthlyFee || 0, status: '正常' })
        await db.openBaHistory({ bankAccount: b.code, company: b.company, customer: o.customer, assignDate: date, soldPrice: +o.price || 0, monthlyFee: +o.monthlyFee || 0, supplierShare: +b.supplierShare || 0, note: '订单 ' + o.no })
        await db.fillAcOrder(o.no, b.code, date)
        if (alsoBill) {
          const no = await nextNo('BILL')
          const pf = acProratedFee(+o.monthlyFee || b.monthlyFee || 0, date)
          await db.saveAcBill({ no, billType: '首期', account: b.code, customer: o.customer, date, period: acPeriodOf(date), items: [{ name: '当月月费(按天)', amount: +pf.toFixed(2), cost: 0, remark: '订单 ' + o.no, kind: 'fee' }], note: '' })
          const ps = acProratedFee(+b.supplierShare || 0, date)
          const co = acCoOf(D, b.company)
          if (!b.stopPay && ps > 0) await db.saveAcDue({ supplier: co?.supplier, bankAccount: b.code, company: b.company, billNo: no, period: acPeriodOf(date), date, amount: +ps.toFixed(2), settled: false, note: `${acCoName(D, b.company)} · ${b.bank}` })
        }
      }
      const newRemain = remain - chosen.length
      await db.saveAcOrder({ ...o, status: newRemain === 0 ? '已完成' : '部分交货' })
      await logAudit('修改', 'AC订单', o.no, `配了 ${chosen.length} 个户口给 ${acCustName(D, o.customer)}`)
      reload(); setBusy(false); setModal(null)
      flash(`已配 ${chosen.length} 个` + (newRemain === 0 ? ' · 订单完成' : ` · 还欠 ${newRemain} 个`))
    } catch (e) { setBusy(false); flash('配货失败：' + e.message) }
  }
  return <Shell wide title={`配户口 — ${o.no} · ${acCustName(D, o.customer)}`} onClose={() => setModal(null)}
    footer={[<button key={1} className="btn ghost" onClick={() => setModal(null)}>取消</button>, <button key={2} className="btn" disabled={busy} onClick={submit}>{busy ? '处理中…' : `确认配 ${chosen.length} 个`}</button>]}>
    <div className="rateline">这张订单要 <b>{o.qty}</b> 个{o.bank ? `（${o.bank}）` : ''} · 已配 <b>{orderFilled(D, o.no)}</b> · <span style={{ color: 'var(--danger)' }}>还欠 {remain} 个</span></div>
    <div className="fg"><Field label="发出日期"><input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
      <Field label="卖价 / 月费（订单谈好的）"><input value={`RM ${fmt(o.price)} / 月费 ${fmt(o.monthlyFee)}`} disabled /></Field></div>
    <div className="hint" style={{ marginTop: 8, marginBottom: 6 }}>从在库户口里勾选要给他的{o.bank ? `（只显示 ${o.bank}）` : ''}</div>
    <div className="panel"><table><thead><tr><th style={{ width: 40 }}></th><th>公司</th><th>银行</th><th>户口号</th><th className="num">进价</th><th className="num">给卡商</th></tr></thead>
      <tbody>{stock.map(b => <tr key={b.code}>
        <td><input type="checkbox" checked={!!sel[b.code]} onChange={e => setSel(s => ({ ...s, [b.code]: e.target.checked }))} style={{ width: 16, height: 16 }} /></td>
        <td>{acCoName(D, b.company)}</td><td><b>{b.bank}</b></td><td><span className="code">{b.accountNo || '—'}</span></td>
        <td className="num">{fmt(b.cost)}</td><td className="num">{fmt(b.supplierShare)}</td>
      </tr>)}
      {!stock.length && <tr><td colSpan={6}><div className="empty">没有在库的户口{o.bank ? `（${o.bank}）` : ''} — 要先进货</div></td></tr>}</tbody></table></div>
    <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 12, marginTop: 8 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14 }}>
        <input type="checkbox" checked={alsoBill} onChange={e => setAlsoBill(e.target.checked)} style={{ width: 16, height: 16 }} />
        顺便开首期账单（当月按天）
      </label>
    </div>
    {chosen.length > 0 && <div className="tot"><span className="k">选中 {chosen.length} 个 · 卖价合计</span><span className="v">{rm(chosen.length * (+o.price || 0))}</span></div>}
  </Shell>
}

/* ---------- 公司 / 银行户口（新结构核心）---------- */
function ACCompanies({ D, setModal, flash, logAudit, reload }) {
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('全部')
  const [open, setOpen] = useState({})
  let cos = D.acCompanies || []
  if (filter !== '全部') cos = cos.filter(c => c.status === filter)
  if (q) cos = cos.filter(c => {
    const bas = baOfCompany(D, c.code)
    return (JSON.stringify(c) + JSON.stringify(bas)).toLowerCase().includes(q.toLowerCase())
  })
  const delCo = async c => {
    if (c.status === '已发') return flash('已发出的公司不能删除，请先退回')
    const bas = baOfCompany(D, c.code)
    if (!confirm(`删除公司「${c.name}」？` + (bas.length ? `\n旗下 ${bas.length} 个银行户口也会一起删除。` : ''))) return
    await db.delAcCompany(c.code); await logAudit('删除', 'AC公司', c.code, c.name); reload(); flash('公司已删除')
  }
  const delBA = async b => {
    if (!confirm(`删除银行户口「${b.bank} ${b.accountNo || ''}」？`)) return
    await db.delAcBankAccount(b.code); await logAudit('删除', 'AC银行户口', b.code, b.bank); reload(); flash('银行户口已删除')
  }
  return <div>
    <div className="bar">
      <input placeholder="搜索公司名 / 银行 / 户口号…" value={q} onChange={e => setQ(e.target.value)} style={{ minWidth: 220 }} />
      <select value={filter} onChange={e => setFilter(e.target.value)}>{['全部', '在库', '已发', '已退', '注销'].map(x => <option key={x}>{x}</option>)}</select>
      <div className="sp" />
      <button className="btn" onClick={() => setModal({ type: 'acCompany' })}>+ 进公司</button>
    </div>
    {cos.length ? cos.map(c => {
      const bas = baOfCompany(D, c.code)
      const isOpen = open[c.code]
      const inStock = bas.filter(b => b.stockStatus === '在库')
      const assigned = bas.filter(b => b.stockStatus === '已发')
      const feeTotal = bas.filter(baCharging).reduce((s, b) => s + (+b.monthlyFee || 0), 0)
      const shareTotal = bas.filter(baPaying).reduce((s, b) => s + (+b.supplierShare || 0), 0)
      return <div key={c.code} className="panel" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', flexWrap: 'wrap' }}>
          <button className="linkbtn" style={{ fontSize: 16, padding: '2px 6px' }} onClick={() => setOpen(o => ({ ...o, [c.code]: !o[c.code] }))}>{isOpen ? '▾' : '▸'}</button>
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ fontWeight: 700 }}>{c.name} <span className="code" style={{ marginLeft: 6 }}>{c.code}</span></div>
            <div className="hint" style={{ marginTop: 2 }}>卡商 {acSupName(D, c.supplier)}{c.ssmNo ? ' · SSM ' + c.ssmNo : ''}</div>
          </div>
          <div style={{ textAlign: 'right', fontSize: 12 }}>
            <div>{bas.length} 个户口 · 在库 {inStock.length} · 已发 {assigned.length}</div>
            <div className="hint">月费 {rm(feeTotal)} · 给卡商 {rm(shareTotal)}</div>
          </div>
          {(() => {
            const bad = bas.filter(b => b.status !== '正常')
            const stopC = bas.filter(b => b.stockStatus === '已发' && b.stopCharge).length
            if (!bad.length && !stopC) return <span className="pill ok">全部正常</span>
            const counts = {}
            bad.forEach(b => counts[b.status] = (counts[b.status] || 0) + 1)
            return <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', maxWidth: 260, justifyContent: 'flex-end' }}>
              {Object.entries(counts).map(([st, n]) => <span key={st} className="pill low" style={{ fontSize: 11 }}>{st} {n}</span>)}
              {stopC > 0 && <span className="pill open" style={{ fontSize: 11 }}>停收 {stopC}</span>}
            </div>
          })()}
          <div style={{ display: 'flex', gap: 4 }}>
            {inStock.length > 0 && <button className="linkbtn" style={{ color: 'var(--gold)', fontWeight: 600 }} onClick={() => setModal({ type: 'acAssignCo', data: c })}>批量发出</button>}
            <button className="linkbtn" onClick={() => setModal({ type: 'acBankAccount', data: { company: c.code } })}>+ 加户口</button>
            <button className="linkbtn" onClick={() => setModal({ type: 'acCompany', data: c })}>编辑</button>
            <button className="linkbtn del" onClick={() => delCo(c)}>删除</button>
          </div>
        </div>
        {isOpen && <div style={{ borderTop: '1px solid var(--line)' }}>
          {bas.length ? <table><thead><tr>
            <th>银行</th><th>户口号</th><th>状态</th><th className="num">进价</th><th className="num">卖价</th><th>顾客</th><th className="num">月费</th><th className="num">给卡商</th><th></th>
          </tr></thead><tbody>{bas.map(b => {
            const bad = b.stockStatus === '已发' && b.status !== '正常'
            return <tr key={b.code} style={bad ? { background: 'var(--danger-soft)' } : {}}>
              <td><b>{b.bank}</b>{b.hasCard && <span className="hint"> · 卡</span>}</td>
              <td><span className="code">{b.accountNo || '—'}</span></td>
              <td style={{ whiteSpace: 'nowrap' }}>
                {b.stockStatus === '在库'
                  ? <span className="pill low">在库</span>
                  : <><BAStatusPill s={b.status} />
                    <div style={{ fontSize: 10, marginTop: 3 }}>
                      <span style={{ color: baCharging(b) ? 'var(--accent)' : 'var(--danger)' }}>{baCharging(b) ? '✓收' : '✕停收'}</span>
                      {' '}
                      <span style={{ color: baPaying(b) ? 'var(--gold)' : 'var(--danger)' }}>{baPaying(b) ? '✓付' : '✕停付'}</span>
                    </div></>}
              </td>
              <td className="num">{fmt(b.cost)}</td>
              <td className="num">{b.stockStatus === '已发' ? fmt(b.soldPrice) : '—'}</td>
              <td>{b.customer ? acCustName(D, b.customer) : <span className="hint">—</span>}</td>
              <td className="num">{fmt(b.monthlyFee)}</td>
              <td className="num">{fmt(b.supplierShare)}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                {b.stockStatus === '在库' && <button className="linkbtn" style={{ color: 'var(--gold)', fontWeight: 600 }} onClick={() => setModal({ type: 'acAssignBA', data: b })}>发出</button>}
                {b.stockStatus === '已发' && <button className="linkbtn" onClick={() => setModal({ type: 'acReturnBA', data: b })}>退回</button>}
                <button className="linkbtn" onClick={() => setModal({ type: 'acBankAccount', data: b })}>编辑</button>
                <button className="linkbtn del" onClick={() => delBA(b)}>删除</button>
              </td>
            </tr>
          })}</tbody></table> : <div className="empty">这家公司还没有银行户口 — 点上面「+ 加户口」</div>}
        </div>}
      </div>
    }) : <div className="panel"><div className="empty">暂无公司 — 点「+ 进公司」开始</div></div>}
  </div>
}
function BAStatusPill({ s }) {
  const map = { '正常': 'ok', '盖户口': 'low', '风控': 'open', '收回': 'low', '退卡': 'low', '停租金': 'open', '人头收回': 'low' }
  return <span className={'pill ' + (map[s] || 'open')}>{s || '正常'}</span>
}

/* ---------- 户口历史（谁用过这个户口）---------- */
function ACBaHistory({ D, setModal }) {
  const [q, setQ] = useState('')
  const [baFilter, setBaFilter] = useState('')
  const [custFilter, setCustFilter] = useState('')
  let rows = [...(D.acBaHistory || [])].reverse()
  if (baFilter) rows = rows.filter(h => h.bankAccount === baFilter)
  if (custFilter) rows = rows.filter(h => h.customer === custFilter)
  if (q) rows = rows.filter(h => {
    const ba = (D.acBankAccounts || []).find(x => x.code === h.bankAccount)
    const txt = [h.bankAccount, acCoName(D, h.company), ba?.bank, ba?.accountNo, acCustName(D, h.customer), h.returnReason].join(' ')
    return txt.toLowerCase().includes(q.toLowerCase())
  })
  // 这段持有期间，这个顾客为这个户口付了多少
  const paidInPeriod = h => {
    const bills = (D.acBills || []).filter(b => b.account === h.bankAccount && b.customer === h.customer
      && b.date >= (h.assignDate || '0000-01-01') && (!h.returnDate || b.date <= h.returnDate))
    let billed = 0, paid = 0
    bills.forEach(b => { billed += acBillTotal(b); paid += acBillPaid(D, b.no) })
    return { billed, paid, count: bills.length }
  }
  return <div>
    <div className="bar">
      <input placeholder="搜索公司/银行/顾客/原因…" value={q} onChange={e => setQ(e.target.value)} style={{ minWidth: 200 }} />
      <select value={baFilter} onChange={e => setBaFilter(e.target.value)}><option value="">全部户口</option>
        {(D.acBankAccounts || []).map(b => <option key={b.code} value={b.code}>{acCoName(D, b.company)} · {b.bank} {b.accountNo || ''}</option>)}</select>
      <select value={custFilter} onChange={e => setCustFilter(e.target.value)}><option value="">全部顾客</option>
        {(D.acCustomers || []).map(c => <option key={c.code} value={c.code}>{c.name}</option>)}</select>
    </div>
    <div className="panel"><table>
      <thead><tr>{['公司 · 银行', '顾客', '发出', '退回', '持有天数', '卖价', '月费', '开单', '已收', '退回原因'].map((x, i) => <th key={i} className={[5, 6, 7, 8].includes(i) ? 'num' : ''}>{x}</th>)}</tr></thead>
      <tbody>{rows.length ? rows.map(h => {
        const ba = (D.acBankAccounts || []).find(x => x.code === h.bankAccount)
        const p = paidInPeriod(h)
        const days = h.assignDate ? Math.round(((h.returnDate ? new Date(h.returnDate) : new Date()) - new Date(h.assignDate)) / 86400000) + 1 : 0
        return <tr key={h.id}>
          <td><b>{acCoName(D, h.company)}</b><div className="hint">{ba ? `${ba.bank} ${ba.accountNo || ''}` : h.bankAccount}</div></td>
          <td>{acCustName(D, h.customer)}</td>
          <td>{h.assignDate || '—'}</td>
          <td>{h.returnDate ? h.returnDate : <span style={{ color: 'var(--accent)', fontWeight: 600 }}>使用中</span>}</td>
          <td>{days} 天</td>
          <td className="num">{fmt(h.soldPrice)}</td>
          <td className="num">{fmt(h.monthlyFee)}</td>
          <td className="num">{fmt(p.billed)}<div className="hint">{p.count} 张</div></td>
          <td className="num" style={{ color: p.paid + 0.01 >= p.billed ? 'var(--accent)' : 'var(--danger)' }}>{fmt(p.paid)}</td>
          <td>{h.returnReason || '—'}</td>
        </tr>
      }) : <tr><td colSpan={10}><div className="empty">暂无历史记录 — 发出户口后会自动记录</div></td></tr>}</tbody>
    </table></div>
    <div className="hint" style={{ marginTop: 8 }}>「开单 / 已收」= 这个顾客持有这个户口期间，为它开出的账单总额与实际收到的钱。</div>
  </div>
}

/* ---------- 卡管理（进卡 + 列表）---------- */
/* ---------- 户口管理（核心）---------- */
function ACAccounts({ D, setModal, flash, logAudit, reload }) {
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('全部')
  let rows = D.acAccounts || []
  if (filter !== '全部') rows = rows.filter(c => c.status === filter)
  rows = rows.filter(c => JSON.stringify(c).toLowerCase().includes(q.toLowerCase()))
  const del = async r => {
    if (r.status === '已发') return flash('已发出的户口不能删除，请先退回')
    if (!confirm('删除户口「' + r.code + '」？')) return
    await db.delAcAccount(r.code); await logAudit('删除', 'AC户口', r.code, (r.bank || '') + ' ' + (r.accountNo || '')); reload(); flash('户口已删除')
  }
  const voidAcct = async r => {
    if (!confirm('注销户口「' + r.code + '」？注销后不可再发。')) return
    await db.voidAccount(r.code); await logAudit('修改', 'AC户口', r.code, '注销'); reload(); flash('户口已注销')
  }
  return <div>
    <div className="bar">
      <input placeholder="搜索户口号/银行/卡号…" value={q} onChange={e => setQ(e.target.value)} style={{ minWidth: 220 }} />
      <select value={filter} onChange={e => setFilter(e.target.value)}>{['全部', '在库', '已发', '已退', '注销'].map(x => <option key={x}>{x}</option>)}</select>
      <div className="sp" />
      <button className="btn" onClick={() => setModal({ type: 'acAccount' })}>+ 进户口</button>
    </div>
    <div className="panel"><table>
      <thead><tr>{['编码', '银行', '户口号', '卡商', '月费', '有卡', '进价', '卖价', '状态', '持有人', ''].map((x, i) => <th key={i} className={i === 4 || i === 6 || i === 7 ? 'num' : ''}>{x}</th>)}</tr></thead>
      <tbody>{rows.length ? rows.map(r => <tr key={r.code}>
        <td><span className="code">{r.code}</span></td><td>{r.bank || '—'}</td><td>{r.accountNo || '—'}</td>
        <td>{acSupName(D, r.supplier)}</td>
        <td className="num">{fmt(r.monthlyFee || 0)}</td>
        <td>{r.hasCard ? <span className="pill ok">有卡</span> : <span className="muted">无</span>}</td>
        <td className="num">{fmt(r.cost)}</td><td className="num">{fmt(r.sell)}</td>
        <td><ACStatusPill s={r.status} /></td>
        <td>{r.status === '已发' ? acCustName(D, r.customer) : '—'}</td>
        <td><button className="linkbtn" onClick={() => setModal({ type: 'acAccount', data: r })}>编辑</button>
          {r.status === '在库' && <button className="linkbtn" onClick={() => voidAcct(r)}>注销</button>}
          {r.status !== '已发' && <button className="linkbtn del" onClick={() => del(r)}>删除</button>}</td>
      </tr>) : <tr><td colSpan={11}><div className="empty">暂无户口</div></td></tr>}</tbody>
    </table></div>
  </div>
}

/* ---------- 发户口 ---------- */
function ACAssign({ D, setModal }) {
  const inStock = (D.acAccounts || []).filter(c => c.status === '在库')
  return <div>
    <div className="hint" style={{ marginBottom: 12 }}>从「在库」的户口里选一个发给顾客（有卡没卡都能发）。发出后状态变「已发」，记录持有人和实际卖价。</div>
    <div className="panel"><table>
      <thead><tr>{['编码', '银行', '户口号', '有卡', '建议卖价', ''].map((x, i) => <th key={i} className={i === 4 ? 'num' : ''}>{x}</th>)}</tr></thead>
      <tbody>{inStock.length ? inStock.map(c => <tr key={c.code}>
        <td><span className="code">{c.code}</span></td><td>{c.bank || '—'}</td><td>{c.accountNo || '—'}</td>
        <td>{c.hasCard ? <span className="pill ok">有卡</span> : <span className="muted">无</span>}</td>
        <td className="num">{fmt(c.sell)}</td>
        <td><button className="btn sm" onClick={() => setModal({ type: 'acAssignAcct', data: c })}>发户口</button></td>
      </tr>) : <tr><td colSpan={6}><div className="empty">没有在库的户口，请先去「户口管理」进户口</div></td></tr>}</tbody>
    </table></div>
  </div>
}

/* ---------- 退户口 ---------- */
function ACReturn({ D, flash, logAudit, reload }) {
  const assigned = (D.acAccounts || []).filter(c => c.status === '已发')
  const doReturn = async c => {
    if (!confirm('确认「' + acCustName(D, c.customer) + '」退回户口 ' + c.code + '？')) return
    await db.returnAccount(c.code); await logAudit('退户口', 'AC户口', c.code, acCustName(D, c.customer)); reload(); flash('已退户口')
  }
  return <div>
    <div className="hint" style={{ marginBottom: 12 }}>从「已发」的户口里选，办理顾客退回。退回后状态变「已退」。</div>
    <div className="panel"><table>
      <thead><tr>{['编码', '银行', '户口号', '持有人', '发出日', '卖价', ''].map((x, i) => <th key={i} className={i === 5 ? 'num' : ''}>{x}</th>)}</tr></thead>
      <tbody>{assigned.length ? assigned.map(c => <tr key={c.code}>
        <td><span className="code">{c.code}</span></td><td>{c.bank || '—'}</td><td>{c.accountNo || '—'}</td>
        <td>{acCustName(D, c.customer)}</td><td>{c.assignDate || '—'}</td><td className="num">{fmt(c.soldPrice)}</td>
        <td><button className="btn sm" onClick={() => doReturn(c)}>退户口</button></td>
      </tr>) : <tr><td colSpan={7}><div className="empty">没有已发出的户口</div></td></tr>}</tbody>
    </table></div>
  </div>
}

function BothDashboard({ D, setTab, setModule }) {
  // SP 部分（16-15 账期）
  const p = profit(D)
  let outstanding = 0
  D.customers.forEach(c => outstanding += customerBalance(D, c.code).outstanding)
  const salesToday = D.sales.filter(s => s.date === todayISO()).reduce((s, x) => s + invoiceTotals(x).rm, 0)
  const spSalesTotal = D.sales.reduce((s, x) => s + invoiceTotals(x).rm, 0)

  // AC 部分（新结构：ac_bank_accounts / ac_companies，自然月账期）
  const bas = D.acBankAccounts || []
  const inStock = bas.filter(b => b.stockStatus === '在库')
  const assigned = bas.filter(b => b.stockStatus === '已发')
  const stockValue = inStock.reduce((s, b) => s + (+b.cost || 0), 0)
  const acPer = acPeriodRangeOf(acCurrentPeriod())
  const acP = acProfitV2(D, acPer.from, acPer.to)
  const acRevenueAll = acP.sellRevenue + acP.initRevenue + acP.feeRevenue   // 本账期：卖户口+首期+月费 收入
  let acOutstanding = 0
  ;(D.acCustomers || []).forEach(c => acOutstanding += acCustomerBalance(D, c.code).outstanding)

  const combinedRevenue = spSalesTotal + acRevenueAll
  const combinedNet = p.net + acP.net
  const combinedOutstanding = outstanding + acOutstanding

  const K = (l, v, mono, onClick) => <div className="kpi" onClick={onClick} style={onClick ? { cursor: 'pointer' } : {}}><div className="l">{l}</div><div className={'v' + (mono ? ' mono' : '')}>{v}</div></div>
  return <div>
    <div className="panel" style={{ marginBottom: 16, textAlign: 'center', padding: '18px 16px', background: 'linear-gradient(160deg,var(--card),var(--accent-soft))' }}>
      <div className="hint" style={{ fontSize: 12 }}>合并净利（SP 全部 + AC 本账期 {acPer.from}~{acPer.to}）</div>
      <div className="mono" style={{ fontSize: 30, fontWeight: 800, color: combinedNet >= 0 ? 'var(--accent)' : 'var(--danger)', letterSpacing: -1, margin: '3px 0' }}>{rm(combinedNet)}</div>
      <div className="hint">SP {rm(p.net)} · AC {rm(acP.net)}</div>
    </div>
    <div className="kpis" style={{ marginBottom: 16 }}>
      {K('合并收入', rm(combinedRevenue), 1)}
      {K('合并应收', rm(combinedOutstanding), 1)}
      {K('SP 今日销售', rm(salesToday), 1, () => { setModule && setModule('sp'); setTab && setTab('sales') })}
      {K('AC 在收户口', fmt(assigned.filter(baCharging).length), 0, () => { setModule && setModule('ac'); setTab && setTab('accompany') })}
    </div>
    <div className="panel" style={{ marginBottom: 16 }}><h3>SP Trading · 买卖系统</h3><div className="body">
      <div className="kpis" style={{ marginBottom: 0 }}>{K('今日销售', rm(salesToday), 1)}{K('净利（全部）', rm(p.net), 1)}{K('应收账款', rm(outstanding), 1)}{K('采购总额', rm(D.purchases.reduce((s, po) => s + purchaseTotals(po).rm, 0)), 1)}</div>
    </div></div>
    <div className="panel" style={{ marginBottom: 16 }}><h3>AC Management · 银行户口</h3><div className="body">
      <div className="kpis" style={{ marginBottom: 0 }}>{K('在库户口', fmt(inStock.length))}{K('已发户口', fmt(assigned.length))}{K('在库成本', rm(stockValue), 1)}{K('卡商数', fmt((D.acSuppliers || []).length))}</div>
    </div></div>
    <div className="panel"><h3>合并收入（本账期）</h3><div className="body">
      <div className="tot"><span className="k">SP Trading 销售（全部）</span><span className="v">{rm(spSalesTotal)}</span></div>
      <div className="tot"><span className="k">AC 卖户口</span><span className="v">{rm(acP.sellRevenue)}</span></div>
      <div className="tot"><span className="k">AC 首期费用</span><span className="v">{rm(acP.initRevenue)}</span></div>
      <div className="tot"><span className="k">AC 月费</span><span className="v">{rm(acP.feeRevenue)}</span></div>
      <div style={{ borderTop: '1px solid var(--line)', marginTop: 8, paddingTop: 8 }} />
      <div className="tot"><span className="k"><b>合计收入</b></span><span className="v"><b>{rm(combinedRevenue)}</b></span></div>
    </div></div>
  </div>
}

/* ---------- 仪表板 ---------- */
/* 近 N 个账期（含当前账期），返回 [{key:'2026-06', label:'6月'}...] 与 ymOf/periodOf 一致 */
function lastMonths(n) {
  const cur = currentPeriod() // '2026-06'
  const [cy, cm] = cur.split('-').map(Number) // cm: 1-12 起始月
  const out = []
  for (let i = n - 1; i >= 0; i--) {
    let y = cy, m = cm - 1 - i // 0-based
    while (m < 0) { m += 12; y -= 1 }
    out.push({ key: y + '-' + String(m + 1).padStart(2, '0'), label: (m + 1) + '月' })
  }
  return out
}
/* 账期：16号~下月15号。命名用起始月（6/16~7/15 记为 6月账期）。返回命名年月字符串 '2026-06' */
function periodOf(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  let y = d.getFullYear(), m = d.getMonth() // 0-11
  if (d.getDate() <= 15) { m -= 1; if (m < 0) { m = 11; y -= 1 } }
  return y + '-' + String(m + 1).padStart(2, '0')
}
const ymOf = dateStr => periodOf(dateStr)
/* 某账期(命名年月 '2026-06')的起止日期：起始月16号 ~ 下月15号 */
function periodRangeOf(ym) {
  const [y, m] = ym.split('-').map(Number) // m: 1-12（起始月）
  const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
  return { from: iso(new Date(y, m - 1, 16)), to: iso(new Date(y, m, 15)) }
}
/* 今天所属账期 */
const currentPeriod = () => periodOf(todayISO())

/* ===== AC 专用：自然月账期（1号~月底）===== */
function acPeriodOf(dateStr) {
  if (!dateStr) return ''
  return dateStr.slice(0, 7)   // 'YYYY-MM'，直接取年月 = 自然月账期
}
/* 某自然月账期的起止：1号 ~ 月底 */
function acPeriodRangeOf(ym) {
  const [y, m] = ym.split('-').map(Number)
  const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
  return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) }  // new Date(y,m,0)=上月最后一天
}
const acCurrentPeriod = () => acPeriodOf(todayISO())
/* AC 按天月费：月费 ÷ 当月天数 × 剩余天数（含当天），自然月 */
function acProratedFee(monthlyFee, dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  const dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()  // 当月总天数
  const remaining = dim - d.getDate() + 1
  return (monthlyFee || 0) / dim * remaining
}
/* AC 近 N 个自然月账期 */
function acLastMonths(n) {
  const out = []
  const now = new Date(todayISO() + 'T00:00:00')
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    out.push({ key: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'), label: (d.getMonth() + 1) + '月' })
  }
  return out
}
/* 账期 +n（起始月命名）*/
function shiftPeriodStr(ym, n) { let [y, m] = ym.split('-').map(Number); m += n; while (m > 12) { m -= 12; y++ } while (m < 1) { m += 12; y-- } return y + '-' + String(m).padStart(2, '0') }
/* 从 fromYm 到 toYm 的账期列表（含两端）*/
function periodsBetween(fromYm, toYm) {
  const out = []
  let cur = fromYm, guard = 0
  while (guard++ < 240) { out.push(cur); if (cur === toYm) break; if (cur > toYm) break; cur = shiftPeriodStr(cur, 1) }
  return out
}
/* 自动补开月费单：为「已发+正常在收」的户口，补齐从发出账期到当前账期缺的月费单。
   返回 { created, skipped, stoppedPending } — created=新开几张, stoppedPending=停收未开几个户口 */
let _genRunning = false
async function generateMonthlyBills(D) {
  if (_genRunning) return { created: 0, stoppedPending: 0, busy: true }
  _genRunning = true
  try {
    return await _generateMonthlyBillsImpl(D)
  } finally { _genRunning = false }
}
async function _generateMonthlyBillsImpl(D) {
  const cur = acCurrentPeriod()
  let created = 0
  const stoppedSet = new Set()
  // 直接从数据库读现有账单（避免用过期的 D 快照导致重复生成）
  let dbBills = []
  try {
    const { data } = await supabase.from('ac_bills').select('account,period,bill_type')
    dbBills = data || []
  } catch (e) { dbBills = (D.acBills || []).map(b => ({ account: b.account, period: b.period, bill_type: b.billType })) }
  const already = new Set(dbBills.filter(b => b.bill_type === '月费').map(b => b.account + '|' + b.period))
  const firstMonthDone = new Set(dbBills.filter(b => b.bill_type === '首期').map(b => b.account + '|' + b.period))
  for (const ba of (D.acBankAccounts || [])) {
    if (ba.stockStatus !== '已发' || !ba.assignDate) continue
    const startYm = acPeriodOf(ba.assignDate)
    const periods = periodsBetween(startYm, cur)
    for (const per of periods) {
      const key = ba.code + '|' + per
      if (already.has(key)) continue                 // 该账期月费单已存在
      if (per === startYm && firstMonthDone.has(key)) continue  // 发出当月已按天开过
      // 停收的跳过（盖户口/风控/停收开关）
      if (!baCharging(ba)) { stoppedSet.add(ba.code); continue }
      const co = acCoOf(D, ba.company)
      const no = await nextNo('BILL')
      const isFirstMonth = per === startYm
      const amount = isFirstMonth ? +acProratedFee(ba.monthlyFee || 0, ba.assignDate).toFixed(2) : (+ba.monthlyFee || 0)
      const rng = acPeriodRangeOf(per)
      const billDate = isFirstMonth ? ba.assignDate : rng.from
      await db.saveAcBill({ no, billType: '月费', account: ba.code, customer: ba.customer, date: billDate, period: per, items: [{ name: '月费', amount, cost: 0, remark: '自动生成 · ' + per + '账期', kind: 'fee' }], note: '' })
      already.add(key)   // 本次运行内也标记，避免同次重复
      // 同时产生卡商应付
      if (baPaying(ba)) {
        const share = isFirstMonth ? +acProratedFee(ba.supplierShare || 0, ba.assignDate).toFixed(2) : (+ba.supplierShare || 0)
        if (share > 0) await db.saveAcDue({ supplier: co?.supplier, bankAccount: ba.code, company: ba.company, billNo: no, period: per, date: billDate, amount: share, settled: false, note: `${acCoName(D, ba.company)} · ${ba.bank}` })
      }
      // 产生 agent 应付（有 agent 且有佣金）
      if (ba.agent && (+ba.agentFee || 0) > 0) {
        const af = isFirstMonth ? +acProratedFee(ba.agentFee || 0, ba.assignDate).toFixed(2) : (+ba.agentFee || 0)
        if (af > 0) await db.saveAgentDue({ agent: ba.agent, bankAccount: ba.code, company: ba.company, billNo: no, period: per, date: billDate, amount: af, settled: false, note: `${acCoName(D, ba.company)} · ${ba.bank}` })
      }
      created++
    }
  }
  return { created, stoppedPending: stoppedSet.size }
}
/* 双色柱状图：series = [{label, values:[{v, sub}], color}] 简化：传 months + 两组数值 */
function TrendBars({ months, a, b, aLabel, bLabel, aColor, bColor }) {
  const max = Math.max(1, ...a, ...b)
  return <div>
    <div style={{ display: 'flex', gap: 16, fontSize: 11, color: 'var(--ink-soft)', marginBottom: 10 }}>
      <span><i style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, background: aColor, marginRight: 5 }} />{aLabel}</span>
      <span><i style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, background: bColor, marginRight: 5 }} />{bLabel}</span>
    </div>
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 130 }}>
      {months.map((m, i) => <div key={m.key} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 100, width: '100%', justifyContent: 'center' }}>
          <div title={aLabel + ' ' + rm(a[i])} style={{ width: '38%', background: aColor, borderRadius: '3px 3px 0 0', height: (a[i] / max * 100) + '%', minHeight: a[i] > 0 ? 3 : 0, transition: 'height .4s var(--ease)' }} />
          <div title={bLabel + ' ' + rm(b[i])} style={{ width: '38%', background: bColor, borderRadius: '3px 3px 0 0', height: (Math.max(0, b[i]) / max * 100) + '%', minHeight: b[i] > 0 ? 3 : 0, transition: 'height .4s var(--ease)' }} />
        </div>
        <div style={{ fontSize: 10, color: 'var(--ink-soft)' }}>{m.label}</div>
      </div>)}
    </div>
  </div>
}
/* 可点击的提醒条 */
function AlertRow({ icon, text, tone, onClick }) {
  const bg = tone === 'warn' ? 'var(--gold-soft)' : tone === 'danger' ? 'var(--danger-soft)' : 'var(--accent-soft)'
  const bd = tone === 'warn' ? 'var(--gold-line)' : tone === 'danger' ? 'var(--danger-line)' : 'var(--accent-line)'
  const col = tone === 'warn' ? 'var(--gold)' : tone === 'danger' ? 'var(--danger)' : 'var(--accent)'
  return <button onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', background: bg, border: '1px solid ' + bd, borderRadius: 10, padding: '11px 13px', cursor: 'pointer', marginBottom: 8, fontSize: 13, color: 'var(--ink)', transition: 'transform .12s var(--ease)' }}>
    <span style={{ fontSize: 17 }}>{icon}</span>
    <span style={{ flex: 1 }}>{text}</span>
    <span style={{ color: col, fontWeight: 600, fontSize: 12 }}>查看 ›</span>
  </button>
}

function Dashboard({ D, can, setModal, setTab }) {
  const inv = useMemo(() => computeInventory(D), [D])
  const invValue = Object.values(inv).reduce((s, m) => s + m.balance * m.avgCost, 0)
  const invQty = Object.values(inv).reduce((s, m) => s + m.balance, 0)
  const p = profit(D)
  let outstanding = 0, received = 0, openCount = 0
  D.customers.forEach(c => { const b = customerBalance(D, c.code); outstanding += b.outstanding; received += b.paid })
  D.sales.forEach(s => { if (invoiceStatus(D, s) !== 'Paid') openCount++ })
  const purchAmt = D.purchases.reduce((s, po) => s + purchaseTotals(po).rm, 0)
  const salesToday = D.sales.filter(s => s.date === todayISO()).reduce((s, x) => s + invoiceTotals(x).rm, 0)
  const lowStock = Object.values(inv).filter(m => m.balance <= m.minStock)
  // 近6个月销售额 + 利润
  const months = lastMonths(6)
  const salesByM = months.map(m => D.sales.filter(s => ymOf(s.date) === m.key).reduce((sm, s) => sm + invoiceTotals(s).rm, 0))
  const profitByM = months.map(m => {
    let pr = 0
    D.sales.filter(s => ymOf(s.date) === m.key).forEach(s => {
      const revRm = invoiceTotals(s).rm
      let cogs = 0
      s.items.forEach(l => { const it = D.items.find(x => x.code === l.item); cogs += l.qty * (it ? (it.cost || 0) : 0) })
      pr += revRm - cogs
    })
    return pr
  })
  const K = (l, v, mono, onClick) => <div className="kpi" onClick={onClick} style={onClick ? { cursor: 'pointer' } : {}}><div className="l">{l}</div><div className={'v' + (mono ? ' mono' : '')}>{v}</div></div>
  return <div>
    <div className="kpis">{K('今日销售', rm(salesToday), 1, () => setTab && setTab('sales'))}{K('净利（全部）', rm(p.net), 1, () => setTab && setTab('profit'))}{K('库存价值', rm(invValue), 1, () => setTab && setTab('inventory'))}{K('总库存数量', fmt(invQty), 0, () => setTab && setTab('inventory'))}</div>
    <div className="kpis">{K('未收账款', rm(outstanding), 1, () => setTab && setTab('payment'))}{K('已收', rm(received), 1, () => setTab && setTab('payment'))}{K('采购', rm(purchAmt), 1, () => setTab && setTab('purchase'))}{K('汇兑损益', rm(fxGainLoss(D).total), 1, () => setTab && setTab('report'))}</div>
    {can('purchase') && <div className="bar">
      <button className="btn" onClick={() => setModal({ type: 'purchase' })}>+ 新采购</button>
      <button className="btn" onClick={() => setModal({ type: 'sales' })}>+ 新销售</button>
      <button className="btn ghost" onClick={() => setModal({ type: 'payment' })}>+ 新收款</button>
    </div>}
    {(openCount > 0 || lowStock.length > 0) && <div className="panel" style={{ marginBottom: 16 }}><h3>提醒</h3><div className="body">
      {openCount > 0 && <AlertRow icon="💰" tone="warn" text={`${openCount} 张发票未收 · 共欠 ${rm(outstanding)}`} onClick={() => setTab && setTab('payment')} />}
      {lowStock.length > 0 && <AlertRow icon="📦" tone="danger" text={`${lowStock.length} 个货品库存偏低`} onClick={() => setTab && setTab('inventory')} />}
    </div></div>}
    <div className="panel" style={{ marginBottom: 16 }}><h3>近 6 个月趋势</h3><div className="body">
      <TrendBars months={months} a={salesByM} b={profitByM} aLabel="销售额" bLabel="利润" aColor="var(--accent-3)" bColor="var(--gold)" />
    </div></div>
    <div className="grid2">
      <div className="panel"><h3>近期销售</h3>
        {D.sales.slice(-6).reverse().length ? <table><tbody>{D.sales.slice(-6).reverse().map((r, i) =>
          <tr key={i} style={{ cursor: 'pointer' }} onClick={() => setModal({ type: 'viewINV', data: r })}><td><span className="code">{r.no}</span></td><td>{cName(D, r.customer)}</td><td className="num">{rm(invoiceTotals(r).rm)}</td></tr>)}</tbody></table>
          : <div className="empty">暂无销售</div>}</div>
      <div className="panel"><h3>库存偏低</h3>
        {lowStock.length ? <table><tbody>{lowStock.map(m =>
          <tr key={m.code}><td><span className="code">{m.code}</span></td><td>{m.name}</td><td className="num">{fmt(m.balance)}</td><td><Pill s="Low" /></td></tr>)}</tbody></table>
          : <div className="empty">库存充足</div>}</div>
    </div>
  </div>
}

/* ---------- 顾客/供应商/货品/货币 ---------- */
function Customers({ D, can, setModal, flash, logAudit, reload }) {
  const del = async r => {
    const used = D.sales.some(s => s.customer === r.code) || D.payments.some(p => p.customer === r.code)
    if (used) return flash('此顾客已有单据记录，不能删除（可改状态为停用）')
    if (!confirm('删除顾客「' + r.name + '」（' + r.code + '）？')) return
    await db.delCustomer(r.code); await logAudit('删除', '顾客', r.code, r.name); reload(); flash('顾客已删除')
  }
  return <TablePage rows={D.customers} can={can('customer')} onAdd={() => setModal({ type: 'customer' })} addLabel="+ 新增顾客" empty="暂无顾客" cols={[
    { h: '编码', c: r => <span className="code">{r.code}</span> }, { h: '名称', c: r => r.name },
    { h: '公司', c: r => <span className="muted">{r.company || '—'}</span> }, { h: '电话', c: r => r.phone || '—' },
    { h: '货币', c: r => r.ccy }, { h: '信用额', num: true, c: r => fmt(r.credit) },
    { h: '未收', num: true, c: r => rm(customerBalance(D, r.code).outstanding) }, { h: '状态', c: r => <Pill s={r.status || '启用'} /> },
    { h: '', c: r => can('customer') && <span><button className="linkbtn" onClick={() => setModal({ type: 'customer', data: r })}>编辑</button>
      <button className="linkbtn" onClick={() => setModal({ type: 'statement', data: r })}>对账单</button>
      <button className="linkbtn del" onClick={() => del(r)}>删除</button></span> },
  ]} />
}
function Suppliers({ D, can, setModal, flash, logAudit, reload }) {
  const del = async r => {
    const used = D.purchases.some(p => p.supplier === r.code)
    if (used) return flash('此供应商已有采购记录，不能删除')
    if (!confirm('删除供应商「' + r.name + '」（' + r.code + '）？')) return
    await db.delSupplier(r.code); await logAudit('删除', '供应商', r.code, r.name); reload(); flash('供应商已删除')
  }
  return <TablePage rows={D.suppliers} can={can('supplier')} onAdd={() => setModal({ type: 'supplier' })} addLabel="+ 新增供应商" empty="暂无供应商" cols={[
    { h: '编码', c: r => <span className="code">{r.code}</span> }, { h: '名称', c: r => r.name },
    { h: '电话', c: r => r.phone || '—' }, { h: '邮箱', c: r => <span className="muted">{r.email || '—'}</span> },
    { h: '货币', c: r => r.ccy }, { h: '', c: r => can('supplier') && <span><button className="linkbtn" onClick={() => setModal({ type: 'supplier', data: r })}>编辑</button>
      <button className="linkbtn del" onClick={() => del(r)}>删除</button></span> },
  ]} />
}
function Items({ D, can, setModal, flash, logAudit, reload }) {
  const inv = computeInventory(D)
  const del = async r => {
    const used = D.purchases.some(p => p.items.some(l => l.item === r.code)) || D.sales.some(s => s.items.some(l => l.item === r.code)) || D.invTx.some(t => t.item === r.code)
    if (used) return flash('此货品已有进销/库存记录，不能删除（可改状态为停用）')
    if (!confirm('删除货品「' + r.name + '」（' + r.code + '）？')) return
    await db.delItem(r.code); await logAudit('删除', '货品', r.code, r.name); reload(); flash('货品已删除')
  }
  return <TablePage rows={D.items} can={can('item')} onAdd={() => setModal({ type: 'item' })} addLabel="+ 新增货品" empty="暂无货品" cols={[
    { h: '编码', c: r => <span className="code">{r.code}</span> }, { h: '名称', c: r => r.name },
    { h: '类别', c: r => <span className="muted">{r.category || '—'}</span> }, { h: '单位', c: r => r.unit },
    { h: '基础成本', num: true, c: r => fmt(r.cost) }, { h: '当前成本', num: true, c: r => fmt(inv[r.code]?.avgCost ?? r.cost) },
    { h: '售价', num: true, c: r => fmt(r.sell) }, { h: '结存', num: true, c: r => fmt(inv[r.code]?.balance || 0) },
    { h: '最低', num: true, c: r => fmt(r.minStock) }, { h: '', c: r => (inv[r.code]?.balance || 0) <= r.minStock ? <Pill s="Low" /> : <Pill s="OK" /> },
    { h: '', c: r => can('item') && <span><button className="linkbtn" onClick={() => setModal({ type: 'item', data: r })}>编辑</button>
      <button className="linkbtn del" onClick={() => del(r)}>删除</button></span> },
  ]} />
}
function Currencies({ D, can, setModal }) {
  return <TablePage rows={D.currencies} can={can('currency')} onAdd={() => setModal({ type: 'currency' })} addLabel="+ 新增／更新汇率" empty="暂无货币" cols={[
    { h: '编码', c: r => <span className="code">{r.code}</span> }, { h: '汇率 → MYR', num: true, c: r => fmtRate(r.rate) },
    { h: '生效日', c: r => r.date }, { h: '示例', c: r => <span className="muted">{`1,000 ${r.code} = ${rm(1000 * r.rate)}`}</span> },
    { h: '', c: r => can('currency') && r.code !== 'MYR' && <button className="linkbtn" onClick={() => setModal({ type: 'currency', data: r })}>编辑</button> },
  ]} />
}

/* ---------- 采购/销售/收款 列表 ---------- */
function Purchases({ D, can, setModal }) {
  const [sup, setSup] = useState('')
  const [sort, setSort] = useState('new')
  let rows = [...D.purchases]
  if (sup) rows = rows.filter(r => r.supplier === sup)
  if (sort === 'new') rows = rows.reverse()
  else if (sort === 'old') { /* keep asc */ }
  else if (sort === 'az') rows = rows.sort((a, b) => sName(D, a.supplier).localeCompare(sName(D, b.supplier)))
  else if (sort === 'amt') rows = rows.sort((a, b) => purchaseTotals(b).rm - purchaseTotals(a).rm)
  return <div>
    <div className="bar">
      <select value={sup} onChange={e => setSup(e.target.value)}><option value="">全部供应商</option>{[...D.suppliers].sort((a, b) => a.name.localeCompare(b.name)).map(s => <option key={s.code} value={s.code}>{s.name}</option>)}</select>
      <select value={sort} onChange={e => setSort(e.target.value)}><option value="new">最新优先</option><option value="old">最早优先</option><option value="az">供应商 A-Z</option><option value="amt">金额高到低</option></select>
      <div className="sp" />
      {can('purchase') && <button className="btn" onClick={() => setModal({ type: 'purchase' })}>+ 新采购</button>}
    </div>
    <div className="panel"><table>
      <thead><tr>{['采购单号', '日期', '供应商', '货币', '汇率', '金额', '合计 RM', ''].map((x, i) => <th key={i} className={i === 4 || i === 5 || i === 6 ? 'num' : ''}>{x}</th>)}</tr></thead>
      <tbody>{rows.length ? rows.map(r => <tr key={r.no}>
        <td><span className="code">{r.no}</span></td><td>{r.date}</td><td>{sName(D, r.supplier)}</td>
        <td>{r.ccy}</td><td className="num">{fmtRate(r.rate)}</td><td className="num">{r.ccy} {fmt(purchaseTotals(r).amt)}</td>
        <td className="num">{rm(purchaseTotals(r).rm)}</td>
        <td><button className="linkbtn" onClick={() => setModal({ type: 'viewPO', data: r })}>查看</button></td>
      </tr>) : <tr><td colSpan={8}><div className="empty">暂无采购</div></td></tr>}</tbody>
    </table></div>
  </div>
}
function Sales({ D, can, setModal }) {
  const [cust, setCust] = useState('')
  const [sort, setSort] = useState('new')
  let rows = [...D.sales]
  if (cust) rows = rows.filter(r => r.customer === cust)
  if (sort === 'new') rows = rows.reverse()
  else if (sort === 'old') { /* asc */ }
  else if (sort === 'az') rows = rows.sort((a, b) => cName(D, a.customer).localeCompare(cName(D, b.customer)))
  else if (sort === 'amt') rows = rows.sort((a, b) => invoiceTotals(b).rm - invoiceTotals(a).rm)
  return <div>
    <div className="bar">
      <select value={cust} onChange={e => setCust(e.target.value)}><option value="">全部顾客</option>{[...D.customers].sort((a, b) => a.name.localeCompare(b.name)).map(c => <option key={c.code} value={c.code}>{c.name}</option>)}</select>
      <select value={sort} onChange={e => setSort(e.target.value)}><option value="new">最新优先</option><option value="old">最早优先</option><option value="az">顾客 A-Z</option><option value="amt">金额高到低</option></select>
      <div className="sp" />
      {can('sales') && <button className="btn" onClick={() => setModal({ type: 'sales' })}>+ 新发票</button>}
    </div>
    <div className="panel"><table>
      <thead><tr>{['发票', '日期', '顾客', '货币', '汇率', '金额', '发票 RM', '状态', ''].map((x, i) => <th key={i} className={i === 4 || i === 5 || i === 6 ? 'num' : ''}>{x}</th>)}</tr></thead>
      <tbody>{rows.length ? rows.map(r => <tr key={r.no}>
        <td><span className="code">{r.no}</span></td><td>{r.date}</td><td>{cName(D, r.customer)}</td>
        <td>{r.ccy}</td><td className="num">{fmtRate(r.rate)}</td><td className="num">{r.ccy} {fmt(invoiceTotals(r).amt)}</td>
        <td className="num">{rm(invoiceTotals(r).rm)}</td><td><Pill s={invoiceStatus(D, r)} /></td>
        <td><button className="linkbtn" onClick={() => setModal({ type: 'viewINV', data: r })}>查看</button></td>
      </tr>) : <tr><td colSpan={9}><div className="empty">暂无发票</div></td></tr>}</tbody>
    </table></div>
  </div>
}
function Payments({ D, can, setModal }) {
  return <TablePage rows={[...D.payments].reverse()} can={can('payment')} onAdd={() => setModal({ type: 'payment' })} addLabel="+ 新收款" empty="暂无收款" cols={[
    { h: '收款', c: r => <span className="code">{r.no}</span> }, { h: '日期', c: r => r.date }, { h: '顾客', c: r => cName(D, r.customer) },
    { h: '货币', c: r => r.ccy }, { h: '汇率', num: true, c: r => fmtRate(r.rate) }, { h: '已付', num: true, c: r => `${r.ccy} ${fmt(r.amount)}` },
    { h: '付款 RM', num: true, c: r => rm(r.amount * r.rate) },
    { h: 'FX', num: true, c: r => { const fx = (r.allocs || []).reduce((s, a) => s + (a.fx || 0), 0); return <span className={fx >= 0 ? 'pos' : 'neg'}>{fmt(fx)}</span> } },
    { h: '', c: r => <button className="linkbtn" onClick={() => setModal({ type: 'viewRCPT', data: r })}>查看</button> },
  ]} />
}

/* ---------- 销售退货（贷记单）---------- */
function SalesReturns({ D, can, setModal }) {
  return <TablePage rows={[...(D.creditNotes || [])].reverse()} can={can('sreturn')} onAdd={() => setModal({ type: 'creditNote' })} addLabel="+ 新销售退货" empty="暂无退货" cols={[
    { h: '贷记单号', c: r => <span className="code">{r.no}</span> }, { h: '日期', c: r => r.date },
    { h: '原发票', c: r => <span className="code">{r.refInvoice || '—'}</span> }, { h: '顾客', c: r => cName(D, r.customer) },
    { h: '货币', c: r => r.ccy }, { h: '退货额', num: true, c: r => `${r.ccy} ${fmt(creditNoteTotals(r).amt)}` },
    { h: '退货 RM', num: true, c: r => rm(creditNoteTotals(r).rm) },
    { h: '', c: r => <button className="linkbtn" onClick={() => setModal({ type: 'viewCN', data: r })}>查看</button> },
  ]} />
}
/* ---------- 采购退货（借记单）---------- */
function PurchaseReturns({ D, can, setModal }) {
  return <TablePage rows={[...(D.debitNotes || [])].reverse()} can={can('preturn')} onAdd={() => setModal({ type: 'debitNote' })} addLabel="+ 新采购退货" empty="暂无退货" cols={[
    { h: '借记单号', c: r => <span className="code">{r.no}</span> }, { h: '日期', c: r => r.date },
    { h: '原采购单', c: r => <span className="code">{r.refPurchase || '—'}</span> }, { h: '供应商', c: r => sName(D, r.supplier) },
    { h: '货币', c: r => r.ccy }, { h: '退货额', num: true, c: r => `${r.ccy} ${fmt(debitNoteTotals(r).amt)}` },
    { h: '退货 RM', num: true, c: r => rm(debitNoteTotals(r).rm) },
    { h: '', c: r => <button className="linkbtn" onClick={() => setModal({ type: 'viewDN', data: r })}>查看</button> },
  ]} />
}

/* ---------- 供应商付款 ---------- */
function SupplierPayments({ D, can, setModal }) {
  return <TablePage rows={[...(D.supplierPayments || [])].reverse()} can={can('spay')} onAdd={() => setModal({ type: 'supplierPayment' })} addLabel="+ 新供应商付款" empty="暂无付款" cols={[
    { h: '付款单号', c: r => <span className="code">{r.no}</span> }, { h: '日期', c: r => r.date }, { h: '供应商', c: r => sName(D, r.supplier) },
    { h: '货币', c: r => r.ccy }, { h: '汇率', num: true, c: r => fmtRate(r.rate) }, { h: '付款', num: true, c: r => `${r.ccy} ${fmt(r.amount)}` },
    { h: '付款 RM', num: true, c: r => rm(r.amount * r.rate) },
    { h: 'FX', num: true, c: r => { const fx = (r.allocs || []).reduce((s, a) => s + (a.fx || 0), 0); return <span className={fx >= 0 ? 'pos' : 'neg'}>{fmt(fx)}</span> } },
    { h: '', c: r => <button className="linkbtn" onClick={() => setModal({ type: 'viewSPAY', data: r })}>查看</button> },
  ]} />
}

/* ---------- 库存 ---------- */
function Inventory({ D }) {
  const inv = computeInventory(D)
  const [sel, setSel] = useState(null)
  const rows = Object.values(inv)
  const ledger = sel ? D.invTx.filter(t => t.item === sel).slice().reverse() : []
  const typeLabel = t => ({ Purchase: '进货', Sales: '销售', Adjustment: '调整' }[t] || t)
  return <div>
    <div className="panel" style={{ marginBottom: 16 }}><h3>库存结存</h3>
      <table><thead><tr>{['货品', '名称', '期初', '进货', '销售', '调整', '结存', '当前成本', '价值 RM', ''].map((x, i) => <th key={i} className={i >= 2 && i < 9 ? 'num' : ''}>{x}</th>)}</tr></thead>
        <tbody>{rows.map(m => <tr key={m.code}>
          <td><span className="code">{m.code}</span></td><td>{m.name}</td>
          <td className="num">{fmt(m.opening || 0)}</td><td className="num">{fmt(m.purchased)}</td><td className="num">{fmt(m.sold)}</td>
          <td className="num">{fmt(m.adj)}</td><td className="num">{fmt(m.balance)}</td><td className="num">{fmt(m.avgCost)}</td><td className="num">{fmt(m.balance * m.avgCost)}</td>
          <td><button className="linkbtn" onClick={() => setSel(m.code)}>流水</button></td></tr>)}</tbody></table></div>
    {sel && <div className="panel"><h3>流水 — {sel}<button className="linkbtn" onClick={() => setSel(null)}>关闭</button></h3>
      {ledger.length ? <table><thead><tr>{['日期', '单号', '类型', '数量'].map((x, i) => <th key={i} className={i === 3 ? 'num' : ''}>{x}</th>)}</tr></thead>
        <tbody>{ledger.map((t, i) => <tr key={i}><td>{t.date}</td><td><span className="code">{t.doc}</span></td><td>{typeLabel(t.type)}</td><td className={'num' + (t.qty < 0 ? ' neg' : '')}>{fmt(t.qty)}</td></tr>)}</tbody></table>
        : <div className="empty">无变动</div>}</div>}
  </div>
}

/* ---------- 利润 ---------- */
function Profit({ D }) {
  const curP = periodRangeOf(currentPeriod())
  const [from, setFrom] = useState(curP.from)
  const [to, setTo] = useState(curP.to)
  const shiftPeriod = (ym, n) => { let [y, m] = ym.split('-').map(Number); m += n; while (m > 12) { m -= 12; y++ } while (m < 1) { m += 12; y-- } return y + '-' + String(m).padStart(2, '0') }
  const setPreset = pr => {
    const cur = currentPeriod()
    if (pr === 'month') { const r = periodRangeOf(cur); setFrom(r.from); setTo(r.to) }
    else if (pr === 'last') { const r = periodRangeOf(shiftPeriod(cur, -1)); setFrom(r.from); setTo(r.to) }
    else if (pr === 'year') { setFrom(new Date().getFullYear() + '-01-01'); setTo(todayISO()) }
  }
  const p = profit(D, from, to)
  const cm = costModel(D)
  const unitCogs = (s, l, idx) => { const u = cm.cogsUnit[s.no]?.[idx]; const it = D.items.find(i => i.code === l.item); return u !== undefined ? u : (it ? it.cost : 0) }
  const byCust = D.customers.map(c => {
    const invs = D.sales.filter(s => s.customer === c.code && (!from || s.date >= from) && (!to || s.date <= to))
    let sales = 0, cogs = 0
    invs.forEach(s => { sales += invoiceTotals(s).rm; s.items.forEach((l, idx) => cogs += unitCogs(s, l, idx) * l.qty) })
    return { name: c.name, sales, profit: sales - cogs }
  }).filter(x => x.sales > 0).sort((a, b) => b.profit - a.profit)
  const byItem = {}
  D.sales.filter(s => (!from || s.date >= from) && (!to || s.date <= to)).forEach(s => s.items.forEach((l, idx) => {
    const it = D.items.find(i => i.code === l.item); if (!it) return
    const line = l.qty * l.price * (1 - (l.disc || 0) / 100) * s.rate
    byItem[it.code] = byItem[it.code] || { name: it.name, sales: 0, profit: 0, qty: 0 }
    byItem[it.code].sales += line; byItem[it.code].profit += line - unitCogs(s, l, idx) * l.qty; byItem[it.code].qty += l.qty
  }))
  const items = Object.values(byItem).sort((a, b) => b.profit - a.profit)
  const Row = (k, v, cls) => <div className="tot"><span className="k">{k}</span><span className={'v ' + (cls || '')}>{v}</span></div>
  return <div>
    <div className="bar">
      <span className="muted">从</span><input type="date" value={from} onChange={e => setFrom(e.target.value)} />
      <span className="muted">到</span><input type="date" value={to} onChange={e => setTo(e.target.value)} />
      <button className="btn ghost sm" onClick={() => setPreset('month')}>本月</button>
      <button className="btn ghost sm" onClick={() => setPreset('last')}>上月</button>
      <button className="btn ghost sm" onClick={() => setPreset('year')}>今年</button>
    </div>
    <div className="grid2">
      <div className="panel"><h3>盈亏</h3><div className="body">
        {Row('销售额', rm(p.sales))}{Row('减：销货成本', '(' + fmt(p.cogs) + ')', 'neg')}{Row('汇兑损益', fmt(p.fx), p.fx >= 0 ? 'pos' : 'neg')}
        <div style={{ borderTop: '1px solid var(--line)', marginTop: 8 }} />{Row('净利', rm(p.net), p.net >= 0 ? 'pos' : 'neg')}</div></div>
      <div className="panel"><h3>利润最高顾客</h3>
        {byCust.length ? <table><tbody>{byCust.slice(0, 8).map((c, i) => <tr key={i}><td>{c.name}</td><td className="num">{rm(c.sales)}</td><td className={'num ' + (c.profit >= 0 ? 'pos' : 'neg')}>{rm(c.profit)}</td></tr>)}</tbody></table> : <div className="empty">暂无数据</div>}</div>
    </div>
    <div className="panel" style={{ marginTop: 16 }}><h3>货品盈利</h3>
      {items.length ? <table><thead><tr>{['货品', '销量', '销售 RM', '利润 RM'].map((x, i) => <th key={i} className={i ? 'num' : ''}>{x}</th>)}</tr></thead>
        <tbody>{items.map((it, i) => <tr key={i}><td>{it.name}</td><td className="num">{fmt(it.qty)}</td><td className="num">{rm(it.sales)}</td><td className={'num ' + (it.profit >= 0 ? 'pos' : 'neg')}>{rm(it.profit)}</td></tr>)}</tbody></table> : <div className="empty">此期间无销售</div>}</div>
  </div>
}

/* ---------- 报表 ---------- */
function Reports({ D, setModal }) {
  const fx = fxGainLoss(D)
  const outstanding = D.sales.map(s => ({ s, paid: invoicePaidRM(D, s.no), total: invoiceTotals(s).rm })).filter(x => x.total - x.paid > 0.01)
  const firstOfMonth = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10) }
  const [from, setFrom] = useState(periodRangeOf(currentPeriod()).from)
  const [to, setTo] = useState(todayISO())
  const inRange = dt => dt >= from && dt <= to
  const rangeSales = D.sales.filter(s => inRange(s.date))
  const rangePurch = D.purchases.filter(p => inRange(p.date))
  const rangePay = D.payments.filter(p => inRange(p.date))
  const salesRM = rangeSales.reduce((s, x) => s + invoiceTotals(x).rm, 0)
  const purchRM = rangePurch.reduce((s, x) => s + purchaseTotals(x).rm, 0)
  const recvRM = rangePay.reduce((s, x) => s + x.amount * x.rate, 0)
  let cogs = 0
  rangeSales.forEach(s => s.items.forEach(l => { const it = D.items.find(x => x.code === l.item); cogs += l.qty * (it ? (it.cost || 0) : 0) }))
  const grossProfit = salesRM - cogs
  const shiftPeriod = (ym, n) => { let [y, m] = ym.split('-').map(Number); m += n; while (m > 12) { m -= 12; y++ } while (m < 1) { m += 12; y-- } return y + '-' + String(m).padStart(2, '0') }
  const setPreset = p => {
    const cur = currentPeriod()
    if (p === 'month') { const r = periodRangeOf(cur); setFrom(r.from); setTo(r.to) }
    else if (p === 'last') { const r = periodRangeOf(shiftPeriod(cur, -1)); setFrom(r.from); setTo(r.to) }
    else if (p === 'year') { const d = new Date(); setFrom(d.getFullYear() + '-01-01'); setTo(todayISO()) }
  }
  const K = (l, v, cls) => <div className="kpi"><div className="l">{l}</div><div className={'v mono ' + (cls || '')}>{v}</div></div>
  return <div>
    <div className="panel" style={{ marginBottom: 16 }}><h3>期间汇总（自订日期）</h3><div className="body">
      <div className="bar">
        <span className="muted">从</span><input type="date" value={from} onChange={e => setFrom(e.target.value)} />
        <span className="muted">到</span><input type="date" value={to} onChange={e => setTo(e.target.value)} />
        <button className="btn ghost sm" onClick={() => setPreset('month')}>本月</button>
        <button className="btn ghost sm" onClick={() => setPreset('last')}>上月</button>
        <button className="btn ghost sm" onClick={() => setPreset('year')}>今年</button>
        <span className="muted" style={{ fontSize: 11 }}>账期：每月16号~次月15号</span>
      </div>
      <div className="kpis" style={{ marginBottom: 0, marginTop: 4 }}>
        {K('销售额 RM', rm(salesRM))}
        {K('采购 RM', rm(purchRM))}
        {K('毛利 RM', rm(grossProfit), grossProfit >= 0 ? 'pos' : 'neg')}
        {K('实收 RM', rm(recvRM))}
      </div>
      <div className="hint" style={{ marginTop: 8 }}>期间内：{rangeSales.length} 张发票 · {rangePurch.length} 张采购 · {rangePay.length} 笔收款。毛利 = 销售额 − 销货成本（按货品成本估算）。</div>
    </div></div>
    <div className="grid2">
      <div className="panel"><h3>未收发票</h3>
        {outstanding.length ? <table><thead><tr>{['发票', '顾客', '合计 RM', '已付', '余额'].map((x, i) => <th key={i} className={i > 1 ? 'num' : ''}>{x}</th>)}</tr></thead>
          <tbody>{outstanding.map((o, i) => <tr key={i}><td><span className="code">{o.s.no}</span></td><td>{cName(D, o.s.customer)}</td><td className="num">{fmt(o.total)}</td><td className="num">{fmt(o.paid)}</td><td className="num neg">{fmt(o.total - o.paid)}</td></tr>)}</tbody></table> : <div className="empty">无未收账款</div>}</div>
      <div className="panel"><h3>汇兑损益</h3>
        {fx.rows.length ? <table><thead><tr>{['日期', '收款', '发票', 'FX RM'].map((x, i) => <th key={i} className={i === 3 ? 'num' : ''}>{x}</th>)}</tr></thead>
          <tbody>{fx.rows.map((r, i) => <tr key={i}><td>{r.date}</td><td><span className="code">{r.payment}</span></td><td><span className="code">{r.invoice}</span></td><td className={'num ' + (r.fx >= 0 ? 'pos' : 'neg')}>{fmt(r.fx)}</td></tr>)}</tbody></table> : <div className="empty">无汇兑差额</div>}</div>
    </div>
    <div className="panel" style={{ marginTop: 16 }}><h3>顾客对账单（应收）</h3>
      <table><thead><tr>{['顾客', '已开票 RM', '已收 RM', '未收', ''].map((x, i) => <th key={i} className={i > 0 && i < 4 ? 'num' : ''}>{x}</th>)}</tr></thead>
        <tbody>{D.customers.map(c => { const b = customerBalance(D, c.code); return <tr key={c.code}><td>{c.name}</td><td className="num">{fmt(b.invoiced)}</td><td className="num">{fmt(b.paid)}</td>
          <td className={'num' + (b.outstanding > 0.01 ? ' neg' : '')}>{fmt(b.outstanding)}</td><td><button className="linkbtn" onClick={() => setModal({ type: 'statement', data: c })}>打开</button></td></tr> })}</tbody></table></div>
    <div className="panel" style={{ marginTop: 16 }}><h3>供应商应付账</h3>
      <table><thead><tr>{['供应商', '采购总额 RM', '已付 RM', '退货 RM', '应付余额'].map((x, i) => <th key={i} className={i > 0 ? 'num' : ''}>{x}</th>)}</tr></thead>
        <tbody>{D.suppliers.map(s => { const b = supplierBalance(D, s.code); return <tr key={s.code}><td>{s.name}</td><td className="num">{fmt(b.billed)}</td><td className="num">{fmt(b.paid)}</td>
          <td className="num">{fmt(b.debit)}</td><td className={'num' + (b.outstanding > 0.01 ? ' neg' : '')}>{fmt(b.outstanding)}</td></tr> })}</tbody></table></div>
    <div className="panel" style={{ marginTop: 16 }}><h3>未付采购单</h3>
      {(() => { const owed = D.purchases.map(p => ({ p, paid: purchasePaidRM(D, p.no), total: purchaseTotals(p).rm })).filter(x => x.total - x.paid > 0.01)
        return owed.length ? <table><thead><tr>{['采购单', '供应商', '合计 RM', '已付', '欠款'].map((x, i) => <th key={i} className={i > 1 ? 'num' : ''}>{x}</th>)}</tr></thead>
          <tbody>{owed.map((o, i) => <tr key={i}><td><span className="code">{o.p.no}</span></td><td>{sName(D, o.p.supplier)}</td><td className="num">{fmt(o.total)}</td><td className="num">{fmt(o.paid)}</td><td className="num neg">{fmt(o.total - o.paid)}</td></tr>)}</tbody></table>
          : <div className="empty">无未付采购单</div> })()}</div>
  </div>
}

/* ---------- 角色权限 ---------- */
function RolesPage({ D, role, flash, logAudit, setModal, reload }) {
  if (role !== '管理员') return <div className="empty">只有「管理员」角色可以管理角色权限。</div>
  const delRole = async r => {
    if (r.locked) return flash('此角色已锁定，不能删除')
    if (r.name === role) return flash('不能删除自己当前使用的角色')
    if (!confirm('删除角色「' + r.name + '」？')) return
    await db.delRole(r.name); await logAudit('删除', '角色', r.name, ''); reload(); flash('角色已删除')
  }
  return <div>
    <div className="bar"><div className="sp" /><button className="btn" onClick={() => setModal({ type: 'role' })}>+ 新增角色</button></div>
    <div className="panel"><table><thead><tr>{['角色', '可访问模块', '', ''].map((x, i) => <th key={i}>{x}</th>)}</tr></thead>
      <tbody>{D.roles.map(r => <tr key={r.name}>
        <td><b>{r.name}</b>{r.locked && <span className="pill ok" style={{ marginLeft: 8 }}>锁定</span>}</td>
        <td><span className="muted">{r.name === '管理员' ? '全部模块' : (r.areas || []).map(areaLabel).join('、') || '—'}</span></td>
        <td><button className="linkbtn" onClick={() => setModal({ type: 'role', data: r })}>{r.locked ? '查看' : '编辑'}</button></td>
        <td>{!r.locked && <button className="linkbtn del" onClick={() => delRole(r)}>删除</button>}</td></tr>)}</tbody></table></div>
    <div className="hint" style={{ marginTop: 12 }}>「管理员」永远拥有全部权限且不能删除。新增模块时管理员会自动获得访问权。</div>
  </div>
}

/* ---------- 操作日志 ---------- */
function AuditPage({ D }) {
  const [q, setQ] = useState('')
  const rows = [...(D.audit || [])].reverse().filter(r => JSON.stringify(r).toLowerCase().includes(q.toLowerCase()))
  const fmtTs = ts => new Date(ts).toLocaleString('zh-Hans', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  const actClass = a => a === '删除' ? 'low' : a === '修改' ? 'partial' : 'ok'
  return <div>
    <div className="bar"><input placeholder="搜索日志（用户 / 动作 / 单号）…" value={q} onChange={e => setQ(e.target.value)} style={{ minWidth: 280 }} /><div className="sp" /><span className="muted">共 {(D.audit || []).length} 条</span></div>
    <div className="panel"><table><thead><tr>{['时间', '登录用户', '角色', '动作', '对象', '单号 / 记录', '详情'].map((x, i) => <th key={i}>{x}</th>)}</tr></thead>
      <tbody>{rows.length ? rows.map((r, i) => <tr key={i}>
        <td><span className="code">{fmtTs(r.ts)}</span></td><td>{r.who}</td><td>{r.role}</td>
        <td><span className={'pill ' + actClass(r.action)}>{r.action}</span></td><td>{r.entity}</td>
        <td><span className="code">{r.ref || '—'}</span></td><td><span className="muted">{r.detail || '—'}</span></td></tr>)
        : <tr><td colSpan={7}><div className="empty">暂无操作记录</div></td></tr>}</tbody></table></div>
    <div className="hint" style={{ marginTop: 12 }}>记录每次新增／修改／删除，含登录用户与时间。登录 IP 可在 Supabase 后台 Authentication 日志查看。</div>
  </div>
}

// 继续见 App.jsx 第 5 段（表单弹窗）

/* =========================================================================
   弹窗表单
   ========================================================================= */
function Modal({ ctx, modal }) {
  const Comp = {
    customer: CustomerForm, supplier: SupplierForm, item: ItemForm, currency: CurrencyForm, role: RoleForm,
    purchase: PurchaseForm, sales: SalesForm, payment: PaymentForm,
    creditNote: CreditNoteForm, debitNote: DebitNoteForm, supplierPayment: SupplierPaymentForm,
    acSupplier: ACSupplierForm, acCustomer: ACCustomerForm, acCard: ACCardForm, acAssign: ACAssignForm,
    acAccount: ACAccountForm, acAssignAcct: ACAssignAcctForm,
    acCompany: ACCompanyForm, acBankAccount: ACBankAccountForm, acAssignCo: ACAssignCoForm,
    acAssignBA: ACAssignBAForm, acReturnBA: ACReturnBAForm,
    acOrder: ACOrderForm, acOrderFill: ACOrderFillForm,
    acFeeList: ACFeeListDoc, acStatement: ACStatementDoc, acSupplierDueList: ACSupplierDueDoc,
    acInitCust: ACInitCustomerDoc, acInitSup: ACInitSupplierDoc,
    acAgent: ACAgentForm, acAgentView: ACAgentViewForm, acAgentSettleForm: ACAgentSettleForm, expense: ExpenseForm, acAgentDue: ACAgentDueDoc,
    acBill: ACBillForm, acReceipt: ACReceiptForm, viewAcBill: ViewACBill, acSettle: ACSettleForm,
    bank: BankForm, viewBank: ViewBank,
    viewPO: ViewPO, viewINV: ViewINV, viewRCPT: ViewRCPT, viewCN: ViewCN, viewDN: ViewDN, viewSPAY: ViewSPAY, statement: Statement,
  }[modal.type]
  return <div className="ov" onMouseDown={e => { if (e.target.className === 'ov') ctx.setModal(null) }}><Comp {...ctx} modal={modal} /></div>
}
function Shell({ title, onClose, children, footer, wide }) {
  return <div className={'modal' + (wide ? ' wide' : '')}>
    <div className="mh"><b>{title}</b><button className="x" onClick={onClose}>×</button></div>
    <div className="mb">{children}</div>
    {footer && <div className="mf">{footer}</div>}
  </div>
}
function nextCode(list, prefix) {
  const nums = list.map(x => parseInt((x.code || '').replace(prefix, '')) || 0)
  return prefix + String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, '0')
}

function LineItems({ D, lines, setLines, mode }) {
  const pf = mode === 'cost' ? 'cost' : 'price'
  const add = () => setLines([...lines, { item: D.items[0]?.code || '', qty: 1, [pf]: mode === 'cost' ? (D.items[0]?.cost || 0) : (D.items[0]?.sell || 0), disc: 0 }])
  const upd = (i, k, v) => { const l = [...lines]; l[i] = { ...l[i], [k]: v }; if (k === 'item') { const it = D.items.find(x => x.code === v); if (it) l[i][pf] = mode === 'cost' ? it.cost : it.sell } setLines(l) }
  const del = i => setLines(lines.filter((_, j) => j !== i))
  return <div>
    <table className="lineitems"><thead><tr>{['货品', '数量', mode === 'cost' ? '单位成本' : '单价', '折扣 %', '小计', ''].map((x, i) => <th key={i} className={i > 0 && i < 5 ? 'num' : ''}>{x}</th>)}</tr></thead>
      <tbody>{lines.map((l, i) => { const sub = l.qty * (l[pf] || 0) * (1 - (l.disc || 0) / 100)
        return <tr key={i}>
          <td><select value={l.item} onChange={e => upd(i, 'item', e.target.value)}>{D.items.map(it => <option key={it.code} value={it.code}>{it.code} — {it.name}</option>)}</select></td>
          <td style={{ width: 70 }}><input type="number" value={l.qty} onChange={e => upd(i, 'qty', +e.target.value)} /></td>
          <td style={{ width: 100 }}><input type="number" value={l[pf]} onChange={e => upd(i, pf, +e.target.value)} /></td>
          <td style={{ width: 70 }}><input type="number" value={l.disc} onChange={e => upd(i, 'disc', +e.target.value)} /></td>
          <td className="num">{fmt(sub)}</td><td><button className="linkbtn del" onClick={() => del(i)}>✕</button></td></tr> })}</tbody></table>
    <button className="btn ghost sm" style={{ marginTop: 8 }} onClick={add}>+ 添加明细</button>
  </div>
}

/* ---- 顾客 ---- */
function CustomerForm({ D, setModal, flash, logAudit, reload, modal }) {
  const d = modal.data
  const [f, setF] = useState(d || { code: nextCode(D.customers, 'SP'), name: '', company: '', phone: '', email: '', address: '', credit: 0, term: 30, ccy: 'MYR', status: '启用' })
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))
  const submit = async () => {
    if (!f.code) return flash('请填写顾客编码')
    if (!f.name) return flash('请填写名称')
    if (!d && D.customers.some(x => x.code === f.code)) return flash('编码已存在，请换一个')
    const { error } = await db.saveCustomer(f); if (error) return flash('保存失败：' + error.message)
    await logAudit(d ? '修改' : '新增', '顾客', f.code, f.name); reload(); setModal(null); flash(d ? '顾客已更新' : '顾客已新增')
  }
  return <Shell title={d ? '编辑顾客' : '新增顾客'} onClose={() => setModal(null)} footer={[<button key={1} className="btn ghost" onClick={() => setModal(null)}>取消</button>, <button key={2} className="btn" onClick={submit}>保存</button>]}>
    <div className="fg"><Field label="顾客编码（可自定义）"><input value={f.code} disabled={!!d} placeholder="例如 SP001 或 自己的编号" onChange={e => set('code', e.target.value.trim())} /></Field><Field label="状态"><select value={f.status} onChange={e => set('status', e.target.value)}>{['启用', '停用'].map(x => <option key={x}>{x}</option>)}</select></Field></div>
    <Field label="顾客名称"><input value={f.name} onChange={e => set('name', e.target.value)} /></Field>
    <Field label="公司"><input value={f.company} onChange={e => set('company', e.target.value)} /></Field>
    <div className="fg"><Field label="电话"><input value={f.phone} onChange={e => set('phone', e.target.value)} /></Field><Field label="邮箱"><input value={f.email} onChange={e => set('email', e.target.value)} /></Field></div>
    <Field label="地址"><input value={f.address} onChange={e => set('address', e.target.value)} /></Field>
    <div className="fg3"><Field label="信用额度"><input type="number" value={f.credit} onChange={e => set('credit', +e.target.value)} /></Field>
      <Field label="付款期（天）"><input type="number" value={f.term} onChange={e => set('term', +e.target.value)} /></Field>
      <Field label="默认货币"><select value={f.ccy} onChange={e => set('ccy', e.target.value)}>{D.currencies.map(c => <option key={c.code}>{c.code}</option>)}</select></Field></div>
  </Shell>
}

/* ---- 供应商 ---- */
function SupplierForm({ D, setModal, flash, logAudit, reload, modal }) {
  const d = modal.data
  const [f, setF] = useState(d || { code: nextCode(D.suppliers, 'SUP'), name: '', phone: '', email: '', address: '', ccy: 'MYR' })
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))
  const submit = async () => {
    if (!f.code) return flash('请填写供应商编码')
    if (!f.name) return flash('请填写名称')
    if (!d && D.suppliers.some(x => x.code === f.code)) return flash('编码已存在，请换一个')
    const { error } = await db.saveSupplier(f); if (error) return flash('保存失败：' + error.message)
    await logAudit(d ? '修改' : '新增', '供应商', f.code, f.name); reload(); setModal(null); flash(d ? '供应商已更新' : '供应商已新增')
  }
  return <Shell title={d ? '编辑供应商' : '新增供应商'} onClose={() => setModal(null)} footer={[<button key={1} className="btn ghost" onClick={() => setModal(null)}>取消</button>, <button key={2} className="btn" onClick={submit}>保存</button>]}>
    <div className="fg"><Field label="供应商编码（可自定义）"><input value={f.code} disabled={!!d} placeholder="例如 SUP001 或 自己的编号" onChange={e => set('code', e.target.value.trim())} /></Field><Field label="默认货币"><select value={f.ccy} onChange={e => set('ccy', e.target.value)}>{D.currencies.map(c => <option key={c.code}>{c.code}</option>)}</select></Field></div>
    <Field label="供应商名称"><input value={f.name} onChange={e => set('name', e.target.value)} /></Field>
    <div className="fg"><Field label="电话"><input value={f.phone} onChange={e => set('phone', e.target.value)} /></Field><Field label="邮箱"><input value={f.email} onChange={e => set('email', e.target.value)} /></Field></div>
    <Field label="地址"><input value={f.address} onChange={e => set('address', e.target.value)} /></Field>
  </Shell>
}

/* ---- 货品 ---- */
function ItemForm({ D, setModal, flash, logAudit, reload, modal }) {
  const d = modal.data
  const [f, setF] = useState(d || { code: '', name: '', category: '', unit: 'pcs', minStock: 0, sell: 0, cost: 0, status: '启用', opening: 0 })
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))
  const submit = async () => {
    if (!f.code || !f.name) return flash('请填写编码与名称')
    if (!d && D.items.some(x => x.code === f.code)) return flash('编码已存在')
    const { error } = await db.saveItem(f); if (error) return flash('保存失败：' + error.message)
    await logAudit(d ? '修改' : '新增', '货品', f.code, f.name); reload(); setModal(null); flash(d ? '货品已更新' : '货品已新增')
  }
  return <Shell title={d ? '编辑货品' : '新增货品'} onClose={() => setModal(null)} footer={[<button key={1} className="btn ghost" onClick={() => setModal(null)}>取消</button>, <button key={2} className="btn" onClick={submit}>保存</button>]}>
    <div className="fg"><Field label="货品编码"><input value={f.code} disabled={!!d} placeholder="WS001" onChange={e => set('code', e.target.value.toUpperCase())} /></Field><Field label="类别"><input value={f.category} onChange={e => set('category', e.target.value)} /></Field></div>
    <Field label="货品名称"><input value={f.name} onChange={e => set('name', e.target.value)} /></Field>
    <div className="fg3"><Field label="单位"><input value={f.unit} onChange={e => set('unit', e.target.value)} /></Field>
      <Field label="基础成本 (RM)"><input type="number" value={f.cost} onChange={e => set('cost', +e.target.value)} /></Field>
      <Field label="售价 (RM)"><input type="number" value={f.sell} onChange={e => set('sell', +e.target.value)} /></Field></div>
    <div className="fg"><Field label="最低库存"><input type="number" value={f.minStock} onChange={e => set('minStock', +e.target.value)} /></Field>
      <Field label="期初数量"><input type="number" value={f.opening} disabled={!!d} onChange={e => set('opening', +e.target.value)} /></Field></div>
  </Shell>
}

/* ---- 货币 ---- */
function CurrencyForm({ D, setModal, flash, logAudit, reload, modal }) {
  const d = modal.data
  const [f, setF] = useState(d || { code: '', rate: 0, date: todayISO() })
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))
  const submit = async () => {
    if (!f.code || !f.rate) return flash('请填写编码与汇率')
    const { error } = await db.saveCurrency(f); if (error) return flash('保存失败：' + error.message)
    await logAudit(d ? '修改' : '新增', '货币', f.code, `汇率 ${fmtRate(f.rate)}`); reload(); setModal(null); flash('汇率已保存')
  }
  return <Shell title={d ? '更新汇率' : '新增货币'} onClose={() => setModal(null)} footer={[<button key={1} className="btn ghost" onClick={() => setModal(null)}>取消</button>, <button key={2} className="btn" onClick={submit}>保存</button>]}>
    <Field label="货币编码"><input value={f.code} disabled={!!d} placeholder="USD" onChange={e => set('code', e.target.value.toUpperCase())} /></Field>
    <div className="fg"><Field label="汇率 → MYR"><input type="number" step="0.0001" value={f.rate} onChange={e => set('rate', +e.target.value)} /></Field>
      <Field label="生效日期"><input type="date" value={f.date} onChange={e => set('date', e.target.value)} /></Field></div>
    <div className="hint">{`1 ${f.code || "XXX"} = ${fmtRate(f.rate)} MYR`}</div>
  </Shell>
}

/* ---- 角色 ---- */
function RoleForm({ D, setModal, flash, logAudit, reload, modal }) {
  const d = modal.data, locked = d && d.locked
  const [name, setName] = useState(d ? d.name : '')
  const [areas, setAreas] = useState(d ? [...(d.areas || [])] : ['dash'])
  const toggle = k => setAreas(a => a.includes(k) ? a.filter(x => x !== k) : [...a, k])
  const submit = async () => {
    if (locked) return setModal(null)
    const nm = name.trim()
    if (!nm) return flash('请填写角色名称')
    if (!d && D.roles.some(r => r.name === nm)) return flash('角色名称已存在')
    if (!areas.length) return flash('至少选择一个可访问模块')
    // 改名时先删旧行（主键是 name）
    if (d && nm !== d.name) await db.delRole(d.name)
    const { error } = await db.saveRole({ name: nm, locked: false, areas })
    if (error) return flash('保存失败：' + error.message)
    await logAudit(d ? '修改' : '新增', '角色', nm, '模块：' + areas.map(areaLabel).join('、')); reload(); setModal(null); flash(d ? '角色已更新' : '角色已新增')
  }
  return <Shell title={locked ? ('角色 — ' + d.name) : (d ? '编辑角色' : '新增角色')} onClose={() => setModal(null)}
    footer={[<button key={1} className="btn ghost" onClick={() => setModal(null)}>取消</button>, !locked && <button key={2} className="btn" onClick={submit}>保存</button>]}>
    {locked && <div className="rateline">「管理员」为系统锁定角色，拥有全部权限，不可修改。</div>}
    <Field label="角色名称"><input value={name} disabled={locked} placeholder="例如：仓管、审计" onChange={e => setName(e.target.value)} /></Field>
    <div className="fld"><label>可访问模块</label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 14px', marginTop: 4 }}>
        {ALL_AREAS.map(a => <label key={a.k} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 400 }}>
          <input type="checkbox" disabled={locked} checked={locked ? true : areas.includes(a.k)} onChange={() => !locked && toggle(a.k)} style={{ width: 'auto' }} />{a.label}</label>)}</div></div>
  </Shell>
}

// 继续见 App.jsx 第 6 段（采购/销售/收款表单 + 查看单据）

/* ---- 采购表单 ---- */
function PurchaseForm({ D, setModal, flash, logAudit, reload, modal }) {
  const ed = modal.data
  const [supplier, setSupplier] = useState(ed ? ed.supplier : (D.suppliers[0]?.code || ''))
  const sup = D.suppliers.find(s => s.code === supplier)
  const [ccy, setCcy] = useState(ed ? ed.ccy : (sup?.ccy || 'MYR'))
  const [rate, setRate] = useState(ed ? ed.rate : rateOf(D.currencies, ccy))
  const [date, setDate] = useState(ed ? ed.date : todayISO())
  const [lines, setLines] = useState(ed ? ed.items.map(l => ({ ...l })) : [{ item: D.items[0]?.code || '', qty: 1, cost: D.items[0]?.cost || 0, disc: 0 }])
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (!ed) setRate(rateOf(D.currencies, ccy)) }, [ccy])
  const amt = lines.reduce((s, l) => s + l.qty * l.cost * (1 - (l.disc || 0) / 100), 0)
  const submit = async () => {
    if (!supplier || !lines.length) return flash('请选择供应商并添加明细')
    setBusy(true)
    const no = ed ? ed.no : await nextNo('PO')
    await db.savePurchase({ no, supplier, date, ccy, rate, items: lines }, !!ed)
    await logAudit(ed ? '修改' : '新增', '采购', no, `${ccy} ${fmt(amt)} · 合计 ${rm(amt * rate)}`)
    reload(); setBusy(false); setModal(null); flash(ed ? '采购已更新 · 库存已重算' : '采购已保存 · 库存已增加')
  }
  return <Shell wide title={ed ? '编辑采购 — ' + ed.no : '新增采购'} onClose={() => setModal(null)}
    footer={[<button key={1} className="btn ghost" onClick={() => setModal(null)}>取消</button>, <button key={2} className="btn" disabled={busy} onClick={submit}>{busy ? '保存中…' : (ed ? '更新采购' : '保存采购')}</button>]}>
    <div className="fg3"><Field label="供应商"><select value={supplier} onChange={e => { setSupplier(e.target.value); const s = D.suppliers.find(x => x.code === e.target.value); if (s) setCcy(s.ccy) }}>{D.suppliers.map(s => <option key={s.code} value={s.code}>{s.name}</option>)}</select></Field>
      <Field label="日期"><input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
      <Field label="货币"><select value={ccy} onChange={e => setCcy(e.target.value)}>{D.currencies.map(c => <option key={c.code}>{c.code}</option>)}</select></Field></div>
    <div className="rateline">{`汇率：1 ${ccy} = ${fmtRate(rate)} MYR  ·  可修改 →`}<input type="number" step="0.0001" value={rate} onChange={e => setRate(+e.target.value)} style={{ width: 110, marginLeft: 10 }} /></div>
    <LineItems D={D} lines={lines} setLines={setLines} mode="cost" />
    <div className="tot"><span className="k">{`金额 (${ccy})`}</span><span className="v">{fmt(amt)}</span></div>
    <div className="tot"><span className="k">合计 RM</span><span className="v">{fmt(amt * rate)}</span></div>
  </Shell>
}

/* ---- 销售表单 ---- */
function SalesForm({ D, setModal, flash, logAudit, reload, modal }) {
  const ed = modal.data
  const inv = computeInventory(D)
  const [customer, setCustomer] = useState(ed ? ed.customer : (D.customers[0]?.code || ''))
  const cust = D.customers.find(c => c.code === customer)
  const [ccy, setCcy] = useState(ed ? ed.ccy : (cust?.ccy || 'MYR'))
  const [rate, setRate] = useState(ed ? ed.rate : rateOf(D.currencies, ccy))
  const [date, setDate] = useState(ed ? ed.date : todayISO())
  const [lines, setLines] = useState(ed ? ed.items.map(l => ({ ...l })) : [{ item: D.items[0]?.code || '', qty: 1, price: D.items[0]?.sell || 0, disc: 0 }])
  const [foreignOnly, setForeignOnly] = useState(ed ? !!ed.foreignOnly : false)
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (!ed) setRate(rateOf(D.currencies, ccy)) }, [ccy])
  const amt = lines.reduce((s, l) => s + l.qty * l.price * (1 - (l.disc || 0) / 100), 0)
  const paidRM = ed ? invoicePaidRM(D, ed.no) : 0
  const stockWarn = lines.filter(l => { const bal = (inv[l.item]?.balance || 0) + (ed ? ed.items.filter(x => x.item === l.item).reduce((s, x) => s + x.qty, 0) : 0); return bal < l.qty })
  const submit = async () => {
    if (!customer || !lines.length) return flash('请选择顾客并添加明细')
    if (ed && paidRM > amt * rate + 0.01) return flash('新发票金额低于已收金额 — 请先调整收款单')
    setBusy(true)
    const no = ed ? ed.no : await nextNo('INV')
    await db.saveSale({ no, customer, date, ccy, rate: foreignOnly ? 1 : rate, items: lines, foreignOnly }, !!ed)
    await logAudit(ed ? '修改' : '新增', '销售发票', no, `${cName(D, customer)} · ${ccy} ${fmt(amt)}`)
    reload(); setBusy(false); setModal(null); flash(ed ? '发票已更新 · 库存已重算' : '发票已保存 · 库存已扣减')
  }
  return <Shell wide title={ed ? '编辑发票 — ' + ed.no : '新增销售发票'} onClose={() => setModal(null)}
    footer={[<button key={1} className="btn ghost" onClick={() => setModal(null)}>取消</button>, <button key={2} className="btn" disabled={busy} onClick={submit}>{busy ? '保存中…' : (ed ? '更新发票' : '保存发票')}</button>]}>
    <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
      <button className={'btn ' + (foreignOnly ? 'ghost' : '')} style={{ flex: 1 }} onClick={() => setForeignOnly(false)}>标准发票（含 RM 换算）</button>
      <button className={'btn ' + (foreignOnly ? '' : 'ghost')} style={{ flex: 1 }} onClick={() => setForeignOnly(true)}>纯外币发票（不显示 RM）</button>
    </div>
    <div className="fg3"><Field label="顾客"><select value={customer} onChange={e => { setCustomer(e.target.value); const c = D.customers.find(x => x.code === e.target.value); if (c) setCcy(c.ccy) }}>{D.customers.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}</select></Field>
      <Field label="日期"><input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
      <Field label="货币"><select value={ccy} onChange={e => setCcy(e.target.value)}>{D.currencies.map(c => <option key={c.code}>{c.code}</option>)}</select></Field></div>
    {!foreignOnly && <div className="rateline">{`发票汇率：1 ${ccy} = ${fmtRate(rate)} MYR  ·  可修改 →`}<input type="number" step="0.0001" value={rate} onChange={e => setRate(+e.target.value)} style={{ width: 110, marginLeft: 10 }} /></div>}
    {foreignOnly && <div className="rateline">纯外币发票：收据只显示 {ccy}，不出现汇率和马币换算</div>}
    <LineItems D={D} lines={lines} setLines={setLines} mode="price" />
    {stockWarn.length > 0 && <div className="hint" style={{ color: 'var(--danger)' }}>⚠ 库存不足：{stockWarn.map(l => l.item).join('、')}（销售后结存将为负）</div>}
    <div className="tot"><span className="k">{`金额 (${ccy})`}</span><span className="v">{fmt(amt)}</span></div>
    {!foreignOnly && <div className="tot"><span className="k">发票 RM</span><span className="v">{fmt(amt * rate)}</span></div>}
  </Shell>
}

/* ---- 收款表单 ---- */
function PaymentForm({ D, setModal, flash, logAudit, reload, modal }) {
  const ed = modal.data
  const [customer, setCustomer] = useState(ed ? ed.customer : (D.customers[0]?.code || ''))
  const paidExcl = invNo => { let p = 0; D.payments.forEach(pm => { if (ed && pm.no === ed.no) return; (pm.allocs || []).forEach(a => { if (a.invoice === invNo) p += a.rm }) }); return p }
  const open = D.sales.filter(s => s.customer === customer).map(s => ({ s, total: invoiceTotals(s).rm, paid: paidExcl(s.no) }))
    .filter(x => x.total - x.paid > 0.01 || (ed && (ed.allocs || []).some(a => a.invoice === x.s.no)))
  const cust = D.customers.find(c => c.code === customer)
  const [ccy, setCcy] = useState(ed ? ed.ccy : (cust?.ccy || 'MYR'))
  const [rate, setRate] = useState(ed ? ed.rate : rateOf(D.currencies, ccy))
  const [amount, setAmount] = useState(ed ? ed.amount : 0)
  const [date, setDate] = useState(ed ? ed.date : todayISO())
  const [alloc, setAlloc] = useState(ed ? Object.fromEntries((ed.allocs || []).map(a => [a.invoice, a.rm])) : {})
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (!ed) setRate(rateOf(D.currencies, ccy)) }, [ccy])
  useEffect(() => { if (!ed) setAlloc({}) }, [customer])
  const paymentRM = amount * rate
  const allocated = Object.values(alloc).reduce((s, v) => s + (+v || 0), 0)
  const autoAllocate = () => { let left = paymentRM; const a = {}; open.forEach(o => { const due = o.total - o.paid; const take = Math.min(due, left); if (take > 0.001) { a[o.s.no] = +take.toFixed(2); left -= take } }); setAlloc(a) }
  const submit = async () => {
    if (!customer || amount <= 0) return flash('请输入金额')
    if (allocated > paymentRM + 0.01) return flash('分配超过付款金额')
    setBusy(true)
    const no = ed ? ed.no : await nextNo('RCPT')
    const allocs = Object.entries(alloc).filter(([_, v]) => +v > 0).map(([invoice, rmv]) => ({ invoice, rm: +(+rmv).toFixed(2), fx: 0 }))
    const diff = +(paymentRM - allocs.reduce((s, a) => s + a.rm, 0)).toFixed(2)
    if (allocs.length && Math.abs(diff) > 0.001) allocs[0].fx = diff
    await db.savePayment({ no, customer, date, ccy, rate, amount: +amount, allocs })
    await logAudit(ed ? '修改' : '新增', '收款', no, `${cName(D, customer)} · ${ccy} ${fmt(+amount)}`)
    reload(); setBusy(false); setModal(null); flash(ed ? '收款已更新' : '收款已保存')
  }
  return <Shell wide title={ed ? '编辑收款 — ' + ed.no : '新增顾客还款'} onClose={() => setModal(null)}
    footer={[<button key={1} className="btn ghost" onClick={() => setModal(null)}>取消</button>, <button key={2} className="btn" disabled={busy} onClick={submit}>{busy ? '保存中…' : (ed ? '更新收款' : '保存收款')}</button>]}>
    <div className="fg3"><Field label="顾客"><select value={customer} onChange={e => { setCustomer(e.target.value); const c = D.customers.find(x => x.code === e.target.value); if (c) setCcy(c.ccy) }}>{D.customers.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}</select></Field>
      <Field label="日期"><input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
      <Field label="付款货币"><select value={ccy} onChange={e => setCcy(e.target.value)}>{D.currencies.map(c => <option key={c.code}>{c.code}</option>)}</select></Field></div>
    <div className="fg"><Field label={'付款金额 (' + ccy + ')'}><input type="number" value={amount} onChange={e => setAmount(+e.target.value)} /></Field>
      <Field label="付款汇率 → MYR"><input type="number" step="0.0001" value={rate} onChange={e => setRate(+e.target.value)} /></Field></div>
    <div className="rateline">{`付款 RM = ${fmt(paymentRM)}   ·   已分配 = ${fmt(allocated)}   ·   未分配 = ${fmt(paymentRM - allocated)}`}</div>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}><b style={{ fontSize: 13 }}>冲抵未收发票（RM）</b><button className="btn ghost sm" onClick={autoAllocate}>自动分配</button></div>
    {open.length ? <table className="lineitems"><thead><tr>{['发票', '货币', '发票 RM', '已付', '余额', '冲抵 RM'].map((x, i) => <th key={i} className={i > 1 ? 'num' : ''}>{x}</th>)}</tr></thead>
      <tbody>{open.map(o => <tr key={o.s.no}><td><span className="code">{o.s.no}</span></td><td>{o.s.ccy}</td><td className="num">{fmt(o.total)}</td><td className="num">{fmt(o.paid)}</td><td className="num">{fmt(o.total - o.paid)}</td>
        <td style={{ width: 120 }}><input type="number" value={alloc[o.s.no] || ''} placeholder="0.00" onChange={e => setAlloc(a => ({ ...a, [o.s.no]: e.target.value }))} /></td></tr>)}</tbody></table>
      : <div className="empty">此顾客无未收发票</div>}
    <div className="hint" style={{ marginTop: 10 }}>付款 RM 与总冲抵 RM 的差额将记为汇兑损益（见报表）。</div>
  </Shell>
}

/* ---- 查看单据 ---- */
function ViewPO({ D, setModal, flash, logAudit, reload, can, modal }) {
  const po = modal.data, t = purchaseTotals(po)
  const del = async () => { if (!confirm('删除采购 ' + po.no + '？库存将相应减少。')) return; await db.delPurchase(po.no); await logAudit('删除', '采购', po.no, `合计 ${rm(t.rm)}`); reload(); setModal(null); flash('采购已删除 · 库存已重算') }
  const editable = can('purchase')
  return <Shell title={'采购 — ' + po.no} onClose={() => setModal(null)}
    footer={editable && [<button key={0} className="btn danger" onClick={del}>删除</button>, <div key={1} style={{ flex: 1 }} />, <button key={2} className="btn ghost" onClick={() => setModal(null)}>关闭</button>, <button key={3} className="btn" onClick={() => setModal({ type: 'purchase', data: po })}>编辑</button>]}>
    <div className="fg"><div><div className="hint">供应商</div><b>{sName(D, po.supplier)}</b></div><div><div className="hint">日期 · 货币</div><b>{`${po.date} · ${po.ccy} @ ${fmt(po.rate)}`}</b></div></div>
    <table style={{ marginTop: 8 }}><thead><tr>{['货品', '数量', '成本', '折扣%', '小计'].map((x, i) => <th key={i} className={i ? 'num' : ''}>{x}</th>)}</tr></thead>
      <tbody>{po.items.map((l, i) => <tr key={i}><td>{itemName(D, l.item)}</td><td className="num">{fmt(l.qty)}</td><td className="num">{fmt(l.cost)}</td><td className="num">{fmt(l.disc || 0)}</td><td className="num">{fmt(l.qty * l.cost * (1 - (l.disc || 0) / 100))}</td></tr>)}</tbody></table>
    <div className="tot"><span className="k">{`金额 (${po.ccy})`}</span><span className="v">{fmt(t.amt)}</span></div>
    <div className="tot"><span className="k">合计 RM</span><span className="v">{fmt(t.rm)}</span></div>
  </Shell>
}
/* ============================================================
   公司抬头信息 —— 打印单据时显示在顶部。以后改这里就行。
   ============================================================ */
const COMPANY = {
  name: '至尊萬象閣',
  sub: 'SP 管理系统',
  regNo: '',            // SSM 注册号，例如 'SSM 202401234567'
  address: '',          // 地址
  phone: '',            // 电话
  email: '',            // 邮箱
}

/* 生成发票打印页（新窗口 → 可打印 / 存 PDF）*/
function printInvoice(D, s) {
  const t = invoiceTotals(s)
  const paid = invoicePaidRM(D, s.no)
  const cust = D.customers.find(c => c.code === s.customer) || {}
  const statusZh = { Open: '未收', Partial: '部分', Paid: '已付' }[invoiceStatus(D, s)] || ''
  const rows = s.items.map(l => {
    const it = D.items.find(i => i.code === l.item)
    const sub = l.qty * l.price * (1 - (l.disc || 0) / 100)
    return `<tr>
      <td>${l.item}</td>
      <td>${it ? it.name : ''}</td>
      <td class="n">${fmt(l.qty)}</td>
      <td class="n">${fmt(l.price)}</td>
      <td class="n">${fmt(l.disc || 0)}%</td>
      <td class="n">${fmt(sub)}</td></tr>`
  }).join('')
  const companyLines = [
    COMPANY.regNo, COMPANY.address, COMPANY.phone && ('电话：' + COMPANY.phone), COMPANY.email && ('邮箱：' + COMPANY.email)
  ].filter(Boolean).map(x => `<div>${x}</div>`).join('')

  const html = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>发票 ${s.no}</title>
  <style>
    *{box-sizing:border-box}
    body{font-family:"PingFang SC","Microsoft YaHei",sans-serif;color:#1a1a1a;margin:0;padding:20px;font-size:12px}
    .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #1f6f5c;padding-bottom:12px}
    .title{text-align:left}
    .title h2{margin:0;font-size:24px;letter-spacing:2px;color:#1f6f5c;font-weight:800}
    .title .no{margin-top:5px;font-family:monospace;font-size:13px;color:#444}
    .title .meta{margin-top:6px;color:#444;font-size:10.5px;line-height:1.5}
    .hd-right{text-align:right;font-size:12px;color:#333;margin-top:-2px}
    .hd-date{font-size:14px;font-weight:600}
    .st{display:inline-block;padding:2px 12px;border-radius:99px;font-size:12px;background:#e6f0ec;color:#1f6f5c}
    .lbl{color:#888;font-size:10px}
    .bill{display:flex;justify-content:space-between;margin:14px 0}
    .bill .box{font-size:11px;line-height:1.6}
    .bill .lbl{color:#888;font-size:10px}
    table{width:100%;border-collapse:collapse;margin-top:6px}
    th{background:#f4f2ec;text-align:left;padding:7px 8px;font-size:10px;color:#555;border-bottom:2px solid #ddd}
    td{padding:7px 8px;border-bottom:1px solid #eee;font-size:11px}
    .n{text-align:right;font-family:monospace}
    .sum{margin-top:12px;margin-left:auto;width:240px;font-size:12px}
    .sum .r{display:flex;justify-content:space-between;padding:4px 0}
    .sum .r.big{border-top:2px solid #1f6f5c;margin-top:5px;padding-top:8px;font-size:15px;font-weight:700;color:#1f6f5c}
    .sum .v{font-family:monospace}
    .foot{margin-top:32px;display:flex;justify-content:space-between;color:#888;font-size:10px}
    .sign{margin-top:40px;text-align:center;width:180px}
    .sign .line{border-top:1px solid #333;padding-top:6px}
    @media print{body{padding:0}.noprint{display:none}}
    @page{size:A5 landscape;margin:10mm}
    body{max-width:210mm;margin:0 auto}
    .noprint{margin-top:24px;text-align:center}
    .btn{background:#1f6f5c;color:#fff;border:0;padding:10px 22px;border-radius:8px;font-size:14px;cursor:pointer;margin:0 6px}
    .btn.g{background:#eee;color:#333}
    .wm{position:fixed;top:42%;left:50%;transform:translate(-50%,-50%);width:60%;max-width:360px;opacity:.28;z-index:0;pointer-events:none;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    body>*:not(.wm){position:relative;z-index:1}
  </style></head><body>
    <div class="head">
      <div class="title"><h2>发票 INVOICE</h2><div class="no">${s.no}</div>${companyLines ? `<div class="meta">${companyLines}</div>` : ''}</div>
      <div class="hd-right">
        <div class="st">${statusZh}</div>
        <div class="lbl" style="margin-top:8px">日期 DATE</div><div class="hd-date">${s.date}</div>
      </div>
    </div>
    <div class="bill">
      <div class="box"><div class="lbl">客户 BILL TO</div><b>${cust.name || s.customer}</b><br>${cust.company || ''}<br>${cust.address || ''}<br>${cust.phone || ''}</div>
      ${s.foreignOnly ? `<div class="box" style="text-align:right"><div class="lbl">货币 CURRENCY</div>${s.ccy}</div>` : `<div class="box" style="text-align:right"><div class="lbl">货币 · 汇率</div>${s.ccy} @ ${fmtRate(s.rate)}</div>`}
    </div>
    <img class="wm" src="${location.origin}/logo.png" onerror="this.style.display='none'"/>
    <table><thead><tr><th>编码</th><th>货品</th><th class="n">数量</th><th class="n">单价</th><th class="n">折扣</th><th class="n">小计</th></tr></thead>
      <tbody>${rows}</tbody></table>
    ${s.foreignOnly ? `<div class="sum">
      <div class="r big"><span>总计 ${s.ccy}</span><span class="v">${fmt(t.amt)}</span></div>
    </div>` : `<div class="sum">
      <div class="r"><span>金额 (${s.ccy})</span><span class="v">${fmt(t.amt)}</span></div>
      <div class="r"><span>汇率</span><span class="v">${fmtRate(s.rate)}</span></div>
      <div class="r big"><span>应付 RM</span><span class="v">${fmt(t.rm)}</span></div>
      <div class="r"><span>已付 RM</span><span class="v">${fmt(paid)}</span></div>
      <div class="r"><span>余额 RM</span><span class="v">${fmt(t.rm - paid)}</span></div>
    </div>`}
    <div class="foot">
      <div>感谢惠顾 · Thank you for your business</div>
    </div>
    <div class="noprint">
      <button class="btn" onclick="window.print()">🖨 打印 / 存为 PDF</button>
    </div>
  </body></html>`

  // 手机浏览器会拦隐藏 iframe 的自动打印，改成可见的全屏预览 + 按钮
  const isMobile = window.matchMedia('(max-width:820px)').matches || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  const old = document.getElementById('tms-print-frame')
  if (old) old.remove()
  const oldWrap = document.getElementById('tms-print-wrap')
  if (oldWrap) oldWrap.remove()

  if (isMobile) {
    // 全屏浮层，里面用 iframe 显示发票，顶部有 打印 / 关闭 按钮
    const wrap = document.createElement('div')
    wrap.id = 'tms-print-wrap'
    wrap.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#fff;display:flex;flex-direction:column'
    const bar = document.createElement('div')
    bar.style.cssText = 'display:flex;gap:10px;padding:12px;background:#0b2b23;flex-shrink:0'
    const mkBtn = (label, bg) => { const b = document.createElement('button'); b.textContent = label; b.style.cssText = `flex:1;padding:14px;font-size:16px;font-weight:600;border:0;border-radius:8px;color:#fff;background:${bg}`; return b }
    const printBtn = mkBtn('🖨 打印 / 存 PDF', '#a8801f')
    const closeBtn = mkBtn('关闭', '#3a4a44')
    bar.appendChild(printBtn); bar.appendChild(closeBtn)
    const frame = document.createElement('iframe')
    frame.style.cssText = 'flex:1;width:100%;border:0'
    wrap.appendChild(bar); wrap.appendChild(frame)
    document.body.appendChild(wrap)
    const fdoc = frame.contentWindow.document
    fdoc.open(); fdoc.write(html); fdoc.close()
    printBtn.onclick = () => { try { frame.contentWindow.focus(); frame.contentWindow.print() } catch (e) { alert('打印出错：' + e.message) } }
    closeBtn.onclick = () => wrap.remove()
    return
  }

  // 桌面：隐藏 iframe 直接打印
  const iframe = document.createElement('iframe')
  iframe.id = 'tms-print-frame'
  iframe.style.position = 'fixed'
  iframe.style.right = '0'
  iframe.style.bottom = '0'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.border = '0'
  document.body.appendChild(iframe)
  const doc = iframe.contentWindow.document
  doc.open()
  doc.write(html)
  doc.close()
  iframe.onload = () => {
    setTimeout(() => {
      try { iframe.contentWindow.focus(); iframe.contentWindow.print() }
      catch (e) { alert('打印出错：' + e.message) }
    }, 300)
  }
}

// 共用打印机制：手机全屏预览，桌面直接打印
function renderPrint(html) {
  const isMobile = window.matchMedia('(max-width:820px)').matches || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  const old = document.getElementById('tms-print-frame'); if (old) old.remove()
  const oldWrap = document.getElementById('tms-print-wrap'); if (oldWrap) oldWrap.remove()
  if (isMobile) {
    const wrap = document.createElement('div'); wrap.id = 'tms-print-wrap'
    wrap.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#fff;display:flex;flex-direction:column'
    const bar = document.createElement('div'); bar.style.cssText = 'display:flex;gap:10px;padding:12px;background:#0b2b23;flex-shrink:0'
    const mkBtn = (label, bg) => { const b = document.createElement('button'); b.textContent = label; b.style.cssText = `flex:1;padding:14px;font-size:16px;font-weight:600;border:0;border-radius:8px;color:#fff;background:${bg}`; return b }
    const printBtn = mkBtn('🖨 打印 / 存 PDF', '#a8801f'), closeBtn = mkBtn('关闭', '#3a4a44')
    bar.appendChild(printBtn); bar.appendChild(closeBtn)
    const frame = document.createElement('iframe'); frame.style.cssText = 'flex:1;width:100%;border:0'
    wrap.appendChild(bar); wrap.appendChild(frame); document.body.appendChild(wrap)
    const fdoc = frame.contentWindow.document; fdoc.open(); fdoc.write(html); fdoc.close()
    printBtn.onclick = () => { try { frame.contentWindow.focus(); frame.contentWindow.print() } catch (e) { alert('打印出错：' + e.message) } }
    closeBtn.onclick = () => wrap.remove()
    return
  }
  const iframe = document.createElement('iframe'); iframe.id = 'tms-print-frame'
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
  document.body.appendChild(iframe)
  const doc = iframe.contentWindow.document; doc.open(); doc.write(html); doc.close()
  iframe.onload = () => setTimeout(() => { try { iframe.contentWindow.focus(); iframe.contentWindow.print() } catch (e) { alert('打印出错：' + e.message) } }, 300)
}

// 付款凭证（还钱给供应商的单据）
function printSupplierPayment(D, p) {
  const sup = D.suppliers.find(s => s.code === p.supplier) || {}
  const payRM = p.amount * p.rate
  // 付款后该供应商余额
  const bal = supplierBalance(D, p.supplier)
  const rows = (p.allocs || []).map(a => {
    const po = D.purchases.find(x => x.no === a.purchase)
    const head = `<tr><td><b>${a.purchase}</b></td><td class="n">${fmt(a.rm)}</td><td class="n">${fmt(a.fx || 0)}</td></tr>`
    const detail = po ? (po.items || []).map(l => {
      const it = D.items.find(i => i.code === l.item)
      return `<tr class="di"><td style="padding-left:22px;color:#555">${it ? it.name : l.item} <span style="color:#999">· ${fmt(l.qty)} × ${fmt(l.cost)}</span></td><td class="n" style="color:#777">${fmt(l.qty * l.cost * (1 - (l.disc || 0) / 100))}</td><td></td></tr>`
    }).join('') : ''
    return head + detail
  }).join('')
  const companyLines = [COMPANY.regNo, COMPANY.address, COMPANY.phone && ('电话：' + COMPANY.phone), COMPANY.email && ('邮箱：' + COMPANY.email)].filter(Boolean).map(x => `<div>${x}</div>`).join('')
  const html = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>付款凭证 ${p.no}</title>
  <style>
    *{box-sizing:border-box}
    body{font-family:"PingFang SC","Microsoft YaHei",sans-serif;color:#1a1a1a;margin:0;padding:20px;font-size:12px}
    .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #1f6f5c;padding-bottom:12px}
    .title h2{margin:0;font-size:24px;letter-spacing:2px;color:#1f6f5c;font-weight:800}
    .title .no{margin-top:5px;font-family:monospace;font-size:13px;color:#444}
    .title .meta{margin-top:6px;color:#444;font-size:10.5px;line-height:1.5}
    .hd-right{text-align:right;font-size:12px;color:#333;margin-top:-2px}
    .hd-date{font-size:14px;font-weight:600}
    .lbl{color:#888;font-size:10px}
    .bill{display:flex;justify-content:space-between;margin:14px 0}
    .bill .box{font-size:11px;line-height:1.6}
    table{width:100%;border-collapse:collapse;margin-top:6px}
    th{background:#f4f2ec;text-align:left;padding:7px 8px;font-size:10px;color:#555;border-bottom:2px solid #ddd}
    td{padding:7px 8px;border-bottom:1px solid #eee;font-size:11px}
    tr.di td{border-bottom:1px dashed #f0f0f0;font-size:10.5px;padding:4px 8px}
    .n{text-align:right;font-family:monospace}
    .sum{margin-top:12px;margin-left:auto;width:240px;font-size:12px}
    .sum .r{display:flex;justify-content:space-between;padding:4px 0}
    .sum .r.big{border-top:2px solid #1f6f5c;margin-top:5px;padding-top:8px;font-size:15px;font-weight:700;color:#1f6f5c}
    .sum .v{font-family:monospace}
    .foot{margin-top:32px;color:#888;font-size:10px}
    @media print{body{padding:0}.noprint{display:none}}
    @page{size:A5 landscape;margin:10mm}
    body{max-width:210mm;margin:0 auto}
    .noprint{margin-top:24px;text-align:center}
    .btn{background:#1f6f5c;color:#fff;border:0;padding:10px 22px;border-radius:8px;font-size:14px;cursor:pointer}
    .wm{position:fixed;top:42%;left:50%;transform:translate(-50%,-50%);width:60%;max-width:360px;opacity:.28;z-index:0;pointer-events:none;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    body>*:not(.wm){position:relative;z-index:1}
  </style></head><body>
    <div class="head">
      <div class="title"><h2>付款凭证 PAYMENT VOUCHER</h2><div class="no">${p.no}</div>${companyLines ? `<div class="meta">${companyLines}</div>` : ''}</div>
      <div class="hd-right">
        <div class="lbl">日期 DATE</div><div class="hd-date">${p.date}</div>
        <div class="lbl" style="margin-top:6px">付款方式</div><div>${p.method || '—'}</div>
      </div>
    </div>
    <div class="bill">
      <div class="box"><div class="lbl">付款给 PAY TO</div><b>${sup.name || p.supplier}</b><br>${sup.address || ''}<br>${sup.phone || ''}</div>
      <div class="box" style="text-align:right"><div class="lbl">货币 · 汇率</div>${p.ccy} @ ${fmtRate(p.rate)}</div>
    </div>
    <img class="wm" src="${location.origin}/logo.png" onerror="this.style.display='none'"/>
    ${rows ? `<table><thead><tr><th>冲抵采购单 / 货品明细</th><th class="n">冲抵 RM</th><th class="n">汇兑 RM</th></tr></thead><tbody>${rows}</tbody></table>` : ''}
    <div class="sum">
      <div class="r"><span>付款金额 (${p.ccy})</span><span class="v">${fmt(p.amount)}</span></div>
      <div class="r"><span>汇率</span><span class="v">${fmtRate(p.rate)}</span></div>
      <div class="r big"><span>付款 RM</span><span class="v">${fmt(payRM)}</span></div>
      <div class="r"><span>付款后该供应商余额 RM</span><span class="v">${fmt(bal.outstanding)}</span></div>
    </div>
    <div class="foot">此凭证证明上述款项已付讫 · Payment received with thanks</div>
    <div class="noprint"><button class="btn" onclick="window.print()">🖨 打印 / 存为 PDF</button></div>
  </body></html>`
  renderPrint(html)
}

function ViewINV({ D, setModal, flash, logAudit, reload, can, modal }) {
  const s = modal.data, t = invoiceTotals(s), paid = invoicePaidRM(D, s.no)
  const del = async () => {
    if (paid > 0.01) { if (!confirm('此发票已收 ' + rm(paid) + '。删除将一并移除这些冲账记录。是否继续？')) return }
    else if (!confirm('删除发票 ' + s.no + '？库存将加回。')) return
    await db.delSale(D, s.no); await logAudit('删除', '销售发票', s.no, `${cName(D, s.customer)} · ${rm(t.rm)}`); reload(); setModal(null); flash('发票已删除 · 库存已重算')
  }
  const editable = can('sales')
  const footer = [
    <button key="print" className="btn ghost" style={{ marginLeft: 0 }} onClick={() => printInvoice(D, s)}>🖨 打印</button>,
    <div key="sp" style={{ flex: 1 }} />,
    editable && <button key="del" className="btn danger" onClick={del}>删除</button>,
    <button key="close" className="btn ghost" onClick={() => setModal(null)}>关闭</button>,
    editable && <button key="edit" className="btn" onClick={() => setModal({ type: 'sales', data: s })}>编辑</button>,
  ].filter(Boolean)
  return <Shell title={'发票 — ' + s.no} onClose={() => setModal(null)} footer={footer}>
    <div className="fg"><div><div className="hint">顾客</div><b>{cName(D, s.customer)}</b></div><div><div className="hint">日期 · 货币</div><b>{`${s.date} · ${s.ccy} @ ${fmtRate(s.rate)}`}</b></div></div>
    <table style={{ marginTop: 8 }}><thead><tr>{['货品', '数量', '价格', '折扣%', '小计'].map((x, i) => <th key={i} className={i ? 'num' : ''}>{x}</th>)}</tr></thead>
      <tbody>{s.items.map((l, i) => <tr key={i}><td>{itemName(D, l.item)}</td><td className="num">{fmt(l.qty)}</td><td className="num">{fmt(l.price)}</td><td className="num">{fmt(l.disc || 0)}</td><td className="num">{fmt(l.qty * l.price * (1 - (l.disc || 0) / 100))}</td></tr>)}</tbody></table>
    <div className="tot"><span className="k">{`金额 (${s.ccy})`}</span><span className="v">{fmt(t.amt)}</span></div>
    <div className="tot"><span className="k">发票 RM</span><span className="v">{fmt(t.rm)}</span></div>
    <div className="tot"><span className="k">已付 RM</span><span className="v">{fmt(paid)}</span></div>
    <div className="tot"><span className="k">余额 RM</span><span className="v">{fmt(t.rm - paid)}</span></div>
    <div style={{ textAlign: 'right', marginTop: 8 }}><Pill s={invoiceStatus(D, s)} /></div>
  </Shell>
}
function ViewRCPT({ D, setModal, flash, logAudit, reload, can, modal }) {
  const p = modal.data
  const del = async () => { if (!confirm('删除收款 ' + p.no + '？相关发票将恢复为未收状态。')) return; await db.delPayment(p.no); await logAudit('删除', '收款', p.no, `${cName(D, p.customer)} · ${p.ccy} ${fmt(p.amount)}`); reload(); setModal(null); flash('收款已删除') }
  const editable = can('payment')
  return <Shell title={'收款 — ' + p.no} onClose={() => setModal(null)}
    footer={editable && [<button key={0} className="btn danger" onClick={del}>删除</button>, <div key={1} style={{ flex: 1 }} />, <button key={2} className="btn ghost" onClick={() => setModal(null)}>关闭</button>, <button key={3} className="btn" onClick={() => setModal({ type: 'payment', data: p })}>编辑</button>]}>
    <div className="fg"><div><div className="hint">顾客</div><b>{cName(D, p.customer)}</b></div><div><div className="hint">日期 · 货币</div><b>{`${p.date} · ${p.ccy} @ ${fmt(p.rate)}`}</b></div></div>
    <div className="tot"><span className="k">{`已收 (${p.ccy})`}</span><span className="v">{fmt(p.amount)}</span></div>
    <div className="tot"><span className="k">付款 RM</span><span className="v">{fmt(p.amount * p.rate)}</span></div>
    <h3 style={{ margin: '14px 0 6px', fontSize: 13 }}>分配明细</h3>
    <table><thead><tr>{['发票', '冲抵 RM', '汇兑 RM'].map((x, i) => <th key={i} className={i ? 'num' : ''}>{x}</th>)}</tr></thead>
      <tbody>{(p.allocs || []).map((a, i) => <tr key={i}><td><span className="code">{a.invoice}</span></td><td className="num">{fmt(a.rm)}</td><td className={'num ' + ((a.fx || 0) >= 0 ? 'pos' : 'neg')}>{fmt(a.fx || 0)}</td></tr>)}</tbody></table>
  </Shell>
}

/* ---- 对账单 ---- */
function Statement({ D, setModal, modal }) {
  const c = modal.data
  const invs = D.sales.filter(s => s.customer === c.code)
  const pays = D.payments.filter(p => p.customer === c.code)
  const cns = (D.creditNotes || []).filter(x => x.customer === c.code)
  const rows = [...invs.map(s => ({ date: s.date, doc: s.no, type: '发票', debit: invoiceTotals(s).rm, credit: 0 })),
  ...pays.map(p => ({ date: p.date, doc: p.no, type: '收款', debit: 0, credit: p.amount * p.rate })),
  ...cns.map(x => ({ date: x.date, doc: x.no, type: '退货', debit: 0, credit: creditNoteTotals(x).rm }))].sort((a, b) => a.date.localeCompare(b.date))
  let bal = 0
  const b = customerBalance(D, c.code)
  return <Shell wide title={'对账单 — ' + c.name} onClose={() => setModal(null)}>
    <div className="fg3"><div><div className="hint">编码</div><b>{c.code}</b></div><div><div className="hint">货币 · 付款期</div><b>{`${c.ccy} · ${c.term} 天`}</b></div><div><div className="hint">未收</div><b className={b.outstanding > 0.01 ? 'neg' : 'pos'}>{rm(b.outstanding)}</b></div></div>
    {rows.length ? <table style={{ marginTop: 6 }}><thead><tr>{['日期', '单号', '类型', '借方 RM', '贷方 RM', '余额 RM'].map((x, i) => <th key={i} className={i > 2 ? 'num' : ''}>{x}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => { bal += r.debit - r.credit; return <tr key={i}><td>{r.date}</td><td><span className="code">{r.doc}</span></td><td>{r.type}</td><td className="num">{r.debit ? fmt(r.debit) : '—'}</td><td className="num">{r.credit ? fmt(r.credit) : '—'}</td><td className="num">{fmt(bal)}</td></tr> })}</tbody></table>
      : <div className="empty">暂无交易</div>}
  </Shell>
}

/* ---- 销售退货：贷记单表单 ---- */
function CreditNoteForm({ D, setModal, flash, logAudit, reload, modal }) {
  const [invNo, setInvNo] = useState('')
  const inv = D.sales.find(s => s.no === invNo)
  const [date, setDate] = useState(todayISO())
  const [reason, setReason] = useState('')
  const [qtys, setQtys] = useState({}) // 行index -> 退货数量
  const [busy, setBusy] = useState(false)

  // 已退数量（同一发票的其他贷记单已退的）
  const alreadyReturned = (lineIdx, itemCode) => {
    let q = 0
    ;(D.creditNotes || []).filter(c => c.refInvoice === invNo).forEach(c =>
      (c.items || []).forEach(l => { if (l.item === itemCode) q += l.qty }))
    return q
  }
  const chooseInv = no => { setInvNo(no); setQtys({}) }

  const lines = inv ? inv.items.map((l, idx) => {
    const ret = alreadyReturned(idx, l.item)
    // 按 item 汇总原数量，避免同货多行时重复扣（简单起见按行处理）
    const maxQ = l.qty
    return { idx, item: l.item, price: l.price, disc: l.disc || 0, origQty: l.qty, maxQ, q: qtys[idx] || 0 }
  }) : []
  const amt = lines.reduce((s, l) => s + (l.q || 0) * l.price * (1 - l.disc / 100), 0)

  const submit = async () => {
    if (!inv) return flash('请先选择原发票')
    const items = lines.filter(l => l.q > 0).map(l => ({ item: l.item, qty: l.q, price: l.price, disc: l.disc }))
    if (!items.length) return flash('请填写退货数量')
    for (const l of lines) { if (l.q > l.origQty) return flash(`${l.item} 退货数量不能超过原数量 ${l.origQty}`) }
    setBusy(true)
    const no = await nextNo('CN')
    await db.saveCreditNote({ no, refInvoice: invNo, customer: inv.customer, date, ccy: inv.ccy, rate: inv.rate, items, reason })
    await logAudit('新增', '销售退货', no, `原${invNo} · ${inv.ccy} ${fmt(amt)}`)
    reload(); setBusy(false); setModal(null); flash('销售退货已保存 · 库存已加回')
  }

  const openInvoices = [...D.sales].reverse()
  return <Shell wide title="新增销售退货（贷记单）" onClose={() => setModal(null)}
    footer={[<button key={1} className="btn ghost" onClick={() => setModal(null)}>取消</button>, <button key={2} className="btn" disabled={busy} onClick={submit}>{busy ? '保存中…' : '保存退货'}</button>]}>
    <div className="fg"><Field label="选择原发票"><select value={invNo} onChange={e => chooseInv(e.target.value)}>
      <option value="">— 请选择 —</option>
      {openInvoices.map(s => <option key={s.no} value={s.no}>{s.no} · {cName(D, s.customer)} · {s.ccy} {fmt(invoiceTotals(s).amt)}</option>)}
    </select></Field>
      <Field label="退货日期"><input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field></div>
    {inv && <>
      <div className="rateline">{`顾客：${cName(D, inv.customer)}  ·  货币：${inv.ccy} @ ${fmt(inv.rate)}`}</div>
      <table className="lineitems"><thead><tr>{['货品', '原数量', '已退', '本次退货', '单价', '小计'].map((x, i) => <th key={i} className={i ? 'num' : ''}>{x}</th>)}</tr></thead>
        <tbody>{lines.map(l => <tr key={l.idx}>
          <td>{itemName(D, l.item)}</td>
          <td className="num">{fmt(l.origQty)}</td>
          <td className="num">{fmt(alreadyReturned(l.idx, l.item))}</td>
          <td style={{ width: 90 }}><input type="number" min="0" max={l.origQty} value={qtys[l.idx] || ''} placeholder="0" onChange={e => setQtys(q => ({ ...q, [l.idx]: Math.min(+e.target.value, l.origQty) }))} /></td>
          <td className="num">{fmt(l.price)}</td>
          <td className="num">{fmt((l.q || 0) * l.price * (1 - l.disc / 100))}</td></tr>)}</tbody></table>
      <Field label="退货原因（选填）"><input value={reason} onChange={e => setReason(e.target.value)} placeholder="例如：货品损坏、客户不要了" /></Field>
      <div className="tot"><span className="k">{`退货额 (${inv.ccy})`}</span><span className="v">{fmt(amt)}</span></div>
      <div className="tot"><span className="k">退货 RM</span><span className="v">{fmt(amt * inv.rate)}</span></div>
      <div className="hint">保存后：退货货品自动加回库存，客户应收减少此金额。</div>
    </>}
  </Shell>
}

/* ---- 采购退货：借记单表单 ---- */
function DebitNoteForm({ D, setModal, flash, logAudit, reload, modal }) {
  const [poNo, setPoNo] = useState('')
  const po = D.purchases.find(p => p.no === poNo)
  const [date, setDate] = useState(todayISO())
  const [reason, setReason] = useState('')
  const [qtys, setQtys] = useState({})
  const [busy, setBusy] = useState(false)
  const choosePO = no => { setPoNo(no); setQtys({}) }
  const alreadyReturned = (itemCode) => {
    let q = 0
    ;(D.debitNotes || []).filter(d => d.refPurchase === poNo).forEach(d =>
      (d.items || []).forEach(l => { if (l.item === itemCode) q += l.qty }))
    return q
  }
  const lines = po ? po.items.map((l, idx) => ({ idx, item: l.item, cost: l.cost, disc: l.disc || 0, origQty: l.qty, q: qtys[idx] || 0 })) : []
  const amt = lines.reduce((s, l) => s + (l.q || 0) * l.cost * (1 - l.disc / 100), 0)
  const submit = async () => {
    if (!po) return flash('请先选择原采购单')
    const items = lines.filter(l => l.q > 0).map(l => ({ item: l.item, qty: l.q, cost: l.cost, disc: l.disc }))
    if (!items.length) return flash('请填写退货数量')
    for (const l of lines) { if (l.q > l.origQty) return flash(`${l.item} 退货数量不能超过原数量 ${l.origQty}`) }
    setBusy(true)
    const no = await nextNo('DN')
    await db.saveDebitNote({ no, refPurchase: poNo, supplier: po.supplier, date, ccy: po.ccy, rate: po.rate, items, reason })
    await logAudit('新增', '采购退货', no, `原${poNo} · ${po.ccy} ${fmt(amt)}`)
    reload(); setBusy(false); setModal(null); flash('采购退货已保存 · 库存已扣减')
  }
  const pos = [...D.purchases].reverse()
  return <Shell wide title="新增采购退货（借记单）" onClose={() => setModal(null)}
    footer={[<button key={1} className="btn ghost" onClick={() => setModal(null)}>取消</button>, <button key={2} className="btn" disabled={busy} onClick={submit}>{busy ? '保存中…' : '保存退货'}</button>]}>
    <div className="fg"><Field label="选择原采购单"><select value={poNo} onChange={e => choosePO(e.target.value)}>
      <option value="">— 请选择 —</option>
      {pos.map(p => <option key={p.no} value={p.no}>{p.no} · {sName(D, p.supplier)} · {p.ccy} {fmt(purchaseTotals(p).amt)}</option>)}
    </select></Field>
      <Field label="退货日期"><input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field></div>
    {po && <>
      <div className="rateline">{`供应商：${sName(D, po.supplier)}  ·  货币：${po.ccy} @ ${fmt(po.rate)}`}</div>
      <table className="lineitems"><thead><tr>{['货品', '原数量', '已退', '本次退货', '成本', '小计'].map((x, i) => <th key={i} className={i ? 'num' : ''}>{x}</th>)}</tr></thead>
        <tbody>{lines.map(l => <tr key={l.idx}>
          <td>{itemName(D, l.item)}</td>
          <td className="num">{fmt(l.origQty)}</td>
          <td className="num">{fmt(alreadyReturned(l.item))}</td>
          <td style={{ width: 90 }}><input type="number" min="0" max={l.origQty} value={qtys[l.idx] || ''} placeholder="0" onChange={e => setQtys(q => ({ ...q, [l.idx]: Math.min(+e.target.value, l.origQty) }))} /></td>
          <td className="num">{fmt(l.cost)}</td>
          <td className="num">{fmt((l.q || 0) * l.cost * (1 - l.disc / 100))}</td></tr>)}</tbody></table>
      <Field label="退货原因（选填）"><input value={reason} onChange={e => setReason(e.target.value)} placeholder="例如：质量问题、多订了" /></Field>
      <div className="tot"><span className="k">{`退货额 (${po.ccy})`}</span><span className="v">{fmt(amt)}</span></div>
      <div className="tot"><span className="k">退货 RM</span><span className="v">{fmt(amt * po.rate)}</span></div>
      <div className="hint">保存后：退货货品自动从库存扣减。</div>
    </>}
  </Shell>
}

/* ---- 查看贷记单 ---- */
function ViewCN({ D, setModal, flash, logAudit, reload, can, modal }) {
  const cn = modal.data, t = creditNoteTotals(cn)
  const del = async () => { if (!confirm('删除销售退货 ' + cn.no + '？库存将扣回、应收恢复。')) return; await db.delCreditNote(cn.no); await logAudit('删除', '销售退货', cn.no, `原${cn.refInvoice}`); reload(); setModal(null); flash('销售退货已删除') }
  const editable = can('sreturn')
  return <Shell title={'销售退货 — ' + cn.no} onClose={() => setModal(null)}
    footer={editable && [<button key={0} className="btn danger" onClick={del}>删除</button>, <div key={1} style={{ flex: 1 }} />, <button key={2} className="btn ghost" onClick={() => setModal(null)}>关闭</button>]}>
    <div className="fg"><div><div className="hint">顾客 · 原发票</div><b>{cName(D, cn.customer)} · {cn.refInvoice}</b></div><div><div className="hint">日期 · 货币</div><b>{`${cn.date} · ${cn.ccy} @ ${fmt(cn.rate)}`}</b></div></div>
    <table style={{ marginTop: 8 }}><thead><tr>{['货品', '退货数量', '单价', '小计'].map((x, i) => <th key={i} className={i ? 'num' : ''}>{x}</th>)}</tr></thead>
      <tbody>{cn.items.map((l, i) => <tr key={i}><td>{itemName(D, l.item)}</td><td className="num">{fmt(l.qty)}</td><td className="num">{fmt(l.price)}</td><td className="num">{fmt(l.qty * l.price * (1 - (l.disc || 0) / 100))}</td></tr>)}</tbody></table>
    {cn.reason && <div className="hint" style={{ marginTop: 8 }}>原因：{cn.reason}</div>}
    <div className="tot"><span className="k">{`退货额 (${cn.ccy})`}</span><span className="v">{fmt(t.amt)}</span></div>
    <div className="tot"><span className="k">退货 RM</span><span className="v">{fmt(t.rm)}</span></div>
  </Shell>
}
/* ---- 查看借记单 ---- */
function ViewDN({ D, setModal, flash, logAudit, reload, can, modal }) {
  const dn = modal.data, t = debitNoteTotals(dn)
  const del = async () => { if (!confirm('删除采购退货 ' + dn.no + '？库存将加回。')) return; await db.delDebitNote(dn.no); await logAudit('删除', '采购退货', dn.no, `原${dn.refPurchase}`); reload(); setModal(null); flash('采购退货已删除') }
  const editable = can('preturn')
  return <Shell title={'采购退货 — ' + dn.no} onClose={() => setModal(null)}
    footer={editable && [<button key={0} className="btn danger" onClick={del}>删除</button>, <div key={1} style={{ flex: 1 }} />, <button key={2} className="btn ghost" onClick={() => setModal(null)}>关闭</button>]}>
    <div className="fg"><div><div className="hint">供应商 · 原采购单</div><b>{sName(D, dn.supplier)} · {dn.refPurchase}</b></div><div><div className="hint">日期 · 货币</div><b>{`${dn.date} · ${dn.ccy} @ ${fmt(dn.rate)}`}</b></div></div>
    <table style={{ marginTop: 8 }}><thead><tr>{['货品', '退货数量', '成本', '小计'].map((x, i) => <th key={i} className={i ? 'num' : ''}>{x}</th>)}</tr></thead>
      <tbody>{dn.items.map((l, i) => <tr key={i}><td>{itemName(D, l.item)}</td><td className="num">{fmt(l.qty)}</td><td className="num">{fmt(l.cost)}</td><td className="num">{fmt(l.qty * l.cost * (1 - (l.disc || 0) / 100))}</td></tr>)}</tbody></table>
    {dn.reason && <div className="hint" style={{ marginTop: 8 }}>原因：{dn.reason}</div>}
    <div className="tot"><span className="k">{`退货额 (${dn.ccy})`}</span><span className="v">{fmt(t.amt)}</span></div>
    <div className="tot"><span className="k">退货 RM</span><span className="v">{fmt(t.rm)}</span></div>
  </Shell>
}

/* ---- 供应商付款表单 ---- */
function SupplierPaymentForm({ D, setModal, flash, logAudit, reload, modal }) {
  const ed = modal.data
  const [supplier, setSupplier] = useState(ed ? ed.supplier : (D.suppliers[0]?.code || ''))
  // 某采购单已付（排除本单，编辑时用）
  const paidExcl = poNo => { let p = 0; (D.supplierPayments || []).forEach(sp => { if (ed && sp.no === ed.no) return; (sp.allocs || []).forEach(a => { if (a.purchase === poNo) p += a.rm }) }); return p }
  const open = D.purchases.filter(p => p.supplier === supplier).map(p => ({ p, total: purchaseTotals(p).rm, paid: paidExcl(p.no) }))
    .filter(x => x.total - x.paid > 0.01 || (ed && (ed.allocs || []).some(a => a.purchase === x.p.no)))
  const sup = D.suppliers.find(s => s.code === supplier)
  const [ccy, setCcy] = useState(ed ? ed.ccy : (sup?.ccy || 'MYR'))
  const [rate, setRate] = useState(ed ? ed.rate : rateOf(D.currencies, ccy))
  const [amount, setAmount] = useState(ed ? ed.amount : 0)
  const [date, setDate] = useState(ed ? ed.date : todayISO())
  const [method, setMethod] = useState(ed ? (ed.method || '银行转账') : '银行转账')
  const [alloc, setAlloc] = useState(ed ? Object.fromEntries((ed.allocs || []).map(a => [a.purchase, a.rm])) : {})
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (!ed) setRate(rateOf(D.currencies, ccy)) }, [ccy])
  useEffect(() => { if (!ed) setAlloc({}) }, [supplier])
  const paymentRM = amount * rate
  const allocated = Object.values(alloc).reduce((s, v) => s + (+v || 0), 0)
  const autoAllocate = () => { let left = paymentRM; const a = {}; open.forEach(o => { const due = o.total - o.paid; const take = Math.min(due, left); if (take > 0.001) { a[o.p.no] = +take.toFixed(2); left -= take } }); setAlloc(a) }
  const submit = async () => {
    if (!supplier || amount <= 0) return flash('请输入金额')
    if (allocated > paymentRM + 0.01) return flash('分配超过付款金额')
    setBusy(true)
    const no = ed ? ed.no : await nextNo('PAY')
    const allocs = Object.entries(alloc).filter(([_, v]) => +v > 0).map(([purchase, rmv]) => ({ purchase, rm: +(+rmv).toFixed(2), fx: 0 }))
    const diff = +(paymentRM - allocs.reduce((s, a) => s + a.rm, 0)).toFixed(2)
    if (allocs.length && Math.abs(diff) > 0.001) allocs[0].fx = diff
    await db.saveSupplierPayment({ no, supplier, date, ccy, rate, amount: +amount, allocs, method })
    await logAudit(ed ? '修改' : '新增', '供应商付款', no, `${sName(D, supplier)} · ${ccy} ${fmt(+amount)}`)
    reload(); setBusy(false); setModal(null); flash(ed ? '付款已更新' : '付款已保存')
  }
  return <Shell wide title={ed ? '编辑供应商付款 — ' + ed.no : '新增供应商付款'} onClose={() => setModal(null)}
    footer={[<button key={1} className="btn ghost" onClick={() => setModal(null)}>取消</button>, <button key={2} className="btn" disabled={busy} onClick={submit}>{busy ? '保存中…' : (ed ? '更新付款' : '保存付款')}</button>]}>
    <div className="fg3"><Field label="供应商"><select value={supplier} onChange={e => { setSupplier(e.target.value); const s = D.suppliers.find(x => x.code === e.target.value); if (s) setCcy(s.ccy) }}>{D.suppliers.map(s => <option key={s.code} value={s.code}>{s.name}</option>)}</select></Field>
      <Field label="日期"><input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
      <Field label="付款货币"><select value={ccy} onChange={e => setCcy(e.target.value)}>{D.currencies.map(c => <option key={c.code}>{c.code}</option>)}</select></Field></div>
    <div className="fg"><Field label={'付款金额 (' + ccy + ')'}><input type="number" value={amount} onChange={e => setAmount(+e.target.value)} /></Field>
      <Field label="付款汇率 → MYR"><input type="number" step="0.0001" value={rate} onChange={e => setRate(+e.target.value)} /></Field></div>
    <Field label="付款方式"><select value={method} onChange={e => setMethod(e.target.value)}>{["银行转账", "现金", "E-wallet", "支票", "其他"].map(x => <option key={x}>{x}</option>)}</select></Field>
    <div className="rateline">{`付款 RM = ${fmt(paymentRM)}   ·   已分配 = ${fmt(allocated)}   ·   未分配 = ${fmt(paymentRM - allocated)}`}</div>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}><b style={{ fontSize: 13 }}>冲抵未付采购单（RM）</b><button className="btn ghost sm" onClick={autoAllocate}>自动分配</button></div>
    {open.length ? <table className="lineitems"><thead><tr>{['采购单', '货币', '采购 RM', '已付', '欠款', '冲抵 RM'].map((x, i) => <th key={i} className={i > 1 ? 'num' : ''}>{x}</th>)}</tr></thead>
      <tbody>{open.map(o => <tr key={o.p.no}><td><span className="code">{o.p.no}</span></td><td>{o.p.ccy}</td><td className="num">{fmt(o.total)}</td><td className="num">{fmt(o.paid)}</td><td className="num">{fmt(o.total - o.paid)}</td>
        <td style={{ width: 120 }}><input type="number" value={alloc[o.p.no] || ''} placeholder="0.00" onChange={e => setAlloc(a => ({ ...a, [o.p.no]: e.target.value }))} /></td></tr>)}</tbody></table>
      : <div className="empty">此供应商无未付采购单</div>}
    <div className="hint" style={{ marginTop: 10 }}>付款 RM 与总冲抵 RM 的差额将记为汇兑损益。</div>
  </Shell>
}

/* ---- 查看供应商付款 ---- */
function ViewSPAY({ D, setModal, flash, logAudit, reload, can, modal }) {
  const p = modal.data
  const del = async () => { if (!confirm('删除供应商付款 ' + p.no + '？相关采购单将恢复为未付。')) return; await db.delSupplierPayment(p.no); await logAudit('删除', '供应商付款', p.no, `${sName(D, p.supplier)} · ${p.ccy} ${fmt(p.amount)}`); reload(); setModal(null); flash('付款已删除') }
  const editable = can('spay')
  return <Shell title={'供应商付款 — ' + p.no} onClose={() => setModal(null)}
    footer={[<button key="print" className="btn ghost" style={{ marginLeft: 0 }} onClick={() => printSupplierPayment(D, p)}>🖨 打印凭证</button>, <div key="sp" style={{ flex: 1 }} />, ...(editable ? [<button key={0} className="btn danger" onClick={del}>删除</button>, <button key={2} className="btn ghost" onClick={() => setModal(null)}>关闭</button>, <button key={3} className="btn" onClick={() => setModal({ type: 'supplierPayment', data: p })}>编辑</button>] : [<button key={2} className="btn ghost" onClick={() => setModal(null)}>关闭</button>])]}>
    <div className="fg"><div><div className="hint">供应商</div><b>{sName(D, p.supplier)}</b></div><div><div className="hint">日期 · 付款方式</div><b>{`${p.date} · ${p.method || '—'}`}</b></div></div>
    <div className="tot"><span className="k">{`付款 (${p.ccy})`}</span><span className="v">{fmt(p.amount)}</span></div>
    <div className="tot"><span className="k">付款 RM</span><span className="v">{fmt(p.amount * p.rate)}</span></div>
    <h3 style={{ margin: '14px 0 6px', fontSize: 13 }}>冲抵明细</h3>
    <table><thead><tr>{['采购单', '冲抵 RM', '汇兑 RM'].map((x, i) => <th key={i} className={i ? 'num' : ''}>{x}</th>)}</tr></thead>
      <tbody>{(p.allocs || []).map((a, i) => <tr key={i}><td><span className="code">{a.purchase}</span></td><td className="num">{fmt(a.rm)}</td><td className={'num ' + ((a.fx || 0) >= 0 ? 'pos' : 'neg')}>{fmt(a.fx || 0)}</td></tr>)}</tbody></table>
  </Shell>
}

/* ---- AC 卡商表单 ---- */
function ACSupplierForm({ D, setModal, flash, logAudit, reload, modal }) {
  const d = modal.data
  const [f, setF] = useState(d || { code: nextCode(D.acSuppliers || [], 'CS'), name: '', phone: '', email: '', address: '' })
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))
  const submit = async () => {
    if (!f.code) return flash('请填写编码')
    if (!f.name) return flash('请填写名称')
    if (!d && (D.acSuppliers || []).some(x => x.code === f.code)) return flash('编码已存在')
    const { error } = await db.saveAcSupplier(f); if (error) return flash('保存失败：' + error.message)
    await logAudit(d ? '修改' : '新增', 'AC卡商', f.code, f.name); reload(); setModal(null); flash(d ? '卡商已更新' : '卡商已新增')
  }
  return <Shell title={d ? '编辑卡商' : '新增卡商'} onClose={() => setModal(null)} footer={[<button key={1} className="btn ghost" onClick={() => setModal(null)}>取消</button>, <button key={2} className="btn" onClick={submit}>保存</button>]}>
    <Field label="卡商编码（可自定义）"><input value={f.code} disabled={!!d} onChange={e => set('code', e.target.value.trim())} /></Field>
    <Field label="卡商名称"><input value={f.name} onChange={e => set('name', e.target.value)} /></Field>
    <div className="fg"><Field label="电话"><input value={f.phone} onChange={e => set('phone', e.target.value)} /></Field><Field label="邮箱"><input value={f.email} onChange={e => set('email', e.target.value)} /></Field></div>
    <Field label="地址"><input value={f.address} onChange={e => set('address', e.target.value)} /></Field>
  </Shell>
}

/* ---- AC 顾客表单 ---- */
function ACCustomerForm({ D, setModal, flash, logAudit, reload, modal }) {
  const d = modal.data
  const [f, setF] = useState(d || { code: nextCode(D.acCustomers || [], 'AC'), name: '', ic: '', phone: '', email: '', address: '', status: '启用' })
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))
  const submit = async () => {
    if (!f.code) return flash('请填写编码')
    if (!f.name) return flash('请填写名称')
    if (!d && (D.acCustomers || []).some(x => x.code === f.code)) return flash('编码已存在')
    const { error } = await db.saveAcCustomer(f); if (error) return flash('保存失败：' + error.message)
    await logAudit(d ? '修改' : '新增', 'AC顾客', f.code, f.name); reload(); setModal(null); flash(d ? '顾客已更新' : '顾客已新增')
  }
  return <Shell title={d ? '编辑顾客' : '新增顾客'} onClose={() => setModal(null)} footer={[<button key={1} className="btn ghost" onClick={() => setModal(null)}>取消</button>, <button key={2} className="btn" onClick={submit}>保存</button>]}>
    <div className="fg"><Field label="顾客编码（可自定义）"><input value={f.code} disabled={!!d} onChange={e => set('code', e.target.value.trim())} /></Field>
      <Field label="状态"><select value={f.status} onChange={e => set('status', e.target.value)}>{['启用', '停用'].map(x => <option key={x}>{x}</option>)}</select></Field></div>
    <Field label="顾客名称"><input value={f.name} onChange={e => set('name', e.target.value)} /></Field>
    <div className="fg"><Field label="身份证号"><input value={f.ic} onChange={e => set('ic', e.target.value)} /></Field><Field label="电话"><input value={f.phone} onChange={e => set('phone', e.target.value)} /></Field></div>
    <Field label="邮箱"><input value={f.email} onChange={e => set('email', e.target.value)} /></Field>
    <Field label="地址"><input value={f.address} onChange={e => set('address', e.target.value)} /></Field>
  </Shell>
}

/* ---- 进卡表单 ---- */
function ACCardForm({ D, setModal, flash, logAudit, reload, modal }) {
  const d = modal.data
  const [f, setF] = useState(d || { cardNo: '', cardType: '', bank: '', cost: 0, sell: 0, bankAccount: '', supplier: (D.acSuppliers || [])[0]?.code || '', inDate: todayISO(), status: '在库', note: '' })
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))
  const submit = async () => {
    if (!f.cardNo) return flash('请填写卡号')
    if (!d && (D.acCards || []).some(x => x.cardNo === f.cardNo)) return flash('卡号已存在')
    const { error } = await db.saveAcCard(f); if (error) return flash('保存失败：' + error.message)
    await logAudit(d ? '修改' : '新增', 'AC卡', f.cardNo, (f.bank || '') + ' ' + (f.cardType || '')); reload(); setModal(null); flash(d ? '卡已更新' : '卡已进库')
  }
  return <Shell title={d ? '编辑卡 — ' + d.cardNo : '进卡（新增）'} onClose={() => setModal(null)} footer={[<button key={1} className="btn ghost" onClick={() => setModal(null)}>取消</button>, <button key={2} className="btn" onClick={submit}>保存</button>]}>
    <div className="fg"><Field label="卡号"><input value={f.cardNo} disabled={!!d} placeholder="卡的唯一编号" onChange={e => set('cardNo', e.target.value.trim())} /></Field>
      <Field label="卡类型"><input value={f.cardType} placeholder="如 Debit / Prepaid" onChange={e => set('cardType', e.target.value)} /></Field></div>
    <div className="fg"><Field label="银行"><input value={f.bank} onChange={e => set('bank', e.target.value)} /></Field>
      <Field label="卡商"><select value={f.supplier} onChange={e => set('supplier', e.target.value)}><option value="">— 选卡商 —</option>{(D.acSuppliers || []).map(s => <option key={s.code} value={s.code}>{s.name}</option>)}</select></Field></div>
    <div className="fg"><Field label="进价 (RM)"><input type="number" value={f.cost} onChange={e => set('cost', +e.target.value)} /></Field>
      <Field label="建议卖价 (RM)"><input type="number" value={f.sell} onChange={e => set('sell', +e.target.value)} /></Field></div>
    <Field label="关联银行账户"><select value={f.bankAccount} onChange={e => set('bankAccount', e.target.value)}><option value="">— 选银行账户 —</option>{(D.bankAccounts || []).map(b => <option key={b.code} value={b.code}>{b.bankName} · {b.accountNo || b.code}</option>)}</select></Field>
    <div className="fg"><Field label="进卡日期"><input type="date" value={f.inDate} onChange={e => set('inDate', e.target.value)} /></Field>
      <Field label="备注"><input value={f.note} onChange={e => set('note', e.target.value)} /></Field></div>
  </Shell>
}

/* ---- 发卡表单 ---- */
function ACAssignForm({ D, setModal, flash, logAudit, reload, modal }) {
  const card = modal.data
  const [customer, setCustomer] = useState((D.acCustomers || [])[0]?.code || '')
  const [date, setDate] = useState(todayISO())
  const [price, setPrice] = useState(card.sell || 0)
  const submit = async () => {
    if (!customer) return flash('请选择顾客')
    const { error } = await db.assignCard(card.cardNo, customer, date, price)
    if (error) return flash('发卡失败：' + error.message)
    await logAudit('发卡', 'AC卡', card.cardNo, acCustName(D, customer) + ' · RM ' + fmt(price)); reload(); setModal(null); flash('发卡成功')
  }
  return <Shell title={'发卡 — ' + card.cardNo} onClose={() => setModal(null)} footer={[<button key={1} className="btn ghost" onClick={() => setModal(null)}>取消</button>, <button key={2} className="btn" onClick={submit}>确认发卡</button>]}>
    <div className="rateline">{`卡号 ${card.cardNo} · ${card.bank || ''} ${card.cardType || ''} · 进价 ${fmt(card.cost)}`}</div>
    <Field label="发给哪个顾客"><select value={customer} onChange={e => setCustomer(e.target.value)}><option value="">— 选顾客 —</option>{(D.acCustomers || []).map(c => <option key={c.code} value={c.code}>{c.name}</option>)}</select></Field>
    <div className="fg"><Field label="发卡日期"><input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
      <Field label="实际卖价 (RM)"><input type="number" value={price} onChange={e => setPrice(+e.target.value)} /></Field></div>
    <div className="hint">发卡后卡状态变「已发」，记录持卡人和卖价。利润 = 卖价 − 进价 = RM {fmt((price || 0) - (card.cost || 0))}</div>
  </Shell>
}

/* ---- Bank 数据库页面 ---- */
function BankAccounts({ D, setModal, flash, logAudit, reload }) {
  const del = async r => {
    if ((D.acCards || []).some(c => c.bankAccount === r.code)) return flash('此银行账户已被卡关联，不能删除')
    if (!confirm('删除银行账户「' + r.bankName + '」？')) return
    await db.delBank(r.code); await logAudit('删除', '银行账户', r.code, r.bankName); reload(); flash('已删除')
  }
  return <TablePage rows={D.bankAccounts || []} onAdd={() => setModal({ type: 'bank' })} addLabel="+ 新增银行账户" empty="暂无银行账户" cols={[
    { h: '编码', c: r => <span className="code">{r.code}</span> },
    { h: '银行', c: r => r.bankName },
    { h: '账户号', c: r => r.accountNo || '—' },
    { h: '户名', c: r => r.accountName || '—' },
    { h: '分行', c: r => <span className="muted">{r.branch || '—'}</span> },
    { h: '', c: r => <span><button className="linkbtn" onClick={() => setModal({ type: 'viewBank', data: r })}>查看</button>
      <button className="linkbtn" onClick={() => setModal({ type: 'bank', data: r })}>编辑</button>
      <button className="linkbtn del" onClick={() => del(r)}>删除</button></span> },
  ]} />
}

/* ---- Bank 表单 ---- */
function BankForm({ D, setModal, flash, logAudit, reload, modal }) {
  const d = modal.data
  const [f, setF] = useState(d || { code: nextCode(D.bankAccounts || [], 'BK'), bankName: '', accountNo: '', accountName: '', branch: '', swift: '', note: '' })
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))
  const submit = async () => {
    if (!f.code) return flash('请填写编码')
    if (!f.bankName) return flash('请填写银行名')
    if (!d && (D.bankAccounts || []).some(x => x.code === f.code)) return flash('编码已存在')
    const { error } = await db.saveBank(f); if (error) return flash('保存失败：' + error.message)
    await logAudit(d ? '修改' : '新增', '银行账户', f.code, f.bankName); reload(); setModal(null); flash(d ? '已更新' : '已新增')
  }
  return <Shell title={d ? '编辑银行账户' : '新增银行账户'} onClose={() => setModal(null)} footer={[<button key={1} className="btn ghost" onClick={() => setModal(null)}>取消</button>, <button key={2} className="btn" onClick={submit}>保存</button>]}>
    <div className="fg"><Field label="编码（可自定义）"><input value={f.code} disabled={!!d} onChange={e => set('code', e.target.value.trim())} /></Field>
      <Field label="银行名"><input value={f.bankName} onChange={e => set('bankName', e.target.value)} /></Field></div>
    <div className="fg"><Field label="账户号"><input value={f.accountNo} onChange={e => set('accountNo', e.target.value)} /></Field>
      <Field label="户名"><input value={f.accountName} onChange={e => set('accountName', e.target.value)} /></Field></div>
    <div className="fg"><Field label="分行"><input value={f.branch} onChange={e => set('branch', e.target.value)} /></Field>
      <Field label="SWIFT"><input value={f.swift} onChange={e => set('swift', e.target.value)} /></Field></div>
    <Field label="备注"><input value={f.note} onChange={e => set('note', e.target.value)} /></Field>
  </Shell>
}

/* ---- 查看银行账户 ---- */
function ViewBank({ D, setModal, modal }) {
  const b = modal.data
  const linkedCards = (D.acCards || []).filter(c => c.bankAccount === b.code)
  const row = (k, v) => <div className="tot"><span className="k">{k}</span><span className="v" style={{ fontFamily: 'inherit' }}>{v || '—'}</span></div>
  return <Shell title={'银行账户 — ' + b.bankName} onClose={() => setModal(null)} footer={[<button key={1} className="btn ghost" onClick={() => setModal(null)}>关闭</button>, <button key={2} className="btn" onClick={() => setModal({ type: 'bank', data: b })}>编辑</button>]}>
    {row('编码', b.code)}
    {row('银行', b.bankName)}
    {row('账户号', b.accountNo)}
    {row('户名', b.accountName)}
    {row('分行', b.branch)}
    {row('SWIFT', b.swift)}
    {row('备注', b.note)}
    <div className="hint" style={{ marginTop: 10 }}>关联的卡：{linkedCards.length} 张{linkedCards.length ? '（' + linkedCards.map(c => c.cardNo).join('、') + '）' : ''}</div>
  </Shell>
}

/* ---- 进户口表单（核心，可选带卡）---- */
function ACAccountForm({ D, setModal, flash, logAudit, reload, modal }) {
  const d = modal.data
  const [f, setF] = useState(d || { code: nextCode(D.acAccounts || [], 'ACC'), supplier: (D.acSuppliers || [])[0]?.code || '', bank: '', accountNo: '', accountName: '', cost: 0, sell: 0, monthlyFee: 0, hasCard: false, cardNo: '', cardType: '', status: '在库', note: '' })
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))
  const submit = async () => {
    if (!f.code) return flash('请填写编码')
    if (!f.supplier) return flash('请选择卡商')
    if (!f.bank) return flash('请填写银行')
    if (f.hasCard && !f.cardNo) return flash('勾了有卡，请填卡号')
    if (!d && (D.acAccounts || []).some(x => x.code === f.code)) return flash('编码已存在')
    const { error } = await db.saveAcAccount(f); if (error) return flash('保存失败：' + error.message)
    await logAudit(d ? '修改' : '新增', 'AC户口', f.code, (f.bank || '') + ' ' + (f.accountNo || '')); reload(); setModal(null); flash(d ? '户口已更新' : '户口已进库')
  }
  return <Shell wide title={d ? '编辑户口 — ' + d.code : '进户口（新增）'} onClose={() => setModal(null)} footer={[<button key={1} className="btn ghost" onClick={() => setModal(null)}>取消</button>, <button key={2} className="btn" onClick={submit}>保存</button>]}>
    <div className="fg"><Field label="编码（可自定义）"><input value={f.code} disabled={!!d} onChange={e => set('code', e.target.value.trim())} /></Field>
      <Field label="所属卡商"><select value={f.supplier} onChange={e => set('supplier', e.target.value)}><option value="">— 选卡商 —</option>{(D.acSuppliers || []).map(s => <option key={s.code} value={s.code}>{s.name}</option>)}</select></Field></div>
    <div className="fg"><Field label="银行"><input value={f.bank} onChange={e => set('bank', e.target.value)} /></Field>
      <Field label="户口号"><input value={f.accountNo} onChange={e => set('accountNo', e.target.value)} /></Field></div>
    <Field label="户名"><input value={f.accountName} onChange={e => set('accountName', e.target.value)} /></Field>
    <div className="fg"><Field label="进价 (RM)"><input type="number" value={f.cost} onChange={e => set('cost', +e.target.value)} /></Field>
      <Field label="建议卖价 (RM)"><input type="number" value={f.sell} onChange={e => set('sell', +e.target.value)} /></Field></div>
    <Field label="标准月费 (RM/月)"><input type="number" value={f.monthlyFee} placeholder="之后每月固定收的月费" onChange={e => set('monthlyFee', +e.target.value)} /></Field>
    <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 12, marginTop: 4 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14 }}>
        <input type="checkbox" checked={f.hasCard} onChange={e => set('hasCard', e.target.checked)} style={{ width: 16, height: 16 }} />
        这个户口有卡
      </label>
      {f.hasCard && <div className="fg" style={{ marginTop: 10 }}>
        <Field label="卡号"><input value={f.cardNo} onChange={e => set('cardNo', e.target.value)} /></Field>
        <Field label="卡类型"><input value={f.cardType} placeholder="如 Debit / ATM" onChange={e => set('cardType', e.target.value)} /></Field>
      </div>}
    </div>
    <Field label="备注"><input value={f.note} onChange={e => set('note', e.target.value)} /></Field>
  </Shell>
}

/* ---- 公司表单（分组：公司名 + 卡商）---- */
function ACCompanyForm({ D, setModal, flash, logAudit, reload, modal }) {
  const d = modal.data
  const [f, setF] = useState(d || { code: nextCode(D.acCompanies || [], 'CO'), name: '', supplier: (D.acSuppliers || [])[0]?.code || '', inDate: todayISO(), ssmNo: '', status: '在库', note: '' })
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))
  const submit = async () => {
    if (!f.name) return flash('请填写公司名')
    if (!f.supplier) return flash('请选择卡商')
    if (!d && (D.acCompanies || []).some(x => x.code === f.code)) return flash('编码已存在')
    const { error } = await db.saveAcCompany(f); if (error) return flash('保存失败：' + error.message)
    await logAudit(d ? '修改' : '新增', 'AC公司', f.code, f.name); reload(); setModal(null); flash(d ? '公司已更新' : '公司已建立')
  }
  return <Shell title={d ? '编辑公司 — ' + d.code : '新增公司'} onClose={() => setModal(null)} footer={[<button key={1} className="btn ghost" onClick={() => setModal(null)}>取消</button>, <button key={2} className="btn" onClick={submit}>保存</button>]}>
    <div className="fg"><Field label="编码"><input value={f.code} disabled={!!d} onChange={e => set('code', e.target.value.trim())} /></Field>
      <Field label="所属卡商"><select value={f.supplier} onChange={e => set('supplier', e.target.value)}><option value="">— 选卡商 —</option>{(D.acSuppliers || []).map(s => <option key={s.code} value={s.code}>{s.name}</option>)}</select></Field></div>
    <Field label="公司名"><input value={f.name} placeholder="例：V PERFECT 23" onChange={e => set('name', e.target.value)} /></Field>
    <div className="fg"><Field label="SSM 注册号（选填）"><input value={f.ssmNo} onChange={e => set('ssmNo', e.target.value)} /></Field>
      <Field label="日期"><input type="date" value={f.inDate || ''} onChange={e => set('inDate', e.target.value)} /></Field></div>
    <Field label="备注"><input value={f.note} onChange={e => set('note', e.target.value)} /></Field>
    <div className="hint">公司只是分组。进价、卖价、发给谁，都在下面的「银行户口」里各自设定。</div>
  </Shell>
}

/* ---- 银行户口表单（挂公司，最小计费单位）---- */
function ACBankAccountForm({ D, setModal, flash, logAudit, reload, modal }) {
  const d = modal.data && modal.data.code ? modal.data : null
  const preCo = modal.data?.company || ''
  const [f, setF] = useState(d || {
    code: nextCode(D.acBankAccounts || [], 'BA'), company: preCo, bank: 'RHB', accountNo: '', receiveDate: todayISO(),
    cost: 0, soldPrice: 0, stockStatus: '在库', customer: null, assignDate: null,
    monthlyFee: 0, supplierShare: 0, status: '正常', stopCharge: false, stopPay: false,
    hasCard: false, cardNo: '', cardType: '', openDate: todayISO(), note: ''
  })
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))
  const co = acCoOf(D, f.company)
  const submit = async () => {
    if (!f.company) return flash('请选择所属公司')
    if (!f.bank) return flash('请选择银行')
    if (f.hasCard && !f.cardNo) return flash('勾了有卡，请填卡号')
    if (!d && (D.acBankAccounts || []).some(x => x.code === f.code)) return flash('编码已存在')
    // 检测金额变化（仅编辑已发户口时）
    let syncMsg = ''
    const agentChanged = d && d.stockStatus === '已发' && ((d.agent || '') !== (f.agent || '') || (+d.agentFee || 0) !== (+f.agentFee || 0))
    if (d && d.stockStatus === '已发') {
      const shareChanged = (+d.supplierShare || 0) !== (+f.supplierShare || 0)
      const feeChanged = (+d.monthlyFee || 0) !== (+f.monthlyFee || 0)
      if (shareChanged || feeChanged) {
        const parts = []
        if (feeChanged) parts.push(`月费 ${fmt(d.monthlyFee)} → ${fmt(f.monthlyFee)}`)
        if (shareChanged) parts.push(`给卡商 ${fmt(d.supplierShare)} → ${fmt(f.supplierShare)}`)
        if (confirm(`金额改了（${parts.join('，')}）。\n\n要不要同步更新这个户口【未收/未结算】的账单和卡商应付？\n（已收清、已结算的不动）`)) {
          syncMsg = '（含同步旧单）'
          if (feeChanged) await db.syncBillsForAccount(f.code, +f.monthlyFee || 0, D)
          if (shareChanged) await db.syncDuesForAccount(f.code, +f.supplierShare || 0, D)
        }
      }
    }
    const { error } = await db.saveAcBankAccount(f); if (error) return flash('保存失败：' + error.message)
    // agent 变化：自动为该户口所有月费账单补上/更新 agent 佣金（用新的 f 值）
    if (agentChanged) {
      const D2 = { ...D, acBankAccounts: (D.acBankAccounts || []).map(x => x.code === f.code ? { ...x, agent: f.agent, agentFee: f.agentFee } : x) }
      await db.syncAgentDuesForAccount(f.code, D2)
      syncMsg = '（已补 agent 佣金）'
    }
    await logAudit(d ? '修改' : '新增', 'AC银行户口', f.code, `${acCoName(D, f.company)} · ${f.bank}${syncMsg}`); reload(); setModal(null); flash(d ? '银行户口已更新' + syncMsg : '银行户口已加入')
  }
  return <Shell title={d ? '编辑银行户口 — ' + d.code : '新增银行户口'} onClose={() => setModal(null)} footer={[<button key={1} className="btn ghost" onClick={() => setModal(null)}>取消</button>, <button key={2} className="btn" onClick={submit}>保存</button>]}>
    <div className="fg"><Field label="编码"><input value={f.code} disabled={!!d} onChange={e => set('code', e.target.value.trim())} /></Field>
      <Field label="所属公司"><select value={f.company} onChange={e => set('company', e.target.value)}><option value="">— 选公司 —</option>{(D.acCompanies || []).map(c => <option key={c.code} value={c.code}>{c.name}</option>)}</select></Field></div>
    {co && <div className="hint">这家公司来自卡商 <b>{acSupName(D, co.supplier)}</b>{co.status === '已发' && <> · 已发给 <b>{acCustName(D, co.customer)}</b></>}</div>}
    <div className="fg"><Field label="银行"><select value={f.bank} onChange={e => set('bank', e.target.value)}>{banksOf(D).map(b => <option key={b}>{b}</option>)}</select></Field>
      <Field label="银行户口号"><input value={f.accountNo} onChange={e => set('accountNo', e.target.value)} /></Field></div>
    <div className="fg"><Field label="进价 (RM)"><input type="number" value={f.cost} onChange={e => set('cost', +e.target.value)} /></Field>
      <Field label="接收日期（从卡商拿到）"><input type="date" value={f.receiveDate || ''} onChange={e => set('receiveDate', e.target.value)} /></Field></div>
    <Field label="建议卖价 (RM)"><input type="number" value={f.soldPrice} onChange={e => set('soldPrice', +e.target.value)} /></Field>
    {f.stockStatus === '已发' && <div className="rateline">已发给 <b>{acCustName(D, f.customer)}</b> · {f.assignDate}</div>}
    <div className="fg">
      <Field label="每月收顾客月费 (RM)"><input type="number" value={f.monthlyFee} onChange={e => set('monthlyFee', +e.target.value)} /></Field>
      <Field label="每月给卡商分成 (RM)"><input type="number" value={f.supplierShare} onChange={e => set('supplierShare', +e.target.value)} /></Field>
    </div>
    <div className="fg">
      <Field label="Agent（介绍人，可留空）"><select value={f.agent || ''} onChange={e => set('agent', e.target.value)}><option value="">无 agent</option>{(D.acAgents || []).map(a => <option key={a.code} value={a.code}>{a.name}</option>)}</select></Field>
      <Field label="每月给 agent 佣金 (RM)"><input type="number" value={f.agentFee || 0} onChange={e => set('agentFee', +e.target.value)} disabled={!f.agent} /></Field>
    </div>
    <div className="hint">月费净赚 = 月费 − 给卡商 − agent佣金 = <b>{rm((+f.monthlyFee || 0) - (+f.supplierShare || 0) - (f.agent ? (+f.agentFee || 0) : 0))}</b> / 月</div>
    <div className="fg">
      <Field label="状态"><select value={f.status} onChange={e => { const v = e.target.value; setF(p => ({ ...p, status: v, statusDate: v === '正常' ? null : (p.statusDate || todayISO()) })) }}>{BA_STATUS.map(s => <option key={s}>{s}</option>)}</select></Field>
      {f.status !== '正常' && <Field label="出问题日期"><input type="date" value={f.statusDate || ''} onChange={e => set('statusDate', e.target.value)} /></Field>}
    </div>
    {f.status !== '正常' && f.statusDate && <div className="hint" style={{ color: 'var(--danger)' }}>已经 {daysSince(f.statusDate)} 天了</div>}
    <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 12, marginTop: 4 }}>
      <div className="hint" style={{ marginBottom: 8 }}>收 / 付 独立控制（例如顾客违规：顾客照收、卡商停付）</div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14, marginBottom: 6 }}>
        <input type="checkbox" checked={!!f.stopCharge} onChange={e => set('stopCharge', e.target.checked)} style={{ width: 16, height: 16 }} />
        停收顾客月费
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14 }}>
        <input type="checkbox" checked={!!f.stopPay} onChange={e => set('stopPay', e.target.checked)} style={{ width: 16, height: 16 }} />
        停付卡商分成
      </label>
    </div>
    <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 12, marginTop: 10 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14 }}>
        <input type="checkbox" checked={!!f.hasCard} onChange={e => set('hasCard', e.target.checked)} style={{ width: 16, height: 16 }} />
        这个户口有卡
      </label>
      {f.hasCard && <div className="fg" style={{ marginTop: 10 }}>
        <Field label="卡号"><input value={f.cardNo} onChange={e => set('cardNo', e.target.value)} /></Field>
        <Field label="卡类型"><input value={f.cardType} placeholder="如 Debit / ATM" onChange={e => set('cardType', e.target.value)} /></Field>
      </div>}
    </div>
    <Field label="备注"><input value={f.note} onChange={e => set('note', e.target.value)} /></Field>
  </Shell>
}

/* ---- 发单个银行户口给顾客 ---- */
function ACAssignBAForm({ D, setModal, flash, logAudit, reload, modal }) {
  const ba = modal.data
  const co = acCoOf(D, ba?.company)
  const [customer, setCustomer] = useState((D.acCustomers || [])[0]?.code || '')
  const [date, setDate] = useState(todayISO())
  const [soldPrice, setSoldPrice] = useState(ba?.soldPrice || 0)
  const [monthlyFee, setMonthlyFee] = useState(ba?.monthlyFee || 0)
  const [share, setShare] = useState(ba?.supplierShare || 0)
  const [alsoBill, setAlsoBill] = useState(true)
  const [busy, setBusy] = useState(false)
  const proFee = acProratedFee(monthlyFee, date)
  const proShare = acProratedFee(share, date)
  const submit = async () => {
    if (!customer) return flash('请选择顾客')
    setBusy(true)
    const upd = { ...ba, stockStatus: '已发', customer, assignDate: date, soldPrice: +soldPrice, monthlyFee: +monthlyFee, supplierShare: +share, status: '正常' }
    const { error } = await db.saveAcBankAccount(upd)
    if (error) { setBusy(false); return flash('保存失败：' + error.message) }
    await db.openBaHistory({ bankAccount: ba.code, company: ba.company, customer, assignDate: date, soldPrice: +soldPrice, monthlyFee: +monthlyFee, supplierShare: +share })
    if (alsoBill) {
      try {
        const no = await nextNo('BILL')
        const items = [{ name: '当月月费(按天)', amount: +proFee.toFixed(2), cost: 0, remark: '发出日 ' + date + ' 按天算', kind: 'fee' }]
        const r1 = await db.saveAcBill({ no, billType: '首期', account: ba.code, customer, date, period: acPeriodOf(date), items, note: '' })
        if (r1?.error) throw new Error('账单：' + r1.error.message)
        if (!upd.stopPay && proShare > 0) {
          const r2 = await db.saveAcDue({ supplier: co?.supplier, bankAccount: ba.code, company: ba.company, billNo: no, period: acPeriodOf(date), date, amount: +proShare.toFixed(2), settled: false, note: `${acCoName(D, ba.company)} · ${ba.bank}` })
          if (r2?.error) throw new Error('卡商应付：' + r2.error.message)
        }
        // agent 佣金（首期按天）
        if (ba.agent && (+ba.agentFee || 0) > 0) {
          const proAgent = +acProratedFee(+ba.agentFee || 0, date).toFixed(2)
          if (proAgent > 0) await db.saveAgentDue({ agent: ba.agent, bankAccount: ba.code, company: ba.company, billNo: no, period: acPeriodOf(date), date, amount: proAgent, settled: false, note: `${acCoName(D, ba.company)} · ${ba.bank}` })
        }
      } catch (e) {
        reload(); setBusy(false); setModal(null)
        return flash('户口已发出，但开账单失败：' + e.message)
      }
    }
    await logAudit('修改', 'AC银行户口', ba.code, `发给 ${acCustName(D, customer)}`)
    reload(); setBusy(false); setModal(null); flash('户口已发出' + (alsoBill ? ' · 已开首期账单' : ''))
  }
  return <Shell title={`发户口 — ${acCoName(D, ba?.company)} · ${ba?.bank}`} onClose={() => setModal(null)}
    footer={[<button key={1} className="btn ghost" onClick={() => setModal(null)}>取消</button>, <button key={2} className="btn" disabled={busy} onClick={submit}>{busy ? '处理中…' : '确认发出'}</button>]}>
    <div className="fg"><Field label="发给顾客"><select value={customer} onChange={e => setCustomer(e.target.value)}>{(D.acCustomers || []).map(c => <option key={c.code} value={c.code}>{c.name}</option>)}</select></Field>
      <Field label="发出日期"><input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field></div>
    <div className="fg"><Field label="卖价 (RM)"><input type="number" value={soldPrice} onChange={e => setSoldPrice(+e.target.value)} /></Field>
      <Field label="进价 (RM)"><input type="number" value={ba?.cost || 0} disabled /></Field></div>
    <div className="fg"><Field label="每月月费 (RM)"><input type="number" value={monthlyFee} onChange={e => setMonthlyFee(+e.target.value)} /></Field>
      <Field label="每月给卡商 (RM)"><input type="number" value={share} onChange={e => setShare(+e.target.value)} /></Field></div>
    <div className="rateline">卖出利润 {rm((+soldPrice || 0) - (+ba?.cost || 0))} · 每月净赚 {rm((+monthlyFee || 0) - (+share || 0))}</div>
    <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 12, marginTop: 8 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14 }}>
        <input type="checkbox" checked={alsoBill} onChange={e => setAlsoBill(e.target.checked)} style={{ width: 16, height: 16 }} />
        顺便开首期账单（当月按天）
      </label>
      {alsoBill && <div className="hint" style={{ marginTop: 8 }}>
        当月月费按天 = <b>{rm(proFee)}</b>（{date} 起算）<br />
        同时产生卡商应付 = <b>{rm(proShare)}</b>
      </div>}
    </div>
  </Shell>
}

/* ---- 批量发出：一家公司底下选多个户口发给同一顾客 ---- */
function ACAssignCoForm({ D, setModal, flash, logAudit, reload, modal }) {
  const co = modal.data
  const bas = baOfCompany(D, co?.code).filter(b => b.stockStatus === '在库')
  const [customer, setCustomer] = useState((D.acCustomers || [])[0]?.code || '')
  const [date, setDate] = useState(todayISO())
  const [sel, setSel] = useState(() => Object.fromEntries(bas.map(b => [b.code, true])))
  const [alsoBill, setAlsoBill] = useState(true)
  const [busy, setBusy] = useState(false)
  const chosen = bas.filter(b => sel[b.code])
  const totalSell = chosen.reduce((s, b) => s + (+b.soldPrice || 0), 0)
  const totalCost = chosen.reduce((s, b) => s + (+b.cost || 0), 0)
  const totalFee = chosen.reduce((s, b) => s + acProratedFee(b.monthlyFee || 0, date), 0)
  const submit = async () => {
    if (!customer) return flash('请选择顾客')
    if (!chosen.length) return flash('请至少选一个户口')
    setBusy(true)
    for (const b of chosen) {
      await db.saveAcBankAccount({ ...b, stockStatus: '已发', customer, assignDate: date, status: '正常' })
      await db.openBaHistory({ bankAccount: b.code, company: b.company, customer, assignDate: date, soldPrice: +b.soldPrice || 0, monthlyFee: +b.monthlyFee || 0, supplierShare: +b.supplierShare || 0 })
      if (alsoBill) {
        const no = await nextNo('BILL')
        const pf = acProratedFee(b.monthlyFee || 0, date)
        await db.saveAcBill({ no, billType: '首期', account: b.code, customer, date, period: acPeriodOf(date), items: [{ name: '当月月费(按天)', amount: +pf.toFixed(2), cost: 0, remark: '发出日 ' + date, kind: 'fee' }], note: '' })
        const ps = acProratedFee(b.supplierShare || 0, date)
        if (!b.stopPay && ps > 0) {
          await db.saveAcDue({ supplier: co.supplier, bankAccount: b.code, company: b.company, billNo: no, period: acPeriodOf(date), date, amount: +ps.toFixed(2), settled: false, note: `${co.name} · ${b.bank}` })
        }
      }
    }
    await logAudit('修改', 'AC公司', co.code, `批量发出 ${chosen.length} 个户口给 ${acCustName(D, customer)}`)
    reload(); setBusy(false); setModal(null); flash(`已发出 ${chosen.length} 个户口`)
  }
  return <Shell wide title={'批量发出 — ' + co?.name} onClose={() => setModal(null)}
    footer={[<button key={1} className="btn ghost" onClick={() => setModal(null)}>取消</button>, <button key={2} className="btn" disabled={busy} onClick={submit}>{busy ? '处理中…' : `确认发出 ${chosen.length} 个`}</button>]}>
    <div className="fg"><Field label="发给顾客"><select value={customer} onChange={e => setCustomer(e.target.value)}>{(D.acCustomers || []).map(c => <option key={c.code} value={c.code}>{c.name}</option>)}</select></Field>
      <Field label="发出日期"><input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field></div>
    <div className="hint" style={{ marginTop: 8, marginBottom: 6 }}>勾选要发给这个顾客的户口（不勾的留在库，之后可单独发给别人）</div>
    <div className="panel"><table><thead><tr><th style={{ width: 40 }}></th><th>银行</th><th>户口号</th><th className="num">进价</th><th className="num">卖价</th><th className="num">月费</th><th className="num">给卡商</th></tr></thead>
      <tbody>{bas.map(b => <tr key={b.code} style={b.status !== '正常' ? { background: 'var(--danger-soft)' } : (b.stockStatus === '已发' && b.stopCharge ? { background: 'var(--gold-soft)' } : {})}>
        <td><input type="checkbox" checked={!!sel[b.code]} onChange={e => setSel(s => ({ ...s, [b.code]: e.target.checked }))} style={{ width: 16, height: 16 }} /></td>
        <td><b>{b.bank}</b></td><td><span className="code">{b.accountNo || '—'}</span></td>
        <td className="num">{fmt(b.cost)}</td><td className="num">{fmt(b.soldPrice)}</td>
        <td className="num">{fmt(b.monthlyFee)}</td><td className="num">{fmt(b.supplierShare)}</td>
      </tr>)}
      {!bas.length && <tr><td colSpan={7}><div className="empty">这家公司没有在库的户口</div></td></tr>}</tbody></table></div>
    <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 12, marginTop: 8 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14 }}>
        <input type="checkbox" checked={alsoBill} onChange={e => setAlsoBill(e.target.checked)} style={{ width: 16, height: 16 }} />
        每个户口都顺便开首期账单（当月按天）
      </label>
    </div>
    <div className="tot"><span className="k">选中 {chosen.length} 个 · 卖价合计</span><span className="v">{rm(totalSell)}</span></div>
    <div className="tot"><span className="k">进价合计</span><span className="v">{rm(totalCost)}</span></div>
    <div className="tot"><span className="k">卖出利润</span><span className={'v ' + (totalSell - totalCost >= 0 ? 'pos' : 'neg')}>{rm(totalSell - totalCost)}</span></div>
    {alsoBill && <div className="tot"><span className="k">首期账单合计（按天）</span><span className="v">{rm(totalFee)}</span></div>}
  </Shell>
}

/* ---- 退回银行户口 ---- */
function ACReturnBAForm({ D, setModal, flash, logAudit, reload, modal }) {
  const ba = modal.data
  const [date, setDate] = useState(todayISO())
  const [reason, setReason] = useState('退卡')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    const { error } = await db.saveAcBankAccount({ ...ba, stockStatus: '在库', customer: null, assignDate: null, soldPrice: 0, stopCharge: false, stopPay: false, status: '正常' })
    if (error) { setBusy(false); return flash('失败：' + error.message) }
    await db.closeBaHistory(ba.code, date, reason)
    await logAudit('修改', 'AC银行户口', ba.code, `退回（原顾客 ${acCustName(D, ba.customer)}）· ${reason}`)
    reload(); setBusy(false); setModal(null); flash('户口已退回在库 · 可再发给别的顾客')
  }
  return <Shell title={`退回户口 — ${acCoName(D, ba?.company)} · ${ba?.bank}`} onClose={() => setModal(null)}
    footer={[<button key={1} className="btn ghost" onClick={() => setModal(null)}>取消</button>, <button key={2} className="btn" disabled={busy} onClick={submit}>{busy ? '处理中…' : '确认退回'}</button>]}>
    <div className="hint">原顾客：<b>{acCustName(D, ba?.customer)}</b> · 发出日 {ba?.assignDate}</div>
    <div className="fg"><Field label="退回日期"><input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
      <Field label="退回原因"><select value={reason} onChange={e => setReason(e.target.value)}>{['退卡', '盖户口', '风控', '收回', '停租金', '人头收回', '顾客不要了', '其他'].map(x => <option key={x}>{x}</option>)}</select></Field></div>
    <div className="hint" style={{ marginTop: 8 }}>退回后这个户口回到「在库」，可以再发给别的顾客。<br />已开的账单和卡商应付<b>不会</b>删除，历史记录会保留在「户口历史」页。</div>
  </Shell>
}

/* ---- 发户口表单（可选顺便开首期账单）---- */
function ACAssignAcctForm({ D, setModal, flash, logAudit, reload, modal }) {
  const acct = modal.data
  const [customer, setCustomer] = useState((D.acCustomers || [])[0]?.code || '')
  const [date, setDate] = useState(todayISO())
  const [price, setPrice] = useState(acct.sell || 0)
  const [monthlyFee, setMonthlyFee] = useState(acct.monthlyFee || 0)
  const [makeBill, setMakeBill] = useState(true)
  const [period, setPeriod] = useState('')
  const [items, setItems] = useState([
    { name: '开通费', amount: 0, remark: '' },
    { name: '当月月费(按天)', amount: +acProratedFee(acct.monthlyFee || 0, todayISO()).toFixed(2), remark: '发出日 ' + todayISO() + ' 按天算' },
  ])
  const [busy, setBusy] = useState(false)
  const setItem = (i, k, v) => setItems(prev => prev.map((it, idx) => idx === i ? { ...it, [k]: v } : it))
  const addItem = () => setItems(prev => [...prev, { name: '', amount: 0, remark: '' }])
  const rmItem = i => setItems(prev => prev.filter((_, idx) => idx !== i))
  // 用某个月费+日期重算「当月月费(按天)」行
  const recalcProrated = (mf, dt) => {
    const pf = acProratedFee(mf || 0, dt)
    setItems(prev => prev.map(it => it.name === '当月月费(按天)' ? { ...it, amount: +pf.toFixed(2), remark: '发出日 ' + dt + ' · 月费' + fmt(mf) + ' 按天算' } : it))
  }
  const changeDate = v => { setDate(v); recalcProrated(monthlyFee, v) }
  const changeFee = v => { setMonthlyFee(v); recalcProrated(v, date) }
  const billTotal = items.reduce((s, it) => s + (+it.amount || 0), 0)

  const submit = async () => {
    if (!customer) return flash('请选择顾客')
    setBusy(true)
    const { error } = await db.assignAccount(acct.code, customer, date, price)
    if (error) { setBusy(false); return flash('发户口失败：' + error.message) }
    await logAudit('发户口', 'AC户口', acct.code, acCustName(D, customer) + ' · RM ' + fmt(price))
    if (makeBill && items.some(it => +it.amount > 0)) {
      const no = await nextNo('BILL')
      await db.saveAcBill({ no, billType: '首期', account: acct.code, customer, date, period, items: items.filter(it => it.name), note: '' })
      await logAudit('新增', 'AC账单', no, '首期 · ' + acCustName(D, customer) + ' · RM ' + fmt(billTotal))
    }
    reload(); setBusy(false); setModal(null); flash(makeBill ? '发户口 + 首期账单已保存' : '发户口成功')
  }
  return <Shell wide title={'发户口 — ' + acct.code} onClose={() => setModal(null)} footer={[<button key={1} className="btn ghost" onClick={() => setModal(null)}>取消</button>, <button key={2} className="btn" disabled={busy} onClick={submit}>{busy ? '保存中…' : '确认发出'}</button>]}>
    <div className="rateline">{`${acct.bank || ''} · 户口 ${acct.accountNo || acct.code} · ${acct.hasCard ? '有卡(' + acct.cardNo + ')' : '无卡'} · 进价 ${fmt(acct.cost)}`}</div>
    <div className="fg"><Field label="发给哪个顾客"><select value={customer} onChange={e => setCustomer(e.target.value)}><option value="">— 选顾客 —</option>{(D.acCustomers || []).map(c => <option key={c.code} value={c.code}>{c.name}</option>)}</select></Field>
      <Field label="发出日期"><input type="date" value={date} onChange={e => changeDate(e.target.value)} /></Field></div>
    <div className="fg"><Field label="户口卖价 (RM)"><input type="number" value={price} onChange={e => setPrice(+e.target.value)} /></Field>
      <Field label="月费 (RM/月，可改)"><input type="number" value={monthlyFee} onChange={e => changeFee(+e.target.value)} /></Field></div>

    <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 12, marginTop: 8 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14, fontWeight: 500 }}>
        <input type="checkbox" checked={makeBill} onChange={e => setMakeBill(e.target.checked)} style={{ width: 16, height: 16 }} />
        顺便开首期账单（开通费、电话卡、SSM 等 + 当月按天月费）
      </label>
      {makeBill && <div style={{ marginTop: 10 }}>
        <Field label="账期说明"><input value={period} placeholder="如 2026-01 首期" onChange={e => setPeriod(e.target.value)} /></Field>
        <table className="lineitems" style={{ marginTop: 8 }}><thead><tr><th>项目名称</th><th className="num" style={{ width: 100 }}>金额 RM</th><th>备注 Remark</th><th style={{ width: 36 }}></th></tr></thead>
          <tbody>{items.map((it, i) => <tr key={i}>
            <td><input value={it.name} onChange={e => setItem(i, 'name', e.target.value)} placeholder="项目名" /></td>
            <td><input type="number" value={it.amount} onChange={e => setItem(i, 'amount', +e.target.value)} /></td>
            <td><input value={it.remark} onChange={e => setItem(i, 'remark', e.target.value)} placeholder="收什么费用" /></td>
            <td><button className="linkbtn del" onClick={() => rmItem(i)}>×</button></td>
          </tr>)}</tbody></table>
        <button className="btn ghost sm" style={{ marginTop: 6 }} onClick={addItem}>+ 加项目</button>
        <div className="tot"><span className="k">首期账单总额</span><span className="v">{rm(billTotal)}</span></div>
      </div>}
    </div>
    <div className="hint" style={{ marginTop: 8 }}>发户口利润 = 卖价 − 进价 = RM {fmt((price || 0) - (acct.cost || 0))}{makeBill ? '（首期账单单独记应收）' : ''}</div>
  </Shell>
}

/* ---------- AC 账单列表 ---------- */
function ACBilling({ D, setModal, flash, logAudit, reload }) {
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('全部')
  const [genBusy, setGenBusy] = useState(false)
  const runGen = async (manual) => {
    setGenBusy(true)
    const r = await generateMonthlyBills(D)
    setGenBusy(false)
    if (r.created > 0) {
      await logAudit('自动', 'AC月费', '批量', `生成 ${r.created} 张月费单`)
      reload()
      flash(`已生成 ${r.created} 张月费单` + (r.stoppedPending > 0 ? ` · 另有 ${r.stoppedPending} 个停收户口未开` : ''))
    } else if (manual) {
      flash(r.stoppedPending > 0 ? `本月都已开齐 · 有 ${r.stoppedPending} 个停收户口未开` : '本月月费单都已开齐，无需补开')
    }
  }
  // 打开账单页自动补开本月漏的月费单（每次进页面跑一次）
  const didAuto = useRef(false)
  useEffect(() => {
    if (didAuto.current) return
    didAuto.current = true
    runGen(false)
  }, [])
  let rows = [...(D.acBills || [])].reverse()
  if (filter !== '全部') rows = rows.filter(b => acBillStatus(D, b) === (filter === '未收' ? 'Open' : filter === '部分' ? 'Partial' : 'Paid'))
  rows = rows.filter(b => JSON.stringify(b).toLowerCase().includes(q.toLowerCase()) || acCustName(D, b.customer).toLowerCase().includes(q.toLowerCase()))
  return <div>
    <div className="panel" style={{ marginBottom: 12, background: 'var(--accent-soft)', border: '1px solid var(--accent-line)' }}><div className="body" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <div style={{ flex: 1, minWidth: 200 }}><b>自动月费</b><div className="hint">打开这一页会自动补开本月该收的月费单。也可以手动点右边一键补开。</div></div>
      <button className="btn" disabled={genBusy} onClick={() => runGen(true)}>{genBusy ? '生成中…' : '🔄 一键补开本月月费'}</button>
    </div></div>
    <div className="bar">
      <input placeholder="搜索单号/顾客…" value={q} onChange={e => setQ(e.target.value)} style={{ minWidth: 200 }} />
      <select value={filter} onChange={e => setFilter(e.target.value)}>{['全部', '未收', '部分', '已付'].map(x => <option key={x}>{x}</option>)}</select>
      <div className="sp" />
      <button className="btn ghost" onClick={() => setModal({ type: 'acBill', data: { billType: '月费' } })}>+ 月费账单</button>
      <button className="btn" onClick={() => setModal({ type: 'acBill', data: { billType: '首期' } })}>+ 首期账单</button>
    </div>
    <div className="panel"><table>
      <thead><tr>{['单号', '类型', '日期', '账期', '顾客', '户口', '金额', '已收', '状态', ''].map((x, i) => <th key={i} className={i === 6 || i === 7 ? 'num' : ''}>{x}</th>)}</tr></thead>
      <tbody>{rows.length ? rows.map(b => { const tot = acBillTotal(b), paid = acBillPaid(D, b.no); const st = acBillStatus(D, b); return <tr key={b.no}>
        <td><span className="code">{b.no}</span></td>
        <td><span className={'pill ' + (b.billType === '首期' ? 'partial' : 'ok')}>{b.billType}</span></td>
        <td>{b.date}</td><td>{b.period || '—'}</td><td>{acCustName(D, b.customer)}</td><td><span className="code">{b.account || '—'}</span></td>
        <td className="num">{fmt(tot)}</td><td className="num">{fmt(paid)}</td>
        <td>{st === 'Paid' ? <span className="pill ok">已付</span> : st === 'Partial' ? <span className="pill partial">部分</span> : <span className="pill open">未收</span>}</td>
        <td><button className="linkbtn" onClick={() => setModal({ type: 'viewAcBill', data: b })}>查看</button></td>
      </tr> }) : <tr><td colSpan={10}><div className="empty">暂无账单</div></td></tr>}</tbody>
    </table></div>
  </div>
}

/* ---------- AC 收款列表 ---------- */
function ACPay({ D, setModal }) {
  return <div>
    <div className="bar"><div className="sp" /><button className="btn" onClick={() => setModal({ type: 'acReceipt' })}>+ 新收款</button></div>
    <div className="panel"><table>
      <thead><tr>{['收款单', '日期', '顾客', '金额', '方式', '冲账单', ''].map((x, i) => <th key={i} className={i === 3 ? 'num' : ''}>{x}</th>)}</tr></thead>
      <tbody>{(D.acReceipts || []).length ? [...(D.acReceipts || [])].reverse().map(r => <tr key={r.no}>
        <td><span className="code">{r.no}</span></td><td>{r.date}</td><td>{acCustName(D, r.customer)}</td>
        <td className="num">{fmt(r.amount)}</td><td>{r.method || '—'}</td>
        <td>{(r.allocs || []).map(a => a.bill).join('、') || '—'}</td>
        <td><button className="linkbtn" onClick={() => setModal({ type: 'acReceipt', data: r })}>查看</button></td>
      </tr>) : <tr><td colSpan={7}><div className="empty">暂无收款</div></td></tr>}</tbody>
    </table></div>
  </div>
}

/* ---------- AC 应收总览 ---------- */
function ACReceivables({ D, setModal }) {
  const [onlyOwing, setOnlyOwing] = useState(false)
  const all = (D.acCustomers || []).map(c => ({ c, b: acCustomerBalance(D, c.code) })).filter(x => x.b.billed > 0 || x.b.outstanding > 0.01)
  const owingRows = all.filter(x => x.b.outstanding > 0.01)
  const rows = onlyOwing ? owingRows : all
  const totalOut = all.reduce((s, x) => s + x.b.outstanding, 0)
  return <div>
    <div className="kpis">
      <div className="kpi" onClick={() => setOnlyOwing(false)} style={{ cursor: 'pointer', outline: !onlyOwing ? '2px solid var(--accent-line)' : 'none' }}><div className="l">总应收</div><div className="v mono">{rm(totalOut)}</div></div>
      <div className="kpi" onClick={() => setOnlyOwing(true)} style={{ cursor: 'pointer', outline: onlyOwing ? '2px solid var(--danger-line)' : 'none' }}><div className="l">有欠款顾客 · 点看是谁</div><div className="v" style={{ color: owingRows.length ? 'var(--danger)' : 'var(--ink)' }}>{fmtInt(owingRows.length)}</div></div>
    </div>
    {onlyOwing && <div className="hint" style={{ margin: '0 2px 8px' }}>只看有欠款的 {owingRows.length} 位 · <span className="linkbtn" onClick={() => setOnlyOwing(false)}>显示全部</span></div>}
    <div className="panel"><table>
      <thead><tr>{['顾客', '账单总额', '已收', '未收', ''].map((x, i) => <th key={i} className={i >= 1 && i <= 3 ? 'num' : ''}>{x}</th>)}</tr></thead>
      <tbody>{rows.length ? rows.map(({ c, b }) => <tr key={c.code} style={b.outstanding > 0.01 ? { background: 'var(--danger-soft)' } : {}}>
        <td><b>{c.name}</b></td><td className="num">{fmt(b.billed)}</td><td className="num">{fmt(b.paid)}</td>
        <td className={'num' + (b.outstanding > 0.01 ? ' neg' : '')}>{fmt(b.outstanding)}</td>
        <td><button className="linkbtn" onClick={() => setModal({ type: 'acReceipt', data: { customer: c.code } })}>收款</button></td>
      </tr>) : <tr><td colSpan={5}><div className="empty">{onlyOwing ? '没有欠款顾客 ✓' : '暂无应收'}</div></td></tr>}</tbody>
    </table></div>
  </div>
}

/* ---------- 账单表单（首期可自由加项目 / 月费）---------- */
function ACBillForm({ D, setModal, flash, logAudit, reload, modal }) {
  const billType = modal.data?.billType || '月费'
  const isFirst = billType === '首期'
  const editing = modal.data?.no ? modal.data : null
  const [account, setAccount] = useState(editing?.account || '')
  // 新结构：account 存的是银行户口 code (BA-xxx)
  const ba = (D.acBankAccounts || []).find(a => a.code === account)
  const co = ba ? acCoOf(D, ba.company) : null
  const [customer, setCustomer] = useState(editing?.customer || '')
  const [date, setDate] = useState(editing?.date || todayISO())
  const [period, setPeriod] = useState(editing?.period || acCurrentPeriod())
  const [items, setItems] = useState(editing?.items || (isFirst
    ? [{ name: '开通费', amount: 0, cost: 0, remark: '', kind: 'init' }]
    : [{ name: '月费', amount: 0, cost: 0, remark: '', kind: 'fee' }]))
  const [share, setShare] = useState(0)   // 这次要给卡商多少（可改）
  const [busy, setBusy] = useState(false)

  const chooseAccount = code => {
    setAccount(code)
    const b = (D.acBankAccounts || []).find(x => x.code === code)
    if (!b) return
    setCustomer(b.customer || '')   // 顾客存在银行户口本身，不是公司
    const useDate = isFirst && b.assignDate ? b.assignDate : date   // 首期账单：带出这户口的发出日
    if (useDate !== date) setDate(useDate)
    if (isFirst) {
      const pf = acProratedFee(b.monthlyFee || 0, useDate)
      setItems(prev => {
        const base = prev.filter(it => it.name !== '当月月费(按天)')
        return [...base, { name: '当月月费(按天)', amount: +pf.toFixed(2), cost: 0, remark: '发出日 ' + useDate + ' 按天算', kind: 'fee' }]
      })
      setShare(+acProratedFee(b.supplierShare || 0, useDate).toFixed(2))
      setPeriod(acPeriodOf(useDate))
    } else {
      setItems([{ name: '月费', amount: b.monthlyFee || 0, cost: 0, remark: '', kind: 'fee' }])
      setShare(+(b.supplierShare || 0))
    }
  }
  const setItem = (i, k, v) => setItems(prev => prev.map((it, idx) => idx === i ? { ...it, [k]: v } : it))
  const addItem = () => setItems(prev => [...prev, { name: '', amount: 0, cost: 0, remark: '', kind: isFirst ? 'init' : 'fee' }])
  const rmItem = i => setItems(prev => prev.filter((_, idx) => idx !== i))
  // 改日期后，重新算按天那项的金额（只在新增首期账单、且已选户口时）
  useEffect(() => {
    if (!editing && isFirst && ba) {
      const pf = acProratedFee(ba.monthlyFee || 0, date)
      setItems(prev => prev.map(it => it.name === '当月月费(按天)' ? { ...it, amount: +pf.toFixed(2), remark: '发出日 ' + date + ' 按天算' } : it))
      setShare(+acProratedFee(ba.supplierShare || 0, date).toFixed(2))
      setPeriod(acPeriodOf(date))
    }
  }, [date])
  const total = items.reduce((s, it) => s + (+it.amount || 0), 0)
  const costTotal = items.reduce((s, it) => s + (+it.cost || 0), 0)
  const grossProfit = total - costTotal - (ba && baPaying(ba) ? (+share || 0) : 0)

  const submit = async () => {
    if (!account) return flash('请选择银行户口')
    if (!customer) return flash('这个户口所属公司还没发给顾客，或请选顾客')
    if (!items.length) return flash('请至少加一个项目')
    // 安全检查：这户口正常要给卡商分成，但现在算出来是 0 — 很可能是漏填，提醒一下
    if (ba && baPaying(ba) && (+ba.supplierShare || 0) > 0 && (+share || 0) <= 0) {
      if (!confirm(`这户口平常要给卡商 ${acSupName(D, co?.supplier)} 分成，但现在「给卡商」栏是 0 或空的。\n\n确定要这样保存吗？（保存后不会产生卡商应付）`)) return
    }
    setBusy(true)
    const no = editing?.no || await nextNo('BILL')
    await db.saveAcBill({ no, billType, account, customer, date, period, items, note: '' })
    // 同时产生卡商月费应付（停付的不产生）
    await db.delAcDuesByBill(no); await db.delAgentDuesByBill(no)   // 编辑时先清掉旧的，避免重复
    if (ba && baPaying(ba) && (+share || 0) > 0) {
      await db.saveAcDue({
        supplier: co?.supplier, bankAccount: ba.code, company: ba.company,
        billNo: no, period, date, amount: +share, settled: false,
        note: `${acCoName(D, ba.company)} · ${ba.bank}`
      })
    }
    await logAudit(editing ? '修改' : '新增', 'AC账单', no, `${billType} · ${acCustName(D, customer)} · RM ${fmt(total)}${(+share || 0) > 0 ? ` · 卡商应付 RM ${fmt(share)}` : ''}`)
    reload(); setBusy(false); setModal(null); flash('账单已保存' + ((+share || 0) > 0 ? ' · 已产生卡商应付' : ''))
  }

  return <Shell wide title={(editing ? '编辑' : '新增') + billType + '账单'} onClose={() => setModal(null)}
    footer={[<button key={1} className="btn ghost" onClick={() => setModal(null)}>取消</button>, <button key={2} className="btn" disabled={busy} onClick={submit}>{busy ? '保存中…' : '保存账单'}</button>]}>
    <div className="fg">
      <Field label="银行户口"><select value={account} onChange={e => chooseAccount(e.target.value)}><option value="">— 选银行户口 —</option>
        {(D.acBankAccounts || []).map(a => { const c = acCoOf(D, a.company); return <option key={a.code} value={a.code}>{c ? c.name : '?'} · {a.bank} {a.accountNo || ''} · {a.status}</option> })}</select></Field>
      <Field label="顾客"><select value={customer} onChange={e => setCustomer(e.target.value)}><option value="">— 选顾客 —</option>{(D.acCustomers || []).map(c => <option key={c.code} value={c.code}>{c.name}</option>)}</select></Field>
    </div>
    <div className="fg">
      <Field label="日期"><input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
      <Field label="账期"><input value={period} placeholder="如 2026-06" onChange={e => setPeriod(e.target.value)} /></Field>
    </div>
    {ba && <div className="rateline">
      {`${acCoName(D, ba.company)} · ${ba.bank} · 标准月费 RM ${fmt(ba.monthlyFee || 0)}/月 · 状态 ${ba.status}`}
      {!baCharging(ba) && <span style={{ color: 'var(--danger)' }}> · ⚠ 此户口已停收顾客月费</span>}
    </div>}
    <div style={{ marginTop: 6 }}>
      <div className="hint" style={{ marginBottom: 6 }}>账单项目 — <b>成本</b>栏：代收代付的填跟金额一样（赚 0），有赚的填实际成本</div>
      <table className="lineitems"><thead><tr><th>项目名称</th><th className="num" style={{ width: 100 }}>金额 RM</th><th className="num" style={{ width: 100 }}>成本 RM</th><th className="num" style={{ width: 80 }}>赚</th><th>备注</th><th style={{ width: 40 }}></th></tr></thead>
        <tbody>{items.map((it, i) => <tr key={i}>
          <td><input value={it.name} onChange={e => setItem(i, 'name', e.target.value)} placeholder="项目名" /></td>
          <td><input type="number" value={it.amount} onChange={e => setItem(i, 'amount', +e.target.value)} /></td>
          <td><input type="number" value={it.cost || 0} onChange={e => setItem(i, 'cost', +e.target.value)} /></td>
          <td className="num" style={{ color: ((+it.amount || 0) - (+it.cost || 0)) >= 0 ? 'var(--accent)' : 'var(--danger)' }}>{fmt((+it.amount || 0) - (+it.cost || 0))}</td>
          <td><input value={it.remark} onChange={e => setItem(i, 'remark', e.target.value)} placeholder="收什么费用" /></td>
          <td><button className="linkbtn del" onClick={() => rmItem(i)}>×</button></td>
        </tr>)}</tbody></table>
      <button className="btn ghost sm" style={{ marginTop: 6 }} onClick={addItem}>+ 加项目</button>
    </div>
    {ba && <div style={{ border: '1px solid var(--gold-line)', background: 'var(--gold-soft)', borderRadius: 8, padding: 12, marginTop: 12 }}>
      <div className="hint" style={{ marginBottom: 6 }}>这张账单要给卡商 <b>{acSupName(D, co?.supplier)}</b> 多少？（默认带出，可改）</div>
      {baPaying(ba)
        ? <input type="number" value={share} onChange={e => setShare(+e.target.value)} style={{ width: 160 }} />
        : <div style={{ color: 'var(--danger)', fontSize: 13 }}>此户口已「停付卡商分成」，不会产生应付</div>}
    </div>}
    <div className="tot"><span className="k">账单总额（跟顾客收）</span><span className="v">{rm(total)}</span></div>
    <div className="tot"><span className="k">项目成本</span><span className="v">{rm(costTotal)}</span></div>
    {ba && baPaying(ba) && <div className="tot"><span className="k">给卡商</span><span className="v">{rm(share)}</span></div>}
    <div className="tot" style={{ borderTop: '1px solid var(--line)', marginTop: 6, paddingTop: 8 }}><span className="k"><b>这张单净赚</b></span><span className={'v ' + (grossProfit >= 0 ? 'pos' : 'neg')}><b>{rm(grossProfit)}</b></span></div>
  </Shell>
}

/* ---------- 查看账单 ---------- */
function ViewACBill({ D, setModal, flash, logAudit, reload, modal }) {
  const b = modal.data, tot = acBillTotal(b), paid = acBillPaid(D, b.no)
  const del = async () => { if (!confirm('删除账单 ' + b.no + '？\n对应的卡商应付也会一起删除。')) return; await db.delAcDuesByBill(b.no); await db.delAgentDuesByBill(b.no); await db.delAcBill(b.no); await logAudit('删除', 'AC账单', b.no, acCustName(D, b.customer)); reload(); setModal(null); flash('账单已删除') }
  return <Shell title={b.billType + '账单 — ' + b.no} onClose={() => setModal(null)}
    footer={[<button key={0} className="btn danger" onClick={del}>删除</button>, <div key={1} style={{ flex: 1 }} />, <button key={2} className="btn ghost" onClick={() => setModal(null)}>关闭</button>, <button key={3} className="btn" onClick={() => setModal({ type: 'acReceipt', data: { customer: b.customer, prefBill: b.no } })}>收款</button>]}>
    <div className="fg"><div><div className="hint">顾客 · 户口</div><b>{acCustName(D, b.customer)} · {b.account}</b></div><div><div className="hint">日期 · 账期</div><b>{b.date} · {b.period || '—'}</b></div></div>
    <table style={{ marginTop: 8 }}><thead><tr>{['项目', '金额', '备注'].map((x, i) => <th key={i} className={i === 1 ? 'num' : ''}>{x}</th>)}</tr></thead>
      <tbody>{b.items.map((it, i) => <tr key={i}><td>{it.name}</td><td className="num">{fmt(it.amount)}</td><td><span className="muted">{it.remark || '—'}</span></td></tr>)}</tbody></table>
    <div className="tot"><span className="k">账单总额</span><span className="v">{rm(tot)}</span></div>
    <div className="tot"><span className="k">已收</span><span className="v">{rm(paid)}</span></div>
    <div className="tot"><span className="k">未收</span><span className="v">{rm(tot - paid)}</span></div>
  </Shell>
}

/* ---------- AC 收款表单 ---------- */
function ACReceiptForm({ D, setModal, flash, logAudit, reload, modal }) {
  const editing = modal.data?.no ? modal.data : null
  const [customer, setCustomer] = useState(modal.data?.customer || editing?.customer || '')
  const [date, setDate] = useState(editing?.date || todayISO())
  const [method, setMethod] = useState(editing?.method || '现金')
  const [busy, setBusy] = useState(false)
  // 该顾客未付清的账单
  const openBills = (D.acBills || []).filter(b => b.customer === customer && acBillStatus(D, b) !== 'Paid')
  const [allocs, setAllocs] = useState(() => {
    const init = {}
    if (editing) (editing.allocs || []).forEach(a => { init[a.bill] = a.amount })
    else if (modal.data?.prefBill) { const b = (D.acBills || []).find(x => x.no === modal.data.prefBill); if (b) init[b.no] = acBillTotal(b) - acBillPaid(D, b.no) }
    return init
  })
  const setAlloc = (no, v) => setAllocs(p => ({ ...p, [no]: v }))
  const total = Object.values(allocs).reduce((s, v) => s + (+v || 0), 0)

  const submit = async () => {
    if (!customer) return flash('请选顾客')
    const list = Object.entries(allocs).filter(([, v]) => +v > 0).map(([bill, amount]) => ({ bill, amount: +amount }))
    if (!list.length) return flash('请填写要收的金额')
    setBusy(true)
    const no = editing?.no || await nextNo('ARCPT')
    await db.saveAcReceipt({ no, customer, date, amount: total, allocs: list, method, note: '' })
    await logAudit(editing ? '修改' : '新增', 'AC收款', no, acCustName(D, customer) + ' · RM ' + fmt(total))
    reload(); setBusy(false); setModal(null); flash('收款已保存')
  }
  const del = async () => { if (!editing) return; if (!confirm('删除收款 ' + editing.no + '？')) return; await db.delAcReceipt(editing.no); await logAudit('删除', 'AC收款', editing.no, ''); reload(); setModal(null); flash('已删除') }

  return <Shell wide title={editing ? '收款 — ' + editing.no : '新增 AC 收款'} onClose={() => setModal(null)}
    footer={[editing && <button key={0} className="btn danger" onClick={del}>删除</button>, <div key={1} style={{ flex: 1 }} />, <button key={2} className="btn ghost" onClick={() => setModal(null)}>取消</button>, <button key={3} className="btn" disabled={busy} onClick={submit}>{busy ? '保存中…' : '保存收款'}</button>].filter(Boolean)}>
    <div className="fg">
      <Field label="顾客"><select value={customer} onChange={e => { setCustomer(e.target.value); setAllocs({}) }}><option value="">— 选顾客 —</option>{(D.acCustomers || []).map(c => <option key={c.code} value={c.code}>{c.name}</option>)}</select></Field>
      <Field label="日期"><input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
    </div>
    <Field label="付款方式"><select value={method} onChange={e => setMethod(e.target.value)}>{['现金', '银行转账', 'E-wallet', '其他'].map(x => <option key={x}>{x}</option>)}</select></Field>
    {customer && <div style={{ marginTop: 6 }}>
      <div className="hint" style={{ marginBottom: 6 }}>未付清的账单（填要冲的金额）</div>
      {openBills.length ? <table className="lineitems"><thead><tr><th>账单</th><th>类型</th><th className="num">未收</th><th className="num" style={{ width: 120 }}>本次收</th></tr></thead>
        <tbody>{openBills.map(b => { const due = acBillTotal(b) - acBillPaid(D, b.no); return <tr key={b.no}>
          <td><span className="code">{b.no}</span></td><td>{b.billType}</td><td className="num">{fmt(due)}</td>
          <td><input type="number" value={allocs[b.no] || ''} placeholder="0" onChange={e => setAlloc(b.no, Math.min(+e.target.value, due))} /></td>
        </tr> })}</tbody></table> : <div className="empty">该顾客没有未付清的账单</div>}
    </div>}
    <div className="tot"><span className="k">收款合计</span><span className="v">{rm(total)}</span></div>
  </Shell>
}

/* ---------- 卡商结算 ---------- */
function ACSettle({ D, setModal }) {
  const rows = (D.acSuppliers || []).map(s => ({ s, p: acSupplierPayableV2(D, s.code) })).filter(x => x.p.dues > 0 || x.p.payable > 0.01)
  const totalPayable = rows.reduce((sm, x) => sm + x.p.payable, 0)
  const totalDues = rows.reduce((sm, x) => sm + x.p.dues, 0)
  return <div>
    <div className="kpis">
      <div className="kpi"><div className="l">卡商应付合计</div><div className="v mono">{rm(totalPayable)}</div></div>
      <div className="kpi"><div className="l">其中月费分成</div><div className="v mono">{rm(totalDues)}</div></div>
      <div className="kpi"><div className="l">有欠款卡商</div><div className="v">{fmt(rows.filter(x => x.p.payable > 0.01).length)}</div></div>
    </div>
    <div className="bar"><div className="sp" /><button className="btn" onClick={() => setModal({ type: 'acSettle' })}>+ 新结算</button></div>
    <div className="panel"><table>
      <thead><tr>{['卡商', '月费分成(未结)', '已结算', '应付', ''].map((x, i) => <th key={i} className={i >= 1 && i <= 3 ? 'num' : ''}>{x}</th>)}</tr></thead>
      <tbody>{rows.length ? rows.map(({ s, p }) => <tr key={s.code}>
        <td>{s.name}</td><td className="num">{fmt(p.dues)}</td><td className="num">{fmt(p.settled)}</td>
        <td className={'num' + (p.payable > 0.01 ? ' neg' : '')}>{fmt(p.payable)}</td>
        <td><button className="linkbtn" onClick={() => setModal({ type: 'acSettle', data: { supplier: s.code } })}>结算</button></td>
      </tr>) : <tr><td colSpan={5}><div className="empty">暂无应付</div></td></tr>}</tbody>
    </table></div>
    <div className="hint" style={{ marginTop: 8 }}>应付 = 未结算的月费分成 − 已结算。月费分成在开月费账单时自动产生。</div>
    <div className="panel" style={{ marginTop: 16 }}><h3>结算记录</h3><table>
      <thead><tr>{['结算单', '日期', '卡商', '金额', '方式', ''].map((x, i) => <th key={i} className={i === 3 ? 'num' : ''}>{x}</th>)}</tr></thead>
      <tbody>{(D.acSettlements || []).length ? [...(D.acSettlements || [])].reverse().map(st => <tr key={st.no}>
        <td><span className="code">{st.no}</span></td><td>{st.date}</td><td>{acSupName(D, st.supplier)}</td>
        <td className="num">{fmt(st.amount)}</td><td>{st.method || '—'}</td>
        <td><button className="linkbtn" onClick={() => setModal({ type: 'acSettle', data: st })}>查看</button></td>
      </tr>) : <tr><td colSpan={6}><div className="empty">暂无结算记录</div></td></tr>}</tbody>
    </table></div>
  </div>
}

/* ---- 卡商结算表单 ---- */
function ACSettleForm({ D, setModal, flash, logAudit, reload, modal }) {
  const editing = modal.data?.no ? modal.data : null
  const [supplier, setSupplier] = useState(modal.data?.supplier || editing?.supplier || '')
  const pay = supplier ? acSupplierPayableV2(D, supplier) : { payable: 0 }
  const [date, setDate] = useState(editing?.date || todayISO())
  const [amount, setAmount] = useState(editing?.amount || 0)
  const [method, setMethod] = useState(editing?.method || '银行转账')
  const [note, setNote] = useState(editing?.note || '')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    if (!supplier) return flash('请选卡商')
    if (!amount || amount <= 0) return flash('请填结算金额')
    setBusy(true)
    const no = editing?.no || await nextNo('SETL')
    await db.saveAcSettlement({ no, supplier, date, amount: +amount, accounts: [], method, note })
    // 用这笔结算把最早的未结月费分成标记为已结（先进先出）
    if (!editing) {
      let left = +amount
      const unsettled = (D.acSupplierDues || []).filter(d => d.supplier === supplier && !d.settled).sort((a, b) => (a.date || '').localeCompare(b.date || ''))
      const ids = []
      for (const d of unsettled) {
        if (left >= (+d.amount || 0) - 0.01) { ids.push(d.id); left -= (+d.amount || 0) } else break
      }
      if (ids.length) await db.markDuesSettled(ids, true)
    }
    await logAudit(editing ? '修改' : '新增', 'AC结算', no, acSupName(D, supplier) + ' · RM ' + fmt(amount))
    reload(); setBusy(false); setModal(null); flash('结算已保存')
  }
  const del = async () => { if (!editing) return; if (!confirm('删除结算 ' + editing.no + '？')) return; await db.delAcSettlement(editing.no); await logAudit('删除', 'AC结算', editing.no, ''); reload(); setModal(null); flash('已删除') }
  return <Shell title={editing ? '结算 — ' + editing.no : '新增卡商结算'} onClose={() => setModal(null)}
    footer={[editing && <button key={0} className="btn danger" onClick={del}>删除</button>, <div key={1} style={{ flex: 1 }} />, <button key={2} className="btn ghost" onClick={() => setModal(null)}>取消</button>, <button key={3} className="btn" disabled={busy} onClick={submit}>{busy ? '保存中…' : '保存'}</button>].filter(Boolean)}>
    <div className="fg"><Field label="卡商"><select value={supplier} onChange={e => setSupplier(e.target.value)}><option value="">— 选卡商 —</option>{(D.acSuppliers || []).map(s => <option key={s.code} value={s.code}>{s.name}</option>)}</select></Field>
      <Field label="日期"><input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field></div>
    {supplier && <div className="rateline">{`当前应付：RM ${fmt(pay.payable)}`}</div>}
    <div className="fg"><Field label="结算金额 (RM)"><input type="number" value={amount} onChange={e => setAmount(+e.target.value)} /></Field>
      <Field label="付款方式"><select value={method} onChange={e => setMethod(e.target.value)}>{['银行转账', '现金', 'E-wallet', '其他'].map(x => <option key={x}>{x}</option>)}</select></Field></div>
    <Field label="备注"><input value={note} onChange={e => setNote(e.target.value)} /></Field>
    {supplier && amount > 0 && <div className="hint">结算后卡商应付 = RM {fmt(pay.payable - amount)}</div>}
  </Shell>
}

/* ---------- AC 报表 ---------- */
/* ===================== AC 三种单据 ===================== */
function acDocHtml(title, subtitle, bodyHtml) {
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>${title}</title>
  <style>
    *{box-sizing:border-box}
    body{font-family:"PingFang SC","Microsoft YaHei",sans-serif;color:#1a1a1a;margin:0 auto;padding:20px;font-size:12px;max-width:210mm}
    .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #1f6f5c;padding-bottom:12px}
    .title h2{margin:0;font-size:22px;letter-spacing:2px;color:#1f6f5c;font-weight:800}
    .title .sub{margin-top:5px;font-size:12px;color:#444}
    .hd-right{text-align:right;font-size:11px;color:#555}
    table{width:100%;border-collapse:collapse;margin-top:12px}
    th{background:#f4f2ec;text-align:left;padding:7px 8px;font-size:10px;color:#555;border-bottom:2px solid #ddd}
    td{padding:7px 8px;border-bottom:1px solid #eee;font-size:11px}
    .n{text-align:right;font-family:monospace}
    tr.stop td{background:#ffe9e9;color:#c0392b;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    tr.grp td{background:#f7f7f4;font-weight:700}
    .seq{text-align:center;color:#999;width:34px;font-size:10px}
    tr.cnt td{background:#f0f6f3;font-weight:700;color:#1f6f5c;border-top:2px solid #1f6f5c}
    .sum{margin-top:12px;margin-left:auto;width:260px;font-size:12px}
    .sum .r{display:flex;justify-content:space-between;padding:4px 0}
    .sum .r.big{border-top:2px solid #1f6f5c;margin-top:5px;padding-top:8px;font-size:15px;font-weight:700;color:#1f6f5c}
    .foot{margin-top:26px;color:#888;font-size:10px}
    @media print{body{padding:0}.noprint{display:none}}
    @page{size:A4 portrait;margin:12mm}
    .noprint{margin-top:20px;text-align:center}
    .btn{background:#1f6f5c;color:#fff;border:0;padding:10px 22px;border-radius:8px;font-size:14px;cursor:pointer}
    .wm{position:fixed;top:45%;left:50%;transform:translate(-50%,-50%);width:60%;max-width:360px;opacity:.28;z-index:0;pointer-events:none;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    body>*:not(.wm){position:relative;z-index:1}
  </style></head><body>
    <img class="wm" src="${location.origin}/logo.png" onerror="this.style.display='none'"/>
    <div class="head">
      <div class="title"><h2>${title}</h2><div class="sub">${subtitle}</div></div>
      <div class="hd-right">打印日期<br><b>${todayISO()}</b></div>
    </div>
    ${bodyHtml}
    <div class="noprint"><button class="btn" onclick="window.print()">🖨 打印 / 存为 PDF</button></div>
  </body></html>`
}

/* 首期费用单（给顾客）：一个顾客一段期间内所有首期账单的明细 */
function ACInitCustomerDoc({ D, setModal, modal }) {
  const { from, to } = modal.data || {}
  const [cust, setCust] = useState((D.acCustomers || [])[0]?.code || '')
  const bills = (D.acBills || []).filter(b => b.billType === '首期' && b.customer === cust && b.date >= from && b.date <= to)
  const total = bills.reduce((s, b) => s + acBillTotal(b), 0)
  const paid = bills.reduce((s, b) => s + acBillPaid(D, b.no), 0)
  const doPrint = () => {
    const rows = bills.map(b => {
      const ba = (D.acBankAccounts || []).find(x => x.code === b.account)
      const head = `<tr class="grp"><td colspan="4">${b.date} · ${acCoName(D, ba?.company)} · ${ba?.bank || ''} <span style="font-weight:400;color:#888">(${b.no})</span></td></tr>`
      const items = (b.items || []).map(it => `<tr><td style="padding-left:20px">${it.name}</td><td>${it.remark || ''}</td><td class="n">${fmt(it.amount)}</td><td></td></tr>`).join('')
      return head + items
    }).join('')
    const body = `<table><thead><tr><th>项目</th><th>说明</th><th class="n">金额 RM</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="4">此期间无首期账单</td></tr>'}</tbody></table>
    <div class="sum"><div class="r"><span>首期费用合计</span><span>RM ${fmt(total)}</span></div>
    <div class="r"><span>已收</span><span>RM ${fmt(paid)}</span></div>
    <div class="r big"><span>尚欠</span><span>RM ${fmt(total - paid)}</span></div></div>
    <div class="foot">首期费用含开通费 / 电话卡 / 当月月费等 · Thank you</div>`
    renderPrint(acDocHtml('Payer Initial Charges', `${acCustName(D, cust)} · ${from} ~ ${to}`, body))
  }
  return <Shell wide title="顾客首期费用单" onClose={() => setModal(null)}
    footer={[<button key={1} className="btn ghost" onClick={() => setModal(null)}>关闭</button>, <button key={2} className="btn" onClick={doPrint}>🖨 打印</button>]}>
    <div className="bar"><select value={cust} onChange={e => setCust(e.target.value)}>{(D.acCustomers || []).map(c => <option key={c.code} value={c.code}>{c.name}</option>)}</select></div>
    <div className="tot"><span className="k">首期合计</span><span className="v">{rm(total)}</span></div>
    <div className="tot"><span className="k">已收</span><span className="v">{rm(paid)}</span></div>
    <div className="tot" style={{ borderTop: '1px solid var(--line)', marginTop: 6, paddingTop: 8 }}><span className="k"><b>尚欠</b></span><span className={'v ' + (total - paid > 0.01 ? 'neg' : 'pos')}><b>{rm(total - paid)}</b></span></div>
    <div className="panel" style={{ marginTop: 10 }}><table><thead><tr><th>日期</th><th>户口</th><th>项目</th><th className="num">金额</th></tr></thead>
      <tbody>{bills.length ? bills.map(b => { const ba = (D.acBankAccounts || []).find(x => x.code === b.account); return (b.items || []).map((it, i) => <tr key={b.no + i}><td>{i === 0 ? b.date : ''}</td><td>{i === 0 ? `${acCoName(D, ba?.company)} · ${ba?.bank || ''}` : ''}</td><td>{it.name}</td><td className="num">{fmt(it.amount)}</td></tr>) }) : <tr><td colSpan={4}><div className="empty">此期间无首期账单</div></td></tr>}</tbody></table></div>
  </Shell>
}

/* 首期单（给卡商）：一段期间发出户口的进价 + 首期分成 */
function ACInitSupplierDoc({ D, setModal, modal }) {
  const { from, to } = modal.data || {}
  const [sup, setSup] = useState((D.acSuppliers || [])[0]?.code || '')
  // 首期分成 = 该期间产生的、对应首期账单的卡商应付（发户口当月那笔，按天）
  const firstBillNos = new Set((D.acBills || []).filter(b => b.billType === '首期').map(b => b.no))
  const shareDues = (D.acSupplierDues || []).filter(d => d.supplier === sup && d.date >= from && d.date <= to && firstBillNos.has(d.billNo))
  const shareTotal = shareDues.reduce((s, d) => s + (+d.amount || 0), 0)
  const custOfDue = d => { const b = (D.acBankAccounts || []).find(x => x.code === d.bankAccount); return b ? acCustName(D, b.customer) : '—' }
  const doPrint = () => {
    const body = `
    ${shareDues.length ? `<h4 style="margin:14px 0 0;font-size:13px;color:#1f6f5c">首期月费分成（当月按天）</h4>
    <table><thead><tr><th>公司 · 银行</th><th>顾客</th><th>日期</th><th class="n">分成 RM</th></tr></thead><tbody>
    ${shareDues.map(d => `<tr><td>${d.note || d.bankAccount}</td><td>${custOfDue(d)}</td><td>${d.date}</td><td class="n">${fmt(d.amount)}</td></tr>`).join('')}
    </tbody></table>` : '<p style="color:#888">此期间没有首期分成</p>'}
    <div class="sum"><div class="r big"><span>首期分成合计</span><span>RM ${fmt(shareTotal)}</span></div></div>
    <div class="foot">此单为首期（发户口当月按天）分成 · 之后月费另见 Supplier Monthly Statement</div>`
    renderPrint(acDocHtml('Supplier Initial Statement', `${acSupName(D, sup)} · ${from} ~ ${to}`, body))
  }
  return <Shell wide title="卡商首期单" onClose={() => setModal(null)}
    footer={[<button key={1} className="btn ghost" onClick={() => setModal(null)}>关闭</button>, <button key={2} className="btn" onClick={doPrint}>🖨 打印</button>]}>
    <div className="bar"><select value={sup} onChange={e => setSup(e.target.value)}>{(D.acSuppliers || []).map(s => <option key={s.code} value={s.code}>{s.name}</option>)}</select></div>
    <div className="tot" style={{ borderTop: '1px solid var(--line)', marginTop: 6, paddingTop: 8 }}><span className="k"><b>首期分成合计（{shareDues.length} 笔）</b></span><span className="v"><b>{rm(shareTotal)}</b></span></div>
    <div className="panel" style={{ marginTop: 10 }}><table><thead><tr><th>公司 · 银行</th><th>顾客</th><th>日期</th><th className="num">分成</th></tr></thead>
      <tbody>{shareDues.length ? shareDues.map(d => { const b = (D.acBankAccounts || []).find(x => x.code === d.bankAccount); return <tr key={d.id}><td>{d.note || d.bankAccount}</td><td>{b ? acCustName(D, b.customer) : '—'}</td><td>{d.date}</td><td className="num">{fmt(d.amount)}</td></tr> }) : <tr><td colSpan={4}><div className="empty">此期间无首期分成</div></td></tr>}</tbody></table></div>
  </Shell>
}

function ACFeeListDoc({ D, setModal, modal }) {
  const { from, to } = modal.data || {}
  const [cust, setCust] = useState('')
  const [showStopped, setShowStopped] = useState(true)
  const custs = (D.acCustomers || []).filter(c => (D.acBankAccounts || []).some(b => b.customer === c.code))
  const list = (D.acBankAccounts || []).filter(b => b.stockStatus === '已发' && (!cust || b.customer === cust))
  const charging = list.filter(baCharging)
  const stopped = list.filter(b => !baCharging(b))
  const total = charging.reduce((s, b) => s + (+b.monthlyFee || 0), 0)
  const doPrint = () => {
    const row = (b, stop, i) => `<tr class="${stop ? 'stop' : ''}"><td class="seq">${i}</td><td>${acCustName(D, b.customer)}</td><td>${acCoName(D, b.company)}</td><td>${b.bank}</td><td>${b.accountNo || ''}</td><td>${acSupName(D, baSupplier(D, b))}</td><td>${b.assignDate || ''}</td><td class="n">${stop ? '—' : fmt(b.monthlyFee)}</td><td>${stop ? (b.status !== '正常' ? b.status : '停收') : ''}</td></tr>`
    const body = `<table><thead><tr><th class="seq">#</th><th>顾客</th><th>公司</th><th>银行</th><th>户口号</th><th>卡商</th><th>出户口日期</th><th class="n">月费 RM</th><th>备注</th></tr></thead><tbody>
      ${charging.map((b, i) => row(b, false, i + 1)).join('')}
      <tr class="cnt"><td colspan="7">共 ${charging.length} 个在收</td><td class="n">${fmt(total)}</td><td></td></tr>
      ${showStopped && stopped.length ? `<tr class="grp"><td colspan="9">以下已停收（${stopped.length} 个）</td></tr>` + stopped.map((b, i) => row(b, true, i + 1)).join('') : ''}
    </tbody></table>
    <div class="sum"><div class="r"><span>在收户口</span><span>${charging.length} 个</span></div>
    <div class="r big"><span>本期应收月费</span><span>RM ${fmt(total)}</span></div></div>
    <div class="foot">请于账期内缴付 · Thank you for your business</div>`
    renderPrint(acDocHtml('Payer Monthly Fee', `${cust ? acCustName(D, cust) : '全部顾客'} · ${from} ~ ${to}`, body))
  }
  return <Shell wide title="顾客月费清单" onClose={() => setModal(null)}
    footer={[<button key={1} className="btn ghost" onClick={() => setModal(null)}>关闭</button>, <button key={2} className="btn" onClick={doPrint}>🖨 打印</button>]}>
    <div className="bar">
      <select value={cust} onChange={e => setCust(e.target.value)}><option value="">全部顾客</option>{custs.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}</select>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
        <input type="checkbox" checked={showStopped} onChange={e => setShowStopped(e.target.checked)} style={{ width: 15, height: 15 }} />含已停的
      </label>
    </div>
    <div className="panel"><table><thead><tr><th>顾客</th><th>公司</th><th>银行</th><th>卡商</th><th>出户口</th><th className="num">月费</th><th>状态</th></tr></thead>
      <tbody>
        {charging.map(b => <tr key={b.code}><td>{acCustName(D, b.customer)}</td><td>{acCoName(D, b.company)}</td><td>{b.bank}</td><td>{acSupName(D, baSupplier(D, b))}</td><td>{b.assignDate || '—'}</td><td className="num">{fmt(b.monthlyFee)}</td><td><span className="pill ok">在收</span></td></tr>)}
        {showStopped && stopped.map(b => <tr key={b.code} style={{ background: 'var(--danger-soft)' }}><td>{acCustName(D, b.customer)}</td><td>{acCoName(D, b.company)}</td><td>{b.bank}</td><td>{acSupName(D, baSupplier(D, b))}</td><td>{b.assignDate || '—'}</td><td className="num">—</td><td><BAStatusPill s={b.status !== '正常' ? b.status : '停收'} /></td></tr>)}
        {!list.length && <tr><td colSpan={7}><div className="empty">没有已发出的户口</div></td></tr>}
      </tbody></table></div>
    <div className="tot"><span className="k">在收 {charging.length} 个 · 本期应收</span><span className="v">{rm(total)}</span></div>
  </Shell>
}

function ACStatementDoc({ D, setModal, modal }) {
  const { from, to } = modal.data || {}
  const [cust, setCust] = useState((D.acCustomers || [])[0]?.code || '')
  const bills = (D.acBills || []).filter(b => b.customer === cust && b.date >= from && b.date <= to)
  const receipts = (D.acReceipts || []).filter(r => r.customer === cust && r.date >= from && r.date <= to)
  const bal = acCustomerBalance(D, cust)
  const billed = bills.reduce((s, b) => s + acBillTotal(b), 0)
  const paid = receipts.reduce((s, r) => s + (+r.amount || 0), 0)
  const doPrint = () => {
    const rows = [
      ...bills.map(b => ({ d: b.date, t: b.billType + '账单 ' + b.no, dr: acBillTotal(b), cr: 0 })),
      ...receipts.map(r => ({ d: r.date, t: '收款 ' + r.no + (r.method ? ' · ' + r.method : ''), dr: 0, cr: +r.amount || 0 })),
    ].sort((a, b) => a.d.localeCompare(b.d))
    let run = 0
    const body = `<table><thead><tr><th>日期</th><th>项目</th><th class="n">应收</th><th class="n">已收</th><th class="n">余额</th></tr></thead><tbody>
      ${rows.map(r => { run += r.dr - r.cr; return `<tr><td>${r.d}</td><td>${r.t}</td><td class="n">${r.dr ? fmt(r.dr) : ''}</td><td class="n">${r.cr ? fmt(r.cr) : ''}</td><td class="n">${fmt(run)}</td></tr>` }).join('')}
    </tbody></table>
    <div class="sum"><div class="r"><span>期间开单</span><span>RM ${fmt(billed)}</span></div>
    <div class="r"><span>期间收款</span><span>RM ${fmt(paid)}</span></div>
    <div class="r big"><span>累计未收</span><span>RM ${fmt(bal.outstanding)}</span></div></div>
    <div class="foot">如有疑问请联络我们 · Statement of Account</div>`
    renderPrint(acDocHtml('对账单 STATEMENT', `${acCustName(D, cust)} · ${from} ~ ${to}`, body))
  }
  return <Shell wide title="顾客对账单" onClose={() => setModal(null)}
    footer={[<button key={1} className="btn ghost" onClick={() => setModal(null)}>关闭</button>, <button key={2} className="btn" onClick={doPrint}>🖨 打印</button>]}>
    <div className="bar"><select value={cust} onChange={e => setCust(e.target.value)}>{(D.acCustomers || []).map(c => <option key={c.code} value={c.code}>{c.name}</option>)}</select></div>
    <div className="tot"><span className="k">期间开单</span><span className="v">{rm(billed)}</span></div>
    <div className="tot"><span className="k">期间收款</span><span className="v">{rm(paid)}</span></div>
    <div className="tot" style={{ borderTop: '1px solid var(--line)', marginTop: 6, paddingTop: 8 }}><span className="k"><b>累计未收</b></span><span className={'v ' + (bal.outstanding > 0.01 ? 'neg' : 'pos')}><b>{rm(bal.outstanding)}</b></span></div>
    <div className="panel" style={{ marginTop: 10 }}><table><thead><tr><th>日期</th><th>账单</th><th className="num">金额</th><th className="num">已收</th></tr></thead>
      <tbody>{bills.map(b => <tr key={b.no}><td>{b.date}</td><td><span className="code">{b.no}</span> {b.billType}</td><td className="num">{fmt(acBillTotal(b))}</td><td className="num">{fmt(acBillPaid(D, b.no))}</td></tr>)}
        {!bills.length && <tr><td colSpan={4}><div className="empty">此期间无账单</div></td></tr>}</tbody></table></div>
  </Shell>
}

function ACSupplierDueDoc({ D, setModal, modal }) {
  const { from, to } = modal.data || {}
  const [sup, setSup] = useState((D.acSuppliers || [])[0]?.code || '')
  const dues = (D.acSupplierDues || []).filter(d => d.supplier === sup && d.date >= from && d.date <= to)
  const dueTotal = dues.reduce((s, d) => s + (+d.amount || 0), 0)
  const pay = acSupplierPayableV2(D, sup)
  const doPrint = () => {
    const custOfDue = d => { const b = (D.acBankAccounts || []).find(x => x.code === d.bankAccount); return b ? acCustName(D, b.customer) : '—' }
    const body = `
    ${dues.length ? `<h4 style="margin:14px 0 0;font-size:13px;color:#1f6f5c">月费分成</h4>
    <table><thead><tr><th class="seq">#</th><th>账期</th><th>公司 · 银行</th><th>顾客</th><th>日期</th><th class="n">分成 RM</th><th>状态</th></tr></thead><tbody>
    ${dues.map((d, i) => `<tr><td class="seq">${i + 1}</td><td>${d.period || ''}</td><td>${d.note || d.bankAccount}</td><td>${custOfDue(d)}</td><td>${d.date}</td><td class="n">${fmt(d.amount)}</td><td>${d.settled ? '已结' : '未结'}</td></tr>`).join('')}
    <tr class="cnt"><td colspan="5">共 ${dues.length} 笔</td><td class="n">${fmt(dueTotal)}</td><td></td></tr>
    </tbody></table>` : '<p style="color:#888">此期间没有月费分成</p>'}
    <div class="sum"><div class="r big"><span>本期月费分成</span><span>RM ${fmt(dueTotal)}</span></div>
    <div class="r"><span>累计未结（含以往）</span><span>RM ${fmt(pay.payable)}</span></div></div>
    <div class="foot">此清单供双方核对 · Supplier Monthly Statement</div>`
    renderPrint(acDocHtml('Supplier Monthly Statement', `${acSupName(D, sup)} · ${from} ~ ${to}`, body))
  }
  return <Shell wide title="卡商应付清单" onClose={() => setModal(null)}
    footer={[<button key={1} className="btn ghost" onClick={() => setModal(null)}>关闭</button>, <button key={2} className="btn" onClick={doPrint}>🖨 打印</button>]}>
    <div className="bar"><select value={sup} onChange={e => setSup(e.target.value)}>{(D.acSuppliers || []).map(s => <option key={s.code} value={s.code}>{s.name}</option>)}</select></div>
    <div className="tot"><span className="k">月费分成（{dues.length} 笔）</span><span className="v">{rm(dueTotal)}</span></div>
    <div className="tot" style={{ borderTop: '1px solid var(--line)', marginTop: 6, paddingTop: 8 }}><span className="k"><b>本期应付（月费分成）</b></span><span className="v"><b>{rm(dueTotal)}</b></span></div>
    <div className="tot"><span className="k">累计未结（含以往）</span><span className={'v ' + (pay.payable > 0.01 ? 'neg' : '')}>{rm(pay.payable)}</span></div>
    <div className="panel" style={{ marginTop: 10 }}><table><thead><tr><th>账期</th><th>公司 · 银行</th><th>顾客</th><th>日期</th><th className="num">分成</th><th>状态</th></tr></thead>
      <tbody>{dues.map(d => { const b = (D.acBankAccounts || []).find(x => x.code === d.bankAccount); return <tr key={d.id}><td>{d.period}</td><td>{d.note || d.bankAccount}</td><td>{b ? acCustName(D, b.customer) : '—'}</td><td>{d.date}</td><td className="num">{fmt(d.amount)}</td><td>{d.settled ? <span className="pill ok">已结</span> : <span className="pill open">未结</span>}</td></tr> })}
        {!dues.length && <tr><td colSpan={6}><div className="empty">此期间没有月费分成</div></td></tr>}</tbody></table></div>
  </Shell>
}

/* ===== 银行名单管理 ===== */
function ACBanks({ D, setModal, flash, logAudit, reload }) {
  const [newBank, setNewBank] = useState('')
  const [busy, setBusy] = useState(false)
  const banks = (D.acBanks && D.acBanks.length) ? D.acBanks : BANK_LIST_DEFAULT.map((n, i) => ({ name: n, sortOrder: i + 1 }))
  const add = async () => {
    const nm = newBank.trim()
    if (!nm) return flash('请输入银行名')
    if (banks.some(b => b.name === nm)) return flash('已经有这家银行了')
    setBusy(true)
    const maxOrder = Math.max(0, ...banks.map(b => b.sortOrder || 0).filter(o => o < 99))
    await db.saveAcBank(nm, maxOrder + 1)
    await logAudit('新增', '银行', nm, ''); setNewBank(''); reload(); setBusy(false); flash('已加入：' + nm)
  }
  const del = async name => {
    const used = (D.acBankAccounts || []).filter(b => b.bank === name).length
    if (used > 0) return flash(`有 ${used} 个户口用这家银行，不能删`)
    if (!confirm('删除银行 ' + name + '？')) return
    await db.delAcBank(name); await logAudit('删除', '银行', name, ''); reload(); flash('已删除')
  }
  return <div>
    <div className="panel" style={{ marginBottom: 12 }}><div className="body" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <input placeholder="输入新银行名，如 Maybank Islamic" value={newBank} onChange={e => setNewBank(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} style={{ flex: 1 }} />
      <button className="btn" disabled={busy} onClick={add}>+ 加银行</button>
    </div></div>
    <div className="panel"><table>
      <thead><tr><th style={{ width: 50 }}>#</th><th>银行名</th><th className="num">用了几个户口</th><th></th></tr></thead>
      <tbody>{banks.map((b, i) => {
        const used = (D.acBankAccounts || []).filter(x => x.bank === b.name).length
        return <tr key={b.name}>
          <td className="num">{i + 1}</td><td><b>{b.name}</b></td><td className="num">{fmt(used)}</td>
          <td>{used === 0 && b.name !== '其他' ? <button className="linkbtn del" onClick={() => del(b.name)}>删</button> : <span className="hint">{used > 0 ? '使用中' : ''}</span>}</td>
        </tr>
      })}</tbody>
    </table></div>
    <div className="hint" style={{ marginTop: 8 }}>加了银行后，发户口 / 编辑户口时下拉就能选到。有户口在用的银行不能删。</div>
  </div>
}

/* Agent 佣金单（可打印，像卡商月费单）*/
function ACAgentDueDoc({ D, setModal, modal }) {
  const { from, to } = modal.data || {}
  const [ag, setAg] = useState((D.acAgents || [])[0]?.code || '')
  const dues = (D.acAgentDues || []).filter(d => d.agent === ag && d.date >= from && d.date <= to)
  const dueTotal = dues.reduce((s, d) => s + (+d.amount || 0), 0)
  const pay = acAgentPayable(D, ag)
  const doPrint = () => {
    const custOfDue = d => { const b = (D.acBankAccounts || []).find(x => x.code === d.bankAccount); return b ? acCustName(D, b.customer) : '—' }
    const body = `
    ${dues.length ? `<h4 style="margin:14px 0 0;font-size:13px;color:#1f6f5c">佣金明细</h4>
    <table><thead><tr><th class="seq">#</th><th>账期</th><th>公司 · 银行</th><th>顾客</th><th>日期</th><th class="n">佣金 RM</th><th>状态</th></tr></thead><tbody>
    ${dues.map((d, i) => `<tr><td class="seq">${i + 1}</td><td>${d.period || ''}</td><td>${d.note || d.bankAccount}</td><td>${custOfDue(d)}</td><td>${d.date}</td><td class="n">${fmt(d.amount)}</td><td>${d.settled ? '已结' : '未结'}</td></tr>`).join('')}
    <tr class="cnt"><td colspan="5">共 ${dues.length} 笔</td><td class="n">${fmt(dueTotal)}</td><td></td></tr>
    </tbody></table>` : '<p style="color:#888">此期间没有佣金</p>'}
    <div class="sum"><div class="r big"><span>本期佣金</span><span>RM ${fmt(dueTotal)}</span></div>
    <div class="r"><span>累计未结（含以往）</span><span>RM ${fmt(pay.payable)}</span></div></div>
    <div class="foot">此清单供双方核对 · Agent Commission Statement</div>`
    renderPrint(acDocHtml('Agent Commission Statement', `${acAgentName(D, ag)} · ${from} ~ ${to}`, body))
  }
  return <Shell wide title="Agent 佣金单" onClose={() => setModal(null)}
    footer={[<button key={1} className="btn ghost" onClick={() => setModal(null)}>关闭</button>, <button key={2} className="btn" onClick={doPrint}>🖨 打印</button>]}>
    <div className="bar"><select value={ag} onChange={e => setAg(e.target.value)}>{(D.acAgents || []).map(a => <option key={a.code} value={a.code}>{a.name}</option>)}</select></div>
    <div className="tot"><span className="k">佣金（{dues.length} 笔）</span><span className="v">{rm(dueTotal)}</span></div>
    <div className="tot" style={{ borderTop: '1px solid var(--line)', marginTop: 6, paddingTop: 8 }}><span className="k"><b>本期应付</b></span><span className="v"><b>{rm(dueTotal)}</b></span></div>
    <div className="tot"><span className="k">累计未结（含以往）</span><span className={'v ' + (pay.payable > 0.01 ? 'neg' : '')}>{rm(pay.payable)}</span></div>
    <div className="panel" style={{ marginTop: 10 }}><table><thead><tr><th>账期</th><th>公司 · 银行</th><th>顾客</th><th>日期</th><th className="num">佣金</th><th>状态</th></tr></thead>
      <tbody>{dues.length ? dues.map(d => { const b = (D.acBankAccounts || []).find(x => x.code === d.bankAccount); return <tr key={d.id}><td>{d.period}</td><td>{d.note || d.bankAccount}</td><td>{b ? acCustName(D, b.customer) : '—'}</td><td>{d.date}</td><td className="num">{fmt(d.amount)}</td><td>{d.settled ? <span className="pill ok">已结</span> : <span className="pill open">未结</span>}</td></tr> }) : <tr><td colSpan={6}><div className="empty">此期间没有佣金</div></td></tr>}</tbody></table></div>
  </Shell>
}

/* ===== Agent 管理（介绍人抽佣）===== */
function ACAgents({ D, setModal, flash, logAudit, reload }) {
  const [q, setQ] = useState('')
  const agents = (D.acAgents || []).filter(a => (a.name + a.code + (a.phone || '')).toLowerCase().includes(q.toLowerCase()))
  const totalPayable = (D.acAgents || []).reduce((s, a) => s + acAgentPayable(D, a.code).payable, 0)
  const del = async a => {
    const bas = acAgentBAs(D, a.code)
    if (bas.length) return flash(`${a.name} 名下还有 ${bas.length} 个户口，先改掉再删`)
    if (!confirm(`删除 agent ${a.name}？`)) return
    await db.delAgent(a.code); await logAudit('删除', 'AC agent', a.code, a.name); reload(); flash('已删除')
  }
  return <div>
    <div className="kpis">
      <div className="kpi"><div className="l">Agent 人数</div><div className="v">{fmt(agents.length)}</div></div>
      <div className="kpi"><div className="l">Agent 应付合计</div><div className="v mono">{rm(totalPayable)}</div></div>
    </div>
    <div className="bar"><input placeholder="搜索 agent…" value={q} onChange={e => setQ(e.target.value)} style={{ minWidth: 200 }} /><div className="sp" /><button className="btn" onClick={() => setModal({ type: 'acAgent' })}>+ 新 agent</button></div>
    <div className="panel"><table>
      <thead><tr><th>编码</th><th>名字</th><th>电话</th><th className="num">名下户口</th><th className="num">每月佣金</th><th className="num">未结应付</th><th></th></tr></thead>
      <tbody>{agents.length ? agents.map(a => {
        const bas = acAgentBAs(D, a.code)
        const monthly = bas.filter(baCharging).reduce((s, b) => s + (+b.agentFee || 0), 0)
        const pay = acAgentPayable(D, a.code)
        return <tr key={a.code}>
          <td><span className="code">{a.code}</span></td><td><b>{a.name}</b></td><td>{a.phone || '—'}</td>
          <td className="num">{fmt(bas.length)}</td><td className="num">{fmt(monthly)}</td>
          <td className={'num' + (pay.payable > 0.01 ? ' neg' : '')}>{fmt(pay.payable)}</td>
          <td style={{ whiteSpace: 'nowrap' }}>
            <button className="linkbtn" onClick={() => setModal({ type: 'acAgentView', data: a })}>看户口</button>
            <button className="linkbtn" onClick={() => setModal({ type: 'acAgent', data: a })}>编辑</button>
            <button className="linkbtn del" onClick={() => del(a)}>删</button>
          </td>
        </tr>
      }) : <tr><td colSpan={7}><div className="empty">还没有 agent — 点「+ 新 agent」</div></td></tr>}</tbody>
    </table></div>
  </div>
}

function ACAgentForm({ D, setModal, flash, logAudit, reload, modal }) {
  const d = modal.data
  const [f, setF] = useState(d || { code: '', name: '', phone: '', note: '' })
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    if (!f.name) return flash('请填名字')
    setBusy(true)
    const code = d?.code || f.code || await nextNo('AGT')
    const { error } = await db.saveAgent({ ...f, code })
    if (error) { setBusy(false); return flash('保存失败：' + error.message) }
    await logAudit(d ? '修改' : '新增', 'AC agent', code, f.name); reload(); setBusy(false); setModal(null); flash(d ? '已更新' : '已加入')
  }
  return <Shell title={d ? '编辑 agent — ' + d.code : '新增 agent'} onClose={() => setModal(null)}
    footer={[<button key={1} className="btn ghost" onClick={() => setModal(null)}>取消</button>, <button key={2} className="btn" disabled={busy} onClick={submit}>{busy ? '保存中…' : '保存'}</button>]}>
    {!d && <Field label="编码（留空自动生成）"><input value={f.code} onChange={e => set('code', e.target.value.trim())} placeholder="AGT001 或自订" /></Field>}
    <Field label="名字"><input value={f.name} onChange={e => set('name', e.target.value)} /></Field>
    <Field label="电话"><input value={f.phone} onChange={e => set('phone', e.target.value)} /></Field>
    <Field label="备注"><input value={f.note} onChange={e => set('note', e.target.value)} /></Field>
  </Shell>
}

/* 看某 agent 名下户口 */
function ACAgentViewForm({ D, setModal, modal }) {
  const a = modal.data
  const bas = acAgentBAs(D, a.code)
  const pay = acAgentPayable(D, a.code)
  return <Shell wide title={`${a.name} 名下户口`} onClose={() => setModal(null)}
    footer={[<button key={1} className="btn ghost" onClick={() => setModal(null)}>关闭</button>]}>
    <div className="tot"><span className="k">名下户口</span><span className="v">{fmt(bas.length)} 个</span></div>
    <div className="tot"><span className="k">未结应付</span><span className={'v ' + (pay.payable > 0.01 ? 'neg' : '')}>{rm(pay.payable)}</span></div>
    <div className="panel" style={{ marginTop: 10 }}><table><thead><tr><th>公司 · 银行</th><th>顾客</th><th>状态</th><th className="num">月费</th><th className="num">给agent</th></tr></thead>
      <tbody>{bas.length ? bas.map(b => <tr key={b.code}><td>{acCoName(D, b.company)} · {b.bank}</td><td>{acCustName(D, b.customer)}</td><td><BAStatusPill s={b.status} /></td><td className="num">{fmt(b.monthlyFee)}</td><td className="num">{fmt(b.agentFee)}</td></tr>) : <tr><td colSpan={5}><div className="empty">名下暂无户口</div></td></tr>}</tbody></table></div>
  </Shell>
}

/* Agent 结算 */
function ACAgentSettle({ D, setModal, flash, logAudit, reload }) {
  const rows = (D.acAgents || []).map(a => ({ a, p: acAgentPayable(D, a.code) })).filter(x => x.p.dues > 0 || x.p.payable > 0.01)
  const totalPayable = rows.reduce((sm, x) => sm + x.p.payable, 0)
  const settlements = [...(D.acAgentSettlements || [])].sort((a, b) => (b.date || '').localeCompare(a.date || ''))
  const delSettle = async s => {
    if (!confirm(`删除这笔结算？\n${acAgentName(D, s.agent)} · RM ${fmt(s.amount)} · ${s.date}\n\n对应的佣金会退回「未结」，可以重新结。`)) return
    await db.delAgentSettlement(s.no, s.agent, s.amount, D)
    await logAudit('删除', 'Agent结算', s.no, acAgentName(D, s.agent) + ' · RM ' + fmt(s.amount))
    reload(); flash('已删除，佣金退回未结')
  }
  return <div>
    <div className="kpis">
      <div className="kpi"><div className="l">Agent 应付合计</div><div className="v mono">{rm(totalPayable)}</div></div>
      <div className="kpi"><div className="l">有欠款 agent</div><div className="v">{fmt(rows.filter(x => x.p.payable > 0.01).length)}</div></div>
    </div>
    <div className="bar"><div className="sp" /><button className="btn ghost" onClick={() => setModal({ type: 'acAgentDue', data: { from: '2020-01-01', to: todayISO() } })}>🖨 佣金单</button><button className="btn" onClick={() => setModal({ type: 'acAgentSettleForm' })}>+ 新结算</button></div>
    <div className="panel"><table>
      <thead><tr>{['Agent', '佣金(未结)', '已结算', '应付', ''].map((x, i) => <th key={i} className={i >= 1 && i <= 3 ? 'num' : ''}>{x}</th>)}</tr></thead>
      <tbody>{rows.length ? rows.map(({ a, p }) => <tr key={a.code}>
        <td>{a.name}</td><td className="num">{fmt(p.dues)}</td><td className="num">{fmt(p.settled)}</td>
        <td className={'num' + (p.payable > 0.01 ? ' neg' : '')}>{fmt(p.payable)}</td>
        <td><button className="linkbtn" onClick={() => setModal({ type: 'acAgentSettleForm', data: { agent: a.code } })}>结算</button></td>
      </tr>) : <tr><td colSpan={5}><div className="empty">暂无应付</div></td></tr>}</tbody>
    </table></div>
    <div className="hint" style={{ marginTop: 8 }}>应付 = 未结算的 agent 佣金 − 已结算。佣金在开月费账单时自动产生。</div>
    <div className="panel" style={{ marginTop: 16 }}><h3>结算记录</h3><table>
      <thead><tr><th>单号</th><th>Agent</th><th>日期</th><th>方式</th><th className="num">金额</th><th>备注</th><th></th></tr></thead>
      <tbody>{settlements.length ? settlements.map(s => <tr key={s.no}>
        <td><span className="code">{s.no}</span></td><td><b>{acAgentName(D, s.agent)}</b></td><td>{s.date}</td><td>{s.method || '—'}</td>
        <td className="num">{fmt(s.amount)}</td><td className="hint">{s.note || ''}</td>
        <td><button className="linkbtn del" onClick={() => delSettle(s)}>删除</button></td>
      </tr>) : <tr><td colSpan={7}><div className="empty">还没有结算记录</div></td></tr>}</tbody>
    </table></div>
    <div className="hint" style={{ marginTop: 8 }}>结错了？点「删除」→ 对应佣金退回未结 → 重新结算。</div>
  </div>
}

function ACAgentSettleForm({ D, setModal, flash, logAudit, reload, modal }) {
  const [agent, setAgent] = useState(modal.data?.agent || '')
  const pay = agent ? acAgentPayable(D, agent) : { payable: 0 }
  const [date, setDate] = useState(todayISO())
  const [amount, setAmount] = useState(0)
  const [method, setMethod] = useState('银行转账')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    if (!agent) return flash('请选 agent')
    if (!amount || amount <= 0) return flash('请填结算金额')
    setBusy(true)
    const no = await nextNo('ASETL')
    await db.saveAgentSettlement({ no, agent, date, amount: +amount, method, note })
    let left = +amount
    const unsettled = (D.acAgentDues || []).filter(d => d.agent === agent && !d.settled).sort((a, b) => (a.date || '').localeCompare(b.date || ''))
    const ids = []
    for (const d of unsettled) { if (left >= (+d.amount || 0) - 0.01) { ids.push(d.id); left -= (+d.amount || 0) } else break }
    if (ids.length) await db.markAgentDuesSettled(ids, true)
    await logAudit('新增', 'Agent结算', no, acAgentName(D, agent) + ' · RM ' + fmt(amount))
    reload(); setBusy(false); setModal(null); flash('结算已保存')
  }
  return <Shell title="新增 agent 结算" onClose={() => setModal(null)}
    footer={[<button key={2} className="btn ghost" onClick={() => setModal(null)}>取消</button>, <button key={3} className="btn" disabled={busy} onClick={submit}>{busy ? '保存中…' : '保存'}</button>]}>
    <div className="fg"><Field label="Agent"><select value={agent} onChange={e => setAgent(e.target.value)}><option value="">— 选 agent —</option>{(D.acAgents || []).map(a => <option key={a.code} value={a.code}>{a.name}</option>)}</select></Field>
      <Field label="日期"><input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field></div>
    {agent && <div className="rateline">{`当前应付：RM ${fmt(pay.payable)}`}</div>}
    <div className="fg"><Field label="结算金额 (RM)"><input type="number" value={amount} onChange={e => setAmount(+e.target.value)} /></Field>
      <Field label="付款方式"><select value={method} onChange={e => setMethod(e.target.value)}>{['银行转账', '现金', 'E-wallet', '其他'].map(x => <option key={x}>{x}</option>)}</select></Field></div>
    <Field label="备注"><input value={note} onChange={e => setNote(e.target.value)} /></Field>
    {agent && amount > 0 && <div className="hint">结算后 agent 应付 = RM {fmt(pay.payable - amount)}</div>}
  </Shell>
}

/* ===== 全公司开销记录 ===== */
const EXP_CATS = ['租金', '水电', '薪水', '花红/佣金', '交通', '餐饮', '办公用品', '维修', '税务/准证', '银行费用', '杂费']
function Expenses({ D, setModal, flash, logAudit, reload }) {
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('全部')
  let rows = [...(D.expenses || [])]
  if (cat !== '全部') rows = rows.filter(e => e.category === cat)
  if (q) rows = rows.filter(e => ((e.payee || '') + (e.note || '') + (e.category || '')).toLowerCase().includes(q.toLowerCase()))
  const total = rows.reduce((s, e) => s + (+e.amount || 0), 0)
  const thisMonth = (D.expenses || []).filter(e => (e.date || '').slice(0, 7) === todayISO().slice(0, 7)).reduce((s, e) => s + (+e.amount || 0), 0)
  const del = async e => { if (!confirm('删除开销 ' + e.no + '？')) return; await db.delExpense(e.no); await logAudit('删除', '开销', e.no, e.payee + ' RM ' + fmt(e.amount)); reload(); flash('已删除') }
  return <div>
    <div className="kpis">
      <div className="kpi"><div className="l">本月开销</div><div className="v mono">{rm(thisMonth)}</div></div>
      <div className="kpi"><div className="l">筛选结果合计</div><div className="v mono">{rm(total)}</div></div>
      <div className="kpi"><div className="l">笔数</div><div className="v">{fmt(rows.length)}</div></div>
    </div>
    <div className="bar">
      <input placeholder="搜索付给谁/备注…" value={q} onChange={e => setQ(e.target.value)} style={{ minWidth: 180 }} />
      <select value={cat} onChange={e => setCat(e.target.value)}><option>全部</option>{EXP_CATS.map(c => <option key={c}>{c}</option>)}</select>
      <div className="sp" /><button className="btn" onClick={() => setModal({ type: 'expense' })}>+ 记开销</button>
    </div>
    <div className="panel"><table>
      <thead><tr><th>日期</th><th>分类</th><th>付给谁</th><th>公司</th><th>方式</th><th className="num">金额</th><th>备注</th><th></th></tr></thead>
      <tbody>{rows.length ? rows.map(e => <tr key={e.no}>
        <td>{e.date}</td><td><span className="pill low">{e.category || '—'}</span></td><td><b>{e.payee || '—'}</b></td>
        <td>{e.company ? acCoName(D, e.company) : (D.companies || []).find(c => c.code === e.company)?.name || '—'}</td>
        <td>{e.method || '—'}</td><td className="num neg">{fmt(e.amount)}</td><td className="hint" style={{ maxWidth: 160 }}>{e.note || ''}</td>
        <td style={{ whiteSpace: 'nowrap' }}><button className="linkbtn" onClick={() => setModal({ type: 'expense', data: e })}>编辑</button><button className="linkbtn del" onClick={() => del(e)}>删</button></td>
      </tr>) : <tr><td colSpan={8}><div className="empty">还没有开销记录 — 点「+ 记开销」</div></td></tr>}</tbody>
    </table></div>
  </div>
}

function ExpenseForm({ D, setModal, flash, logAudit, reload, modal }) {
  const d = modal.data
  const [f, setF] = useState(d || { no: '', date: todayISO(), category: EXP_CATS[0], payee: '', amount: 0, method: '银行转账', company: '', note: '' })
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    if (!f.amount || f.amount <= 0) return flash('请填金额')
    setBusy(true)
    const no = d?.no || await nextNo('EXP')
    const { error } = await db.saveExpense({ ...f, no })
    if (error) { setBusy(false); return flash('保存失败：' + error.message) }
    await logAudit(d ? '修改' : '新增', '开销', no, `${f.category} · ${f.payee} · RM ${fmt(f.amount)}`); reload(); setBusy(false); setModal(null); flash(d ? '已更新' : '已记录')
  }
  const allCompanies = [...(D.acCompanies || []).map(c => ({ code: c.code, name: c.name })), ...((D.companies || []).map(c => ({ code: c.code, name: c.name })))]
  return <Shell title={d ? '编辑开销 — ' + d.no : '记开销'} onClose={() => setModal(null)}
    footer={[<button key={1} className="btn ghost" onClick={() => setModal(null)}>取消</button>, <button key={2} className="btn" disabled={busy} onClick={submit}>{busy ? '保存中…' : '保存'}</button>]}>
    <div className="fg"><Field label="日期"><input type="date" value={f.date} onChange={e => set('date', e.target.value)} /></Field>
      <Field label="分类"><select value={f.category} onChange={e => set('category', e.target.value)}>{EXP_CATS.map(c => <option key={c}>{c}</option>)}</select></Field></div>
    <div className="fg"><Field label="付给谁"><input value={f.payee} onChange={e => set('payee', e.target.value)} placeholder="房东 / 员工名 / 供应商…" /></Field>
      <Field label="金额 (RM)"><input type="number" value={f.amount} onChange={e => set('amount', +e.target.value)} /></Field></div>
    <div className="fg"><Field label="付款方式"><select value={f.method} onChange={e => set('method', e.target.value)}>{['银行转账', '现金', 'E-wallet', '支票', '其他'].map(x => <option key={x}>{x}</option>)}</select></Field>
      <Field label="哪家公司（可留空）"><select value={f.company} onChange={e => set('company', e.target.value)}><option value="">总公司/不指定</option>{allCompanies.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}</select></Field></div>
    <Field label="备注"><input value={f.note} onChange={e => set('note', e.target.value)} /></Field>
  </Shell>
}

function ACReport({ D, setModal }) {
  const [from, setFrom] = useState(acPeriodRangeOf(acCurrentPeriod()).from)
  const [to, setTo] = useState(acPeriodRangeOf(acCurrentPeriod()).to)
  const [open, setOpen] = useState({})
  const tog = k => setOpen(o => ({ ...o, [k]: !o[k] }))
  const shiftPeriod = (ym, n) => { let [y, m] = ym.split('-').map(Number); m += n; while (m > 12) { m -= 12; y++ } while (m < 1) { m += 12; y-- } return y + '-' + String(m).padStart(2, '0') }
  const setPreset = pr => {
    const cur = acCurrentPeriod()
    if (pr === 'month') { const r = acPeriodRangeOf(cur); setFrom(r.from); setTo(r.to) }
    else if (pr === 'last') { const r = acPeriodRangeOf(shiftPeriod(cur, -1)); setFrom(r.from); setTo(r.to) }
    else if (pr === 'year') { const d = new Date(); setFrom(d.getFullYear() + '-01-01'); setTo(todayISO()) }
  }
  const inR = d => d && d >= from && d <= to
  const P = acProfitV2(D, from, to)
  // 累计（不受日期影响）
  let recvOut = 0; (D.acCustomers || []).forEach(c => recvOut += acCustomerBalance(D, c.code).outstanding)
  let payableOut = 0; (D.acSuppliers || []).forEach(s => payableOut += acSupplierPayableV2(D, s.code).payable)
  const received = (D.acReceipts || []).filter(r => inR(r.date)).reduce((s, r) => s + (+r.amount || 0), 0)

  /* 分组分析 */
  // 按银行：期间内已发户口的卖出利润 + 在收月费净利
  const byBank = {}
  ;(D.acBankAccounts || []).forEach(b => {
    const k = b.bank || '其他'
    byBank[k] = byBank[k] || { bank: k, count: 0, sellProfit: 0, feeNet: 0, live: 0 }
    byBank[k].count++
    if (b.stockStatus === '已发' && inR(b.assignDate)) byBank[k].sellProfit += (+b.soldPrice || 0) - (+b.cost || 0)
    if (baCharging(b)) { byBank[k].feeNet += (+b.monthlyFee || 0) - (baPaying(b) ? (+b.supplierShare || 0) : 0); byBank[k].live++ }
  })
  const bankRows = Object.values(byBank).sort((a, b) => (b.sellProfit + b.feeNet) - (a.sellProfit + a.feeNet))
  // 按卡商
  const supRows = (D.acSuppliers || []).map(s => {
    const bas = acSupplierBAs(D, s.code)
    let sellProfit = 0, feeNet = 0, live = 0
    bas.forEach(b => {
      if (b.stockStatus === '已发' && inR(b.assignDate)) sellProfit += (+b.soldPrice || 0) - (+b.cost || 0)
      if (baCharging(b)) { feeNet += (+b.monthlyFee || 0) - (baPaying(b) ? (+b.supplierShare || 0) : 0); live++ }
    })
    const pay = acSupplierPayableV2(D, s.code)
    return { name: s.name, code: s.code, count: bas.length, live, sellProfit, feeNet, payable: pay.payable }
  }).filter(x => x.count > 0).sort((a, b) => (b.sellProfit + b.feeNet) - (a.sellProfit + a.feeNet))
  // 按顾客
  const custRows = (D.acCustomers || []).map(c => {
    const bas = acCustomerBAs(D, c.code)
    const bal = acCustomerBalance(D, c.code)
    const billed = (D.acBills || []).filter(b => b.customer === c.code && inR(b.date)).reduce((s, b) => s + acBillTotal(b), 0)
    const feeNet = bas.filter(baCharging).reduce((s, b) => s + (+b.monthlyFee || 0) - (baPaying(b) ? (+b.supplierShare || 0) : 0), 0)
    return { name: c.name, code: c.code, accounts: bas.length, billed, outstanding: bal.outstanding, feeNet }
  }).filter(x => x.accounts > 0 || x.billed > 0).sort((a, b) => b.feeNet - a.feeNet)

  const Sec = ({ id, title, right, children }) => <div className="panel" style={{ marginBottom: 12 }}>
    <div onClick={() => tog(id)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '13px 15px', cursor: 'pointer' }}>
      <span style={{ fontSize: 14, color: 'var(--ink-soft)' }}>{open[id] ? '▾' : '▸'}</span>
      <b style={{ flex: 1 }}>{title}</b>
      <span className="mono" style={{ fontWeight: 700 }}>{right}</span>
    </div>
    {open[id] && <div style={{ borderTop: '1px solid var(--line)' }}>{children}</div>}
  </div>

  return <div>
    {/* 日期 */}
    <div className="bar">
      <span className="muted">从</span><input type="date" value={from} onChange={e => setFrom(e.target.value)} />
      <span className="muted">到</span><input type="date" value={to} onChange={e => setTo(e.target.value)} />
      <button className="btn ghost sm" onClick={() => setPreset('month')}>本月</button>
      <button className="btn ghost sm" onClick={() => setPreset('last')}>上月</button>
      <button className="btn ghost sm" onClick={() => setPreset('year')}>今年</button>
      <span className="muted" style={{ fontSize: 11 }}>账期 每月1号~月底</span>
    </div>

    {/* 顶部大数字 */}
    <div className="panel" style={{ marginBottom: 14, textAlign: 'center', padding: '26px 16px', background: 'linear-gradient(160deg,var(--card),var(--accent-soft))' }}>
      <div className="hint" style={{ fontSize: 13 }}>本期净赚</div>
      <div className="mono" style={{ fontSize: 42, fontWeight: 800, color: P.net >= 0 ? 'var(--accent)' : 'var(--danger)', letterSpacing: -1, margin: '4px 0' }}>{rm(P.net)}</div>
      <div className="hint">{from} ~ {to} · 收入 {rm(P.revenue)} − 成本 {rm(P.cost)}</div>
    </div>

    {/* 三块拆解 */}
    <div className="hint" style={{ margin: '4px 2px 8px' }}>点开看细节 ↓</div>
    <Sec id="sell" title="① 卖户口" right={rm(P.sellProfit)}>
      <div className="body">
        <div className="tot"><span className="k">卖价合计</span><span className="v">{rm(P.sellRevenue)}</span></div>
        <div className="tot"><span className="k">减：进价</span><span className="v neg">({fmt(P.sellCost)})</span></div>
        <div className="tot" style={{ borderTop: '1px solid var(--line)', marginTop: 5, paddingTop: 7 }}><span className="k"><b>卖户口利润</b></span><span className={'v ' + (P.sellProfit >= 0 ? 'pos' : 'neg')}><b>{rm(P.sellProfit)}</b></span></div>
        <div className="hint" style={{ marginTop: 6 }}>期间内发出的银行户口（一次性利润）</div>
      </div>
    </Sec>
    <Sec id="init" title="② 首期项目（开通费 / 电话卡等）" right={rm(P.initProfit)}>
      <div className="body">
        <div className="tot"><span className="k">收顾客</span><span className="v">{rm(P.initRevenue)}</span></div>
        <div className="tot"><span className="k">减：成本</span><span className="v neg">({fmt(P.initCost)})</span></div>
        <div className="tot" style={{ borderTop: '1px solid var(--line)', marginTop: 5, paddingTop: 7 }}><span className="k"><b>服务费利润</b></span><span className={'v ' + (P.initProfit >= 0 ? 'pos' : 'neg')}><b>{rm(P.initProfit)}</b></span></div>
        <div className="hint" style={{ marginTop: 6 }}>代收代付的项目（成本=金额）利润为 0，只有加价的才算赚</div>
      </div>
    </Sec>
    <Sec id="fee" title="③ 月费（每月固定）" right={rm(P.feeProfit)}>
      <div className="body">
        <div className="tot"><span className="k">收顾客月费</span><span className="v">{rm(P.feeRevenue)}</span></div>
        <div className="tot"><span className="k">减：给卡商分成</span><span className="v neg">({fmt(P.dueCost)})</span></div>
        {P.agentCost > 0 && <div className="tot"><span className="k">减：给 agent 佣金</span><span className="v neg">({fmt(P.agentCost)})</span></div>}
        <div className="tot" style={{ borderTop: '1px solid var(--line)', marginTop: 5, paddingTop: 7 }}><span className="k"><b>月费净利</b></span><span className={'v ' + (P.feeProfit >= 0 ? 'pos' : 'neg')}><b>{rm(P.feeProfit)}</b></span></div>
        <div className="hint" style={{ marginTop: 6 }}>这是每个月稳定进来的钱 — 看它够不够支撑开销</div>
      </div>
    </Sec>

    {/* 现金与欠款 */}
    <Sec id="cash" title="收款与欠款" right={rm(received) + ' 已收'}>
      <div className="body">
        <div className="tot"><span className="k">期间实际收款</span><span className="v">{rm(received)}</span></div>
        <div className="tot"><span className="k">顾客还欠我（累计）</span><span className={'v ' + (recvOut > 0.01 ? 'neg' : '')}>{rm(recvOut)}</span></div>
        <div className="tot"><span className="k">我还欠卡商（累计）</span><span className={'v ' + (payableOut > 0.01 ? 'neg' : '')}>{rm(payableOut)}</span></div>
      </div>
    </Sec>

    {/* 分组分析 */}
    <Sec id="bank" title="按银行看" right={bankRows.length + ' 家银行'}>
      <table><thead><tr>{['银行', '户口数', '在收', '卖出利润', '每月净利'].map((x, i) => <th key={i} className={i ? 'num' : ''}>{x}</th>)}</tr></thead>
        <tbody>{bankRows.map(b => <tr key={b.bank}>
          <td><b>{b.bank}</b></td><td className="num">{b.count}</td><td className="num">{b.live}</td>
          <td className={'num ' + (b.sellProfit >= 0 ? 'pos' : 'neg')}>{fmt(b.sellProfit)}</td>
          <td className={'num ' + (b.feeNet >= 0 ? 'pos' : 'neg')}>{fmt(b.feeNet)}</td></tr>)}
          {!bankRows.length && <tr><td colSpan={5}><div className="empty">暂无数据</div></td></tr>}</tbody></table>
      <div className="hint" style={{ padding: '8px 14px' }}>「每月净利」= 还在收的户口，月费 − 给卡商。看哪个银行的户口最划算。</div>
    </Sec>
    <Sec id="sup" title="按卡商看" right={supRows.length + ' 个卡商'}>
      <table><thead><tr>{['卡商', '户口数', '在收', '卖出利润', '每月净利', '我欠他'].map((x, i) => <th key={i} className={i ? 'num' : ''}>{x}</th>)}</tr></thead>
        <tbody>{supRows.map(s => <tr key={s.code}>
          <td><b>{s.name}</b></td><td className="num">{s.count}</td><td className="num">{s.live}</td>
          <td className={'num ' + (s.sellProfit >= 0 ? 'pos' : 'neg')}>{fmt(s.sellProfit)}</td>
          <td className={'num ' + (s.feeNet >= 0 ? 'pos' : 'neg')}>{fmt(s.feeNet)}</td>
          <td className={'num ' + (s.payable > 0.01 ? 'neg' : '')}>{fmt(s.payable)}</td></tr>)}
          {!supRows.length && <tr><td colSpan={6}><div className="empty">暂无数据</div></td></tr>}</tbody></table>
      <div className="hint" style={{ padding: '8px 14px' }}>看跟哪个卡商拿货最划算。</div>
    </Sec>
    <Sec id="cust" title="按顾客看" right={custRows.length + ' 个顾客'}>
      <table><thead><tr>{['顾客', '户口数', '期间开单', '每月净利', '还欠我'].map((x, i) => <th key={i} className={i ? 'num' : ''}>{x}</th>)}</tr></thead>
        <tbody>{custRows.map(c => <tr key={c.code}>
          <td><b>{c.name}</b></td><td className="num">{c.accounts}</td>
          <td className="num">{fmt(c.billed)}</td>
          <td className={'num ' + (c.feeNet >= 0 ? 'pos' : 'neg')}>{fmt(c.feeNet)}</td>
          <td className={'num ' + (c.outstanding > 0.01 ? 'neg' : '')}>{fmt(c.outstanding)}</td></tr>)}
          {!custRows.length && <tr><td colSpan={5}><div className="empty">暂无数据</div></td></tr>}</tbody></table>
    </Sec>

    {/* 单据 */}
    <div className="panel" style={{ marginTop: 14 }}><h3>打印单据</h3><div className="body" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <button className="btn" onClick={() => setModal({ type: 'acFeeList', data: { from, to } })}>📋 顾客月费清单</button>
      <button className="btn" onClick={() => setModal({ type: 'acInitCust', data: { from, to } })}>🧾 顾客首期费用单</button>
      <button className="btn ghost" onClick={() => setModal({ type: 'acStatement', data: { from, to } })}>🧾 顾客对账单</button>
      <button className="btn ghost" onClick={() => setModal({ type: 'acSupplierDueList', data: { from, to } })}>🏭 卡商月费单</button>
      <button className="btn ghost" onClick={() => setModal({ type: 'acAgentDue', data: { from, to } })}>🤝 Agent 佣金单</button>
      <button className="btn ghost" onClick={() => setModal({ type: 'acInitSup', data: { from, to } })}>🏭 卡商首期单</button>
    </div></div>
  </div>
}
