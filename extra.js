// ===== login, reports, admin (loaded after app.js) =====
let me = null;
try { me = JSON.parse(localStorage.getItem("mams_me") || "null"); } catch (e) {}
let afterLogin = "dashboard";

function saveMe() {
  try { if (me) localStorage.setItem("mams_me", JSON.stringify(me)); else localStorage.removeItem("mams_me"); } catch (e) {}
  showMe();
}
function showMe() { $("who").innerHTML = me ? "👤 " + esc(me.flat) + " " + esc(me.owner) : "👤 Log in"; }
function restoreLogin() { showMe(); }
function gate(view) {
  afterLogin = view;
  return '<div class="summary">Please log in with your flat and PIN. <button class="mini" onclick="show(\'account\')">Log in</button></div>';
}
function inp(id, label, type, val, ph) {
  return '<label>' + label + '</label><input id="' + id + '" type="' + (type || "text") + '" value="' + esc(val || "") + '" placeholder="' + (ph || "") + '">';
}

// ---------- account ----------
function renderAccount() {
  const b = $("accBody");
  if (!me) {
    b.innerHTML = inp("accFlat", "Flat", "text", "", "e.g. G1") + inp("accPin", "PIN", "password", "", "First time PIN is 123") +
      '<button type="button" onclick="doLogin()">Log in</button>';
    return;
  }
  b.innerHTML = '<p>Signed in as <b>' + esc(me.flat) + " " + esc(me.owner) + "</b></p>" +
    '<div class="list-title">Change PIN</div>' + inp("accNew", "New PIN", "password") +
    '<button type="button" onclick="changePin()">Change PIN</button>' +
    '<button type="button" class="mini alt" onclick="logout()" style="margin-top:12px;width:100%">Log out</button>';
}
async function doLogin() {
  const flat = $("accFlat").value.trim().toUpperCase(), pin = $("accPin").value;
  try {
    const r = await post({ action: "login", flat: flat, pin: pin });
    if (r.status === "error") throw new Error(r.message);
    me = { flat: r.flat, owner: r.owner, pin: pin };
    saveMe();
    show(afterLogin);
  } catch (err) { alert("Error : " + err.message); }
}
async function changePin() {
  const np = $("accNew").value.trim();
  if (!np) { alert("Enter a new PIN"); return; }
  try {
    const r = await post({ action: "change_pin", flat: me.flat, pin: me.pin, newPin: np });
    if (r.status === "error") throw new Error(r.message);
    me.pin = np; saveMe(); $("accNew").value = ""; alert("PIN changed");
  } catch (err) { alert("Error : " + err.message); }
}
function logout() { me = null; saveMe(); renderAccount(); }

// ---------- pay: locked to the logged-in flat ----------
function payInit() {
  if (!me) {
    $("payGate").style.display = "block"; $("payGate").innerHTML = gate("pay"); $("payCard").style.display = "none";
    return;
  }
  $("payGate").style.display = "none"; $("payCard").style.display = "block";
  $("flat").value = me.flat; $("flat").disabled = true;
  loadBalance();
}

