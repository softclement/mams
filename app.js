const API_URL =
  "https://script.google.com/macros/s/AKfycbxGgtUd2WuVk1P-TbGhRLkExKcH3aDd6CTdyIttJzSgE-EJNmWPruwfjStUCnjYbuY4/exec";

window.onload = function () {
  loadFlats();
};

function setStatus(msg) {
  document.getElementById("status").innerHTML = msg;
}

async function loadFlats() {
  const dropdown = document.getElementById("flat");
  try {
    const response = await fetch(API_URL + "?action=flats");
    const data = await response.json();

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

async function submitPayment() {
  const btn = document.querySelector("button");

  const payload = {
    action: "payment",
    flat: document.getElementById("flat").value,
    amount: document.getElementById("amount").value,
    mode: document.getElementById("mode").value,
    reference: document.getElementById("reference").value,
    remarks: document.getElementById("remarks").value,
  };

  if (!payload.amount || Number(payload.amount) <= 0) {
    alert("Please enter a valid amount");
    return;
  }

  btn.disabled = true;
  setStatus("⏳ Saving...");

  try {
    // String body with no custom headers = "simple" request (no CORS preflight),
    // which is what Apps Script web apps need.
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
      throw new Error(
        "Server did not return JSON (check deployment access / doPost). Got: " +
          text.slice(0, 120)
      );
    }

    if (result.status === "success") {
      setStatus("✅ Payment Saved");
      alert("Payment Saved Successfully");
      document.getElementById("amount").value = "";
      document.getElementById("reference").value = "";
      document.getElementById("remarks").value = "";
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
