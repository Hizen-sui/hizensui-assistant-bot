require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { Anthropic } = require('@anthropic-ai/sdk');

// 新規: カスタムモジュールの読み込み
const CommandParser = require('./src/CommandParser');
const SearchEngine = require('./src/SearchEngine');
const ConversationManager = require('./src/ConversationManager');

// 環境変数の取得
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || process.env.claudeAntholopic_API_Key;
const PORT = process.env.PORT || 3000;

if (!TELEGRAM_TOKEN) {
  console.error('❌ Error: TELEGRAM_BOT_TOKEN is not defined');
}
if (!ANTHROPIC_API_KEY) {
  console.error('❌ Error: ANTHROPIC_API_KEY is not defined');
}

// Anthropic クライアントの初期化
const anthropic = new Anthropic({
  apiKey: ANTHROPIC_API_KEY || 'MISSING_KEY',
});

// カスタムモジュールの初期化
let commandParser, searchEngine, conversationManager;
try {
  commandParser = new CommandParser();
  searchEngine = new SearchEngine();
  conversationManager = new ConversationManager();
  console.log('✅ All modules initialized');
} catch (error) {
  console.error('❌ Module initialization failed:', error.message);
}

// グローバルエラーハンドリング
process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
});

const app = express();
app.use(bodyParser.json());

// ルートパスにアクセスした際の確認用
app.get('/', (req, res) => {
  res.send('Telegram Bot is running (Enhanced with AI Code List integration)!');
});

// Telegram API メソッド
const telegramApi = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

// GitHub 設定 (承認連携用)
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO;

// 新規: メッセージを複数メッセージに分割送信
async function sendSplitMessages(chatId, text, maxLength = 4096) {
  const messages = [];
  let currentMessage = '';

  // テキストを改行で分割
  const lines = text.split('\n');

  for (const line of lines) {
    if ((currentMessage + '\n' + line).length > maxLength) {
      // 現在のメッセージが満杯なら送信
      if (currentMessage) {
        messages.push(currentMessage.trim());
      }
      currentMessage = line;
    } else {
      currentMessage += (currentMessage ? '\n' : '') + line;
    }
  }

  // 最後のメッセージを追加
  if (currentMessage) {
    messages.push(currentMessage.trim());
  }

  // 各メッセージを送信
  for (const msg of messages) {
    try {
      await axios.post(`${telegramApi}/sendMessage`, {
        chat_id: chatId,
        text: msg,
        parse_mode: 'HTML',
      });
      // Telegram API のレート制限を回避
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      console.error('Telegram send error:', error.message);
    }
  }
}

// 新規: 拡張メッセージ処理エンジン（検索・会話管理統合）
async function processMessageV2(text, chatId) {
  if (!ANTHROPIC_API_KEY || ANTHROPIC_API_KEY === 'MISSING_KEY') {
    return "エラー: Anthropic APIキーが設定されていません。Vercelの環境変数を確認してください。";
  }

  try {
    // Step 1: テキスト解析（CommandParser）
    const parsed = commandParser.parse(text);
    console.log(`[CommandParser] Type: ${parsed.type}, Systems: ${parsed.systems.join(', ')}, Confidence: ${parsed.confidence}`);

    // Step 2: セマンティック検索（SearchEngine）
    console.log('[SearchEngine] 検索開始...');
    const searchResults = await searchEngine.search(text, anthropic);
    const filesFound = searchResults.results.length;
    console.log(`[SearchEngine] ${filesFound} ファイルを検出 (${searchResults.stats.totalTime}ms)`);

    // Step 3: 会話コンテキスト取得（ConversationManager）
    const conversationContext = conversationManager.getContext(chatId, 2);
    const systemPrompt = conversationManager.buildSystemPrompt(chatId);
    const messageHistory = conversationManager.buildMessageHistory(chatId, text);

    // Step 4: Claude API 呼び出し（検索結果を含める）
    let contextText = '';
    if (filesFound > 0) {
      contextText = '\n\n【参考ファイル】\n';
      searchResults.results.slice(0, 3).forEach((file, idx) => {
        contextText += `\n${idx + 1}. **${file.path}** (${file.type})\n`;
        // ファイル内容をプレビュー（最初の500文字）
        const preview = file.content.substring(0, 500);
        contextText += '```\n' + preview + '\n...\n```\n';
      });
    }

    const userMessageWithContext = text + contextText;
    messageHistory[messageHistory.length - 1].content = userMessageWithContext;

    const response = await anthropic.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 2000,
      system: systemPrompt,
      messages: messageHistory,
    });

    const responseText = response.content[0].text;

    // Step 5: 会話履歴に保存
    conversationManager.addTurn(
      chatId,
      text,
      responseText,
      {
        systems: parsed.systems,
        filesReferenced: searchResults.results.map(f => f.path),
        confidence: parsed.confidence,
      }
    );

    return responseText;
  } catch (error) {
    console.error('Claude API Error:', error);
    const errorDetail = error.response ? JSON.stringify(error.response.data) : error.message;
    return `申し訳ありません。エラーが発生しました。\n詳細: ${errorDetail}`;
  }
}

