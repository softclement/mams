const API_URL =
  "https://script.google.com/macros/s/AKfycbyUfTFLmLWJDvpfjwCXdkD5JiJbNDHmh5vQBPnBfz9nOp9EsCerTDqn2nqfw4LL7xTU/exec";

const VIEWS = ["dashboard", "pay", "statement", "expenses", "defaulters", "lead"];
let current = null; // balance of the flat selected on the Pay screen

// ---------- helpers ----------
const $ = (id) => document.getElementById(id);
const rupee = (n) => "₹" + Math.abs(Number(n)).toLocaleString("en-IN");
const esc = (s) =>
  String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function todayStr() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function setStatus(msg) {
  $("status").innerHTML = msg;
}

async function api(params) {
  const res = await fetch(API_URL + "?" + new URLSearchParams(params));
  const data = await res.json();
  if (data && data.status === "error") throw new Error(data.message);
  return data;
}

async function post(payload) {
  // text/plain keeps this a "simple" request (no CORS preflight), which Apps Script needs
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error("Server did not return JSON (check deployment). Got: " + text.slice(0, 120));
  }
}

function statusLine(outstanding, monthly) {
  const months = monthly ? Math.round((Math.abs(outstanding) / monthly) * 10) / 10 : 0;
  if (outstanding > 0) return '<span class="due">Due ' + rupee(outstanding) + "</span> (about " + months + " months)";
  if (outstanding < 0) return '<span class="adv">Advance ' + rupee(outstanding) + "</span> (about " + months + " months)";
  return "Up to date";
}

// ---------- menu / routing ----------
function show(view) {
  if (location.hash !== "#" + view) location.hash = view; // triggers route()
  else route();
}

function route() {
  let view = location.hash.replace("#", "");
  if (VIEWS.indexOf(view) < 0) view = "dashboard";
  VIEWS.forEach((v) => $("view-" + v).classList.toggle("active", v === view));
  document.querySelectorAll("#nav button").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  window.scrollTo(0, 0);

  if (view === "dashboard") loadDashboard();
  if (view === "pay") loadBalance();
  if (view === "statement") loadStatement();
  if (view === "expenses") loadExpenses();
}

window.addEventListener("hashchange", route);

window.onload = async function () {
  $("paymentDate").value = todayStr();
  await loadFlats();
  route();
};

// ---------- flats (shared by Pay and My Dues) ----------
async function loadFlats() {
  const selects = [$("flat"), $("stmtFlat")];
  try {
    const data = await api({ action: "flats" });
    selects.forEach((sel) => {
      sel.innerHTML = "";
      data.forEach((row) => {
        const option = document.createElement("option");
        option.value = row[0];
        option.text = row[0] + " - " + row[1];
        sel.appendChild(option);
      });
    });
    setStatus("Ready");
  } catch (err) {
    console.error(err);
    selects.forEach((sel) => (sel.innerHTML = "<option>Could not load flats</option>"));
    setStatus("❌ Could not load flats: " + err.message);
  }
}

// ---------- dashboard ----------
function tile(label, value, cls, sub) {
  return (
    '<div class="tile ' + (cls || "") + '"><div class="l">' + label + '</div><div class="v">' +
    value + "</div>" + (sub ? '<div class="s">' + sub + "</div>" : "") + "</div>"
  );
}

async function loadDashboard() {
  const box = $("dashTiles");
  box.innerHTML = "Loading...";
  try {
    const d = await api({ action: "dashboard" });
    $("dashMonth").textContent = "· " + d.month;
    box.innerHTML =
      '<div class="tiles">' +
      tile("Total Collection Due", rupee(d.demand), "", "all months raised") +
      tile("Total Received", rupee(d.received), "green", rupee(d.receivedThisMonth) + " this month") +
      tile("Outstanding Due", rupee(d.outstandingDue), "red", d.flatsWithDues + " of " + d.flats + " flats") +
      tile("Advance Balance", rupee(d.advance), "green", "paid ahead") +
      tile("Expenses This Month", rupee(d.expensesThisMonth), "", rupee(d.expensesTotal) + " in total") +
      tile("Net Funds*", (d.netFunds < 0 ? "-" : "") + rupee(d.netFunds), d.netFunds < 0 ? "red" : "", "received − expenses") +
      "</div>" +
      '<p class="muted">*Does not include any opening bank balance.</p>' + groupsHtml(d);
  } catch (err) {
    box.innerHTML = "❌ " + esc(err.message);
  }
}

