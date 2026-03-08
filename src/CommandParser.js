/**
 * CommandParser.js
 * 自然言語メッセージから意図とキーワードを抽出
 */

class CommandParser {
  constructor() {
    // 認識すべきシステム名
    this.systems = [
      'instagram',
      'notion',
      'google',
      'invoice',
      'telegram',
      'strategy',
      'brain',
      'company',
    ];

    // 認識すべきアクション
    this.actions = [
      'setup',
      'configure',
      'integrate',
      'explain',
      'how',
      'what',
      'find',
      'search',
      'status',
      'analyze',
      'run',
      'execute',
      'query',
      'help',
      'example',
    ];

    // コマンドプリフィックス
    this.commandPrefixes = ['/find', '/status', '/help', '/index_refresh', '/run', '/analyze'];
  }

  /**
   * ユーザーメッセージを解析
   * @param {string} text ユーザーメッセージ
   * @returns {object} 解析結果 {type, systems, actions, keywords, confidence}
   */
  parse(text) {
    const result = {
      type: 'natural_language',
      systems: [],
      actions: [],
      keywords: [],
      confidence: 0.5,
      originalText: text,
    };

    if (!text || text.length === 0) return result;

    // Step 1: 明示的なコマンド判定
    for (const prefix of this.commandPrefixes) {
      if (text.startsWith(prefix)) {
        result.type = 'command';
        const parts = text.substring(prefix.length).trim().split(/\s+/);
        result.command = prefix;
        result.args = parts;
        result.confidence = 0.95;
        return result;
      }
    }

    // Step 2: テキストの正規化
    const normalized = text.toLowerCase();

    // Step 3: システム検出
    const detectedSystems = new Set();
    this.systems.forEach(sys => {
      if (normalized.includes(sys)) {
        detectedSystems.add(sys);
      }
    });
    result.systems = Array.from(detectedSystems);

    // Step 4: アクション検出
    const detectedActions = new Set();
    this.actions.forEach(action => {
      if (normalized.includes(action)) {
        detectedActions.add(action);
      }
    });
    result.actions = Array.from(detectedActions);

    // Step 5: キーワード抽出（アルファベット+数字のみ、3文字以上）
    const words = normalized
      .replace(/[^\w\s]/g, ' ') // 特殊文字を空白に
      .split(/\s+/)
      .filter(
        w =>
          w.length >= 3 &&
          !['the', 'and', 'for', 'with', 'from', 'that', 'this', 'what', 'which', 'how'].includes(w)
      );
    result.keywords = Array.from(new Set(words)).slice(0, 10);

    // Step 6: 信頼度計算
    let confidence = 0.3;
    if (result.systems.length > 0) confidence += 0.3;
    if (result.actions.length > 0) confidence += 0.2;
    if (result.keywords.length > 3) confidence += 0.2;
    result.confidence = Math.min(confidence, 1.0);

    return result;
  }

  /**
   * コマンドが明示的か、自然言語かを判定
   */
  isExplicitCommand(text) {
    return this.commandPrefixes.some(prefix => text.startsWith(prefix));
  }

  /**
   * 質問の性質を判定（定義系、方法系、状態系など）
   */
  getQuestionType(text) {
    const normalized = text.toLowerCase();

    if (/^(what|which|who|why|where)/.test(normalized)) return 'definition';
    if (/^(how|setup|configure|integrate)/.test(normalized)) return 'howto';
    if (/^(status|check|list)/.test(normalized)) return 'status';
    if (/^(explain|describe|tell)/.test(normalized)) return 'explanation';
    if (/\?$/.test(normalized)) return 'question';

    return 'general';
  }
}

module.exports = CommandParser;