// ---------- reports ----------
function monthNow() { return todayStr().slice(0, 7); }
function repInit() {
  $("repBody").innerHTML = me ? "" : gate("reports");
  $("repBox").style.display = me ? "block" : "none";
  if (me) repCtl();
}
function repCtl() {
  const t = $("repType").value, flats = window.FLATS || [];
  let h = "";
  if (t === "sel") h = '<div class="box">' + flats.map((f) => '<label style="font-weight:normal;display:inline-block;width:48%"><input type="checkbox" class="selFlat" value="' + esc(f[0]) + '" style="width:auto"> ' + esc(f[0]) + " " + esc(f[1]) + "</label>").join("") + "</div>";
  if (t === "ledger") h = '<label>Flat</label><select id="repFlat">' + flats.map((f) => "<option value=\"" + esc(f[0]) + "\"" + (me && f[0] === me.flat ? " selected" : "") + ">" + esc(f[0]) + " - " + esc(f[1]) + "</option>").join("") + "</select>";
  if (t === "coll" || t === "exp") h = inp("repMonth", "Month", "month", monthNow());
  $("repCtl").innerHTML = h;
  $("repOut").innerHTML = "";
}
function totalsList(title, pairs) {
  return '<div class="list-title">' + title + "</div>" + (pairs.map((p) => item(esc(p[0]), "", rupee(p[1]))).join("") || '<p class="muted">None</p>');
}
async function repShow() {
  const t = $("repType").value, out = $("repOut");
  out.innerHTML = "Loading...";
  const call = async (action, extra) => {
    const d = await post(Object.assign({ action: action, flat: me.flat, pin: me.pin }, extra));
    if (d.status === "error") throw new Error(d.message);
    return d;
  };
  try {
    let h = "";
    if (t === "dues" || t === "sel") {
      let rows = (await call("rep_dues")).rows;
      if (t === "sel") {
        const picked = [].slice.call(document.querySelectorAll(".selFlat:checked")).map((x) => x.value);
        rows = rows.filter((r) => picked.indexOf(r.flat) >= 0);
      }
      const due = rows.reduce((s, r) => s + (r.outstanding > 0 ? r.outstanding : 0), 0);
      const adv = rows.reduce((s, r) => s + (r.outstanding < 0 ? -r.outstanding : 0), 0);
      h = '<div class="summary">' + rows.length + " flats · Due <b class=\"due\">" + rupee(due) + "</b> · Advance <b class=\"adv\">" + rupee(adv) + "</b></div>" +
        rows.map((r) => item("<b>" + esc(r.flat) + "</b> " + esc(r.owner), "Opening " + (r.opening < 0 ? "-" : "") + rupee(r.opening) + " · Charged " + rupee(r.demand) + " · Paid " + rupee(r.paid),
          r.outstanding > 0 ? '<span class="due">' + rupee(r.outstanding) + "</span>" : r.outstanding < 0 ? '<span class="adv">Adv ' + rupee(r.outstanding) + "</span>" : "Nil")).join("");
    } else if (t === "ledger") {
      const d = await call("rep_ledger", { target: $("repFlat").value });
      h = '<div class="summary"><b>' + esc(d.flat) + " " + esc(d.owner) + "</b><br>Balance: " + statusLine(d.balance, 0) + "</div>" +
        (d.entries.map((e) => item(esc(e.date) + " · " + esc(e.desc), "Balance " + (e.balance < 0 ? "Adv " : "Due ") + rupee(e.balance),
          e.debit ? "+" + rupee(e.debit) : '<span class="adv">−' + rupee(e.credit) + "</span>")).join("") || '<p class="muted">No entries</p>');
    } else if (t === "coll") {
      const d = await call("rep_collection", { month: $("repMonth").value || "all" });
      h = '<div class="summary">Confirmed <b>' + rupee(d.verified) + "</b>" + (d.pending ? " · awaiting confirmation " + rupee(d.pending) : "") + "</div>" +
        totalsList("By group", d.byGroup) + totalsList("By mode", d.byMode) + '<div class="list-title">Payments</div>' +
        (d.rows.map((r) => item("<b>" + esc(r.flat) + "</b> " + esc(r.owner), esc(r.date) + " · " + esc(r.mode) + (r.reference ? " · " + esc(r.reference) : "") + " · " + esc(r.group || "General") + (r.payTo ? " → " + esc(r.payTo) : "") +
          (r.status !== "Verified" ? ' <span class="tag">' + esc(r.status) + "</span>" : ""), rupee(r.amount))).join("") || '<p class="muted">No payments</p>');
    } else {
      const d = await call("rep_expense", { month: $("repMonth").value || "all" });
      h = '<div class="summary">Total spent <b>' + rupee(d.total) + "</b></div>" + totalsList("By category", d.byCategory) + '<div class="list-title">Expenses</div>' +
        (d.rows.map((r) => item(esc(r.category) + (r.vendor ? " · " + esc(r.vendor) : ""), esc(r.date) + (r.group ? " · " + esc(r.group) : "") + (r.paidBy ? " · paid by " + esc(r.paidBy) : "") + (r.remarks ? " · " + esc(r.remarks) : ""), rupee(r.amount))).join("") || '<p class="muted">No expenses</p>');
    }
    out.innerHTML = h;
  } catch (err) { out.innerHTML = "❌ " + esc(err.message); }
}

// ---------- admin (committee PIN) ----------
let adm = null, M = null;
const ADM_MENU = [["flats", "Flats master"], ["groups", "Groups"], ["members", "Group members"], ["leads", "Leads"], ["opening", "Opening balance"],
  ["rates", "Maintenance rates"], ["demand", "Monthly demand raise"], ["pin", "Reset a flat's PIN"]];