// ---------- submit payment ----------
async function loadBalance() {
  const flat = $("flat").value;
  current = null;
  $("preview").innerHTML = "";
  if (!flat || flat.indexOf("Could not") === 0 || flat === "Loading...") return;
  $("summary").innerHTML = "Loading balance...";
  try {
    current = await api({ action: "balance", flat: flat });
    fillPayFor();
    renderSummary();
    updatePreview();
  } catch (err) {
    console.error(err);
    $("summary").innerHTML = "❌ Could not load balance: " + esc(err.message);
  }
}

function renderSummary() {
  if (!current) return;
  const last = current.lastPayment
    ? current.lastPayment.date + " (" + rupee(current.lastPayment.amount) + ")"
    : "none yet";
  $("summary").innerHTML =
    "Monthly amount: <b>" + rupee(current.monthly) + "</b><br>" +
    "Status: " + statusLine(current.outstanding, current.monthly) + "<br>" +
    "Last payment: " + last +
    (current.group ? "<br>Your group: <b>" + esc(current.group.group) + "</b> · pay to <b>" + esc(current.group.payTo + " " + current.group.payToOwner) + "</b>" : "") +
    (current.pendingAmount ? "<br>Awaiting lead confirmation: " + rupee(current.pendingAmount) : "");
}

function updatePreview() {
  const amount = Number($("amount").value);
  if (!current || !(amount > 0)) {
    $("preview").innerHTML = "";
    return;
  }
  $("preview").innerHTML = "After this payment: " + statusLine(current.outstanding - amount, current.monthly);
}

async function submitPayment(force) {
  const btn = $("submitBtn");
  const payload = {
    action: "payment",
    flat: $("flat").value,
    paymentDate: $("paymentDate").value,
    amount: $("amount").value,
    mode: $("mode").value,
    reference: $("reference").value,
    remarks: $("remarks").value,
    force: force === true,
    purpose: payTarget().purpose,
    group: payTarget().group,
    payTo: payTarget().payTo,
  };

  if (!payload.amount || Number(payload.amount) <= 0) {
    alert("Please enter a valid amount");
    return;
  }
  if (!payload.paymentDate) {
    alert("Please select the payment date");
    return;
  }

  btn.disabled = true;
  setStatus("⏳ Saving...");

  try {
    const result = await post(payload);

    if (result.status === "success") {
      setStatus("✅ Payment Saved");
      alert("Payment Saved Successfully");
      $("amount").value = "";
      $("reference").value = "";
      $("remarks").value = "";
      current = result.balance;
      renderSummary();
      updatePreview();
    } else if (result.status === "duplicate") {
      setStatus("⚠️ Possible duplicate");
      btn.disabled = false;
      if (confirm(result.message + "\nSave it anyway?")) await submitPayment(true);
      return;
    } else {
      setStatus("❌ " + esc(result.message));
      alert("Error : " + result.message);
    }
  } catch (err) {
    console.error(err);
    setStatus("❌ " + esc(err.message));
    alert("Error : " + err.message);
  } finally {
    btn.disabled = false;
  }
}

// ---------- my dues / statement ----------
function item(left, sub, right) {
  return (
    '<div class="item"><div>' + left + (sub ? '<div class="sub">' + sub + "</div>" : "") +
    '</div><div class="amt">' + right + "</div></div>"
  );
}

