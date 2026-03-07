require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { Anthropic } = require('@anthropic-ai/sdk');

// 環境変数の取得
// 環境変数の取得 (複数の可能性をチェック)
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || process.env.claudeAntholopic_API_Key;
const PORT = process.env.PORT || 3000;

if (!TELEGRAM_TOKEN || !ANTHROPIC_API_KEY) {
  console.error('Error: TELEGRAM_BOT_TOKEN or ANTHROPIC_API_KEY is not defined');
}

// Anthropic クライアントの初期化 (apiKeyが未定義でもインスタンス化自体は行い、使用時にエラーをチェックします)
const anthropic = new Anthropic({
  apiKey: ANTHROPIC_API_KEY || 'MISSING_KEY',
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
  if (!ANTHROPIC_API_KEY || ANTHROPIC_API_KEY === 'MISSING_KEY') {
    return "エラー: Anthropic APIキーが設定されていません。Vercelの環境変数を確認してください。";
  }
  try {
    const response = await anthropic.messages.create({
      model: "claude-3-5-sonnet-20240620",
      max_tokens: 1024,
      system: "あなたは Hizen sui株式会社（肥前翆）のアシスタント AI です。会社は肥前（佐賀）の陶磁器や金継ぎを欧州のラグジュアリー市場へ展開しています。代表は高校時代から環境問題に取り組み、以前は昆虫食事業（iF株式会社）を行っていましたが、現在は伝統工芸の再定義に注力しています。主要な実績として、フォーシーズンズホテル丸の内の『SÉZANNE』との契約があります。",
      messages: [{ role: "user", content: text }],
    });
    return response.content[0].text;
  } catch (error) {
    console.error('Claude API Error:', error);
    // 詳細なエラー内容を返信に含める（デバッグ用）
    const errorDetail = error.response ? JSON.stringify(error.response.data) : error.message;
    return `申し訳ありません。エラーが発生しました。\n詳細: ${errorDetail}`;
  }
}

// Webhook エンドポイント
app.post(`/webhook/${TELEGRAM_TOKEN}`, async (req, res) => {
  const { message } = req.body;

  if (message && message.text) {
    const chatId = message.chat.id;
    let incomingText = message.text;

    console.log(`Received message from ${chatId}: ${incomingText}`);

    // /start の場合は、Claude に「挨拶をして」という文脈で処理させるか、
    // あるいはそのまま Claude に渡します。ここではシンプルにそのまま渡します。
    if (incomingText === '/start') {
      incomingText = "こんにちは。自己紹介をして、何ができるか教えてください。";
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
