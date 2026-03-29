const express = require("express");
const axios = require("axios");
const fs = require("fs");

const app = express();

// 👉 HIER DEINE DATEN EINTRAGEN
const INTEGRATION_KEY = process.env.INTEGRATION_KEY;
const USER_ID = process.env.USER_ID;
const ACCOUNT_ID = process.env.ACCOUNT_ID;

const PRIVATE_KEY = fs.readFileSync("private.key"); // RSA Key

// 👉 TOKEN HOLEN (JWT)
async function getAccessToken() {
  const jwt = require("jsonwebtoken");

  const now = Math.floor(Date.now() / 1000);

  const payload = {
    iss: INTEGRATION_KEY,
    sub: USER_ID,
    aud: "account-d.docusign.com",
    iat: now,
    exp: now + 3600,
    scope: "signature impersonation"
  };

  const token = jwt.sign(payload, PRIVATE_KEY, { algorithm: "RS256" });

  const res = await axios.post(
    "https://account-d.docusign.com/oauth/token",
    `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${token}`,
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      }
    }
  );

  return res.data.access_token;
}

// 👉 START ROUTE
app.get("/", async (req, res) => {
  try {
    const accessToken = await getAccessToken();

    // 👉 kleines Test-PDF (wichtig!)
    const pdfBase64 = Buffer.from(`
      <html>
        <body>
          <h1>Bitte hier unterschreiben</h1>
          <p>/sn1/</p>
        </body>
      </html>
    `).toString("base64");

    // 1. Envelope erstellen
    const envelopeRes = await axios.post(
      `https://demo.docusign.net/restapi/v2.1/accounts/${ACCOUNT_ID}/envelopes`,
      {
        emailSubject: "Bitte unterschreiben",
        documents: [
          {
            documentBase64: pdfBase64,
            name: "Dokument",
            fileExtension: "html",
            documentId: "1"
          }
        ],
        recipients: {
          signers: [
            {
              email: "test@test.com",
              name: "Kiosk User",
              recipientId: "1",
              clientUserId: "1234"
            }
          ]
        },
        status: "sent"
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      }
    );

    const envelopeId = envelopeRes.data.envelopeId;

    // 2. Signing URL holen
    const viewRes = await axios.post(
      `https://demo.docusign.net/restapi/v2.1/accounts/${ACCOUNT_ID}/envelopes/${envelopeId}/views/recipient`,
      {
        returnUrl: "https://deine-render-app.onrender.com",
        authenticationMethod: "none",
        email: "test@test.com",
        userName: "Kiosk User",
        clientUserId: "1234"
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      }
    );

    // 3. Weiterleitung = Kiosk
    res.redirect(viewRes.data.url);

  } catch (e) {
    console.error(e.response?.data || e.message);
    res.send("Fehler bei DocuSign");
  }
});

app.listen(3000, () => console.log("läuft"));
