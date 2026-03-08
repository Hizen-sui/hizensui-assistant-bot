/**
 * SearchEngine.js
 * 4ステージセマンティック検索エンジン
 * Stage 1: キーワード検索 (50ms)
 * Stage 2: コンテンツフィルタリング (200ms)
 * Stage 3: LLM再ランキング (2-3s)
 * Stage 4: コンテンツ取得 (可変)
 */

const fs = require('fs');
const path = require('path');

class SearchEngine {
  constructor(indexDir = '../data/indexes') {
    this.indexDir = path.resolve(__dirname, indexDir);
    // Vercel 環境では __dirname から相対的にプロジェクトルートを特定する
    // ローカル環境との互換性のために環境変数 HIZENSUI_BASE_DIR もサポート
    this.baseDir = process.env.HIZENSUI_BASE_DIR || path.resolve(__dirname, '../../');

    // インデックスをメモリに読み込み
    this.loadIndexes();
  }

  loadIndexes() {
    try {
      this.fileCatalog = JSON.parse(
        fs.readFileSync(path.join(this.indexDir, 'file_catalog.json'), 'utf8')
      );
      this.keywordMap = JSON.parse(
        fs.readFileSync(path.join(this.indexDir, 'keyword_mapping.json'), 'utf8')
      );
      this.systemRegistry = JSON.parse(
        fs.readFileSync(path.join(this.indexDir, 'system_registry.json'), 'utf8')
      );
      this.functionIndex = JSON.parse(
        fs.readFileSync(path.join(this.indexDir, 'function_index.json'), 'utf8')
      );
      console.log('✅ インデックス読み込み完了');
    } catch (error) {
      console.error('❌ インデックス読み込みエラー:', error.message);
      this.fileCatalog = { files: [] };
      this.keywordMap = { keywords: {} };
      this.systemRegistry = { systems: {} };
    }
  }

  /**
   * Stage 1: キーワードベースの検索
   */
  keywordSearch(keywords, limit = 30) {
    const results = new Set();

    keywords.forEach(keyword => {
      const matches = this.keywordMap.keywords[keyword] || [];
      matches.slice(0, 10).forEach(filePath => results.add(filePath));
    });

    // ファイル情報を取得
    const fileDetails = Array.from(results)
      .map(filePath => this.fileCatalog.files.find(f => f.path === filePath))
      .filter(f => f !== undefined)
      .slice(0, limit);

    return fileDetails;
  }

  /**
   * Stage 2: コンテンツフィルタリング
   */
  filterByContent(candidates, queryKeywords) {
    const scored = candidates.map(file => {
      let score = 0;

      // ファイルタイプによるスコア
      const typeScore = {
        markdown: 10,
        python: 8,
        json: 5,
        javascript: 5,
        text: 3,
      };
      score += typeScore[file.type] || 0;

      // ファイル名マッチによるスコア
      const fileName = file.name.toLowerCase();
      queryKeywords.forEach(keyword => {
        if (fileName.includes(keyword)) score += 5;
      });

      // キーワードマッチによるスコア
      const fileKeywords = file.keywords || [];
      queryKeywords.forEach(keyword => {
        if (fileKeywords.includes(keyword)) score += 3;
      });

      // 最近更新されたファイルをスコアアップ
      const mtime = new Date(file.modified);
      const daysOld = (new Date() - mtime) / (1000 * 60 * 60 * 24);
      if (daysOld < 30) score += 2;

      return { ...file, score };
    });

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map(({ score, ...file }) => file); // scoreフィールドを削除
  }

