const API_URL =
  "https://script.google.com/macros/s/AKfycbyUfTFLmLWJDvpfjwCXdkD5JiJbNDHmh5vQBPnBfz9nOp9EsCerTDqn2nqfw4LL7xTU/exec";

const VIEWS = ["dashboard", "pay", "statement", "expenses", "defaulters"];
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
      '<p class="muted">*Does not include any opening bank balance.</p>';
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
    "Last payment: " + last;
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
