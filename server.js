const fs = require("fs");
const path = require("path");
const express = require("express");
const { chromium } = require("playwright");
const { Browserbase } = require("@browserbasehq/sdk");
const fetch = require("node-fetch");
require("dotenv").config();

const app = express();
const PORT = 3000;
const CONTEXT_FILE = ".amazon-context-id";
const bb = new Browserbase({ apiKey: process.env.BROWSERBASE_API_KEY });

app.use(express.static(path.join(__dirname, "public")));

async function getOrCreateContext() {
  if (fs.existsSync(CONTEXT_FILE)) {
    const savedId = fs.readFileSync(CONTEXT_FILE, "utf-8").trim();
    console.log("🔁 Reusing context:", savedId);
    return savedId;
  }

  const context = await bb.contexts.create({
    projectId: process.env.BROWSERBASE_PROJECT_ID,
    stealth: true,
  });

  fs.writeFileSync(CONTEXT_FILE, context.id);
  console.log("✅ New context created:", context.id);
  return context.id;
}

async function createSession(contextId) {
  return await bb.sessions.create({
    projectId: process.env.BROWSERBASE_PROJECT_ID,
    browserSettings: {
      context: { id: contextId, persist: true },
      advancedStealth: true,
      fingerprint: {
        devices: ["desktop"],
        locales: ["en-US"],
        operatingSystems: ["windows"],
      },
      viewport: { width: 1366, height: 768 },
    },
  });
}

async function getLiveViewUrl(sessionId) {
  const res = await fetch(`https://www.browserbase.com/v1/sessions/${sessionId}/debug`, {
    headers: { "X-BB-API-Key": process.env.BROWSERBASE_API_KEY },
  });
  const data = await res.json();
  return data.debuggerFullscreenUrl;
}

app.get("/start", async (req, res) => {
  try {
    const contextId = await getOrCreateContext();
    const session = await createSession(contextId);
    const liveUrl = await getLiveViewUrl(session.id);

    const browser = await chromium.connectOverCDP(session.connectUrl);
    const context = browser.contexts()[0];
    const page = context.pages()[0] || await context.newPage();

    await page.goto("https://www.amazon.com/ap/signin", { waitUntil: "load" });
    console.log("🟢 Amazon login page opened.");

    // Watch for redirect to homepage (login success)
    page.waitForURL("https://www.amazon.com/?*", { timeout: 0 }).then(() => {
      console.log("✅ Amazon login complete");
      fetch("http://localhost:3000/close"); // trigger frontend iframe close
    });

    res.json({ liveUrl });
  } catch (err) {
    console.error("❌ Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Signal to close iframe on frontend
let shouldClose = false;
app.get("/close", (req, res) => {
  shouldClose = true;
  res.send("✅ Close triggered");
});

app.get("/status", (req, res) => {
  res.json({ shouldClose });
  if (shouldClose) shouldClose = false; // reset
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