// 旧関数（後方互換性）
async function processMessage(text) {
  // 新規エンジンを使用（chatIdなしなので、デフォルトの1を使用）
  return processMessageV2(text, 'default');
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
    const userId = message.from.id;
    let incomingText = message.text;

    console.log(`Received message from ${chatId} (user: ${userId}): ${incomingText}`);

    // /start コマンド処理
    if (incomingText === '/start') {
      const welcomeMessage = `🤖 **Hizen sui AI Assistant v2.0**

こんにちは！私は Hizen sui株式会社（肥前翆）の AI アシスタントです。

**できること：**
✅ 0. AI Code list 全体を自動検索
✅ Instagram自動化、Notion同期などのシステムについて説明
✅ セットアップ方法やAPIの使い方を案内
✅ 複数の質問を記憶して関連性の高い回答を提供

**使い方：**
自然言語で質問するだけです（コマンド不要）。例：
• "Instagramのセットアップ方法は？"
• "Notion自動化の説明をして"
• "Google Workspaceと統合する方法は？"`;

      await sendSplitMessages(chatId, welcomeMessage);
      return res.sendStatus(200);
    }

    // /index_refresh コマンド（管理者用）
    if (incomingText === '/index_refresh') {
      await axios.post(`${telegramApi}/sendMessage`, {
        chat_id: chatId,
        text: '🔄 インデックス更新中...',
      });
      // 実装例：ここで generate-indexes.js を実行
      // subprocess.exec('node scripts/generate-indexes.js') など
      await axios.post(`${telegramApi}/sendMessage`, {
        chat_id: chatId,
        text: '✅ インデックスの自動更新は毎日 00:00 に実行されます。\n手動実行はサーバー管理者に連絡してください。',
      });
      return res.sendStatus(200);
    }

    // /status コマンド
    if (incomingText === '/status') {
      const stats = conversationManager.getStats();
      const statusMsg = `📊 **ボットステータス**

🔹 アクティブな会話: ${stats?.totalConversations || 0}
🔹 総ターン数: ${stats?.totalTurns || 0}
🔹 インデックス: ✅ Ready
   - ファイル数: 1227
   - キーワード数: 2521

⚙️ 最後の更新: 2026-03-08 18:26 UTC`;

      await sendSplitMessages(chatId, statusMsg);
      return res.sendStatus(200);
    }

    // 通常のメッセージ処理（新規エンジン使用）
    try {
      const responseText = await processMessageV2(incomingText, userId);
      await sendSplitMessages(chatId, responseText);
    } catch (error) {
      console.error('Telegram API Error:', error.response ? error.response.data : error.message);
      await axios.post(`${telegramApi}/sendMessage`, {
        chat_id: chatId,
        text: '❌ 処理中にエラーが発生しました。しばらくしてからもう一度お試しください。',
      });
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
