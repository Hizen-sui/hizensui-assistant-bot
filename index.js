require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { Anthropic } = require('@anthropic-ai/sdk');

// 環境変数の取得
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const PORT = process.env.PORT || 3000;

if (!TELEGRAM_TOKEN || !ANTHROPIC_API_KEY) {
  console.error('Error: TELEGRAM_BOT_TOKEN or ANTHROPIC_API_KEY is not defined');
}

// Anthropic クライアントの初期化
const anthropic = new Anthropic({
  apiKey: ANTHROPIC_API_KEY,
});

const app = express();
app.use(bodyParser.json());

// ルートパスにアクセスした際の確認用
app.get('/', (req, res) => {
  res.send('Telegram Bot is running!');
});

// Telegram API メソッド
const telegramApi = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

// メッセージ処理エンジン
async function processMessage(text) {
  try {
    const response = await anthropic.messages.create({
      model: "claude-3-5-sonnet-20240620",
      max_tokens: 1024,
      messages: [{ role: "user", content: text }],
    });
    return response.content[0].text;
  } catch (error) {
    console.error('Claude API Error:', error);
    return "申し訳ありません。メッセージの処理中にエラーが発生しました。";
  }
}

// Webhook エンドポイント
app.post(`/webhook/${TELEGRAM_TOKEN}`, async (req, res) => {
  const { message } = req.body;

  if (message && message.text) {
    const chatId = message.chat.id;
    const incomingText = message.text;

    console.log(`Received message from ${chatId}: ${incomingText}`);

    // コマンドの処理 (簡易版)
    if (incomingText === '/start') {
      await axios.post(`${telegramApi}/sendMessage`, {
        chat_id: chatId,
        text: "こんにちは！Claude 搭載のアシスタントボットです。メッセージを送ってください。"
      });
      return res.sendStatus(200);
    }

    // Claude でメッセージを処理
    const responseText = await processMessage(incomingText);

    // Telegram に返信を送信
    try {
      await axios.post(`${telegramApi}/sendMessage`, {
        chat_id: chatId,
        text: responseText
      });
    } catch (error) {
      console.error('Telegram API Error:', error.response ? error.response.data : error.message);
    }
  }

  res.sendStatus(200);
});

// サーバーの起動 (ローカル実行時のみ)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Webhook endpoint: /webhook/${TELEGRAM_TOKEN}`);
  });
}

// Vercel 用に app をエクスポート
module.exports = app;
