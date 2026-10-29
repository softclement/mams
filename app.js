const API_URL =
  "https://script.google.com/macros/s/AKfycbxGgtUd2WuVk1P-TbGhRLkExKcH3aDd6CTdyIttJzSgE-EJNmWPruwfjStUCnjYbuY4/exec";

let current = null; // balance of the selected flat

const rupee = (n) => "₹" + Math.abs(Number(n)).toLocaleString("en-IN");

function todayStr() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function setStatus(msg) {
  document.getElementById("status").innerHTML = msg;
}

async function api(params) {
  const res = await fetch(API_URL + "?" + new URLSearchParams(params));
  const data = await res.json();
  if (data && data.status === "error") throw new Error(data.message);
  return data;
}

window.onload = async function () {
  document.getElementById("paymentDate").value = todayStr();
  await loadFlats();
  await loadBalance();
};

async function loadFlats() {
  const dropdown = document.getElementById("flat");
  try {
    const data = await api({ action: "flats" });
    dropdown.innerHTML = "";
    data.forEach((row) => {
      const option = document.createElement("option");
      option.value = row[0];
      option.text = row[0] + " - " + row[1];
      dropdown.appendChild(option);
    });
    setStatus("Ready");
  } catch (err) {
    console.error(err);
    dropdown.innerHTML = "<option>Could not load flats</option>";
    setStatus("❌ Could not load flats: " + err.message);
  }
}

async function loadBalance() {
  const flat = document.getElementById("flat").value;
  const box = document.getElementById("summary");
  current = null;
  document.getElementById("preview").innerHTML = "";
  if (!flat || flat.indexOf("Could not") === 0) return;
  box.innerHTML = "Loading balance...";
  try {
    current = await api({ action: "balance", flat: flat });
    renderSummary();
    updatePreview();
  } catch (err) {
    console.error(err);
    box.innerHTML = "❌ Could not load balance: " + err.message;
  }
}

function statusLine(outstanding, monthly) {
  const months = monthly ? Math.round((Math.abs(outstanding) / monthly) * 10) / 10 : 0;
  if (outstanding > 0) return '<span class="due">Due ' + rupee(outstanding) + "</span> (about " + months + " months)";
  if (outstanding < 0) return '<span class="adv">Advance ' + rupee(outstanding) + "</span> (about " + months + " months)";
  return "Up to date";
}

function renderSummary() {
  if (!current) return;
  const last = current.lastPayment
    ? current.lastPayment.date + " (" + rupee(current.lastPayment.amount) + ")"
    : "none yet";
  document.getElementById("summary").innerHTML =
    "Monthly amount: <b>" + rupee(current.monthly) + "</b><br>" +
    "Status: " + statusLine(current.outstanding, current.monthly) + "<br>" +
    "Last payment: " + last;
}

function updatePreview() {
  const box = document.getElementById("preview");
  const amount = Number(document.getElementById("amount").value);
  if (!current || !(amount > 0)) {
    box.innerHTML = "";
    return;
  }
  box.innerHTML = "After this payment: " + statusLine(current.outstanding - amount, current.monthly);
}

function setAmount(v) {
  document.getElementById("amount").value = v;
  updatePreview();
}

function fillMonths(n) {
  if (current) setAmount(current.monthly * n);
}

function fillDues() {
  if (!current) return;
  if (current.outstanding > 0) setAmount(current.outstanding);
  else alert("No dues pending for this flat");
}

async function submitPayment(force) {
  const btn = document.getElementById("submitBtn");

  const payload = {
    action: "payment",
    flat: document.getElementById("flat").value,
    paymentDate: document.getElementById("paymentDate").value,
    amount: document.getElementById("amount").value,
    mode: document.getElementById("mode").value,
    reference: document.getElementById("reference").value,
    remarks: document.getElementById("remarks").value,
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
    // text/plain keeps this a "simple" request (no CORS preflight), which Apps Script needs
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
    });

    const text = await response.text();
    console.log("Raw response:", text);

    let result;
    try {
      result = JSON.parse(text);
    } catch (e) {
      throw new Error("Server did not return JSON (check deployment). Got: " + text.slice(0, 120));
    }

    if (result.status === "success") {
      setStatus("✅ Payment Saved");
      alert("Payment Saved Successfully");
      document.getElementById("amount").value = "";
      document.getElementById("reference").value = "";
      document.getElementById("remarks").value = "";
      current = result.balance;
      renderSummary();
      updatePreview();
    } else if (result.status === "duplicate") {
      setStatus("⚠️ Possible duplicate");
      btn.disabled = false;
      if (confirm(result.message + "\nSave it anyway?")) await submitPayment(true);
      return;
    } else {
      setStatus("❌ " + result.message);
      alert("Error : " + result.message);
    }
  } catch (err) {
    console.error(err);
    setStatus("❌ " + err.message);
    alert("Error : " + err.message);
  } finally {
    btn.disabled = false;
  }
}
