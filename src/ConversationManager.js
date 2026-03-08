/**
 * ConversationManager.js
 * マルチターン会話管理・コンテキスト保持
 */

const fs = require('fs');
const path = require('path');

class ConversationManager {
  constructor(dataDir = '../data/conversations') {
    this.dataDir = path.resolve(__dirname, dataDir);
    this.maxTurns = 10; // 最大保持ターン数
    this.maxSize = 1024 * 1024; // 1MB上限

    // ディレクトリ確保
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  getConversationPath(userId) {
    return path.join(this.dataDir, `${userId}.json`);
  }

  /**
   * ユーザーの会話履歴を取得
   */
  getConversation(userId) {
    const filePath = this.getConversationPath(userId);

    if (!fs.existsSync(filePath)) {
      return {
        user_id: userId,
        created_at: new Date().toISOString(),
        last_updated: new Date().toISOString(),
        turns: [],
        metadata: {
          total_turns: 0,
          systems_discussed: [],
          files_accessed: [],
        },
      };
    }

    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
      console.error(`会話読込エラー (${userId}):`, error.message);
      return {
        user_id: userId,
        created_at: new Date().toISOString(),
        last_updated: new Date().toISOString(),
        turns: [],
        metadata: {},
      };
    }
  }

  /**
   * ターンを会話履歴に追加
   */
  addTurn(userId, userMessage, botResponse, context = {}) {
    const conversation = this.getConversation(userId);

    const turn = {
      turn: conversation.turns.length + 1,
      timestamp: new Date().toISOString(),
      user_message: userMessage,
      bot_response: botResponse,
      context: {
        systems: context.systems || [],
        files_referenced: context.filesReferenced || [],
        confidence: context.confidence || 0,
      },
    };

    conversation.turns.push(turn);
    conversation.last_updated = new Date().toISOString();

    // メタデータ更新
    conversation.metadata.total_turns = conversation.turns.length;
    if (context.systems) {
      context.systems.forEach(sys => {
        if (!conversation.metadata.systems_discussed.includes(sys)) {
          conversation.metadata.systems_discussed.push(sys);
        }
      });
    }
    if (context.filesReferenced) {
      context.filesReferenced.forEach(file => {
        if (!conversation.metadata.files_accessed.includes(file)) {
          conversation.metadata.files_accessed.push(file);
        }
      });
    }

    // 最大ターン数を超過したら古いターンを削除
    if (conversation.turns.length > this.maxTurns) {
      conversation.turns = conversation.turns.slice(-this.maxTurns);
    }

    // 保存
    this.saveConversation(userId, conversation);

    return turn;
  }

  /**
   * 会話履歴をファイルに保存
   */
  saveConversation(userId, conversation) {
    const filePath = this.getConversationPath(userId);

    try {
      const data = JSON.stringify(conversation, null, 2);

      // サイズチェック
      if (data.length > this.maxSize) {
        // 古いターンを削除
        conversation.turns = conversation.turns.slice(-3);
        const compactData = JSON.stringify(conversation, null, 2);
        fs.writeFileSync(filePath, compactData);
      } else {
        fs.writeFileSync(filePath, data);
      }
    } catch (error) {
      console.error(`会話保存エラー (${userId}):`, error.message);
    }
  }

  /**
   * 最近のターンをコンテキストとして取得
   */
  getContext(userId, turnCount = 3) {
    const conversation = this.getConversation(userId);
    const recentTurns = conversation.turns.slice(Math.max(0, conversation.turns.length - turnCount));

    return {
      recentTurns,
      focusedSystems: conversation.metadata.systems_discussed || [],
      recentFiles: conversation.metadata.files_accessed.slice(-5) || [],
    };
  }

  /**
   * Claude API 用のプロンプトコンテキストを生成
   */
  buildSystemPrompt(userId) {
    const context = this.getContext(userId, 3);

    let systemPrompt = `あなたは Hizen sui 株式会社（肥前翆）のAIアシスタントです。
会社は肥前（佐賀）の陶磁器や金継ぎを欧州のラグジュアリー市場へ展開しています。`;

    if (context.focusedSystems.length > 0) {
      systemPrompt += `\n\n現在の会話で議論されているシステム: ${context.focusedSystems.join(', ')}`;
    }

    if (context.recentFiles.length > 0) {
      systemPrompt += `\n最近アクセスしたファイル:`;
      context.recentFiles.forEach(file => {
        systemPrompt += `\n  - ${file}`;
      });
    }

    systemPrompt += `\n\n前の会話を踏まえて、継続性を保ちながら回答してください。`;

    return systemPrompt;
  }

  /**
   * 会話コンテキストをメッセージ配列に変換
   */
  buildMessageHistory(userId, newMessage) {
    const context = this.getContext(userId, 2);
    const messages = [];

    // 最近の 2 ターンを履歴として含める
    context.recentTurns.forEach(turn => {
      messages.push({
        role: 'user',
        content: turn.user_message,
      });
      messages.push({
        role: 'assistant',
        content: turn.bot_response,
      });
    });

    // 新しいメッセージを追加
    messages.push({
      role: 'user',
      content: newMessage,
    });

    return messages;
  }

  /**
   * 古い会話を削除（ハウスキーピング）
   */
  cleanup(maxAgeHours = 24) {
    try {
      const files = fs.readdirSync(this.dataDir);

      files.forEach(file => {
        const filePath = path.join(this.dataDir, file);
        const stat = fs.statSync(filePath);
        const ageHours = (new Date() - stat.mtime) / (1000 * 60 * 60);

        // maxAgeHours より古い会話を削除
        if (ageHours > maxAgeHours) {
          try {
            fs.unlinkSync(filePath);
            console.log(`✅ 古い会話を削除: ${file}`);
          } catch (err) {
            console.error(`削除失敗: ${file}`, err.message);
          }
        }
      });
    } catch (error) {
      console.error('クリーンアップエラー:', error.message);
    }
  }

  /**
   * 会話統計
   */
  getStats() {
    try {
      const files = fs.readdirSync(this.dataDir);
      const totalConversations = files.length;
      let totalTurns = 0;
      let totalSize = 0;

      files.forEach(file => {
        const filePath = path.join(this.dataDir, file);
        const content = fs.readFileSync(filePath, 'utf8');
        const conversation = JSON.parse(content);
        totalTurns += conversation.turns.length;
        totalSize += content.length;
      });

      return {
        totalConversations,
        totalTurns,
        totalSize,
        avgTurnsPerConversation: totalConversations > 0 ? totalTurns / totalConversations : 0,
        avgSize: totalConversations > 0 ? totalSize / totalConversations : 0,
      };
    } catch (error) {
      console.error('統計取得エラー:', error.message);
      return null;
    }
  }
}

module.exports = ConversationManager;