function admInit() {
  const b = $("admBody");
  if (!adm) {
    b.innerHTML = inp("admPin", "Committee PIN", "password") + '<button type="button" onclick="admLogin()">Open</button>';
    $("admOut").innerHTML = "";
    return;
  }
  b.innerHTML = '<select id="admType" onchange="admOpen()"><option value="">Select…</option>' + ADM_MENU.map((m) => '<option value="' + m[0] + '">' + m[1] + "</option>").join("") + "</select>";
}
function admLogin() { adm = $("admPin").value; admInit(); }
async function admCall(extra) {
  const d = await post(Object.assign({ adminPin: adm }, extra));
  if (d.status === "error") { if (/PIN/.test(d.message)) { adm = null; admInit(); } throw new Error(d.message); }
  return d;
}
async function admOpen() {
  const t = $("admType").value, out = $("admOut");
  if (!t) { out.innerHTML = ""; return; }
  if (t === "demand") {
    out.innerHTML = inp("dmMonth", "Month", "month", monthNow()) + '<button type="button" onclick="admDemand()">Raise demand for this month</button><div id="dmOut"></div>';
  } else if (t === "pin") {
    out.innerHTML = '<label>Flat</label><select id="pinFlat">' + (window.FLATS || []).map((f) => "<option value=\"" + esc(f[0]) + "\">" + esc(f[0]) + " - " + esc(f[1]) + "</option>").join("") +
      '</select><button type="button" onclick="admReset()">Reset PIN to 123</button>';
  } else {
    out.innerHTML = "Loading...";
    try { M = Object.assign({ type: t }, await admCall({ action: "master_list", sheet: t })); renderMaster(); }
    catch (err) { out.innerHTML = "❌ " + esc(err.message); }
  }
}
function renderMaster() {
  $("admOut").innerHTML = '<button type="button" class="mini" onclick="admEdit(0)">+ Add new</button><div id="admForm"></div>' +
    (M.rows.map((r) => item("<b>" + esc(r.values[0]) + "</b> " + esc(r.values[1] != null ? r.values[1] : ""), esc(r.values.slice(2).filter((v) => v !== "").join(" · ")),
      '<button class="mini" onclick="admEdit(' + r.row + ')">Edit</button>')).join("") || '<p class="muted">No rows yet</p>');
}
function admEdit(row) {
  const cur = (M.rows.filter((r) => r.row === row)[0] || { values: [] }).values;
  let h = '<div class="box"><b>' + (row ? "Edit" : "Add") + "</b>";
  M.cols.forEach((c, i) => {
    const v = cur[i] == null ? "" : cur[i], id = "mf_" + i;
    if (c.t === "group" || c.t === "lead") {
      const opts = c.t === "group" ? M.options.groups.map((g) => [g, g])
        : M.options.leads.map((l) => [l.flat, l.flat + " – " + l.owner]).concat([["Vendor direct", "Vendor direct (agency)"]]);
      if (v && !opts.some((o) => o[0] === v)) opts.push([v, v]);
      h += "<label>" + esc(c.n) + '</label><select id="' + id + '"><option value="">Select…</option>' +
        opts.map((o) => '<option value="' + esc(o[0]) + '"' + (o[0] === v ? " selected" : "") + ">" + esc(o[1]) + "</option>").join("") + "</select>";
    } else if (c.t === "yn") h += "<label>" + esc(c.n) + '</label><select id="' + id + '"><option' + (v === "N" ? "" : " selected") + ">Y</option><option" + (v === "N" ? " selected" : "") + ">N</option></select>";
    else h += inp(id, esc(c.n), c.t === "number" ? "number" : c.t === "date" ? "date" : "text", v);
  });
  h += '<button class="mini" onclick="admSave(' + row + ')">Save</button><button class="mini alt" onclick="$(\'admForm\').innerHTML=\'\'">Cancel</button></div>';
  $("admForm").innerHTML = h;
}
async function admSave(row) {
  try {
    const values = M.cols.map((c, i) => $("mf_" + i).value);
    M = Object.assign({ type: M.type }, await admCall({ action: "master_save", sheet: M.type, row: row, values: values }));
    renderMaster();
  } catch (err) { alert("Error : " + err.message); }
}
async function admDemand() {
  try {
    const d = await admCall({ action: "demand_raise", month: $("dmMonth").value });
    $("dmOut").innerHTML = '<div class="summary">' + d.added + " new rows raised for " + esc(d.month) + " · month total " + rupee(d.total) + "</div>" +
      d.rows.map((r) => item(esc(r.flat), "", rupee(r.amount))).join("");
  } catch (err) { alert("Error : " + err.message); }
}
async function admReset() {
  const f = $("pinFlat").value;
  if (!confirm("Reset PIN of " + f + " to 123?")) return;
  try { await admCall({ action: "admin_reset_pin", flat: f }); alert("PIN of " + f + " is now 123"); }
  catch (err) { alert("Error : " + err.message); }
}