  /**
   * Stage 3: LLM再ランキング（Claude Haiku使用）
   * @param {array} candidates 候補ファイル
   * @param {string} query ユーザーの質問
   * @param {object} anthropic Anthropicクライアント
   */
  async rerankWithLLM(candidates, query, anthropic) {
    if (!anthropic || candidates.length === 0) {
      return candidates.slice(0, 3);
    }

    // 候補ファイルのサマリーを生成
    const candidateSummaries = candidates
      .slice(0, 8)
      .map(
        (file, idx) =>
          `${idx + 1}. ${file.path}\n   Type: ${file.type}, Size: ${file.size} bytes\n   Keywords: ${(file.keywords || []).slice(0, 5).join(', ')}`
      )
      .join('\n');

    try {
      const response = await anthropic.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 500,
        system: `あなたはファイルランキング専門家です。与えられた候補ファイルの中から、
ユーザーの質問に最も関連性の高いファイルを特定してください。
ファイルパスのみを行ごとに返してください（説明なし）。`,
        messages: [
          {
            role: 'user',
            content: `ユーザーの質問: "${query}"\n\n候補ファイル:\n${candidateSummaries}\n\nもっとも関連性の高いファイル3つをランク付けして、パスのみ列挙してください。`,
          },
        ],
      });

      // Claude の応答からファイルパスを抽出
      const responseText = response.content[0].text;
      const rankedPaths = responseText
        .split('\n')
        .filter(line => line.trim().length > 0)
        .slice(0, 3)
        .map(line => line.replace(/^\d+\.\s*/, '').trim()); // "1. path/file" → "path/file"

      // ランク付けされたファイルを取得
      const ranked = rankedPaths
        .map(path => candidates.find(f => f.path === path || f.path.endsWith(path)))
        .filter(f => f !== undefined);

      // ランク付け失敗時はトップ3を返す
      return ranked.length > 0 ? ranked : candidates.slice(0, 3);
    } catch (error) {
      console.error('LLM再ランキングエラー:', error.message);
      return candidates.slice(0, 3);
    }
  }

  /**
   * Stage 4: ファイルコンテンツ取得
   */
  getFileContent(filePath, maxSize = 50000) {
    try {
      const fullPath = path.join(this.baseDir, filePath);
      const stat = fs.statSync(fullPath);

      // ファイルサイズチェック
      if (stat.size > maxSize) {
        // 大型ファイルは最初と最後を取得
        const content = fs.readFileSync(fullPath, 'utf8');
        const lines = content.split('\n');
        const headerLines = lines.slice(0, 20).join('\n');
        const footerLines = lines.slice(Math.max(0, lines.length - 10)).join('\n');
        return `${headerLines}\n\n... (省略) ...\n\n${footerLines}`;
      }

      return fs.readFileSync(fullPath, 'utf8');
    } catch (error) {
      return `[ファイル読込エラー: ${error.message}]`;
    }
  }

  /**
   * 統合検索メソッド
   * @param {string} query ユーザーの質問
   * @param {object} anthropic Anthropicクライアント（オプション）
   */
  async search(query, anthropic = null) {
    const startTime = Date.now();

    // Stage 1: キーワード検索
    const keywords = query
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 3);

    const stage1Results = this.keywordSearch(keywords, 30);
    const stage1Time = Date.now() - startTime;

    // Stage 2: フィルタリング
    const stage2Results = this.filterByContent(stage1Results, keywords);
    const stage2Time = Date.now() - startTime;

    // Stage 3: LLM再ランキング
    let finalResults = stage2Results.slice(0, 3);
    const stage3Start = Date.now();
    if (anthropic && stage2Results.length > 0) {
      finalResults = await this.rerankWithLLM(stage2Results, query, anthropic);
    }
    const stage3Time = Date.now() - stage3Start;

    // Stage 4: コンテンツ取得
    const resultsWithContent = finalResults.map(file => ({
      ...file,
      content: this.getFileContent(file.path, 30000),
    }));

    return {
      query,
      results: resultsWithContent,
      stats: {
        stage1Time,
        stage2Time,
        stage3Time,
        totalTime: Date.now() - startTime,
        candidatesFound: stage1Results.length,
        finalResults: resultsWithContent.length,
      },
    };
  }

  /**
   * システム関連ファイルの検索
   */
  searchBySystem(systemName) {
    const system = Object.values(this.systemRegistry.systems).find(
      sys => sys.path && sys.path.toLowerCase().includes(systemName.toLowerCase())
    );

    if (!system) return [];

    return this.fileCatalog.files
      .filter(f => f.path.includes(system.path))
      .slice(0, 10);
  }
}

module.exports = SearchEngine;