async function loadStatement() {
  const flat = $("stmtFlat").value;
  const box = $("stmt");
  if (!flat || flat.indexOf("Could not") === 0 || flat === "Loading...") return;
  box.innerHTML = "Loading...";
  try {
    const s = await api({ action: "statement", flat: flat });
    let html =
      '<div class="summary">' +
      "Owner: <b>" + esc(s.owner) + "</b><br>" +
      "Monthly amount: <b>" + rupee(s.monthly) + "</b><br>" +
      "Status: " + statusLine(s.outstanding, s.monthly) + "<br>" +
      "Opening " + (s.opening < 0 ? "advance " : "due ") + rupee(s.opening) +
      " · Charged " + rupee(s.demand) + " · Paid " + rupee(s.paid) +
      "</div>";

    html += '<div class="list-title">Payments</div>';
    html += s.payments.length
      ? s.payments.map((p) =>
          item(
            esc(p.date) + (p.status !== "Verified" ? ' <span class="tag">' + esc(p.status) + "</span>" : ""),
            esc([p.mode, p.reference, p.remarks].filter(Boolean).join(" · ")),
            rupee(p.amount)
          )
        ).join("")
      : '<p class="muted">No payments yet</p>';

    html += '<div class="list-title">Monthly charges</div>';
    html += s.charges.length
      ? s.charges.map((c) => item(esc(c.month), "", rupee(c.amount))).join("")
      : '<p class="muted">No charges raised yet</p>';

    box.innerHTML = html;
  } catch (err) {
    box.innerHTML = "❌ " + esc(err.message);
  }
}

// ---------- expenses ----------
let expFiltersReady = false;

function fillOptions(sel, values, keep) {
  sel.innerHTML = '<option value="all">All</option>';
  values.forEach((v) => {
    const o = document.createElement("option");
    o.value = v;
    o.text = v;
    sel.appendChild(o);
  });
  sel.value = keep || "all";
}

async function loadExpenses() {
  const box = $("expBody");
  box.innerHTML = "Loading...";
  try {
    const d = await api({ action: "expenses", year: $("expYear").value, category: $("expCat").value });

    if (!expFiltersReady) {
      fillOptions($("expYear"), d.years, "all");
      fillOptions($("expCat"), d.categories, "all");
      expFiltersReady = true;
    }

    let html =
      '<div class="summary">Total: <b>' + rupee(d.total) + "</b> in " + d.count + " expense(s)</div>";

    html += '<div class="list-title">By category</div>';
    html += d.byCategory.length
      ? d.byCategory.map((c) => item(esc(c[0]), "", rupee(c[1]))).join("")
      : '<p class="muted">No expenses recorded yet</p>';

    if (d.rows.length) {
      html += '<div class="list-title">Details</div>';
      html += d.rows.map((r) =>
        item(
          esc(r.category) + (r.vendor ? " · " + esc(r.vendor) : ""),
          esc(r.date) + (r.paidBy ? " · paid by " + esc(r.paidBy) : "") + (r.remarks ? " · " + esc(r.remarks) : ""),
          rupee(r.amount)
        )
      ).join("");
    }
    box.innerHTML = html;
  } catch (err) {
    box.innerHTML = "❌ " + esc(err.message);
  }
}

// ---------- defaulters (committee PIN) ----------
async function loadDefaulters() {
  const box = $("defBody");
  const pin = $("pin").value;
  if (!pin) {
    alert("Enter the committee PIN");
    return;
  }
  box.innerHTML = "Loading...";
  try {
    const d = await post({ action: "defaulters", pin: pin });
    if (d.status === "error") throw new Error(d.message);

    let html = '<div class="summary">Total outstanding: <b class="due">' + rupee(d.total) + "</b> from " + d.list.length + " flat(s)</div>";
    html += d.list.length
      ? d.list.map((x) => item("<b>" + esc(x.flat) + "</b>", esc(x.owner) + " · about " + x.months + " months", '<span class="due">' + rupee(x.outstanding) + "</span>")).join("")
      : '<p class="muted">No pending dues 🎉</p>';
    box.innerHTML = html;
  } catch (err) {
    box.innerHTML = "❌ " + esc(err.message);
  }
}

// ---------- pay for: group (monthly), special collection, or extra contribution ----------
function fillPayFor() {
  const sel = $("payFor"), ex = $("extraGroup");
  sel.innerHTML = "";
  const add = (v, t) => { const o = document.createElement("option"); o.value = v; o.text = t; sel.appendChild(o); };
  if (current.group) add("M|" + current.group.group + "|" + current.group.payTo, "Monthly – " + current.group.group + " (expected " + rupee(current.group.expected) + ")");
  else add("M||", "General maintenance");
  (current.specials || []).forEach((s) => {
    if (s.remaining > 0) add("S|" + s.id + "|" + s.lead, "Special – " + s.description + " (" + rupee(s.remaining) + " due)");
  });
  add("X||", "Extra contribution to a group…");
  ex.innerHTML = "";
  (current.groups || []).forEach((g) => {
    const o = document.createElement("option");
    o.value = g.group + "|" + g.payTo;
    o.text = g.group;
    ex.appendChild(o);
  });
  onPayFor();
}

