#!/usr/bin/env node
/**
 * Index Generation Script
 * スキャン対象: /Users/eguchigaijou/0. AI Code list (全フォルダ)
 * 生成ファイル: data/indexes/*.json
 * 実行: node scripts/generate-indexes.js
 */

const fs = require('fs');
const path = require('path');

const BASE_DIR = '/Users/eguchigaijou/0. AI Code list';
const OUTPUT_DIR = path.join(__dirname, '../data/indexes');

// システムレジストリ（事前定義）
const SYSTEMS = {
  'eu-strategy-agents': {
    name: 'Instagram自動化 + エージェント組織',
    description: 'Instagramの成長戦略自動化、トレンド分析、エージェント実行',
    path: '01_Systems/eu-strategy-agents',
    key_features: ['Instagram automation', 'Agent organization', 'MCP integration', 'Trend analysis'],
  },
  'hizensui-assistant-bot': {
    name: 'Telegramボット',
    description: 'Claude APIと統合したTelegramチャットボット、承認ワークフロー',
    path: '01_Systems/hizensui-assistant-bot',
    key_features: ['Telegram integration', 'Claude API', 'Webhook handling'],
  },
  'notion-automation': {
    name: 'Notion自動同期',
    description: 'Notion DBをGit Markdownに自動同期',
    path: '01_Systems/notion automation',
    key_features: ['Notion API', 'Git sync', 'Markdown export'],
  },
  'google-automation': {
    name: 'Google Workspace統合',
    description: 'Gmail、Google Drive、Google Sheetsの自動化CLI',
    path: '01_Systems/Google automation',
    key_features: ['Gmail automation', 'Google Drive', 'Google Sheets', 'OAuth2'],
  },
  'invoice-downloader': {
    name: '請求書自動ダウンロード',
    description: 'GmailとGoogleドライブから請求書を自動収集',
    path: '01_Systems/invoice-downloader',
    key_features: ['Email automation', 'Invoice collection', 'Browser automation'],
  },
  'company-info': {
    name: '企業情報',
    description: 'Hizen sui 企業情報、戦略、ブランドアイデンティティ',
    path: '00_Company',
    key_features: ['Company strategy', 'Brand identity', 'Financial info'],
  },
};

// 除外パターン
const EXCLUDE_PATTERNS = [
  /node_modules/,
  /\.git/,
  /\.DS_Store/,
  /__pycache__/,
  /\.pytest_cache/,
  /\.vercel/,
  /dist$/,
  /build$/,
];

function shouldExclude(filePath) {
  return EXCLUDE_PATTERNS.some(pattern => pattern.test(filePath));
}

function getFileType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const typeMap = {
    '.py': 'python',
    '.js': 'javascript',
    '.ts': 'typescript',
    '.json': 'json',
    '.md': 'markdown',
    '.txt': 'text',
    '.go': 'go',
    '.sh': 'shell',
    '.yml': 'yaml',
    '.yaml': 'yaml',
    '.pdf': 'pdf',
    '.png': 'image',
    '.jpg': 'image',
    '.jpeg': 'image',
    '.gif': 'image',
  };
  return typeMap[ext] || 'other';
}

function isSourceFile(fileType) {
  return ['python', 'javascript', 'typescript', 'json', 'markdown', 'go', 'shell'].includes(fileType);
}

function extractKeywords(filePath, content = '') {
  const keywords = new Set();
  const fileName = path.basename(filePath).toLowerCase();
  const dirPath = path.dirname(filePath).toLowerCase();

  // File name keywords
  fileName.split(/[_.-]/).forEach(word => {
    if (word.length > 2) keywords.add(word);
  });

  // Directory path keywords
  dirPath.split(/[/\\]/).forEach(word => {
    if (word.length > 2) keywords.add(word);
  });

  // Content keywords (first 500 chars)
  if (content && content.length > 0) {
    const preview = content.substring(0, 500).toLowerCase();
    // Extract words starting with letters, length > 2
    const words = preview.match(/\b[a-z][a-z0-9]*\b/g) || [];
    words.slice(0, 20).forEach(word => {
      if (word.length > 2 && !['the', 'and', 'for', 'with', 'from'].includes(word)) {
        keywords.add(word);
      }
    });
  }

  return Array.from(keywords);
}

function scanDirectory(dir) {
  const catalog = [];
  const keywordMap = {};

  console.log(`📁 スキャン開始: ${dir}`);

  function walk(currentPath, relativePrefix = '') {
    try {
      const items = fs.readdirSync(currentPath);
      items.forEach(item => {
        const itemPath = path.join(currentPath, item);
        const relPath = path.join(relativePrefix, item);

        if (shouldExclude(relPath)) return;

        try {
          const stat = fs.statSync(itemPath);

          if (stat.isDirectory()) {
            // 再帰的に掘り下げる
            walk(itemPath, relPath);
          } else if (stat.isFile()) {
            const fileType = getFileType(itemPath);
            let content = '';
            let lineCount = 0;

            // ソースファイルなら最初の100行を読み込み
            if (isSourceFile(fileType) && stat.size < 500000) {
              try {
                const fullContent = fs.readFileSync(itemPath, 'utf8');
                const lines = fullContent.split('\n');
                lineCount = lines.length;
                content = lines.slice(0, 100).join('\n');
              } catch (e) {
                // 読込失敗は無視
              }
            }

            const fileEntry = {
              path: relPath,
              name: path.basename(relPath),
              type: fileType,
              size: stat.size,
              modified: stat.mtime.toISOString(),
              lines: lineCount,
            };

            // キーワード抽出
            const keywords = extractKeywords(relPath, content);
            fileEntry.keywords = keywords;

            // キーワードマップに追加
            keywords.forEach(keyword => {
              if (!keywordMap[keyword]) keywordMap[keyword] = [];
              keywordMap[keyword].push(relPath);
            });

            catalog.push(fileEntry);
          }
        } catch (err) {
          // ファイルアクセス失敗は無視
        }
      });
    } catch (err) {
      // ディレクトリアクセス失敗は無視
    }
  }

  walk(dir, '');
  return { catalog, keywordMap };
}

