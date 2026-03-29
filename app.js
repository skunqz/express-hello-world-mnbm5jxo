const express = require("express");
const axios = require("axios");
const fs = require("fs");
const jwt = require("jsonwebtoken");

const app = express();

// 👉 ENV Variablen
const INTEGRATION_KEY = process.env.INTEGRATION_KEY;
const USER_ID = process.env.USER_ID;

// 👉 RSA Key laden
const PRIVATE_KEY = fs.readFileSync("private.key");

// 🔐 JWT + Account automatisch holen
async function getDocuSignAuth() {
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

  // 👉 Access Token holen
  const tokenRes = await axios.post(
    "https://account-d.docusign.com/oauth/token",
    `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${token}`,
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      }
    }
  );

  const accessToken = tokenRes.data.access_token;

  // 👉 richtigen Account + Base URL holen
  const userInfoRes = await axios.get(
    "https://account-d.docusign.com/oauth/userinfo",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    }
  );

  const account =
    userInfoRes.data.accounts.find(a => a.is_default) ||
    userInfoRes.data.accounts[0];

  return {
    accessToken,
    accountId: account.account_id,
    baseUri: account.base_uri
  };
}

// 🚀 START ROUTE
app.get("/", async (req, res) => {
  try {
    const { accessToken, accountId, baseUri } = await getDocuSignAuth();

    // 👉 Test-Dokument
    const pdfBase64 = Buffer.from(`
      <html>
        <body>
          <h1>Bitte hier unterschreiben</h1>
          <p>/sn1/</p>
        </body>
      </html>
    `).toString("base64");

    // 📄 Envelope erstellen
    const envelopeRes = await axios.post(
      `${baseUri}/restapi/v2.1/accounts/${accountId}/envelopes`,
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
              clientUserId: "1234",
              tabs: {
                signHereTabs: [
                  {
                    anchorString: "/sn1/",
                    anchorYOffset: "0",
                    anchorUnits: "pixels",
                    anchorXOffset: "0"
                  }
                ]
              }
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

    // ✍️ Signing URL holen
    const viewRes = await axios.post(
      `${baseUri}/restapi/v2.1/accounts/${accountId}/envelopes/${envelopeId}/views/recipient`,
      {
        returnUrl: "https://express-hello-world-43k4.onrender.com/done",
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

    // 👉 Weiterleitung zu DocuSign
    res.redirect(viewRes.data.url);

  } catch (e) {
    console.error("DOCUSIGN ERROR:");
    console.error(e.response?.data || e.message);
    res.send("Fehler bei DocuSign");
  }
});

// ✅ Nach Unterschrift
app.get("/done", (req, res) => {
  res.send("Unterschrift abgeschlossen.");
});

// Render Port
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("läuft"));
