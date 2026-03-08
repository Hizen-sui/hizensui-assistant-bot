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
const INNOVATOR_TOKEN = process.env.INNOVATOR_BOT_TOKEN;
const PORT = process.env.PORT || 3000;

if (!TELEGRAM_TOKEN) {
  console.error('❌ Error: TELEGRAM_BOT_TOKEN is not defined');
}
if (!ANTHROPIC_API_KEY) {
  console.error('❌ Error: ANTHROPIC_API_KEY is not defined');
}
if (!INNOVATOR_TOKEN) {
  console.warn('⚠️ Warning: INNOVATOR_BOT_TOKEN is not defined in .env');
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

// GitHub 設定 (取得用ヘルパー)
const getGithubConfig = () => ({
  token: process.env.GITHUB_TOKEN,
  repo: process.env.GITHUB_REPO
});

// 新規: メッセージを複数メッセージに分割送信
async function sendSplitMessages(chatId, text, maxLength = 4096, customToken = null) {
  const token = customToken || TELEGRAM_TOKEN;
  const api = `https://api.telegram.org/bot${token}`;

  const messages = [];
  let currentMessage = '';

  // テキストを改行で分割
  const lines = text.split('\n');

  for (const line of lines) {
    if ((currentMessage + '\n' + line).length > maxLength) {
      if (currentMessage) {
        messages.push(currentMessage.trim());
      }
      currentMessage = line;
    } else {
      currentMessage += (currentMessage ? '\n' : '') + line;
    }
  }

  if (currentMessage) {
    messages.push(currentMessage.trim());
  }

  for (const msg of messages) {
    try {
      await axios.post(`${api}/sendMessage`, {
        chat_id: chatId,
        text: msg,
        parse_mode: 'HTML',
      });
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

/**
 * 新規: 破壊的イノベーターボットからのアイデアを保存する
 * @param {string} originalIdea 破壊的イノベーターのテキスト
 * @param {string} userReply ユーザーの返信
 */
async function saveIdeaToNewProjects(originalIdea, userReply) {
  const { token, repo } = getGithubConfig();

  if (!token || !repo) {
    console.error(`[GitHub] Critical error: Missing config. Token: ${!!token}, Repo: ${repo}`);
    return { error: 'config_missing' };
  }

  // アイデア名（コンセプト名）を抽出する試み
  const conceptMatch = originalIdea.match(/⚡️ 破壊的コンセプト名: (.*)/);
  const conceptName = conceptMatch ? conceptMatch[1].trim() : "Untitled Idea";

  // ファイル名の生成 (YYYYMMDD_ConceptName.md)
  const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const fileName = `${dateStr}_${conceptName.replace(/[\/\\?%*:|"<>]/g, '_')}.md`;
  const path = `00_Company/04_new projects/${fileName}`;

  const markdownContent = `# New Project Idea: ${conceptName}

## 💡 User Feedback
${userReply}

## 🌪 Original Disruptive Idea
${originalIdea}

---
*Created via Telegram Reply on ${new Date().toLocaleString('ja-JP')}*
`;

  const base64Content = Buffer.from(markdownContent).toString('base64');
  const apiUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`;

  try {
    // 既存のファイルの SHA を取得（上書き・コンフリクト回避用）
    let sha;
    try {
      const getRes = await axios.get(apiUrl, {
        headers: { Authorization: `token ${GITHUB_TOKEN}` }
      });
      sha = getRes.data.sha;
      console.log(`[GitHub] Existing file found (SHA: ${sha}). Updating...`);
    } catch (e) {
      // 404 なら新規作成なので問題なし
      if (e.response && e.response.status !== 404) {
        console.warn(`[GitHub] Failed to check existing file: ${e.message}`);
      }
    }

    await axios.put(apiUrl, {
      message: `feat: add new project idea from Telegram [${conceptName}]`,
      content: base64Content,
      sha: sha // SHAがあれば更新、なければ新規作成
    }, {
      headers: { Authorization: `token ${GITHUB_TOKEN}` }
    });

    console.log(`✅ Idea saved to GitHub: ${path}`);
    return { fileName };
  } catch (error) {
    const errorMsg = error.response ? JSON.stringify(error.response.data) : error.message;
    console.error('GitHub API Error (saveIdea):', errorMsg);
    return { error: errorMsg };
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

// 新規: 破壊的イノベーターボット専用のWebhookエンドポイント
const FINAL_INNOVATOR_TOKEN = process.env.INNOVATOR_BOT_TOKEN || "8348511739:AAF0xrvgcQ9jhoXjJtM8591uxHZ071Qtckg";

app.post(`/webhook/${FINAL_INNOVATOR_TOKEN}`, async (req, res) => {
  const { message } = req.body;

  try {
    if (message && message.text) {
      const chatId = message.chat.id;
      const incomingText = message.text;

      // 返信かどうかを確認
      if (message.reply_to_message) {
        console.log(`[Innovator] Received reply to an idea: ${incomingText}`);

        const originalIdea = message.reply_to_message.text;
        const result = await saveIdeaToNewProjects(originalIdea, incomingText);

        if (result.fileName) {
          await axios.post(`https://api.telegram.org/bot${FINAL_INNOVATOR_TOKEN}/sendMessage`, {
            chat_id: chatId,
            text: `✅ アイデアを保存しました！\nファイル名: ${result.fileName}\n場所: 00_Company/04_new projects/`,
          });
        } else {
          await axios.post(`https://api.telegram.org/bot${FINAL_INNOVATOR_TOKEN}/sendMessage`, {
            chat_id: chatId,
            text: `❌ 保存に失敗しました。\n原因: ${result.error || '不明なエラー'}\n\nGitHubの権限（GITHUB_TOKEN）またはリポジトリ名（GITHUB_REPO）が正しいか、Vercelの環境変数を確認してください。`,
          });
        }
      } else if (incomingText === '/start') {
        await axios.post(`https://api.telegram.org/bot${FINAL_INNOVATOR_TOKEN}/sendMessage`, {
          chat_id: chatId,
          text: `🌪 **Disruptive Innovator Feedback Collector**\n\n提案されたアイデアに返信（Reply）すると、自動的に「00_Company/04_new projects」フォルダに保存されます。`,
        });
      } else {
        // 通常のメッセージ（返信ではない）
        await axios.post(`https://api.telegram.org/bot${FINAL_INNOVATOR_TOKEN}/sendMessage`, {
          chat_id: chatId,
          text: `👋 アイデアを保存するには、対象のメッセージに対して「返信（Reply）」を行ってください。`,
        });
      }
    }
  } catch (error) {
    console.error('[Innovator] Webhook Error:', error.message);
  }

  // Telegramに常に200を返して再送を防ぐ
  res.sendStatus(200);
});

