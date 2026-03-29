const express = require("express");
const axios = require("axios");
const fs = require("fs");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// 🔑 DocuSign
const INTEGRATION_KEY = process.env.INTEGRATION_KEY;
const USER_ID = process.env.USER_ID;
const PRIVATE_KEY = fs.readFileSync("private.key");

// 📧 Gmail Daten
const EMAIL_USER = "alwin8952@gmail.com";
const EMAIL_PASS = "bakcxfizejdtbwqm";

// 📧 Mail Setup
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: EMAIL_USER,
    pass: EMAIL_PASS
  }
});

// 🔐 DocuSign Auth
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
      headers: { "Content-Type": "application/x-www-form-urlencoded" }
    }
  );

  const accessToken = tokenRes.data.access_token;

  const userInfoRes = await axios.get(
    "https://account-d.docusign.com/oauth/userinfo",
    {
      headers: { Authorization: `Bearer ${accessToken}` }
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

// 🏠 Startseite
app.get("/", (req, res) => {
  res.send(`
    <html>
      <body style="font-family:Arial; background:#f5f5f5;">
        <div style="max-width:500px;margin:40px auto;background:white;padding:30px;border-radius:12px;">
          
          <h2>Auftrag starten</h2>

          <form method="POST" action="/start-signing">
            <label>Name</label><br>
            <input name="customerName" required><br><br>

            <label>E-Mail</label><br>
            <input name="customerEmail" required><br><br>

            <button>Zur Unterschrift</button>
          </form>

        </div>
      </body>
    </html>
  `);
});

// ✍️ Signing starten
app.post("/start-signing", async (req, res) => {
  try {
    const name = req.body.customerName;
    const email = req.body.customerEmail;

    const { accessToken, accountId, baseUri } = await getDocuSignAuth();

    const documentHtml = `
      <html>
        <body style="font-family:Arial;padding:40px;">
          <img src="https://i.imgur.com/jqPSi9m.jpeg" style="width:250px;">
          <h2>Einverständniserklärung</h2>
          <p>Hiermit bestätige ich den Auftrag sowie die Durchführung der vereinbarten Arbeiten.</p>
          <p>Name: ${name}</p>
          <p>Email: ${email}</p>
          <p>/sn1/</p>
        </body>
      </html>
    `;

    const envelopeRes = await axios.post(
      `${baseUri}/restapi/v2.1/accounts/${accountId}/envelopes`,
      {
        emailSubject: "Signatur",
        documents: [
          {
            documentBase64: Buffer.from(documentHtml).toString("base64"),
            name: "Dokument",
            fileExtension: "html",
            documentId: "1"
          }
        ],
        recipients: {
          signers: [
            {
              email: "test@test.com",
              name: "Kiosk",
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
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    const envelopeId = envelopeRes.data.envelopeId;

    const viewRes = await axios.post(
      `${baseUri}/restapi/v2.1/accounts/${accountId}/envelopes/${envelopeId}/views/recipient`,
      {
        returnUrl: `https://express-hello-world-43k4.onrender.com/done?envelopeId=${envelopeId}&name=${encodeURIComponent(name)}`,
        authenticationMethod: "none",
        email: "test@test.com",
        userName: "Kiosk",
        clientUserId: "1234"
      },
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    res.redirect(viewRes.data.url);

  } catch (e) {
    console.error(e.response?.data || e.message);
    res.send("Fehler bei DocuSign");
  }
});

// 📩 PDF holen + Mail senden
app.get("/done", async (req, res) => {
  try {
    const envelopeId = req.query.envelopeId;
    const name = req.query.name;

    const { accessToken, accountId, baseUri } = await getDocuSignAuth();

    const pdfRes = await axios.get(
      `${baseUri}/restapi/v2.1/accounts/${accountId}/envelopes/${envelopeId}/documents/combined`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        responseType: "arraybuffer"
      }
    );

    await transporter.sendMail({
      from: EMAIL_USER,
      to: "info@amz-dreilaendereck.de",
      subject: `Neuer Auftrag unterschrieben – ${name}`,
      text: "Im Anhang befindet sich das unterschriebene Dokument.",
      attachments: [
        {
          filename: "auftrag.pdf",
          content: pdfRes.data
        }
      ]
    });

    res.send(`
      <h2>Fertig</h2>
      <p>Dokument wurde erfolgreich per Mail gesendet.</p>
      <a href="/">Neuer Auftrag</a>
    `);

  } catch (e) {
    console.error(e.response?.data || e.message);
    res.send("Fehler beim Mailversand");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("läuft"));
