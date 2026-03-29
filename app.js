const express = require("express");
const axios = require("axios");
const fs = require("fs");
const jwt = require("jsonwebtoken");

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const INTEGRATION_KEY = process.env.INTEGRATION_KEY;
const USER_ID = process.env.USER_ID;
const PRIVATE_KEY = fs.readFileSync("private.key");

// JWT + Account automatisch holen
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

  const userInfoRes = await axios.get(
    "https://account-d.docusign.com/oauth/userinfo",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    }
  );

  const account =
    userInfoRes.data.accounts.find((a) => a.is_default) ||
    userInfoRes.data.accounts[0];

  return {
    accessToken,
    accountId: account.account_id,
    baseUri: account.base_uri
  };
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Startseite mit Formular
app.get("/", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.send(`
    <!DOCTYPE html>
    <html lang="de">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Unterschrift starten</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          background: #f7f7f7;
          margin: 0;
          padding: 0;
        }
        .wrap {
          max-width: 520px;
          margin: 40px auto;
          background: white;
          padding: 28px;
          border-radius: 12px;
          box-shadow: 0 4px 16px rgba(0,0,0,0.08);
        }
        h1 {
          margin-top: 0;
          font-size: 28px;
        }
        label {
          display: block;
          margin-top: 18px;
          margin-bottom: 8px;
          font-weight: bold;
        }
        input {
          width: 100%;
          padding: 14px;
          font-size: 18px;
          box-sizing: border-box;
          border: 1px solid #ccc;
          border-radius: 8px;
        }
        button {
          margin-top: 24px;
          width: 100%;
          padding: 16px;
          font-size: 20px;
          border: none;
          border-radius: 10px;
          background: #4f46e5;
          color: white;
          cursor: pointer;
        }
        p.note {
          margin-top: 16px;
          font-size: 14px;
          color: #555;
        }
      </style>
    </head>
    <body>
      <div class="wrap">
        <h1>Bitte Daten eingeben</h1>
        <form method="POST" action="/start-signing" autocomplete="off">
          <label for="customerName">Name</label>
          <input id="customerName" name="customerName" type="text" required />

          <label for="customerEmail">E-Mail-Adresse</label>
          <input id="customerEmail" name="customerEmail" type="email" required />

          <button type="submit">Zur Unterschrift</button>
        </form>
        <p class="note">
          Der Kunde gibt hier seinen Namen und seine E-Mail ein und wird danach direkt zur Unterschrift weitergeleitet.
        </p>
      </div>
    </body>
    </html>
  `);
});

// Signing starten
app.post("/start-signing", async (req, res) => {
  try {
    const customerName = (req.body.customerName || "").trim();
    const customerEmail = (req.body.customerEmail || "").trim();

    if (!customerName || !customerEmail) {
      return res.status(400).send("Name und E-Mail sind erforderlich.");
    }

    const { accessToken, accountId, baseUri } = await getDocuSignAuth();

    // Einfaches Testdokument
    const documentHtml = `
      <html>
        <body style="font-family: Arial, sans-serif; padding: 40px;">
          <h1>Bitte hier unterschreiben</h1>
          <p>Name: ${escapeHtml(customerName)}</p>
          <p>E-Mail: ${escapeHtml(customerEmail)}</p>
          <p style="margin-top: 40px;">/sn1/</p>
        </body>
      </html>
    `;

    const documentBase64 = Buffer.from(documentHtml).toString("base64");

    // Name/E-Mail/clientUserId müssen für den Recipient View mit dem Empfänger im Envelope übereinstimmen. :contentReference[oaicite:1]{index=1}
    const signer = {
      email: customerEmail,
      name: customerName,
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
    };

    const envelopeRes = await axios.post(
      `${baseUri}/restapi/v2.1/accounts/${accountId}/envelopes`,
      {
        emailSubject: "Bitte unterschreiben",
        documents: [
          {
            documentBase64,
            name: "Dokument",
            fileExtension: "html",
            documentId: "1"
          }
        ],
        recipients: {
          signers: [signer]
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

    const viewRes = await axios.post(
      `${baseUri}/restapi/v2.1/accounts/${accountId}/envelopes/${envelopeId}/views/recipient`,
      {
        returnUrl: "https://express-hello-world-43k4.onrender.com/done",
        authenticationMethod: "none",
        email: customerEmail,
        userName: customerName,
        clientUserId: "1234"
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      }
    );

    return res.redirect(viewRes.data.url);
  } catch (e) {
    console.error("DOCUSIGN ERROR:");
    console.error(e.response?.data || e.message);
    return res.status(500).send("Fehler bei DocuSign");
  }
});

app.get("/done", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.send(`
    <!DOCTYPE html>
    <html lang="de">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Fertig</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          background: #f7f7f7;
          margin: 0;
          padding: 0;
        }
        .wrap {
          max-width: 520px;
          margin: 40px auto;
          background: white;
          padding: 28px;
          border-radius: 12px;
          box-shadow: 0 4px 16px rgba(0,0,0,0.08);
          text-align: center;
        }
        a {
          display: inline-block;
          margin-top: 24px;
          padding: 14px 20px;
          background: #4f46e5;
          color: white;
          text-decoration: none;
          border-radius: 10px;
          font-size: 18px;
        }
      </style>
    </head>
    <body>
      <div class="wrap">
        <h1>Vielen Dank</h1>
        <p>Die Unterschrift wurde abgeschlossen.</p>
        <a href="/">Zur Startseite</a>
      </div>
    </body>
    </html>
  `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("läuft"));
