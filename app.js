const API_URL =
"https://script.google.com/macros/s/AKfycbxGgtUd2WuVk1P-TbGhRLkExKcH3aDd6CTdyIttJzSgE-EJNmWPruwfjStUCnjYbuY4/exec";

window.onload = function() {

loadFlats();

};

async function loadFlats() {

const url =
API_URL +
"?action=flats";

const response =
await fetch(url);

const data =
await response.json();

const dropdown =
document.getElementById("flat");

dropdown.innerHTML = "";

data.forEach(row => {

const option =
document.createElement("option");

option.value = row[0];

option.text =
row[0] + " - " + row[1];

dropdown.appendChild(option);

});

}

async function submitPayment() {

  const payload = {

    action: "payment",

    flat:
      document.getElementById("flat").value,

    amount:
      document.getElementById("amount").value,

    mode:
      document.getElementById("mode").value,

    reference:
      document.getElementById("reference").value,

    remarks:
      document.getElementById("remarks").value

  };

  const response =
    await fetch(API_URL, {

      method: "POST",

      body: JSON.stringify(payload)

    });

  const result =
    await response.json();

  console.log(result);

  if(result.status === "success") {

    alert("Payment Saved Successfully");

    document.getElementById("status")
      .innerHTML =
      "✅ Payment Saved";

  } else {

    alert(
      "Error : " + result.message
    );

  }

}
