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

// DocuSign Auth
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

// HTML Escape
function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Startseite
app.get("/", (req, res) => {
  res.send(`
    <html>
      <body style="font-family:Arial; background:#f5f5f5;">
        <div style="max-width:500px;margin:40px auto;background:white;padding:30px;border-radius:12px;">
          
          <h2>Auftrag starten</h2>

          <form method="POST" action="/start-signing">
            <label>Name</label><br>
            <input name="customerName" style="width:100%;padding:10px;margin-top:5px;" required><br><br>

            <label>E-Mail</label><br>
            <input name="customerEmail" type="email" style="width:100%;padding:10px;margin-top:5px;" required><br><br>

            <button style="width:100%;padding:15px;background:black;color:white;border:none;border-radius:8px;">
              Zur Unterschrift
            </button>
          </form>

        </div>
      </body>
    </html>
  `);
});

// Signing starten
app.post("/start-signing", async (req, res) => {
  try {
    const name = req.body.customerName;
    const email = req.body.customerEmail;

    const { accessToken, accountId, baseUri } = await getDocuSignAuth();

    const documentHtml = `
      <html>
        <body style="font-family: Arial; background:#f5f5f5; padding:40px;">
          
          <div style="max-width:600px; margin:auto; background:white; padding:40px; border-radius:12px;">

            <div style="text-align:center; margin-bottom:30px;">
              <img src="https://i.imgur.com/jqPSi9m.jpeg" style="width:250px;" />
            </div>

            <h2 style="text-align:center;">Einverständniserklärung</h2>

            <p style="text-align:center;">
              Hiermit bestätige ich den Auftrag sowie die Durchführung der vereinbarten Arbeiten an meinem Fahrzeug.
            </p>

            <p><strong>Name:</strong> ${escapeHtml(name)}</p>
            <p><strong>E-Mail:</strong> ${escapeHtml(email)}</p>

            <p style="margin-top:50px;"><strong>Unterschrift:</strong></p>

            <div style="margin-top:30px; text-align:center;">
              /sn1/
            </div>

          </div>

        </body>
      </html>
    `;

    const documentBase64 = Buffer.from(documentHtml).toString("base64");

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
          signers: [
            {
              email,
              name,
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
          ],
          carbonCopies: [
            {
              email: "info@amz-dreilaendereck.de",
              name: "AMZ Dreilaendereck",
              recipientId: "2"
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

    const viewRes = await axios.post(
      `${baseUri}/restapi/v2.1/accounts/${accountId}/envelopes/${envelopeId}/views/recipient`,
      {
        returnUrl: "https://express-hello-world-43k4.onrender.com/done",
        authenticationMethod: "none",
        email,
        userName: name,
        clientUserId: "1234"
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      }
    );

    res.redirect(viewRes.data.url);
  } catch (e) {
    console.error("DOCUSIGN ERROR:", e.response?.data || e.message);
    res.send("Fehler bei DocuSign");
  }
});

app.get("/done", (req, res) => {
  res.send(`
    <html>
      <body style="font-family:Arial; text-align:center; padding:50px;">
        <h2>Vielen Dank!</h2>
        <p>Der Auftrag wurde erfolgreich bestätigt.</p>
        <a href="/">Neuer Auftrag</a>
      </body>
    </html>
  `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("läuft"));
