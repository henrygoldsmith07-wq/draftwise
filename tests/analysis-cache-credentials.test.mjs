import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const analysisHookUrl = new URL("../hooks/useAnalysis.ts", import.meta.url);

test("AI analysis cache is invalidated when provider or classifier credentials change", async () => {
  const source = await readFile(analysisHookUrl, "utf8");
  assert.match(source, /credentialIdentity = useRef\(\{ providerApiKey: settings\.apiKey, classifierApiKey: classifier\?\.apiKey \?\? "" \}\)/u);
  assert.match(source, /credentialIdentity\.current\.providerApiKey !== nextCredentialIdentity\.providerApiKey/u);
  assert.match(source, /credentialIdentity\.current\.classifierApiKey !== nextCredentialIdentity\.classifierApiKey/u);
  assert.match(source, /if \(credentialsChanged\) \{[\s\S]*?cache\.current\.clear\(\);[\s\S]*?credentialIdentity\.current = nextCredentialIdentity;/u);
});

test("credential cache invalidation happens before cloud eligibility and cache lookup", async () => {
  const source = await readFile(analysisHookUrl, "utf8");
  const clearIndex = source.indexOf("if (credentialsChanged)");
  const eligibilityIndex = source.indexOf("if (!aiEnabled || !settings.apiKey.trim()");
  const lookupIndex = source.indexOf("const cached = cache.current.get(cacheKey)");
  assert.ok(clearIndex >= 0);
  assert.ok(eligibilityIndex > clearIndex);
  assert.ok(lookupIndex > eligibilityIndex);
});