function payTarget() {
  const v = ($("payFor").value || "M||").split("|");
  if (v[0] === "S") return { purpose: v[1], group: "", payTo: v[2] };
  if (v[0] === "X") { const g = ($("extraGroup").value || "|").split("|"); return { purpose: "Maintenance", group: g[0], payTo: g[1] }; }
  return { purpose: "Maintenance", group: v[1] || "", payTo: v[2] || "" };
}

function onPayFor() {
  const isX = ($("payFor").value || "").charAt(0) === "X";
  $("extraGroup").style.display = isX ? "block" : "none";
  const t = payTarget();
  let who = t.payTo;
  if (current && current.specials) { const s = current.specials.filter((x) => x.id === t.purpose)[0]; if (s) who = s.lead + " " + s.leadOwner; }
  if (current && current.group && t.payTo === current.group.payTo) who = t.payTo + " " + current.group.payToOwner;
  if (current && current.groups) { const g = current.groups.filter((x) => x.group === t.group && x.payTo === t.payTo)[0]; if (g && g.payToOwner) who = t.payTo + " " + g.payToOwner; }
  $("payTo").innerHTML = who ? "Pay to: <b>" + esc(who) + "</b> · it counts after the lead confirms receipt" : "";
}

// ---------- home: group funds and special collections ----------
function groupsHtml(d) {
  let h = '<div class="list-title">Group funds</div>';
  h += (d.groups || []).map((g) =>
    item("<b>" + esc(g.group) + "</b> · " + g.flats + " flats",
      "Lead " + esc(g.leads.join("/")) + " · budget " + rupee(g.budget) + " · collected " + rupee(g.collectedMonth) + " · spent " + rupee(g.spentMonth) +
      (g.pending ? " · unconfirmed " + rupee(g.pending) : ""),
      (g.balance < 0 ? '<span class="neg">−' : "<span>") + rupee(g.balance) + "</span>")).join("");
  if ((d.specials || []).length) {
    h += '<div class="list-title">Special collections</div>';
    h += d.specials.map((s) =>
      item("<b>" + esc(s.description) + "</b>", esc(s.id) + " · " + rupee(s.share) + " per flat · " + s.unpaid.length + " flats pending · lead " + esc(s.lead),
        rupee(s.collected) + " / " + rupee(s.total))).join("");
  }
  return h;
}

// ---------- collection lead ----------
let lead = null;
async function leadCall(extra) {
  const d = await post(Object.assign({ leadFlat: lead.flat, pin: lead.pin }, extra));
  if (d.status === "error") throw new Error(d.message);
  return d;
}

async function leadLogin() {
  lead = { flat: $("leadFlat").value.trim().toUpperCase(), pin: $("leadPin").value };
  $("leadBody").innerHTML = "Loading...";
  try {
    renderLead(await leadCall({ action: "lead" }));
    $("leadLogin").style.display = "none";
  } catch (err) {
    lead = null;
    $("leadBody").innerHTML = "❌ " + esc(err.message);
  }
}