function generateIndexes() {
  console.log('🔍 インデックス生成開始...\n');

  // Step 1: ファイルスキャン
  const { catalog, keywordMap } = scanDirectory(BASE_DIR);
  console.log(`✅ スキャン完了: ${catalog.length} ファイル検出\n`);

  // Step 2: file_catalog.json
  const fileCatalog = {
    generated: new Date().toISOString(),
    totalFiles: catalog.length,
    files: catalog.sort((a, b) => a.path.localeCompare(b.path)),
  };

  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'file_catalog.json'),
    JSON.stringify(fileCatalog, null, 2)
  );
  console.log('✅ file_catalog.json 生成完了');

  // Step 3: system_registry.json
  const systemRegistry = {
    generated: new Date().toISOString(),
    systems: SYSTEMS,
  };

  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'system_registry.json'),
    JSON.stringify(systemRegistry, null, 2)
  );
  console.log('✅ system_registry.json 生成完了');

  // Step 4: keyword_mapping.json (最大5000キーワード)
  const sortedKeywords = Object.entries(keywordMap)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 5000)
    .reduce((acc, [key, val]) => {
      acc[key] = val.slice(0, 20); // ファイル参照は最大20件
      return acc;
    }, {});

  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'keyword_mapping.json'),
    JSON.stringify(
      {
        generated: new Date().toISOString(),
        totalKeywords: Object.keys(sortedKeywords).length,
        keywords: sortedKeywords,
      },
      null,
      2
    )
  );
  console.log(`✅ keyword_mapping.json 生成完了 (${Object.keys(sortedKeywords).length} キーワード)`);

  // Step 5: function_index.json (Python/JavaScript関数・クラス抽出)
  const functionIndex = {
    generated: new Date().toISOString(),
    functions: {},
  };

  catalog.forEach(file => {
    if (['python', 'javascript', 'typescript'].includes(file.type)) {
      const filePath = path.join(BASE_DIR, file.path);
      try {
        const content = fs.readFileSync(filePath, 'utf8').split('\n').slice(0, 200).join('\n');

        // Python functions/classes
        if (file.type === 'python') {
          const funcMatches = content.match(/^def\s+(\w+)/gm) || [];
          const classMatches = content.match(/^class\s+(\w+)/gm) || [];
          if (funcMatches.length > 0 || classMatches.length > 0) {
            functionIndex.functions[file.path] = {
              type: file.type,
              functions: funcMatches.map(m => m.replace(/^def\s+/, '')),
              classes: classMatches.map(m => m.replace(/^class\s+/, '')),
            };
          }
        }

        // JavaScript functions/exports
        if (['javascript', 'typescript'].includes(file.type)) {
          const exportMatches = content.match(/export\s+(function|class|const)\s+(\w+)/gm) || [];
          const funcMatches = content.match(/^\s*function\s+(\w+)/gm) || [];
          if (exportMatches.length > 0 || funcMatches.length > 0) {
            functionIndex.functions[file.path] = {
              type: file.type,
              exports: exportMatches.map(m => m.replace(/export\s+(function|class|const)\s+/, '')),
              functions: funcMatches.map(m => m.replace(/^\s*function\s+/, '')),
            };
          }
        }
      } catch (e) {
        // 解析失敗は無視
      }
    }
  });

  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'function_index.json'),
    JSON.stringify(functionIndex, null, 2)
  );
  console.log(`✅ function_index.json 生成完了`);

  // Step 6: api_endpoints.json (CLI commands, routes等)
  const apiIndex = {
    generated: new Date().toISOString(),
    routes: [],
    commands: [],
  };

  // Telegramボットのエンドポイント検出
  const botFile = catalog.find(f => f.path.includes('hizensui-assistant-bot/index.js'));
  if (botFile) {
    try {
      const content = fs.readFileSync(path.join(BASE_DIR, botFile.path), 'utf8');
      const routeMatches = content.match(/app\.(get|post|put|delete)\s*\(\s*['"]([^'"]+)['"]/g) || [];
      routeMatches.forEach(match => {
        const parts = match.match(/(get|post|put|delete)\s*\(\s*['"]([^'"]+)['"]/);
        if (parts) {
          apiIndex.routes.push({
            method: parts[1].toUpperCase(),
            path: parts[2],
            file: 'hizensui-assistant-bot/index.js',
          });
        }
      });
    } catch (e) {
      // 解析失敗は無視
    }
  }

  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'api_endpoints.json'),
    JSON.stringify(apiIndex, null, 2)
  );
  console.log(`✅ api_endpoints.json 生成完了`);

  // Summary
  console.log('\n📊 インデックス生成サマリー:');
  console.log(`  総ファイル数: ${catalog.length}`);
  console.log(`  総キーワード数: ${Object.keys(sortedKeywords).length}`);
  console.log(`  生成ファイル: 5個 (data/indexes/)`);
  console.log(`\n✨ インデックス生成完了！\n`);
}

// 実行
try {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  generateIndexes();
  process.exit(0);
} catch (error) {
  console.error('❌ エラー:', error.message);
  process.exit(1);
}
