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

// GitHub 設定 (承認連携用)
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO; // "username/repo"

// メッセージ処理エンジン
async function processMessage(text) {
  if (!ANTHROPIC_API_KEY || ANTHROPIC_API_KEY === 'MISSING_KEY') {
    return "エラー: Anthropic APIキーが設定されていません。Vercelの環境変数を確認してください。";
  }
  try {
    const response = await anthropic.messages.create({
      model: "claude-3-5-sonnet-20240620",
      max_tokens: 1024,
      system: "あなたは Hizen sui株式会社（肥前翆）のアシスタント AI です。会社は肥前（佐賀）の陶磁器や金継ぎを欧州のラグジュアリー市場へ展開しています。代表は高校時代から環境問題に取り組みが、現在は伝統工芸の再定義に注力しています。",
      messages: [{ role: "user", content: text }],
    });
    return response.content[0].text;
  } catch (error) {
    console.error('Claude API Error:', error);
    const errorDetail = error.response ? JSON.stringify(error.response.data) : error.message;
    return `申し訳ありません。エラーが発生しました。\n詳細: ${errorDetail}`;
  }
}

// 承認状態を GitHub リポジトリに保存する関数
async function saveApprovalStatus(workflowId, status) {
  if (!GITHUB_TOKEN || !GITHUB_REPO) {
    console.error('GITHUB_TOKEN or GITHUB_REPO is missing');
    return false;
  }

  const path = `data/approvals/${workflowId}.json`;
  const content = Buffer.from(JSON.stringify({
    status: status,
    timestamp: new Date().toISOString()
  })).toString('base64');

  try {
    // 既存のファイルの SHA を取得
    let sha;
    try {
      const getRes = await axios.get(`https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`, {
        headers: { Authorization: `token ${GITHUB_TOKEN}` }
      });
      sha = getRes.data.sha;
    } catch (e) {
      // ファイルが存在しない場合は新規作成
    }

    await axios.put(`https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`, {
      message: `chore: update approval status for ${workflowId} [${status}]`,
      content: content,
      sha: sha
    }, {
      headers: { Authorization: `token ${GITHUB_TOKEN}` }
    });
    return true;
  } catch (error) {
    console.error('GitHub API Error:', error.response ? error.response.data : error.message);
    return false;
  }
}

// Webhook エンドポイント
app.post(`/webhook/${TELEGRAM_TOKEN}`, async (req, res) => {
  const { message, callback_query } = req.body;

  // ボタン押下（Callback Query）の処理
  if (callback_query) {
    const callbackData = callback_query.data; // "approve:wf123" or "reject:wf123"
    const [action, workflowId] = callbackData.split(':');
    const chatId = callback_query.message.chat.id;
    const messageId = callback_query.message.message_id;

    console.log(`Callback received: ${action} for ${workflowId}`);

    const success = await saveApprovalStatus(workflowId, action === 'approve' ? 'approved' : 'rejected');

    const resultText = success
      ? `✅ ${action === 'approve' ? '承認' : '却下'} を受け付けました。`
      : `❌ 通信エラーが発生しました。`;

    // ボタンを消去して結果を表示
    try {
      await axios.post(`${telegramApi}/editMessageText`, {
        chat_id: chatId,
        message_id: messageId,
        text: `${callback_query.message.text}\n\n${resultText}`
      });
    } catch (error) {
      console.error('Telegram Edit Error:', error);
    }

    return res.sendStatus(200);
  }

  if (message && message.text) {
    const chatId = message.chat.id;
    let incomingText = message.text;

    console.log(`Received message from ${chatId}: ${incomingText}`);

    if (incomingText === '/start') {
      incomingText = "こんにちは。自己紹介をして、何ができるか教えてください。";
    }

    const responseText = await processMessage(incomingText);

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
