// aiService.js
require('dotenv').config();
const { TextAnalyticsClient, AzureKeyCredential } = require("@azure/ai-text-analytics");

const client = new TextAnalyticsClient(
  process.env.AZURE_LANGUAGE_ENDPOINT,
  new AzureKeyCredential(process.env.AZURE_LANGUAGE_KEY)
);

// Extract key phrases
async function extractKeyPhrases(text) {
  const documents = [text];
  const result = await client.extractKeyPhrases(documents);
  return result[0]?.keyPhrases || [];
}

// Recognize entities
async function recognizeEntities(text) {
  const documents = [text];
  const result = await client.recognizeEntities(documents);
  return result[0]?.entities.map(e => ({ text: e.text, category: e.category })) || [];
}

module.exports = { extractKeyPhrases, recognizeEntities };