// 新規: 破壊的イノベーターエージェントのCronジョブエンドポイント
app.get('/api/cron/disruptive-innovator', async (req, res) => {
  try {
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "AIzaSyBBtv3C9e095BJz1qgvytiyB99sxxLGhmg";
    const TARGET_CHAT_ID = process.env.MY_CHAT_ID || "8226465347";
    const CURRENT_INNOVATOR_TOKEN = process.env.INNOVATOR_BOT_TOKEN || "8348511739:AAF0xrvgcQ9jhoXjJtM8591uxHZ071Qtckg";

    const systemPrompt = `あなたはHizen sui EU Strategy Organizationにおける「破壊的イノベーター」です。あなたの最大の使命は、既存のマーケティングや常識の枠組みを破壊し、突拍子もないが本質を突いたアイデアを創出することです。
【思考・行動の絶対ルール】
1. 制約の完全無視: 予算、現在の技術的限界、業界の慣習（伝統やアートの一般的な見せ方）を一切無視してください。
2. 異次元の掛け合わせ: 「金継ぎ（Heritage & Legacy）」の哲学と、完全に対極にある概念（例：量子コンピューティング、デジタル空間のグリッチ、宇宙空間、バイオテクノロジーなど）を強制的に結合させてください。
3. 論理的飛躍の歓迎: 「AだからB」という順当な論理ではなく、「AだからZ」となるような飛躍を提案してください。ただし、Hizen suiの核となる美意識だけは絶対に損なわないこと。
【出力フォーマット】
* ⚡️ 破壊的コンセプト名: （一言で目を引くキャッチコピー）
* 💥 常識の破壊点: （現在のどの前提を、どう壊しているか）
* 🏺 哲学との接続: （一見狂っているが、なぜこれが「金継ぎ」や「記憶の継承」という精神と合致するのか）
* 🚀 具体的なアクション: （明日、CEOが実行すべきクレイジーな第一歩）
×５アイディア`;

    const userPrompt = "本日の破壊的アイデアを5つ提案してください。";

    // Gemini API Request
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent?key=${GEMINI_API_KEY}`;

    const payload = {
      systemInstruction: {
        parts: [{ text: systemPrompt }]
      },
      contents: [{
        role: "user",
        parts: [{ text: userPrompt }]
      }],
      generationConfig: {
        temperature: 0.9,
      }
    };

    const response = await axios.post(geminiUrl, payload, {
      headers: { 'Content-Type': 'application/json' }
    });

    const generatedText = response.data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!generatedText) {
      throw new Error("Failed to generate text from Gemini API.");
    }

    // Wrap with header
    const finalMessage = `🌪 **[毎朝の破壊的イノベーション提案]** 🌪\n\n${generatedText}`;

    // 専用Botを使用して送信
    await sendSplitMessages(TARGET_CHAT_ID, finalMessage, 4096, INNOVATOR_TOKEN);

    res.status(200).json({ success: true, message: "Disruptive Innovator agent executed successfully." });
  } catch (error) {
    console.error('Disruptive Innovator Cron Error:', error.response ? JSON.stringify(error.response.data) : error.message);

    // Attempt fallback or notify user of failure
    try {
      const TARGET_CHAT_ID = process.env.MY_CHAT_ID || "8226465347";
      const CURRENT_INNOVATOR_TOKEN = process.env.INNOVATOR_BOT_TOKEN || "8348511739:AAF0xrvgcQ9jhoXjJtM8591uxHZ071Qtckg";
      await sendSplitMessages(TARGET_CHAT_ID, "⚠️ 破壊的イノベーターエージェントの実行に失敗しました。\n" + error.message, 4096, CURRENT_INNOVATOR_TOKEN);
    } catch (e) {
      console.error('Failed to send error message to Telegram', e);
    }

    res.status(500).json({ success: false, error: error.message });
  }
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