function renderLead(d) {
  window.leadData = d;
  let h = '<p class="muted">Signed in: <b>' + esc(d.lead) + " " + esc(d.owner) + "</b></p>";

  h += '<div class="list-title">Payments to confirm (' + d.pending.length + ")</div>";
  h += d.pending.length
    ? d.pending.map((p) =>
        '<div class="box">' + item("<b>" + esc(p.flat) + "</b> " + esc(p.owner),
          esc(p.date) + " · " + esc(p.mode) + (p.reference ? " · " + esc(p.reference) : "") + " · " + esc(p.group || p.purpose), rupee(p.amount)) +
        '<button class="mini" onclick="leadConfirm(\'' + p.id + "','Verified')\">✔ Received</button>" +
        '<button class="mini no" onclick="leadConfirm(\'' + p.id + "','Rejected')\">✖ Not received</button></div>").join("")
    : '<p class="muted">Nothing waiting</p>';

  h += '<div class="list-title">My groups</div>';
  h += d.groups.map((g) =>
    '<div class="box">' + item("<b>" + esc(g.group) + "</b>",
      "Budget " + rupee(g.budget) + " · collected this month " + rupee(g.collectedMonth) + " · spent " + rupee(g.spentMonth),
      (g.balance < 0 ? '<span class="neg">−' : "<span>") + rupee(g.balance) + "</span>") +
    (g.balance < 0 ? '<p class="neg">Bills exceed collection by ' + rupee(g.balance) + " – ask other flats to contribute, or you have advanced it.</p>" : "") +
    '<button class="mini" onclick="leadForm(\'bill\',\'' + esc(g.group) + "')\">Record bill paid</button></div>").join("") || '<p class="muted">No groups</p>';

  h += '<div class="list-title">Special collections I lead</div>';
  h += d.specials.map((s) =>
    '<div class="box">' + item("<b>" + esc(s.description) + "</b>",
      esc(s.id) + " · " + rupee(s.share) + " per flat · pending: " + (s.unpaid.map((u) => u.flat).join(", ") || "none"),
      rupee(s.collected) + " / " + rupee(s.total)) +
    "<div class=\"muted\">Spent " + rupee(s.spent) + " · in hand " + rupee(s.balance) + "</div>" +
    '<button class="mini" onclick="leadForm(\'sbill\',\'' + esc(s.id) + "')\">Record vendor payment</button></div>").join("");
  h += '<button class="mini alt" onclick="leadForm(\'special\')">+ New special collection</button>';
  $("leadBody").innerHTML = h;
}

async function leadConfirm(id, decision) {
  try { renderLead(await leadCall({ action: "confirm", ids: [id], decision: decision })); }
  catch (err) { alert("Error : " + err.message); }
}

function leadForm(kind, key) {
  const d = window.leadData, f = $("leadForm");
  const inp = (id, label, type, ph) => "<label>" + label + '</label><input id="lf_' + id + '" type="' + (type || "text") + '" placeholder="' + (ph || "") + '">';
  let h = '<div class="box"><b>' + (kind === "special" ? "New special collection" : "Record bill / vendor payment " + esc(key)) + "</b>";
  if (kind === "special") {
    h += inp("description", "Description", "text", "e.g. Lift AMC") + inp("total", "Total amount", "number") + inp("due", "Due date", "date");
    h += '<p class="muted">Split equally among all paying flats.</p>';
  } else {
    h += inp("date", "Bill / payment date", "date") + inp("amount", "Amount", "number");
    h += "<label>Category</label><select id=\"lf_category\">" + d.categories.map((c) => "<option>" + esc(c) + "</option>").join("") + "<option>Special</option></select>";
    h += inp("vendor", "Vendor", "text") + (kind === "bill" ? inp("period", "Bill month", "month") : "") + inp("remarks", "Reference / remarks", "text");
  }
  h += '<button class="mini" onclick="leadSave(\'' + kind + "','" + (key || "") + "')\">Save</button>" +
       '<button class="mini alt" onclick="$(\'leadForm\').innerHTML=\'\'">Cancel</button></div>';
  f.innerHTML = h;
  if ($("lf_date")) $("lf_date").value = todayStr();
  f.scrollIntoView();
}

async function leadSave(kind, key) {
  const v = (id) => ($("lf_" + id) ? $("lf_" + id).value : "");
  try {
    let r;
    if (kind === "special") {
      r = await leadCall({ action: "special_new", description: v("description"), total: v("total"), dueDate: v("due") });
      alert("Created " + r.created + ": " + rupee(r.share) + " per flat × " + r.flats + " flats");
    } else {
      r = await leadCall({
        action: "bill", group: kind === "bill" ? key : "", specialId: kind === "sbill" ? key : "", date: v("date"), amount: v("amount"),
        category: v("category"), vendor: v("vendor"), billPeriod: v("period"), remarks: v("remarks"),
      });
      alert("Bill recorded");
    }
    $("leadForm").innerHTML = "";
    renderLead(r);
  } catch (err) {
    alert("Error : " + err.message);
  }
}
